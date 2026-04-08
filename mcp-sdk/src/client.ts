import { createKiteWallet, generateSeedPhrase } from "./wallet.js";
import { ContractService } from "./contracts.js";
import { ChannelManager } from "./channel.js";
import { BatchManager } from "./batch.js";
import type { BatchLimits, BatchEndReason } from "./batch.js";
import { PaymentInterceptor } from "./interceptor.js";
import { UsageTracker } from "./usage.js";
import { KITE_TESTNET } from "./config.js";
import { onboardAgent } from "./onboard.js";
import type { OnboardOptions, OnboardResult } from "./onboard.js";
import type {
  KiteConfig,
  ChannelConfig,
  ChannelState,
  Receipt,
  BatchSession,
  UsageLog,
  InterceptorOptions,
} from "./types.js";

export interface KiteClientOptions {
  seedPhrase: string;
  config?: Partial<KiteConfig>;
  agentId?: string;
  defaultPaymentMode?: "x402" | "channel" | "batch" | "auto";
  walletAddress?: string;
  sessionKey?: string;
}

export class KitePaymentClient {
  readonly address: string;
  readonly config: KiteConfig;

  private readonly wdkAccount: any;
  private readonly wdk: any;
  private readonly contractService: ContractService;
  private readonly channelManager: ChannelManager;
  private readonly batchManager: BatchManager;
  private readonly interceptor: PaymentInterceptor;
  private readonly usage: UsageTracker;
  private readonly agentId: string;
  private readonly privateKey: Uint8Array;

  private constructor(
    address: string,
    config: KiteConfig,
    wdk: any,
    wdkAccount: any,
    contractService: ContractService,
    channelManager: ChannelManager,
    batchManager: BatchManager,
    interceptor: PaymentInterceptor,
    usage: UsageTracker,
    agentId: string,
    privateKey: Uint8Array,
  ) {
    this.address = address;
    this.config = config;
    this.wdk = wdk;
    this.wdkAccount = wdkAccount;
    this.contractService = contractService;
    this.channelManager = channelManager;
    this.batchManager = batchManager;
    this.interceptor = interceptor;
    this.usage = usage;
    this.agentId = agentId;
    this.privateKey = privateKey;
  }

  static async create(options: KiteClientOptions): Promise<KitePaymentClient> {
    const config: KiteConfig = {
      ...KITE_TESTNET,
      ...options.config,
      contracts: {
        ...KITE_TESTNET.contracts,
        ...options.config?.contracts,
      },
    };

    const { wdk, account, address } = await createKiteWallet(
      options.seedPhrase,
      config.rpcUrl
    );

    const contractService = new ContractService(config, account);
    const keyPair = account.keyPair;
    if (!keyPair?.privateKey) throw new Error("Could not extract private key from WDK account");
    const privateKey: Uint8Array = keyPair.privateKey;
    const channelManager = new ChannelManager(contractService, config.token, privateKey, address);
    const batchManager = new BatchManager();
    const usage = new UsageTracker();
    const agentId = options.agentId || address;

    const interceptor = new PaymentInterceptor(
      channelManager,
      contractService,
      usage,
      agentId,
      privateKey,
      address,
      {
        paymentMode: options.defaultPaymentMode || "auto",
        walletAddress: options.walletAddress,
        sessionKey: options.sessionKey || address,
      }
    );
    interceptor.setBatchManager(batchManager);

    return new KitePaymentClient(
      address,
      config,
      wdk,
      account,
      contractService,
      channelManager,
      batchManager,
      interceptor,
      usage,
      agentId,
      privateKey,
    );
  }

  static generateSeedPhrase(): string {
    return generateSeedPhrase();
  }

  // -- Agent Registration --

  async registerAgent(
    metadata: `0x${string}`,
    agentIndex: number = 0,
    walletContract?: string,
  ): Promise<{ txHash: string; agentId: `0x${string}` }> {
    const wallet = walletContract || this.config.contracts.kiteAAWallet;
    return await this.contractService.registerAgent(
      this.address,
      wallet,
      agentIndex,
      metadata,
    );
  }

  async getAgent(agentId: `0x${string}`) {
    return await this.contractService.getAgent(agentId);
  }

  async resolveAgentByAddress(address: string) {
    return await this.contractService.resolveAgentByAddress(address);
  }

  // -- Session Keys --

  async registerSession(
    agentId: `0x${string}`,
    sessionKey: string,
    sessionIndex: number,
    validUntil: number,
  ): Promise<string> {
    return await this.contractService.registerSession(
      agentId,
      sessionKey,
      sessionIndex,
      validUntil
    );
  }

  // -- Wallet --

  async depositToWallet(amount: bigint, token?: string): Promise<string> {
    return await this.contractService.depositToWallet(
      token || this.config.token,
      amount
    );
  }

  async getTokenBalance(token?: string): Promise<bigint> {
    return await this.contractService.getTokenBalance(
      token || this.config.token,
      this.address
    );
  }

  // -- Payment Channels --

  async openChannel(
    channelConfig: ChannelConfig
  ): Promise<{ txHash: string; channelId: `0x${string}` }> {
    const result = await this.channelManager.openChannel(channelConfig);
    this.interceptor.setChannelForProvider(
      channelConfig.provider,
      result.channelId
    );
    return result;
  }

  async activateChannel(channelId: `0x${string}`): Promise<string> {
    return await this.channelManager.activateChannel(channelId);
  }

  async closeChannel(channelId: `0x${string}`): Promise<string> {
    const channel = await this.channelManager.getChannel(channelId);
    this.interceptor.removeChannelForProvider(channel.provider);
    return await this.channelManager.closeChannel(channelId);
  }

  async getChannel(channelId: `0x${string}`): Promise<ChannelState> {
    return await this.channelManager.getChannel(channelId);
  }

  // -- Receipts --

  async signReceiptAsProvider(
    channelId: `0x${string}`,
    callCost: bigint,
    consumerAddress: string,
    requestHash?: string,
    responseHash?: string
  ): Promise<Receipt> {
    return await this.channelManager.signReceiptAsProvider(
      channelId,
      callCost,
      consumerAddress,
      requestHash,
      responseHash
    );
  }

  async verifyAndStoreReceipt(
    channelId: `0x${string}`,
    receipt: Receipt,
    providerAddress: string,
    ratePerCall: bigint
  ): Promise<{ valid: boolean; reason?: string }> {
    return await this.channelManager.verifyAndStoreReceipt(
      channelId,
      receipt,
      providerAddress,
      ratePerCall
    );
  }

  getReceipts(channelId: `0x${string}`): Receipt[] {
    return this.channelManager.getReceipts(channelId);
  }

  // -- Batch Sessions (A2) --

  startBatchSession(provider: string, deposit: bigint, limits?: BatchLimits): BatchSession {
    return this.batchManager.startSession(this.address, provider, deposit, limits);
  }

  endBatchSession(sessionId: string, reason?: BatchEndReason): {
    session: BatchSession;
    finalReceipt: Receipt | null;
    refund: bigint;
    reason: BatchEndReason;
  } {
    return this.batchManager.endSession(sessionId, reason);
  }

  getBatchSession(sessionId: string): BatchSession | null {
    return this.batchManager.getSession(sessionId);
  }

  getActiveBatchSessions(): BatchSession[] {
    return this.batchManager.getActiveSessions();
  }

  canAffordBatchCall(sessionId: string, callCost: bigint): boolean {
    return this.batchManager.canAfford(sessionId, callCost);
  }

  getBatchManager(): BatchManager {
    return this.batchManager;
  }

  // -- Intercepted Fetch --

  async fetch(
    url: string,
    init?: RequestInit,
    options?: InterceptorOptions
  ): Promise<Response> {
    return await this.interceptor.fetch(url, init, options);
  }

  setChannelForProvider(
    provider: string,
    channelId: `0x${string}`
  ): void {
    this.interceptor.setChannelForProvider(provider, channelId);
  }

  // -- Usage --

  getUsageLogs(): UsageLog[] {
    return this.usage.getLogs();
  }

  getTotalSpent(): bigint {
    return this.usage.getTotalSpent();
  }

  // -- Contracts (advanced) --

  getContractService(): ContractService {
    return this.contractService;
  }

  getChannelManager(): ChannelManager {
    return this.channelManager;
  }

  // -- Onboarding --

  /** Get the EOA private key for deterministic derivation. */
  getPrivateKey(): Uint8Array {
    return this.privateKey;
  }

  /**
   * Full onboarding: register EOA, create agent + session key, optionally fund.
   * Replaces the multi-step frontend wizard.
   */
  async onboard(
    options: OnboardOptions,
    onStep?: (step: string) => void,
  ): Promise<OnboardResult> {
    return onboardAgent(
      this.contractService,
      this.privateKey,
      this.address,
      this.config,
      options,
      onStep,
    );
  }
}
