import {SolanaClient} from "@solana/client";
import {decompress as decompressFz} from 'fzstd';
import {PublicKey} from "@solana/web3.js"
import {decompress as decompressBr} from 'brotli-compress/js';

export interface VideoAccountStorageParam {
    address: PublicKey;
    param: number;
}

export interface SolanaVideoAccount {
    owner: PublicKey;
    bump: number;
    video_duration: number;
    storages: VideoAccountStorageParam[];
}

export interface SolanaVideoStorageAccount {
    admin: PublicKey;
    bump: number;
    data: Uint8Array
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
                        const numStorages = subArrayBytesView.getUint16(36, true);

                        const storages: VideoAccountStorageParam[] = [];
                        let _storage_offset = 40;
                        for (let i = 0; i < numStorages; i++) {

                            if(data.length < _storage_offset + 33){
                                resolve(null);
                                break;
                            }else{
                                const storageAddrBytes = data.subarray(_storage_offset, _storage_offset + 32);
                                const storageAddr = new PublicKey(storageAddrBytes);
                                const storageParam = data[_storage_offset + 32];

                                storages.push({address: storageAddr, param: storageParam});
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

export const readSolanaVideoStorageAccount = (client: SolanaClient, address: string): [AbortController, Promise<SolanaVideoStorageAccount | null | undefined>] => {
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
                        console.log('Promised admin:', adminAddr.toBase58());
                        const binary_data_len = subArrayBytesView.getUint16(34, true);

                        console.log("Promised binary_data_len:", binary_data_len);

                        const binaryBytes = data.subarray(36, 36 + binary_data_len);
                        let decompressedBytes :Uint8Array;
                        try {
                            decompressedBytes = decompressBr(binaryBytes,{});
                        }catch(brError: any){
                            decompressedBytes = new Uint8Array;
                            reject({errno: 1, error: 'Unable to decompress account data.', brotliError: brError});
                        }

                        resolve({admin: adminAddr, bump: accountBump, data: decompressedBytes});
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