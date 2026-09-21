import {SolanaClient} from "@solana/client";
import {decompress as decompressFz} from 'fzstd';
import {PublicKey} from "@solana/web3.js"
import {decompress as decompressBr} from 'brotli-compress/js';

import pkg_js_crc_models from 'js-crc/models';
const { crc_64_ecma_182 } = pkg_js_crc_models;

export class VideoAccountStorageParam {
    address: PublicKey;
    param: number; // 8-bit

    accountContent: SolanaVideoStorageAccount | null = null;
    accountContentLoadingAbortCtrl :AbortController | null = null;

    constructor(fields: any) {
        this.address = fields.address;
        this.param = fields.param;
    }

    isAuthenticFlag(){
        return (this.param & 1) !== 0;
    }

    addressStr() :string {
        return this.address.toBase58();
    }
}

export interface SolanaVideoAccount {
    owner: PublicKey;
    bump: number;
    video_duration: number;
    storages: VideoAccountStorageParam[];
}

export class Web3StoragePoint {
    url :string;
    param :number; // 8-bit

    constructor(fields: any) {
        this.url = fields.url;
        this.param = fields.param;
    }

    isHasGlobalConfig(){
        return (this.param & 1) !== 0;
    }

    globalConfigUrls(): string[]{
        if(this.url.endsWith('.json')){
            return [this.url/*, this.url + '.br'*/];
        }else {
            return [this.url + '/storage-config.json', this.url + '/storage-config.json.br'];
        }
    }
}

export interface SolanaVideoSource {
    storageAddress :string;
    subStorage :number;
    isPrimarySubStorage : boolean;
    subStorageParam :number; // 8-bit
}

export class SolanaVideoStorageAccount {
    admin: PublicKey;
    bump: number;
    wsps: Web3StoragePoint[];

    client: SolanaClient | null = null;

    // if global config is loaded, it's cached here
    globalConfigUrl: string | undefined = undefined;
    globalConfig: any | null | undefined = undefined;


    // if solana video address and storage param are known, they're stored in the below:
    solanaVideoAddress: string | null = null;
    solanaVideoAccountStorageParam: VideoAccountStorageParam | null = null;

    // as long as sources are known, they'll be populated into below array
    solanaVideoSources :SolanaVideoSource[] | null = null;

    solanaVideoSubstorageIndexes :Map<number|"primary", string> = new Map();


    constructor(fields: any) {
        this.admin = fields.admin;
        this.bump = fields.bump;
        this.wsps = fields.wsps;
        if (fields.client !== undefined) { this.client = fields.client; }
        if(fields.solanaVideoAddress) { this.solanaVideoAddress = fields.solanaVideoAddress; }
        if(fields.solanaVideoAccountStorageParam) { this.solanaVideoAccountStorageParam = fields.solanaVideoAccountStorageParam; console.log("SolanaVideoStorageAccount constructed with ", fields.solanaVideoAccountStorageParam); }
    }

    async getGlobalConfig(): Promise<any | null> {
        if ((this.globalConfig === undefined) || (this.globalConfig === null)) {
            let havingConfigPoints = this.wsps.filter(item => item.isHasGlobalConfig());

            while(havingConfigPoints.length>0){
                const havingConfigRandomPointIndex = Math.floor(Math.random() * havingConfigPoints.length);
                const havingConfigRandomPoint = havingConfigPoints.splice(havingConfigRandomPointIndex,1)[0];
                const urls = havingConfigRandomPoint.globalConfigUrls();
                for(let i=0; i<urls.length; i++){
                    const response = await fetch(urls[i], {});
                    let jsonObject = null;
                    try {
                        jsonObject = await response.json();
                    } catch(err :any) {
                    }

                    if(jsonObject){
                        this.globalConfig = jsonObject;
                        this.globalConfigUrl = urls[i];
                        break;
                    }
                }
                if(this.globalConfig) { break; }
            }
            if(!this.globalConfig) {
                console.error("Unable to retrieve Decentralized Video Storage config. Error #01", this.solanaVideoAccountStorageParam?.address.toBase58());
            }
        }

        return this.globalConfig;
    }

    async fetchSources(){
        if(!this.solanaVideoAddress || !this.solanaVideoAccountStorageParam){ return null; }

        const globalConfig = await this.getGlobalConfig();
        if(!globalConfig) { return null; }

        if(this.solanaVideoAccountStorageParam?.isAuthenticFlag()){ // this can provide sources

        }
    }

    async getSubStorageConfig(subStorageId :number | "primary"){
        const globalConfig = await this.getGlobalConfig();
        if(!globalConfig) { return undefined; }

        if (!Array.isArray(globalConfig)){
            console.error("Storage doesn't have substorages. At least one substorage needs to be defined. Error #04", subStorageId, this.solanaVideoAccountStorageParam?.address.toBase58());
            return globalConfig; // single sub storage within this storage
        }else{
            if(subStorageId === "primary"){
                const primarySubStorages = globalConfig.filter(item => (item?.primary === true) || (item?.primary === 1) || (item?.primary === "1"));
                if(primarySubStorages.length > 0){
                    if(primarySubStorages.length > 1){
                        console.error("Only single primary substorage is allowed. Error #01", this.solanaVideoAccountStorageParam?.address.toBase58());
                    }
                    return primarySubStorages[0];
                }else{
                    console.error("Primary substorage must be explicitly defined. Error #02", this.solanaVideoAccountStorageParam?.address.toBase58());
                    return globalConfig[0];
                }
            }else{
                const foundSubStorages = globalConfig.filter(item => (item?.id === subStorageId));
                if(foundSubStorages.length === 0){
                    return null;
                }else{
                    if(foundSubStorages.length > 1){
                        console.error("Substorage id must be unique, however multiple substorages with the same id found. Error #03", subStorageId, this.solanaVideoAccountStorageParam?.address.toBase58());
                    }
                    return foundSubStorages[0];
                }
            }
        }
    }

    public static readonly SUBSTORAGE_DEFAULT_FOLDERS = {
        'data' : 'data',
        'index': 'index'
    } as const;

    // type Substorage_Folder_Type = keyof typeof SolanaVideoStorageAccount.SUBSTORAGE_DEFAULT_FOLDERS;

    async getSubstorageConfigFolder(subStorageId :number | "primary", folderName :keyof typeof SolanaVideoStorageAccount.SUBSTORAGE_DEFAULT_FOLDERS){
        const subStorageConfig = await this.getSubStorageConfig(subStorageId);
        if(!subStorageConfig){ return undefined; }

        let baseUrl :string | null = null;
        if(this.globalConfigUrl){
            baseUrl = getBaseUrlFrom(this.globalConfigUrl)
        }

        const subStorageDataParam = subStorageConfig?.[folderName] ?? SolanaVideoStorageAccount.SUBSTORAGE_DEFAULT_FOLDERS?.[folderName as keyof typeof SolanaVideoStorageAccount.SUBSTORAGE_DEFAULT_FOLDERS];

        const dataFolderUrl = new URL(subStorageDataParam, baseUrl ?? "").href;
        return dataFolderUrl;
    }

    // takes the index information available at subStorageId
    async getSubstorageVideoIndex(subStorageId :number | "primary"){
        const _cachedIndex = this.solanaVideoSubstorageIndexes.get(subStorageId);
        if((_cachedIndex !== undefined) && (_cachedIndex !== null)){
            // console.log("getSubstorageVideoIndex CP0", _cachedIndex);
            return _cachedIndex;
        }

        const indexFolder = await this.getSubstorageConfigFolder(subStorageId,'index');
        const index_file_url = new URL(crc_64_ecma_182(this.solanaVideoAddress) + ".json", indexFolder + "/").href;
        // console.log("getSubstorageVideoIndex CP1", index_file_url, this.solanaVideoAddress);
        let jsonData :any = undefined;
        try {
            const response = await fetch(index_file_url, {});
            if(response.ok){
                try {
                    jsonData = await response.json();
                    const jsonDataFiltered = (jsonData as any[]).filter(item => (item?.address === this.solanaVideoAddress));
                    if(jsonDataFiltered.length === 1){
                        this.solanaVideoSubstorageIndexes.set(subStorageId, jsonDataFiltered[0]);

                        console.info("Notice #002. Returning value ", jsonDataFiltered[0]);
                        return jsonDataFiltered[0];
                    }else if(jsonDataFiltered.length === 0){
                        console.info("Notice #001. No index available for video in a substorage. Using a fallback (equal to address).", subStorageId, this.solanaVideoAddress, index_file_url);
                        return {
                            "address": this.solanaVideoAddress,
                            "filename": this.solanaVideoAddress
                        }
                    }else if(jsonDataFiltered.length > 1){
                        console.error("Error #003. Multiple indexes available for video in a substorage.", subStorageId, this.solanaVideoAddress, jsonDataFiltered, index_file_url);
                        return null;
                    }
                    console.log("getSubstorageVideoIndex CP6",jsonData, jsonDataFiltered);
                }catch(err_response_json: any){
                    console.log("Notice #002. No index available for video in a substorage. Using a fallback (equal to address).", subStorageId, this.solanaVideoAddress, index_file_url,err_response_json);
                    return {
                        "address": this.solanaVideoAddress,
                        "filename": this.solanaVideoAddress
                    }
                }
                console.log("getSubstorageVideoIndex CP3",response);
            }else{
                console.log("Notice #003. No index available for video in a substorage. Using a fallback (equal to address).", subStorageId, this.solanaVideoAddress, index_file_url,response.status, response.statusText);
                return {
                    "address": this.solanaVideoAddress,
                    "filename": this.solanaVideoAddress
                }
            }
            //
        }catch(err_fetch: any){
            console.log("Notice #004. No index available for video in a substorage. Using a fallback (equal to address).", subStorageId, this.solanaVideoAddress, index_file_url, err_fetch);
            return {
                "address": this.solanaVideoAddress,
                "filename": this.solanaVideoAddress
            }
        }
    }
}


const getBaseUrlFrom = (url: string) :string => {
    const lastShashPos = url.lastIndexOf("/");
    if(lastShashPos === -1){
        return url;
    }else{
        let return_value :string;
        if(lastShashPos >= 2){
            if(url.substring(lastShashPos-2,lastShashPos+1) === "://"){
                return_value = url;
            }else{
                return_value = url.substring(0, lastShashPos);
            }

            if(return_value.substring(return_value.length-1) !== "/"){
                return_value+="/";
            }

            return return_value;
        }else{
            return url;
        }
    }
}


export const readSolanaVideoAccount = (client: SolanaClient, address: string): [AbortController, Promise<SolanaVideoAccount | null | undefined>] => {
    const [abortController,dataPromise] = readSolanaAccountData(client, address);
    return [abortController, new Promise<SolanaVideoAccount | null | undefined>((resolve, reject) => {
        dataPromise.then((data) => {
            if(data === undefined){
                // console.log("CP1 readSolanaVideoAccount has been safely aborted by the user.");
                resolve(undefined);
            }else{
                const subArrayBytesView = new DataView(data.buffer, 0, 40);

                if (subArrayBytesView.getUint8(0) !== 1) {
                    reject({errno: 0, error: "Only 1st version is currently supported."});
                } else {
                    if(data.length < 40){
                        resolve(null);
                    }else{
                        const ownerAddrBytes = data.subarray(1, 33);
                        const ownerAddr = new PublicKey(ownerAddrBytes);
                        console.log('Promised owner:', ownerAddr.toBase58());

                        const accountBump = subArrayBytesView.getUint8(33);
                        const videoDuration = subArrayBytesView.getUint32(34, true);
                        const numStorages = subArrayBytesView.getUint16(38, true);

                        console.log('read numStorages', numStorages, videoDuration, data.length);

                        const storages: VideoAccountStorageParam[] = [];
                        let _storage_offset = 40;
                        for (let i = 0; i < numStorages; i++) {

                            if(data.length < (_storage_offset + 33)){
                                resolve(null);
                                break;
                            }else{
                                const storageAddrBytes = data.subarray(_storage_offset, _storage_offset + 32);
                                const storageAddr = new PublicKey(storageAddrBytes);
                                const storageParam = data[_storage_offset + 32];

                                storages.push(new VideoAccountStorageParam({address: storageAddr, param: storageParam}));

                                console.log('storageAddr', _storage_offset, storageAddr.toBase58());
                                _storage_offset += 33;
                            }
                        }

                        resolve({owner: ownerAddr,bump: accountBump,video_duration: videoDuration,storages: storages});
                    }
                }
            }

        }).catch((err: any) => {
            reject({errno: 0, error: err});
        }).finally(()=>{

        });
    })];
}

export const readSolanaVideoStorageAccount = (client: SolanaClient, address: string, solanaVideoAddress ?: string, videoAccountStorageParam ?: VideoAccountStorageParam): [AbortController, Promise<SolanaVideoStorageAccount | null | undefined>] => {
    const [abortController,dataPromise] = readSolanaAccountData(client, address);
    return [abortController, new Promise<SolanaVideoStorageAccount | null | undefined>((resolve, reject) => {
        dataPromise.then((data) => {
            if(data === undefined){
                // console.log("CP1 readSolanaVideoStorageAccount has been safely aborted by the user.");
                resolve(undefined);
            }else{
                if(data.length < 35){
                    resolve(null);
                }else{
                    const subArrayBytesView = new DataView(data.buffer, 0, 36);
                    if (subArrayBytesView.getUint8(0) !== 1) {
                        reject({errno: 0, error: "Only 1st version is currently supported."});
                    }else{
                        const accountBump = subArrayBytesView.getUint8(1);
                        const adminAddrBytes = data.subarray(2, 34);
                        const adminAddr = new PublicKey(adminAddrBytes);
                        //console.log('Promised storage admin:', adminAddr.toBase58());
                        const binary_data_len = subArrayBytesView.getUint16(34, true);
                        const binaryBytes = data.subarray(36, 36 + binary_data_len);
                        let decompressedBytes :Uint8Array;
                        try {
                            decompressedBytes = decompressBr(binaryBytes,{});
                        }catch(brError: any){
                            decompressedBytes = new Uint8Array;
                            reject({errno: 1, error: 'Unable to decompress account data.', brotliError: brError});
                        }

                        console.log("readSolanaVideoStorageAccount CP2", decompressedBytes);

                        let points: Web3StoragePoint[] = [];
                        if (decompressedBytes.length > 0) {
                            // unwrap
                            const decompressedBytesDataView = new DataView(decompressedBytes.buffer);
                            let _dc_offset = 0;

                            const textDecoder = new TextDecoder();

                            while (_dc_offset < decompressedBytesDataView.byteLength) {
                                const url_str_len = decompressedBytesDataView.getUint16(_dc_offset + 1,true);
                                const url_str = textDecoder.decode(decompressedBytes.subarray(_dc_offset+3,_dc_offset+3+url_str_len));
                                points.push(new Web3StoragePoint({param: decompressedBytesDataView.getUint8(_dc_offset), url: url_str}));
                                _dc_offset+=3+url_str_len;
                            }
                        }
                        resolve(new SolanaVideoStorageAccount({admin: adminAddr, bump: accountBump, wsps: points, client: client, solanaVideoAddress: solanaVideoAddress, solanaVideoAccountStorageParam: videoAccountStorageParam }));
                    }
                }
            }
        }).catch((err: any) => {
            reject({errno: 0, error: err});
        }).finally(()=>{

        });
    })]
}

const readSolanaAccountData = (client: SolanaClient, address: string): [AbortController, Promise<Uint8Array | undefined>]  => {

    const abortController = new AbortController();
    const { signal } = abortController;

    return [abortController, new Promise((resolve, reject) => {
        client.runtime.rpc.getAccountInfo(address, {encoding: "base64+zstd"}).send({abortSignal: signal}).then((get_account_result: any) => {

            let compressedBytes: Uint8Array;
            const readData = get_account_result?.value?.data?.[0];

            if (typeof window !== 'undefined' && typeof window.atob === 'function') {
                const binaryString = window.atob(readData);
                compressedBytes = new Uint8Array(binaryString.length);
                for(let i = 0; i < binaryString.length; i++){
                    compressedBytes[i] = binaryString.charCodeAt(i);
                }
            }else{
                const nodeBuffer = Buffer.from(readData, 'base64');
                compressedBytes = new Uint8Array(nodeBuffer.buffer, nodeBuffer.byteOffset, nodeBuffer.byteLength);
            }

            const unCompressedBytes: Uint8Array = decompressFz(compressedBytes);
            resolve(unCompressedBytes);
        }).catch((error: any) => {
            if (error instanceof DOMException && error.name === "AbortError") {
                resolve(undefined);
            }else{
                console.log("Error occured when fetching Solana account ", address, error);
                reject(error);
            }
        }).finally(() => {
            // cleanup operations
        });
    })];
}

// export * from './components/VideoPlayer.js';