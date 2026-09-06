"use client";

import React, { useState } from 'react';
import {readSolanaVideoAccount, SolanaVideoAccount} from "../index.js";
import {SolanaClient} from "@solana/client";

interface VideoPlayerProps {
    solanaVideoAddress?: string,
    solanaClient: SolanaClient,
    src?: string; // Your .fmp4
    moofIndexSrc?: string;
}

export const MOOF_INDEX_RETRIEVAL_NOT_RETRIEVED = 0;
export const MOOF_INDEX_RETRIEVAL_RETRIEVING = 1;
export const MOOF_INDEX_RETRIEVAL_RETRIEVED = 2;

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ solanaVideoAddress, solanaClient, src, moofIndexSrc}) => {
    const videoRef = React.useRef<HTMLVideoElement | null>(null);
    const mediaSourceRef = React.useRef<MediaSource | null>(null);
    const sourceBufferRef = React.useRef<SourceBuffer | null>(null);

    // const sourceBufferMoofsRef = React.useRef<number[][] | null>([[0,1333],[40,647958],[63,959320],[92,1407296],[132,1975391],[156,2263568],[185,2724990],[225,3262232],[258,3735382],[287,4157310]]);

    const moofIndexRetievalState = React.useRef<number>(MOOF_INDEX_RETRIEVAL_NOT_RETRIEVED);
    const moofIndexRetievalAbortController = React.useRef<AbortController | null>(null);

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

            await fetchMoofIndex();
            const mimeCodecStr = `video/mp4; codecs="${sb_codec_str.current}"`;

            if (!MediaSource.isTypeSupported(mimeCodecStr)) {
                console.error("The specified codec string is not supported by this browser.");
                return;
            }


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
                if(nextDownloadingMoofIndex.current !== null){
                    fetchNextSequentialChunk(nextDownloadingMoofIndex.current);
                }
            });
            currentPositionTimeUnits.current = 0;
            addedMoofs.current.clear();
            fetchNextSequentialChunk(null);
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


    const fetchMoofIndex = async() => {

        if (moofIndexRetievalState.current === MOOF_INDEX_RETRIEVAL_NOT_RETRIEVED) {

            moofIndexRetievalState.current = MOOF_INDEX_RETRIEVAL_RETRIEVING;

            if(typeof solanaVideoAddress === "string") {
                console.log("solanaVideoAddress CP1");
                const [abortCtrl, solanaAccountPromise] = readSolanaVideoAccount(solanaClient, solanaVideoAddress);
                console.log("solanaVideoAddress CP2");
                moofIndexRetievalAbortController.current = abortCtrl;
                solanaAccountPromise.then(async (solVideoAccount :SolanaVideoAccount | null | undefined) => {
                    console.log("VideoPlayer read solana acct", solVideoAccount);
                    if(solVideoAccount?.storages){

                    }
                }).catch((err :any) => {
                    moofIndexRetievalState.current = MOOF_INDEX_RETRIEVAL_NOT_RETRIEVED;
                    // TODO: repeat attempt in 5 - 15 seconds or so
                }).finally(() => {
                    moofIndexRetievalAbortController.current = null;
                });
            }

            const response = await fetch(moofIndexSrc ?? '', {});
            const buffer: Buffer<ArrayBuffer> = Buffer.from(await response.arrayBuffer());

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
            }
            moofIndexRetievalState.current = MOOF_INDEX_RETRIEVAL_RETRIEVED;
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
            sourceBufferRef.current.appendBuffer(buffer);
        } catch (err) {
            console.error("Chunk retrieval failed:", err);
            isAppendingRef.current = false;
        }
    }

    const retrVideoBuf = async (moofFrom :number | null, moofTo :number, brStart :number | null | undefined, brEnd: number | null) => {
        const use_bytes_header :boolean = ((brStart !== null) && (brStart !== undefined)) || (brEnd !== null && brEnd !== undefined);
        const endHttpHeaderStr = (brEnd !== null && brEnd !== undefined) ? `${brEnd}` : "";

        const response = await fetch(src ?? '', { headers: use_bytes_header ? { 'Range': `bytes=${brStart}-${endHttpHeaderStr}` } : {} });
        if ((response.status !== 206) && use_bytes_header) throw new Error("Server must support HTTP 206 Range requests");
        const buffer = await response.arrayBuffer();

        // mark downloaded moofs as received
        for(let _i = moofFrom ?? 0; _i < (moofTo ?? ((sourceBufferMoofsRef.current?.length ?? 1) - 1) ) ; _i++){
            //console.log("addedMoofs push", _i);
            if(!addedMoofs.current.has(_i)){addedMoofs.current.add(_i);}
        }

        return buffer;
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
