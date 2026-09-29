import {address} from "@solana/addresses";
import {getProgramDerivedAddress} from '@solana/kit';
import {PublicKey, SystemProgram} from "@solana/web3.js";
import {
    buildCreateOrUpdateVideoInstructionBuffer, CreateNewVideoArgsStorageConfig,
    OP_CREATE_VIDEO, OP_UPDATE_VIDEO,
    SOLANA_PROGRAM_ADDRESS
} from './common/instructionsSerialize.js'
import {type SolanaClient} from "@solana/client";

const SOLANA_ACCOUNT_IS_WRITEABLE = 1;
const SOLANA_ACCOUNT_IS_SIGNER = 2;

interface CreateOrUpdateVideoInstructionResult {
    ix: any,
    video_pda: string,
    video_pda_bump: number | undefined,
}

export const buildCreateOrUpdateVideoInstructionClientHelper = async (operation :typeof OP_CREATE_VIDEO, ownerAccount: string, feePayerAccount: string, video_id: string, storages_to_add :CreateNewVideoArgsStorageConfig[], storages_to_del :PublicKey[] | null, options: any): Promise<CreateOrUpdateVideoInstructionResult> => {
    const programId = address(typeof options?.overrideProgramId === "string" ? options.overrideProgramId : SOLANA_PROGRAM_ADDRESS);

    const sf_seeds = [Buffer.from("service_fee_wallet") ];
    const [sf_pda,sf_bump] = await getProgramDerivedAddress({programAddress: programId, seeds: sf_seeds});

    let pda_account_address :string;
    let pda_account_bump :number | undefined = undefined;
    switch(operation){
        case OP_CREATE_VIDEO:
            const str_id_hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(video_id)));
            const seeds = [Buffer.from("video"), str_id_hash];
            [pda_account_address,pda_account_bump] = await getProgramDerivedAddress({programAddress: programId, seeds: seeds});
            break;

        case OP_UPDATE_VIDEO:
            pda_account_address = video_id;
            break;

        default:
            // error: operation not implemented/supported
            return {ix: null, video_pda: video_id, video_pda_bump: undefined};
            break;
    }

    const data = await buildCreateOrUpdateVideoInstructionBuffer(operation, video_id, storages_to_add, storages_to_del);

    const ixAccounts = [
        {address: ownerAccount, role: 0}, // owner
        {address: feePayerAccount, role: SOLANA_ACCOUNT_IS_WRITEABLE + SOLANA_ACCOUNT_IS_SIGNER}, // payer
        {address: pda_account_address, role: SOLANA_ACCOUNT_IS_WRITEABLE}, // video account
        {address: sf_pda, role: SOLANA_ACCOUNT_IS_WRITEABLE}, // global config (service fee wallet)
        {address: SystemProgram.programId.toString(), role: 0},
    ];

    return {
        ix: {
            data: data,
            programAddress: programId,
            accounts: ixAccounts
        },
        video_pda: pda_account_address,
        video_pda_bump: pda_account_bump
    }
}

export const prepareTransaction = async(client: SolanaClient, authority: any, instructions: any[], feePayer: any) => {
    return await client.helpers.transaction.prepare({
        authority: authority,
        instructions: instructions,
        feePayer: feePayer
    });
}

export {OP_CREATE_VIDEO, OP_UPDATE_VIDEO}