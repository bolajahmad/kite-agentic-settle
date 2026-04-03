import type { KiteConfig, ChannelState } from "./types.js";
export declare class ContractService {
    private readonly client;
    private readonly config;
    private readonly wdkAccount;
    constructor(config: KiteConfig, wdkAccount: any);
    private sendTx;
    private waitAndDecodeLogs;
    registerAgent(agentId: string, domain: string, agentAddress: string, walletContract: string): Promise<{
        txHash: string;
        agentIdBytes32: `0x${string}`;
    }>;
    registerSession(agentId: string, sessionKey: string, validUntil: number): Promise<string>;
    getAgent(agentId: string): Promise<readonly [string, `0x${string}`, `0x${string}`, `0x${string}`, active: boolean]>;
    resolveAgentByDomain(domain: string): Promise<readonly [`0x${string}`, `0x${string}`, `0x${string}`, active: boolean]>;
    depositToWallet(token: string, amount: bigint): Promise<string>;
    addSessionKeyRule(sessionKey: string, agentId: string, valueLimit: bigint, dailyLimit: bigint, validUntil: number, allowedRecipients: string[]): Promise<string>;
    getSessionRule(sessionKey: string): Promise<readonly [`0x${string}`, bigint, bigint, validUntil: bigint, active: boolean]>;
    getTokenBalance(token: string, address: string): Promise<bigint>;
    openChannel(provider: string, token: string, mode: number, deposit: bigint, maxDuration: number, ratePerCall: bigint): Promise<{
        txHash: string;
        channelId: `0x${string}` | undefined;
    }>;
    activateChannel(channelId: `0x${string}`): Promise<string>;
    closeChannel(channelId: `0x${string}`, sequenceNumber: number, cumulativeCost: bigint, timestamp: number, providerSignature: `0x${string}`): Promise<string>;
    closeChannelEmpty(channelId: `0x${string}`): Promise<string>;
    getChannel(channelId: `0x${string}`): Promise<ChannelState>;
    getReceiptHash(channelId: `0x${string}`, sequenceNumber: number, cumulativeCost: bigint, timestamp: number): Promise<`0x${string}`>;
    isChannelExpired(channelId: `0x${string}`): Promise<boolean>;
    deployWalletViaFactory(): Promise<string>;
    getWalletFromFactory(owner: string): Promise<string>;
    executePayment(walletAddress: string, sessionKey: string, recipient: string, token: string, amount: bigint): Promise<string>;
    transferToken(token: string, to: string, amount: bigint): Promise<string>;
    getAllowance(token: string, owner: string, spender: string): Promise<bigint>;
}
