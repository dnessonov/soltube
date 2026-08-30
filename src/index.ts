import {SolanaClient} from "@solana/client";
import {decompress} from 'fzstd';

// const formatPrice = (price: number): string => `$${price.toFixed(2)}`;


export const readSolanaVideoAccount = (client: SolanaClient, address: string): [AbortController, Promise<any>] => {
    const [abortController,dataPromise] = readSolanaAccountData(client, address);
    return [abortController, new Promise<any>((resolve, reject) => {
        dataPromise.then((data) => {

            if(data === undefined){
                console.log("CP1 readSolanaVideoAccount has been safely aborted by the user.");
            }else{
                if (data[0] !== 1) {
                    reject({errno: 0, error: "Only 1st version is currently supported."});
                } else {
                    console.log('Promised w/o error data:', data);
                }
            }

        }).catch((err: any) => {
            reject({errno: 0, error: err});
        }).finally(()=>{

        });
    })];
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

            const unCompressedBytes: Uint8Array = decompress(compressedBytes);
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