import { ContractService } from "./contracts.js";
import { ChannelManager } from "./channel.js";
import { BatchManager } from "./batch.js";
import type { BatchLimits, BatchEndReason } from "./batch.js";
import type { KiteConfig, ChannelConfig, ChannelState, Receipt, BatchSession, UsageLog, InterceptorOptions } from "./types.js";
export interface KiteClientOptions {
    seedPhrase: string;
    config?: Partial<KiteConfig>;
    agentId?: string;
    defaultPaymentMode?: "x402" | "channel" | "batch" | "auto";
    walletAddress?: string;
    sessionKey?: string;
}
export declare class KitePaymentClient {
    readonly address: string;
    readonly config: KiteConfig;
    private readonly wdkAccount;
    private readonly wdk;
    private readonly contractService;
    private readonly channelManager;
    private readonly batchManager;
    private readonly interceptor;
    private readonly usage;
    private readonly agentId;
    private constructor();
    static create(options: KiteClientOptions): Promise<KitePaymentClient>;
    static generateSeedPhrase(): string;
    registerAgent(name: string, domain: string, walletContract?: string): Promise<{
        txHash: string;
        agentIdBytes32: `0x${string}`;
    }>;
    getAgent(agentId: string): Promise<readonly [string, `0x${string}`, `0x${string}`, `0x${string}`, active: boolean]>;
    resolveAgentByDomain(domain: string): Promise<readonly [`0x${string}`, `0x${string}`, `0x${string}`, active: boolean]>;
    registerSession(agentId: string, sessionKey: string, validUntil: number): Promise<string>;
    depositToWallet(amount: bigint, token?: string): Promise<string>;
    getTokenBalance(token?: string): Promise<bigint>;
    openChannel(channelConfig: ChannelConfig): Promise<{
        txHash: string;
        channelId: `0x${string}`;
    }>;
    activateChannel(channelId: `0x${string}`): Promise<string>;
    closeChannel(channelId: `0x${string}`): Promise<string>;
    getChannel(channelId: `0x${string}`): Promise<ChannelState>;
    signReceiptAsProvider(channelId: `0x${string}`, callCost: bigint, consumerAddress: string, requestHash?: string, responseHash?: string): Promise<Receipt>;
    verifyAndStoreReceipt(channelId: `0x${string}`, receipt: Receipt, providerAddress: string, ratePerCall: bigint): Promise<{
        valid: boolean;
        reason?: string;
    }>;
    getReceipts(channelId: `0x${string}`): Receipt[];
    startBatchSession(provider: string, deposit: bigint, limits?: BatchLimits): BatchSession;
    endBatchSession(sessionId: string, reason?: BatchEndReason): {
        session: BatchSession;
        finalReceipt: Receipt | null;
        refund: bigint;
        reason: BatchEndReason;
    };
    getBatchSession(sessionId: string): BatchSession | null;
    getActiveBatchSessions(): BatchSession[];
    canAffordBatchCall(sessionId: string, callCost: bigint): boolean;
    getBatchManager(): BatchManager;
    fetch(url: string, init?: RequestInit, options?: InterceptorOptions): Promise<Response>;
    setChannelForProvider(provider: string, channelId: `0x${string}`): void;
    getUsageLogs(): UsageLog[];
    getTotalSpent(): bigint;
    getContractService(): ContractService;
    getChannelManager(): ChannelManager;
}
