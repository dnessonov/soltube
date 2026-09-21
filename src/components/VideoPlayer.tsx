"use client";

import React, { useState } from 'react';
import {
    readSolanaVideoAccount,
    readSolanaVideoStorageAccount,
    SolanaVideoAccount, SolanaVideoStorageAccount,
    VideoAccountStorageParam
} from "../index.js";
import {SolanaClient} from "@solana/client";

interface VideoPlayerProps {
    solanaVideoAddress?: string,
    solanaClient: SolanaClient,
    src?: string; // Your .fmp4
    moofIndexSrc?: string;
}

interface VideoPlayerLoadedSolanaStorage {
    storage: VideoAccountStorageParam;
    abortCtrl :AbortController | null;

    data: SolanaVideoStorageAccount | null;
}

interface VideoDataSource {
    type:
        "data" // actual video data
      | "midx" // moofs index
      | "mcs", // checksums for the actual data

    url: string
    ranges: number[][] | null
}

export const VIDEO_OPENING_STATE_NOT_OPEN = 0;
export const VIDEO_OPENING_STATE_READING_SOLANA_VIDEO_ACCOUNT = 1;
export const VIDEO_OPENING_STATE_RETRIEVING_MOOF_INDEX = 2;

export const VIDEO_OPENING_STATE_CHECKING_MOOF_INDEX = 3;
export const VIDEO_OPENING_STATE_MOOF_INDEX_RECEIVED = 4;
export const VIDEO_OPENING_STATE_MOOF_INDEX_LOADED = 5;

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ solanaVideoAddress, solanaClient, src, moofIndexSrc}) => {
    const videoRef = React.useRef<HTMLVideoElement | null>(null);
    const mediaSourceRef = React.useRef<MediaSource | null>(null);
    const sourceBufferRef = React.useRef<SourceBuffer | null>(null);

    // const sourceBufferMoofsRef = React.useRef<number[][] | null>([[0,1333],[40,647958],[63,959320],[92,1407296],[132,1975391],[156,2263568],[185,2724990],[225,3262232],[258,3735382],[287,4157310]]);

    const videoSolStoragesRef = React.useRef<VideoPlayerLoadedSolanaStorage[] | null>(null);

    const videoOpeningState = React.useRef<number>(VIDEO_OPENING_STATE_NOT_OPEN);
    const moofIndexRetievalAbortController = React.useRef<AbortController | null>(null);

    const dataSourcesRef = React.useRef<VideoDataSource[]>([]);

    const sourceBufferMoofsRef = React.useRef<number[][] | null>(null);
    const currentlyDownloadingMoofIndex = React.useRef<number | null | undefined>(undefined);
    const nextDownloadingMoofIndex = React.useRef<number | null>(null);
    const currentPositionTimeUnitsBeforeWorryAboutNextInterval = React.useRef<number | null | undefined>(undefined);
    const currentPositionRemoveTimeRangesAround = React.useRef<number | null>(1200); // in timeunits (1/2 of a sec.) will remove intervals around cursor to prevent overloading SourceBuffer
    const currentPositionTimeUnits = React.useRef<number | null>(null);
    const addedMoofs = React.useRef<Set<number>>(new Set());

    const sb_video_resolution_h = React.useRef<number|null>(null);
    const sb_video_resolution_w = React.useRef<number|null>(null);
    const sb_audio_sample_rate = React.useRef<number|null>(null);
    const sb_audio_channels = React.useRef<number|null>(null);
    const sb_bit_rate = React.useRef<number|null>(null);
    const sb_video_stream_i = React.useRef<number|null>(null);
    const sb_audio_stream_i = React.useRef<number|null>(null);
    const sb_duration = React.useRef<number|null>(null);
    const sb_codec_str = React.useRef<string|null>(null);

    const currentByteRef = React.useRef<number>(0);
    const isAppendingRef = React.useRef<boolean>(false);
    const isSeekingRef = React.useRef<boolean>(false);

    React.useEffect(() => {
        const videoElement = videoRef.current;
        if (!videoElement) return;

        const mediaSource = new MediaSource();
        mediaSourceRef.current = mediaSource;
        videoElement.src = URL.createObjectURL(mediaSource);

        // console.log("w1",mediaSource.readyState);

        const onSourceOpen = async () => {
            console.log('The mediaSource is open and ready to receive a sourceBuffer');
            // The mediaSource is open and ready to receive a sourceBuffer

            // await fetchMoofIndex();
            const open_result = await openDecentralizedVideo();
            if (open_result) {
                const mimeCodecStr = `video/mp4; codecs="${sb_codec_str.current}"`;

                if (!MediaSource.isTypeSupported(mimeCodecStr)) {
                    console.error("The specified codec string is not supported by this browser.");
                    return;
                }

                console.log('hyrray!');


                currentPositionTimeUnitsBeforeWorryAboutNextInterval.current = 16; // 8 seconds before next fragment will start loading

                // mediaSource.duration = duration === undefined ? 0 : duration; // seconds
                mediaSource.duration = sb_duration.current === null ? 0 : sb_duration.current / 1000;

                const bufferVideo = mediaSource.addSourceBuffer(mimeCodecStr);
                sourceBufferRef.current = bufferVideo;
                // bufferVideo.appendBuffer(buf);

                bufferVideo.addEventListener('updateend', () => {
                    //console.log("updateend CB CP initial");
                    isAppendingRef.current = false;
                    if (isSeekingRef.current) {
                        isSeekingRef.current = false;
                        return;
                    }
                    if (nextDownloadingMoofIndex.current !== null) {
                        fetchNextSequentialChunk(nextDownloadingMoofIndex.current);
                    }
                });
                currentPositionTimeUnits.current = 0;
                addedMoofs.current.clear();
                fetchNextSequentialChunk(null);
            }
        };

        mediaSource.addEventListener('sourceopen', onSourceOpen);

        return () => {

            if (moofIndexRetievalAbortController.current !== null){
                moofIndexRetievalAbortController.current.abort();
            }

            mediaSource.removeEventListener('sourceopen', onSourceOpen);
            if(mediaSource.readyState === 'open'){
                mediaSource.endOfStream();
            }

        }
    }, [src]);

    const addSources = async (sourcesData :any[]) => {

    }

    const openDecentralizedVideo = async() => {

        let return_value = null;

        if(videoOpeningState.current === VIDEO_OPENING_STATE_NOT_OPEN){
            videoSolStoragesRef.current = [];
            videoOpeningState.current = VIDEO_OPENING_STATE_READING_SOLANA_VIDEO_ACCOUNT;
            if((typeof solanaVideoAddress === "string") && ((videoSolStoragesRef.current === null) || (videoSolStoragesRef.current.length === 0))) {
                const [abortCtrl, solanaAccountPromise] = readSolanaVideoAccount(solanaClient, solanaVideoAddress);
                moofIndexRetievalAbortController.current = abortCtrl;
                await new Promise<void>((openVideoResolve, openVideoReject) => {
                    solanaAccountPromise.then(async (solVideoAccount: SolanaVideoAccount | null | undefined) => {
                        if (videoOpeningState.current === VIDEO_OPENING_STATE_READING_SOLANA_VIDEO_ACCOUNT) {
                            // console.log("VideoPlayer read solana acct", solVideoAccount);
                            if (solVideoAccount?.storages) {
                                for (let _i_storage = 0; _i_storage < solVideoAccount?.storages.length; _i_storage++) {
                                    // console.log("asking for storage promise for ", solVideoAccount.storages[_i_storage].address.toString());
                                    videoSolStoragesRef.current?.push({
                                        storage: solVideoAccount.storages[_i_storage],
                                        abortCtrl: null,
                                        data: null
                                    });
                                }
                            }

                            videoOpeningState.current = VIDEO_OPENING_STATE_RETRIEVING_MOOF_INDEX;

                            // pick a random solana source that has isAuthenticFlag
                            let authenticSolStorages = videoSolStoragesRef.current?.filter(item => item.storage.isAuthenticFlag());

                            if ((authenticSolStorages === undefined) || (authenticSolStorages.length < 1)) {
                                videoOpeningState.current = VIDEO_OPENING_STATE_NOT_OPEN;
                                console.log("Unable to open Solana Video. Error #001", solanaVideoAddress);
                            } else {
                                let intermediaryState = VIDEO_OPENING_STATE_RETRIEVING_MOOF_INDEX;
                                while ((intermediaryState === VIDEO_OPENING_STATE_RETRIEVING_MOOF_INDEX) && (authenticSolStorages.length > 0)) {
                                    const currentAuthenticStorageIndex = Math.floor(Math.random() * authenticSolStorages.length);
                                    const currentAuthenticStorage = authenticSolStorages.splice(currentAuthenticStorageIndex, 1)[0];

                                    if (currentAuthenticStorage.data === null) {
                                        const [currentAuthenticStorage_abort_ctrl, currentAuthenticStorage_data_promise] = readSolanaVideoStorageAccount(solanaClient, currentAuthenticStorage.storage.address.toString(), solanaVideoAddress);
                                        currentAuthenticStorage.abortCtrl = currentAuthenticStorage_abort_ctrl;
                                        try {
                                            const currentAuthenticStorage_data = await currentAuthenticStorage_data_promise;
                                            if (currentAuthenticStorage_data) {
                                                currentAuthenticStorage.data = currentAuthenticStorage_data;
                                                //console.log("openDecentralizedVideo CP2", currentAuthenticStorage_data);
                                            } else {
                                                //console.log("openDecentralizedVideo CP4", currentAuthenticStorage_data);
                                            }
                                        } catch (currentAuthenticStorage_data_err: any) {
                                            // console.log("openDecentralizedVideo CP3", currentAuthenticStorage.storage.address.toString(), currentAuthenticStorage_data_err);
                                        }
                                    }

                                    if (currentAuthenticStorage.data !== null) {
                                        let videoIndex = undefined;
                                        try {
                                            videoIndex = await currentAuthenticStorage.data.getSubstorageVideoIndex("primary");

                                        } catch (obtainVideoIndexError: any) {
                                            console.log("Error obtaining storage index for . Notice #003. Continuing looking for valid sources.", solanaVideoAddress, obtainVideoIndexError);
                                        }

                                        if ((videoIndex !== undefined) && (videoIndex !== null)) {
                                            const filename = videoIndex?.filename;
                                            if (Array.isArray(filename) && filename.length > 0) {
                                                console.log("filename is ", filename);
                                            } else if (typeof filename === "string") {
                                                const dataFolder = await currentAuthenticStorage.data.getSubstorageConfigFolder("primary", "data");
                                                if (dataFolder === undefined) {
                                                    console.log("Error obtaining storage index for . Notice #006. Unable to locate data folder. Continuing looking for valid sources.", solanaVideoAddress, filename);
                                                } else {
                                                    const midxUrls: string[] = [];
                                                    const srcFilenameFullUrl = dataFolder + "/" + filename + ".src.json";
                                                    const responseSrcData = await fetch(srcFilenameFullUrl, {});
                                                    if (responseSrcData.ok) {
                                                        try {
                                                            let responseSrcDataResponse = await responseSrcData.json();
                                                            if (!Array.isArray(responseSrcDataResponse)) {
                                                                console.log("Error receiving sources for for . Notice #008. Wrong format of sources list. Continuing looking for valid sources.", solanaVideoAddress, filename);
                                                            } else {

                                                                // add sources
                                                                for (const srcElement of responseSrcDataResponse) if (srcElement?.path) {
                                                                    const datumType = srcElement?.type ?? 'data';
                                                                    const datumRanges = srcElement?.ranges ?? null;
                                                                    switch (datumType) {
                                                                        case "midx":
                                                                        case "data":
                                                                        case "mcs": {
                                                                            if (srcElement?.substorages === undefined) {
                                                                                const filenameFullUrl = dataFolder + "/" + srcElement.path;
                                                                                dataSourcesRef.current.push({
                                                                                    url: filenameFullUrl,
                                                                                    type: datumType,
                                                                                    ranges: datumRanges
                                                                                });
                                                                            }else if(Array.isArray(srcElement?.substorages)) {
                                                                                for (const srcMoofIndexElementSubstorage of srcElement?.substorages) {
                                                                                    try {
                                                                                        const substorageDataFolder = await currentAuthenticStorage.data.getSubstorageConfigFolder(srcMoofIndexElementSubstorage, "data");
                                                                                        if (substorageDataFolder !== undefined) {
                                                                                            const filenameFullUrl = substorageDataFolder + "/" + srcElement.path;
                                                                                            dataSourcesRef.current.push({
                                                                                                url: filenameFullUrl,
                                                                                                type: datumType,
                                                                                                ranges: datumRanges
                                                                                            });
                                                                                        }
                                                                                    } catch (srcMoofIndexElementSubstorageParseError: any) {
                                                                                        console.log("Error adding a source. Notice #011. Malformed configuration.", srcMoofIndexElementSubstorageParseError);
                                                                                    }
                                                                                }
                                                                            }
                                                                        } break;
                                                                    }
                                                                }

                                                                const moofIndexSrcEntries = responseSrcDataResponse.filter(item => (item?.type === 'midx'));
                                                                console.log("moofIndexSrcEntries", moofIndexSrcEntries);
                                                                if (moofIndexSrcEntries.length < 1) {
                                                                    console.log("Error receiving sources for for . Notice #009. Requested data is not found. Continuing looking for valid sources.", solanaVideoAddress, filename);
                                                                }
                                                                for (const srcMoofIndexElement of moofIndexSrcEntries) {
                                                                    if (srcMoofIndexElement?.substorages === undefined) {
                                                                        const filenameFullUrl = dataFolder + "/" + srcMoofIndexElement.path;
                                                                        midxUrls.push(filenameFullUrl);
                                                                    } else if (Array.isArray(srcMoofIndexElement?.substorages)) {
                                                                        for (const srcMoofIndexElementSubstorage of srcMoofIndexElement?.substorages) {
                                                                            try {
                                                                                const substorageDataFolder = await currentAuthenticStorage.data.getSubstorageConfigFolder(srcMoofIndexElementSubstorage, "data");
                                                                                if (substorageDataFolder !== undefined) {
                                                                                    const filenameFullUrl = substorageDataFolder + "/" + srcMoofIndexElement.path;
                                                                                    midxUrls.push(filenameFullUrl);
                                                                                }
                                                                            } catch (srcMoofIndexElementSubstorageParseError: any) {
                                                                                console.log("Error adding a source. Notice #010. Malformed configuration.", srcMoofIndexElementSubstorageParseError);
                                                                            }
                                                                        }
                                                                    }
                                                                }
                                                            }
                                                        } catch (responseSrcDataJsonParseError: any) {
                                                            console.log("Error receiving sources for for. Notice #013. Invalid data returned. Continuing looking for valid sources.", solanaVideoAddress, responseSrcDataJsonParseError);
                                                            const filenameFullUrl = dataFolder + "/" + filename + ".midx";
                                                            midxUrls.push(filenameFullUrl);
                                                        }

                                                    } else {
                                                        const filenameFullUrl = dataFolder + "/" + filename + ".midx";
                                                        midxUrls.push(filenameFullUrl);
                                                    }

                                                    for (const filenameMidxFullUrl of midxUrls) {
                                                        const response = await fetch(filenameMidxFullUrl, {});
                                                        if (response.ok) {
                                                            const buffer: Buffer<ArrayBuffer> = Buffer.from(await response.arrayBuffer());
                                                            videoOpeningState.current = VIDEO_OPENING_STATE_MOOF_INDEX_RECEIVED;
                                                            fetchMoofIndex(buffer);
                                                            return_value = true;
                                                            break;
                                                        } else {
                                                            console.log("Error obtaining storage index for . Notice #007. Continuing looking for valid sources as moof index is not fetchable.", solanaVideoAddress, filenameMidxFullUrl);
                                                        }
                                                    }
                                                }
                                            } else if (filename === undefined) {
                                                console.log("Error obtaining storage index for . Notice #004. Continuing looking for valid sources.", solanaVideoAddress);
                                            } else {
                                                console.log("Error obtaining storage index for . Notice #005. Continuing looking for valid sources.", solanaVideoAddress, filename);
                                            }
                                        }
                                    }
                                }

                                if ((authenticSolStorages.length === 0) && (videoOpeningState.current <= VIDEO_OPENING_STATE_RETRIEVING_MOOF_INDEX)) {
                                    videoOpeningState.current = VIDEO_OPENING_STATE_NOT_OPEN;
                                    console.log("Unable to open Solana Video. Error #002", solanaVideoAddress);
                                    return_value = null;
                                }
                            }

                        }
                    }).catch((err: any) => {
                        if (videoOpeningState.current === VIDEO_OPENING_STATE_READING_SOLANA_VIDEO_ACCOUNT) {
                            videoOpeningState.current = VIDEO_OPENING_STATE_NOT_OPEN;
                            // TODO: repeat attempt in 5 - 15 seconds or so
                        }
                    }).finally(() => {
                        moofIndexRetievalAbortController.current = null;
                        openVideoResolve();
                    });
                });
            }else{
                // as a fallback use moofIndexSrc prop
                const response = await fetch(moofIndexSrc ?? '', {});
                const buffer: Buffer<ArrayBuffer> = Buffer.from(await response.arrayBuffer());
                videoOpeningState.current = VIDEO_OPENING_STATE_MOOF_INDEX_RECEIVED;
                fetchMoofIndex(buffer);
                return_value = true;
            }
        }
        console.log("about to return", return_value);
        return return_value;
    }

    const fetchMoofIndex = (buffer: Buffer<ArrayBuffer>) => {

        if (videoOpeningState.current === VIDEO_OPENING_STATE_MOOF_INDEX_RECEIVED) {

            if((typeof solanaVideoAddress === "string") && (videoSolStoragesRef.current === null)) {
                videoSolStoragesRef.current = [];

            }

            if(sourceBufferMoofsRef.current === null){
                sourceBufferMoofsRef.current = [];
            }

            let _offset = 0;

            sb_bit_rate.current = buffer.readUInt32LE(_offset);
            sb_video_stream_i.current = buffer.readUInt8(_offset+4);
            sb_audio_stream_i.current = buffer.readUInt8(_offset+5);
            sb_audio_channels.current = buffer.readUInt8(_offset+6);
            sb_audio_sample_rate.current = buffer.readUInt32LE(_offset+7);
            sb_video_resolution_h.current = buffer.readUInt16LE(_offset+11);
            sb_video_resolution_w.current = buffer.readUInt16LE(_offset+13);
            sb_duration.current = buffer.readUInt32LE(_offset+15);

            const codec_str_len = buffer.readUInt8(_offset+19);
            sb_codec_str.current = "";
            if(codec_str_len > 0){
                sb_codec_str.current += buffer.toString('ascii', 20, 20+codec_str_len);
            }

            _offset +=20 + codec_str_len;

            while(_offset < buffer.byteLength){
                const _timeVal = buffer.readUInt32LE(_offset);
                const _seekVal = buffer.readUInt32LE(_offset + 4);
                _offset+=8;
                sourceBufferMoofsRef.current.push([_timeVal, _seekVal]);
                // console.log('moof data pushed', _timeVal, _seekVal);
            }
            videoOpeningState.current = VIDEO_OPENING_STATE_MOOF_INDEX_LOADED;
        }
    }


    const fetchNextSequentialChunk = async (moofIndex :number | null) => {
        // console.log("moofIndex passed: (CP1)", moofIndex);
        if(!sourceBufferRef.current || !mediaSourceRef.current) return;

        if(isAppendingRef.current) {
            if((moofIndex !== null) && (sourceBufferMoofsRef.current?.[moofIndex] !== undefined)){
                nextDownloadingMoofIndex.current = moofIndex;
            }
            return;
        }

        nextDownloadingMoofIndex.current = null;

        let start, end :number | undefined | null;

        let _moofIndexTo :number;
        if(moofIndex === null) {
            start = 0;
            currentlyDownloadingMoofIndex.current = 0;
            _moofIndexTo = 1;
        }else{
            // console.log("moofIndex passed(CP3):", moofIndex);
            while(addedMoofs.current.has(moofIndex)){
                moofIndex++;
                if((typeof currentPositionTimeUnitsBeforeWorryAboutNextInterval.current === 'number') && (sourceBufferMoofsRef.current?.[moofIndex] !== undefined) && (typeof sourceBufferMoofsRef.current?.[moofIndex][0] === 'number')
                    && (sourceBufferMoofsRef.current?.[moofIndex][0] <= ((currentPositionTimeUnits.current ?? 0) + currentPositionTimeUnitsBeforeWorryAboutNextInterval.current))){
                    //console.log("moofIndex passed(CP4.1):", moofIndex);
                }else{
                    //console.log("moofIndex passed(CP4.2):", moofIndex);
                    return;
                }
                if(moofIndex > ((sourceBufferMoofsRef.current?.length ?? 0) - 1)){
                    //console.log("moofIndex passed(CP4.3):", moofIndex);
                    return; // data is already downloaded
                }
            }
            start = sourceBufferMoofsRef.current?.[moofIndex][1];
            _moofIndexTo = moofIndex + 1;
        }

        isAppendingRef.current = true;
        while(true) {
            end = (sourceBufferMoofsRef.current?.[_moofIndexTo] === undefined) ? undefined :  (sourceBufferMoofsRef.current?.[_moofIndexTo][1] ?? 1) - 1;
            if(end === undefined){
                if(start === 0) { start = null; }
                end = null; // query whole file without http bytes ranges header
                break;
            }else{
                if((sourceBufferMoofsRef.current?.[_moofIndexTo][0] !== undefined) && (typeof currentPositionTimeUnitsBeforeWorryAboutNextInterval.current === 'number')
                    && (sourceBufferMoofsRef.current?.[_moofIndexTo][0] <= ((currentPositionTimeUnits.current ?? 0) + currentPositionTimeUnitsBeforeWorryAboutNextInterval.current))
                    && (!addedMoofs.current.has(_moofIndexTo))){
                    _moofIndexTo++;
                }else{
                    break;
                }
            }
        }

        try {
            const buffer = await retrVideoBuf(moofIndex, _moofIndexTo, start, end);
            if(buffer) {
                sourceBufferRef.current.appendBuffer(buffer);
            }
        } catch (err) {
            console.error("Chunk retrieval failed:", err);
            isAppendingRef.current = false;
        }
    }

    const retrVideoBuf = async (moofFrom :number | null, moofTo :number, brStart :number | null | undefined, brEnd: number | null) => {

        let srcData = dataSourcesRef.current.filter(item => (item.type === 'data') );
        console.log('my sources (data only):', srcData);

        if(srcData.length === 0){
            // TODO: look for more sources
        }else{
            while(srcData.length > 0){
                const randomSrcDataIndex = Math.floor(Math.random() * srcData.length);
                const currentSrcDatum = srcData.splice(randomSrcDataIndex, 1)[0];
                console.log('choosing random index', randomSrcDataIndex, srcData.length, currentSrcDatum.url);
                if(currentSrcDatum?.ranges === null){

                    const use_bytes_header :boolean = ((brStart !== null) && (brStart !== undefined)) || (brEnd !== null && brEnd !== undefined);
                    const endHttpHeaderStr = (brEnd !== null && brEnd !== undefined) ? `${brEnd}` : "";

                    const response = await fetch(currentSrcDatum.url
                        /* src ?? ''*/
                        , { headers: use_bytes_header ? { 'Range': `bytes=${brStart}-${endHttpHeaderStr}` } : {} });

                    if(response.ok){
                        if ((response.status !== 206) && use_bytes_header){
                            console.log("Notice #012. Server must support 206 HTTP Range bytes requests.");
                        }else{

                            const buffer = await response.arrayBuffer();

                            // mark downloaded moofs as received
                            for (let _i = moofFrom ?? 0; _i < (moofTo ?? ((sourceBufferMoofsRef.current?.length ?? 1) - 1)); _i++) {
                                //console.log("addedMoofs push", _i);
                                if (!addedMoofs.current.has(_i)) {
                                    addedMoofs.current.add(_i);
                                }
                            }

                            return buffer;
                        }
                    }else{
                        // TODO: continue looking for sources
                        console.log("Something went wrong", currentSrcDatum.url);
                    }

                }
            }
        }
    }

    const handleSeek = async () => {
        const video = videoRef.current;

        const sb = sourceBufferRef.current;
        if (!video || !sb || sb.updating) return;

        isSeekingRef.current = true;


        const time_marks_units_time = Math.floor(video.currentTime * 2);
        currentPositionTimeUnits.current = time_marks_units_time;

        let _atMoofIndex :number = 0;
        for(let _i=0;_i < (sourceBufferMoofsRef.current?.length ?? 0); _i++ ){
            if(currentPositionTimeUnits.current >= (sourceBufferMoofsRef.current?.[_i][0] ?? 0)){
                _atMoofIndex = _i;
            }else{
                break;
            }
        }

        if(!addedMoofs.current.has(_atMoofIndex)){
            console.log(`seeking at ${video.currentTime} (in units ${time_marks_units_time}) loading chunk ${_atMoofIndex}`);
            fetchNextSequentialChunk(_atMoofIndex);
        }else{
            console.log(`seeking at ${video.currentTime} (in units ${time_marks_units_time}) chunk ${_atMoofIndex} is already loaded.`);
        }
        isSeekingRef.current = false;
    };

    const handleOnStalled = () => {
        console.log("onStalled");
    }

    const handleOnSuspend = () => {
        console.log("onSuspend");
    }

    const handleTimeUpdate = () => {
        currentPositionTimeUnits.current = (videoRef.current?.currentTime ?? 0) * 2;

        let _atMoofIndex :number | null = null;
        for(let _i=0;_i < (sourceBufferMoofsRef.current?.length ?? 0); _i++ ){
            if(currentPositionTimeUnits.current >= (sourceBufferMoofsRef.current?.[_i][0] ?? 0)){
                _atMoofIndex = _i;
            }else{
                break;
            }
        }

        if ( (typeof _atMoofIndex === 'number')
            && (typeof sourceBufferMoofsRef.current?.length === 'number')
            && (typeof currentPositionTimeUnits.current === 'number')
            && (_atMoofIndex < (sourceBufferMoofsRef.current?.length - 1))
            && (sourceBufferMoofsRef.current?.[_atMoofIndex+1] !== undefined)
            && ( currentPositionTimeUnits.current + ( currentPositionTimeUnitsBeforeWorryAboutNextInterval.current ?? 2) >
                (sourceBufferMoofsRef.current?.[_atMoofIndex+1][0] ?? 0) ) ) {

            // console.log("About to fetch", _atMoofIndex+1);
            if(typeof _atMoofIndex === 'number'){
                if(!isAppendingRef.current && !addedMoofs.current.has(_atMoofIndex + 1)) {
                    //console.log("About to fetch", _atMoofIndex+1);
                    fetchNextSequentialChunk(_atMoofIndex + 1);
                }
            }
        }

        if(currentPositionRemoveTimeRangesAround.current !== null){
            // TODO: sourceBuffer.remove everything outside (cursor-currentPositionRemoveTimeRangesAround.current; cursor+currentPositionRemoveTimeRangesAround.current)
            // TODO: update addedMoofs too by removing respective moofs
            // TODO: call this periodically, not more often than once in a minute, two minutes or so when video is playing (not paused)
        }
    }

    return (
        <>
            <video
                ref={videoRef}
                controls
                onSeeking={handleSeek}
                onStalled={handleOnStalled}
                onSuspend={handleOnSuspend}
                onTimeUpdate={handleTimeUpdate}
                style={{ width: '100%', maxWidth: '800px' }}
            />
        </>
    )
}
