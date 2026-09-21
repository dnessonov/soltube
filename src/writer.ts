import {PublicKey, SystemProgram, TransactionInstruction, Transaction, Keypair,Connection,BlockhashWithExpiryBlockHeight,sendAndConfirmTransaction} from "@solana/web3.js";
import * as borsh from "borsh";
import {compress as compressBr} from 'brotli-compress';
import {Web3StoragePoint} from "./index.js";

export const SOLANA_PROGRAM_ADDRESS = "FviQDovpzu6wRh9xeZESmVbMkNH6f6Tpn8QbAkLGw1um";

export const CreateStorageOptionsWeb3_DATA_MAX_FRAGMENT_SIZE = 720;

export interface CreateStorageOptionsWeb3 {
//    address: PublicKey;
    data_max_fragment_size?: number; // may override default CreateStorageOptionsWeb3_DATA_MAX_FRAGMENT_SIZE if specified
    overrideProgramId? :string;
    latestBlockHash ?:BlockhashWithExpiryBlockHeight;
}

class InitializeNewStorageArgs {
    str_id: string;
    bump: number;
    data: Uint8Array;
    projected_bin_data_length: number;

    constructor(fields: any) {
        this.str_id = fields.str_id;
        this.bump = fields.bump;
        this.data = fields.data;
        this.projected_bin_data_length = fields.projected_bin_data_length;
    }
}

const InitializeNewStorageArgsInstructionSchema = {
    struct: {
        str_id: 'string',
        bump: 'u8',
        data: { array: { type: 'u8' } },
        projected_bin_data_length: 'u16'
    },
};

class UpdateStorageArgs {
    bump: number;
    data: Uint8Array;
    offset: number;
    trim_account_data: number;

    constructor(fields: any) {
        this.bump = fields.bump;
        this.data = fields.data;
        this.offset = fields.offset;
        this.trim_account_data = fields.trim_account_data;
    }
}

const UpdateStorageArgsInstructionSchema = {
    struct: {
        bump: 'u8',
        data: { array: { type: 'u8' } }, // Array of u8 elements matching Vec<u8>
        offset: 'u16',
        trim_account_data: 'u8'
    },
};

export interface CreateStorageFirstInstructionResultWeb3 {
    pda :PublicKey;
    bump :number;
    ix :TransactionInstruction;
}

export interface BuildCreateStorageInstructionsResultWeb3 {
    pda :PublicKey;
    bump :number;
    ixs :TransactionInstruction[];
}


export interface CreateStorageResultWeb3 {
    tx0signature: string;
    tx_write_signatures: string[];
}

const generatePdaForVideoStorage = async (storage_id: string, programIdOverrideStr ?:string) => {
    const programId = new PublicKey(typeof programIdOverrideStr === "string" ? programIdOverrideStr : SOLANA_PROGRAM_ADDRESS);

    const str_id_hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(storage_id)));
    const seeds = [Buffer.from("storage"), str_id_hash];

    return { address: PublicKey.findProgramAddressSync(seeds, programId), programId: programId };
}

const buildCreateStorageInstructionWeb3 = async (owner: PublicKey, feePayer: PublicKey, storage_id :string, initial_bin_data: Uint8Array, projected_overall_bin_data_length :number, options? :CreateStorageOptionsWeb3) : Promise<CreateStorageFirstInstructionResultWeb3> => {
    const { address: [pda, bump], programId: programId} = await generatePdaForVideoStorage(storage_id, typeof options?.overrideProgramId === "string" ? options.overrideProgramId : SOLANA_PROGRAM_ADDRESS);
    const pda_account = new PublicKey(pda);

    const variant = Buffer.from([6]); // enum variant index = 6

    const payload = borsh.serialize(
        InitializeNewStorageArgsInstructionSchema,
        new InitializeNewStorageArgs({str_id: storage_id, bump: bump, data: initial_bin_data, projected_bin_data_length: projected_overall_bin_data_length})
    );
    const instructionBuffer = Buffer.concat([variant, Buffer.from(payload)]);

    const keys = [
        {pubkey: owner, isSigner: true, isWritable: false}, // storage admin
        {pubkey: feePayer, isSigner: true, isWritable: false}, // fee payer
        {pubkey: pda_account, isSigner: false, isWritable: true},
        {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
    ];

    const ix = new TransactionInstruction({keys: keys, programId: programId, data: instructionBuffer});

    return {pda, bump, ix};
}

const buildUpdateStorageInstructionWeb3 = (owner: PublicKey, feePayer: PublicKey, pda_account :PublicKey, bump: number, bin_data: Uint8Array, bin_data_offset :number, do_trim_account_data :boolean, options? :CreateStorageOptionsWeb3) : TransactionInstruction => {
    const programId = new PublicKey(typeof options?.overrideProgramId === "string" ? options.overrideProgramId : SOLANA_PROGRAM_ADDRESS);


    const variant = Buffer.from([7]); // enum variant index = 7
    const payload = borsh.serialize(
        UpdateStorageArgsInstructionSchema,
        new UpdateStorageArgs({bump: bump, data: bin_data, offset: bin_data_offset, trim_account_data: do_trim_account_data ? 1:0})
    );
    const instructionBuffer = Buffer.concat([variant, Buffer.from(payload)]);

    const keys = [
        {pubkey: owner, isSigner: true, isWritable: false}, // storage admin
        {pubkey: feePayer, isSigner: true, isWritable: false}, // fee payer
        {pubkey: pda_account, isSigner: false, isWritable: true},
        {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
    ];

    const ix = new TransactionInstruction({keys: keys, programId: programId, data: instructionBuffer});
    return ix;
}


export const buildCreateOrUpdateStorageInstructionsWeb3 = async (owner: PublicKey, feePayer: PublicKey, storage_id :string | [PublicKey,number], data: Uint8Array, options? :CreateStorageOptionsWeb3) : Promise<BuildCreateStorageInstructionsResultWeb3> => {
    const acct_data: Uint8Array = await compressBr(data);
    const max_data_fragment_len = typeof options?.data_max_fragment_size === 'number' ? options.data_max_fragment_size : CreateStorageOptionsWeb3_DATA_MAX_FRAGMENT_SIZE;

    let data_offset = 0;
    let data_first_chunk_len = Math.min(max_data_fragment_len, acct_data.length);
    //console.log("buildCreateStorageInstructionsWeb3 CP1", data_first_chunk_len, acct_data.length);
    console.info("Storage update/create. First chunk len: " + data_offset + " bytes. Total account data len: " + acct_data.length + " bytes.");
    let ix1:any;
    if(typeof storage_id === 'string') {
        ix1 = await buildCreateStorageInstructionWeb3(owner, feePayer, storage_id, acct_data.subarray(data_offset, data_first_chunk_len), acct_data.length, options);
    }else{
        ix1 = { pda: storage_id[0], bump: storage_id[1], ix: null };
        const do_trim_account_data = data_first_chunk_len === acct_data.length;
        ix1.ix = buildUpdateStorageInstructionWeb3(owner,feePayer,ix1.pda,ix1.bump,acct_data.subarray(data_offset, data_first_chunk_len),data_offset,do_trim_account_data);
    }
    //console.log("buildCreateStorageInstructionsWeb3 CP2", ix1);
    data_offset+=data_first_chunk_len;

    const ixs: TransactionInstruction[] = [ix1.ix];

    while (data_offset < acct_data.length) {
        data_first_chunk_len = Math.min(max_data_fragment_len, acct_data.length - data_offset);
        const do_trim_account_data = (typeof storage_id !== 'string') && ((data_offset + data_first_chunk_len) === acct_data.length);
        const ix2 = buildUpdateStorageInstructionWeb3(owner,feePayer,ix1.pda,ix1.bump,acct_data.subarray(data_offset, data_first_chunk_len),data_offset,do_trim_account_data);
        data_offset += data_first_chunk_len;
        ixs.push(ix2);
    }

    return {pda: ix1.pda, bump: ix1.bump, ixs: ixs}
}


export const createOrUpdateStorageWeb3RawBinaryData = async (connection :Connection, owner: Keypair, feePayer: Keypair, storage_id :string | [PublicKey,number], data: Uint8Array, options? :CreateStorageOptionsWeb3) : Promise<CreateStorageResultWeb3 | null> => {
    const latestBlockHash = typeof options?.latestBlockHash !== 'undefined' ? options.latestBlockHash : await connection.getLatestBlockhash();

    const ixs = await buildCreateOrUpdateStorageInstructionsWeb3(owner.publicKey, feePayer.publicKey, storage_id, data, options);

    if(ixs.ixs?.[0]){

        let transaction0 = new Transaction({
            feePayer: feePayer.publicKey,
            blockhash: latestBlockHash.blockhash,
            lastValidBlockHeight: latestBlockHash.lastValidBlockHeight
        }).add(ixs.ixs[0]);

        const tx_signers = [feePayer];
        if(!feePayer.publicKey.equals(owner.publicKey)){ tx_signers.push(owner); }

        const transaction0Signature = await sendAndConfirmTransaction(
            connection,
            transaction0,
            tx_signers
        );

        const parallelWritePromises :Promise<string>[] = [];
        for(let i=1;i<ixs.ixs.length;i++){

            let transaction1 = new Transaction({
                feePayer: feePayer.publicKey,
                blockhash: latestBlockHash.blockhash,
                lastValidBlockHeight: latestBlockHash.lastValidBlockHeight
            }).add(ixs.ixs[i]);

            parallelWritePromises.push( sendAndConfirmTransaction(connection, transaction1, tx_signers) );
        }

        const writeSignatures = await Promise.all(parallelWritePromises);
        return { tx0signature: transaction0Signature, tx_write_signatures: writeSignatures };
    }else{
        return null;
    }
}

export const createOrUpdateStorageWeb3 = (connection :Connection, owner: Keypair, feePayer: Keypair, storage_id :string | [PublicKey,number], data: Web3StoragePoint[], options? :CreateStorageOptionsWeb3) : Promise<CreateStorageResultWeb3 | null> => {

    let binaryDataBlocks :Uint8Array[] = [];
    let binaryDataBlocks_size :number = 0;
    data.forEach((value, key) => {
        const sv = serializeWeb3StoragePoint(value);
        binaryDataBlocks.push(sv);
        binaryDataBlocks_size+=sv.length;
    });

    const oa_data :Uint8Array = new Uint8Array(binaryDataBlocks_size);
    let offset = 0;
    binaryDataBlocks.forEach((value, key) => {
        oa_data.set(value, offset);
        offset+=value.byteLength;
    })

    const createStorageResult = createOrUpdateStorageWeb3RawBinaryData(connection, owner, feePayer, storage_id, oa_data, options);
    return createStorageResult;
}

const serializeWeb3StoragePoint = (inputData :Web3StoragePoint) :Uint8Array => {
    const encoder = new TextEncoder();
    const binaryData: Uint8Array = encoder.encode(inputData.url);

    const binaryData2Bytes = new Uint8Array(2);
    const binaryData2BytesView = new DataView(binaryData2Bytes.buffer);
    binaryData2BytesView.setUint16(0, binaryData.length, true);

    const paramData1Byte = new Uint8Array(1);
    const paramData1ByteView = new DataView(paramData1Byte.buffer);
    paramData1ByteView.setUint8(0, inputData.param);

    const resultArray = new Uint8Array(3+binaryData.length);
    resultArray.set(paramData1Byte, 0);
    resultArray.set(binaryData2Bytes, 1);
    resultArray.set(binaryData, 3);

    return resultArray;
}

export const buildCreateStorageInstructionClientHelper = (storage_id :string, options? :CreateStorageOptionsWeb3) => {

}