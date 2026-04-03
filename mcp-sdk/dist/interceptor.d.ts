import { ChannelManager } from "./channel.js";
import { ContractService } from "./contracts.js";
import { UsageTracker } from "./usage.js";
import type { InterceptorOptions } from "./types.js";
import { BatchManager } from "./batch";
export declare class PaymentInterceptor {
    private readonly channelManager;
    private readonly contractService;
    private readonly usage;
    private readonly agentId;
    private readonly privateKey;
    private readonly signerAddress;
    private readonly defaultOptions;
    private readonly providerChannels;
    private batchManager;
    constructor(channelManager: ChannelManager, contractService: ContractService, usage: UsageTracker, agentId: string, privateKey: Uint8Array, signerAddress: string, defaultOptions?: InterceptorOptions);
    setBatchManager(batchManager: BatchManager): void;
    getBatchManager(): BatchManager | null;
    setChannelForProvider(provider: string, channelId: `0x${string}`): void;
    removeChannelForProvider(provider: string): void;
    fetch(url: string, init?: RequestInit, options?: InterceptorOptions): Promise<Response>;
    private payViaX402;
    private payViaChannel;
    private payViaBatch;
}
