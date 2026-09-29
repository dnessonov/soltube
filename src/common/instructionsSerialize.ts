import {PublicKey} from "@solana/web3.js";
import * as borsh from "borsh";

export const SOLANA_PROGRAM_ADDRESS = "FviQDovpzu6wRh9xeZESmVbMkNH6f6Tpn8QbAkLGw1um";

export const OP_CREATE_VIDEO :number = 0;
export const OP_UPDATE_VIDEO :number = 1;

export interface CreateNewVideoArgsStorageConfig {
    address: Uint8Array; // Must be a 32-byte Uint8Array (Pubkey.toBytes())
    param: number;       // Must be a u8 numeric integer (0 - 255)
}

const CreateVideoInstructionSchema = {
    struct: {
        storages: { array: {type: { struct: {
                        address: { array: { type: "u8", len: 32} },
                        param: 'u8'
                    }}}},
        str_id: 'string',
        video_duration: 'u32'
    },
};

export interface CreateNewVideoArgsStorageConfig {
    address: Uint8Array; // Must be a 32-byte Uint8Array (Pubkey.toBytes())
    param: number;       // Must be a u8 numeric integer (0 - 255)
}

class CreateNewVideoArgs {
    storages: CreateNewVideoArgsStorageConfig[];
    str_id: string;
    video_duration: number;

    constructor(fields: { storages: CreateNewVideoArgsStorageConfig[], str_id: string, video_duration: number }) {
        this.storages = fields.storages;
        this.str_id = fields.str_id;
        this.video_duration = fields.video_duration;
    }
}

const UpdateVideoInstructionSchema = {
    struct: {
        storages_to_add: { array: {type: { struct: {
                        address: { array: { type: "u8", len: 32} },
                        param: 'u8'
                    }}}},
        storages_to_del: { array: {type: { array: { type: "u8", len: 32} }}},
        bitwise_flags: 'u8',
        video_duration: 'u32'
    }
}

class UpdateVideoArgs {
    storages_to_add: CreateNewVideoArgsStorageConfig[];
    storages_to_del: Uint8Array[];
    bitwise_flags: number;
    video_duration: number;

    constructor(fields: { storages_to_add: CreateNewVideoArgsStorageConfig[], storages_to_del: Uint8Array[], bitwise_flags: number, video_duration: number }) {
        this.storages_to_add = fields.storages_to_add;
        this.storages_to_del = fields.storages_to_del;
        this.bitwise_flags = fields.bitwise_flags;
        this.video_duration = fields.video_duration;
    }
}

export const buildCreateOrUpdateVideoInstructionBuffer = async (operation :typeof OP_CREATE_VIDEO, video_id :string, storages_to_add :CreateNewVideoArgsStorageConfig[], storages_to_del :PublicKey[] | null) : Promise<Buffer<ArrayBuffer>> => {
    const variant = Buffer.from([operation]); // enum variant index = 0 (Create video account)
    let payload :Uint8Array<ArrayBufferLike>;
    switch(operation){
        case OP_CREATE_VIDEO:
            payload = borsh.serialize(
                CreateVideoInstructionSchema,
                new CreateNewVideoArgs({storages: storages_to_add, str_id: video_id, video_duration: 1})
            );
            break;

        case OP_UPDATE_VIDEO:
            let _storages_to_del :Uint8Array[] = [];
            if(Array.isArray(storages_to_del)) {
                for (const _storages_to_del_item of storages_to_del) {
                    _storages_to_del.push(_storages_to_del_item.toBytes());
                }
            }
            payload = borsh.serialize(
                UpdateVideoInstructionSchema,
                new UpdateVideoArgs({storages_to_add: storages_to_add, storages_to_del: _storages_to_del, video_duration: 1, bitwise_flags: 1})
            );
            break;

        default:
            throw new Error(`${operation} is not supported (buildCreateOrUpdateVideoInstructionWeb3)`);
    }

    const instructionBuffer = Buffer.concat([variant, Buffer.from(payload)]);
    return instructionBuffer;
}