import { ContractService } from "./contracts.js";
import type { ChannelConfig, ChannelState, Receipt } from "./types.js";
export declare class ChannelManager {
    private readonly contractService;
    private readonly token;
    private readonly privateKey;
    private readonly signerAddress;
    private readonly receipts;
    constructor(contractService: ContractService, token: string, privateKey: Uint8Array, signerAddress: string);
    openChannel(config: ChannelConfig): Promise<{
        txHash: string;
        channelId: `0x${string}`;
    }>;
    activateChannel(channelId: `0x${string}`): Promise<string>;
    signReceiptAsProvider(channelId: `0x${string}`, callCost: bigint, consumerAddress: string, requestHash?: string, responseHash?: string): Promise<Receipt>;
    verifyAndStoreReceipt(channelId: `0x${string}`, receipt: Receipt, providerAddress: string, ratePerCall: bigint): Promise<{
        valid: boolean;
        reason?: string;
    }>;
    closeChannel(channelId: `0x${string}`): Promise<string>;
    getChannel(channelId: `0x${string}`): Promise<ChannelState>;
    getReceipts(channelId: `0x${string}`): Receipt[];
    getLastReceipt(channelId: `0x${string}`): Receipt | null;
    getTotalSpent(channelId: `0x${string}`): bigint;
}
