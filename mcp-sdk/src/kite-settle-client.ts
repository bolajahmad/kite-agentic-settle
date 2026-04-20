/**
 * KiteSettleClient — unified entry point for the Kite Agent Pay SDK.
 *
 * This is the single class that consumers and providers need. It wraps
 * every capability of the SDK:
 *
 *  - Wallet management (balances, deposit, withdraw)
 *  - Per-call x402 payments (EIP-712 signed, KiteAAWallet settlement)
 *  - Payment channel lifecycle (open → activate → settle → finalize)
 *  - Batch session payments
 *  - Agent & session key registration / onboarding
 *  - On-chain data via the subgraph indexer
 *  - Payment decision engine (rules / cost model / LLM)
 *  - Usage tracking
 *  - Credential store (vars)
 *
 * Quick start:
 * ```ts
 * const client = await KiteSettleClient.fromCredential(seedPhraseOrPrivKey);
 * const response = await client.fetchWithPayment("https://api.example.com/data");
 * ```
 */

import { formatUnits, parseUnits } from "viem";
import type { BatchEndReason, BatchLimits } from "./batch.js";
import { KITE_TESTNET, TOKENS } from "./config.js";
import {
  checkRules,
  decide,
} from "./decide.js";
import type {
  Decision,
  DecisionContext,
  DecisionMode,
  DecisionResult,
  SessionRules,
} from "./decide.js";
import type {
  IndexedAgent,
  IndexedPayment,
  IndexedSession,
} from "./indexer.js";
import {
  getAgentById,
  getAgentsByOwner,
  getPaymentsByAgent,
  getRecentPayments,
  getSessionKeyAdded,
  getSessionsByAgent,
} from "./indexer.js";
import type { OnboardOptions, OnboardResult } from "./onboard.js";
import type {
  BatchSession,
  ChannelConfig,
  ChannelState,
  InterceptorOptions,
  KiteConfig,
  PaymentRequest,
  PaymentResult,
  Receipt,
  UsageLog,
} from "./types.js";
import {
  deleteVar,
  getKiteDir,
  getVar,
  getVarsPath,
  hasVar,
  listVars,
  resolveVar,
  setVar,
} from "./vars.js";
import {
  deriveAgentAccount,
  deriveSessionAccount,
} from "./wallet.js";
import { KitePaymentClient } from "./client.js";
import type { KiteClientOptions } from "./client.js";

// ── Re-export supporting types so consumers need only this module ──

export type {
  KiteConfig,
  ChannelConfig,
  ChannelState,
  Receipt,
  BatchSession,
  PaymentResult,
  PaymentRequest,
  InterceptorOptions,
  UsageLog,
  DecisionMode,
  DecisionResult,
  DecisionContext,
  SessionRules,
  OnboardOptions,
  OnboardResult,
  IndexedAgent,
  IndexedSession,
  IndexedPayment,
};

export { KITE_TESTNET, TOKENS };

// ── CreateOptions ──────────────────────────────────────────────────

export interface KiteSettleClientOptions {
  /** EOA seed phrase or private key. */
  credential: string;
  /** Optional network config override. Defaults to Kite testnet. */
  config?: Partial<KiteConfig>;
  /**
   * Default payment mode for `fetchWithPayment`.
   * - `"perCall"` — x402 programmable settlement (EIP-712, requires session key)
   * - `"channel"` — payment channel (prepaid deposit)
   * - `"batch"`   — off-chain batch session
   * - `"auto"`    — SDK picks the best available mode
   */
  defaultPaymentMode?: KiteClientOptions["defaultPaymentMode"];
  /**
   * Agent derivation index for the `perCall` (x402) flow.
   * When set, the SDK derives the agent and session keys automatically.
   * Default: 0
   */
  agentIndex?: number;
  /**
   * Session key derivation index (within the agent). Default: 0.
   */
  sessionIndex?: number;
}

// ── KiteSettleClient ───────────────────────────────────────────────

export class KiteSettleClient {
  /** EOA-level payment client (used for wallet ops and deriving keys). */
  private readonly eoaClient: KitePaymentClient;

  /** Active payment client (session key for x402, agent key for channels). */
  private readonly paymentClient: KitePaymentClient;

  /** Full network config in use. */
  readonly config: KiteConfig;

  /** EOA address (the top-level wallet owner). */
  readonly eoaAddress: string;

  /** Active address used for signing payments. */
  readonly address: string;

  /** Derived agent address (index `agentIndex`). */
  readonly agentAddress: string | undefined;

  /** Derived session key address (for x402 mode). */
  readonly sessionKeyAddress: string | undefined;

  private constructor(
    eoaClient: KitePaymentClient,
    paymentClient: KitePaymentClient,
    agentAddress: string | undefined,
    sessionKeyAddress: string | undefined,
  ) {
    this.eoaClient = eoaClient;
    this.paymentClient = paymentClient;
    this.config = eoaClient.config;
    this.eoaAddress = eoaClient.address;
    this.address = paymentClient.address;
    this.agentAddress = agentAddress;
    this.sessionKeyAddress = sessionKeyAddress;
  }

  // ── Factories ──────────────────────────────────────────────────

  /**
   * Create a KiteSettleClient from a credential (seed phrase or private key).
   *
   * For `perCall` mode the SDK automatically derives the session key and
   * initialises the internal payment client with it, so `fetchWithPayment`
   * works out of the box.
   */
  static async create(
    options: KiteSettleClientOptions,
  ): Promise<KiteSettleClient> {
    const {
      credential,
      config,
      defaultPaymentMode = "auto",
      agentIndex = 0,
      sessionIndex = 0,
    } = options;

    const eoaClient = await KitePaymentClient.create({
      seedPhrase: credential,
      config,
      defaultPaymentMode: "auto",
    });

    let paymentClient: KitePaymentClient;
    let agentAddress: string | undefined;
    let sessionKeyAddress: string | undefined;

    if (defaultPaymentMode === "perCall") {
      // Derive both the agent and session key deterministically.
      const { address: agentAddr } = await deriveAgentAccount(
        eoaClient.getPrivateKey(),
        agentIndex,
      );
      const { privateKey: sessionPrivKey, address: sessionAddr } =
        await deriveSessionAccount(
          eoaClient.getPrivateKey(),
          agentIndex,
          sessionIndex,
        );
      agentAddress = agentAddr;
      sessionKeyAddress = sessionAddr;

      paymentClient = await KitePaymentClient.create({
        seedPhrase: sessionPrivKey,
        config,
        defaultPaymentMode: "perCall",
        sessionKey: sessionAddr,
        walletAddress: agentAddr,
      });
    } else if (defaultPaymentMode === "channel" || defaultPaymentMode === "batch") {
      const { privateKey: agentPrivKey, address: agentAddr } =
        await deriveAgentAccount(eoaClient.getPrivateKey(), agentIndex);
      agentAddress = agentAddr;
      paymentClient = await KitePaymentClient.create({
        seedPhrase: agentPrivKey,
        config,
        defaultPaymentMode,
      });
    } else {
      // auto — use EOA-level client
      paymentClient = eoaClient;
    }

    return new KiteSettleClient(
      eoaClient,
      paymentClient,
      agentAddress,
      sessionKeyAddress,
    );
  }

  /**
   * Create a client from the credential stored in the local vars store
   * (set by `kite init` / `kite vars set PRIVATE_KEY`).
   */
  static async fromStoredCredential(
    options: Omit<KiteSettleClientOptions, "credential"> = {},
  ): Promise<KiteSettleClient> {
    const credential = getVar("PRIVATE_KEY");
    if (!credential) {
      throw new Error(
        "No credential found in vars store. Run: npx kite init",
      );
    }
    return KiteSettleClient.create({ ...options, credential });
  }

  /** Generate a new BIP-39 seed phrase. */
  static generateSeedPhrase(): string {
    return KitePaymentClient.generateSeedPhrase();
  }

  // ── Identity ───────────────────────────────────────────────────

  /** Derive the agent account at a given index without changing the client. */
  async deriveAgent(
    agentIndex: number,
  ): Promise<{ address: string; privateKey: `0x${string}` }> {
    return deriveAgentAccount(this.eoaClient.getPrivateKey(), agentIndex);
  }

  /** Derive a session key at a given agent + session index. */
  async deriveSession(
    agentIndex: number,
    sessionIndex: number,
  ): Promise<{ address: string; privateKey: `0x${string}` }> {
    return deriveSessionAccount(
      this.eoaClient.getPrivateKey(),
      agentIndex,
      sessionIndex,
    );
  }

  // ── Fetch (payments) ──────────────────────────────────────────

  /**
   * Fetch a URL, automatically handling 402 Payment Required responses.
   *
   * The SDK negotiates the payment scheme returned in the 402 challenge
   * and retries with the appropriate payment proof header.
   *
   * @param url     Target URL
   * @param init    Standard `fetch` init options
   * @param options Payment options (override mode, max amount, callbacks…)
   */
  async fetchWithPayment(
    url: string,
    init?: RequestInit,
    options?: InterceptorOptions,
  ): Promise<Response> {
    return this.paymentClient.fetch(url, init, options);
  }

  // ── Wallet ────────────────────────────────────────────────────

  /**
   * Deposited (KiteAAWallet) balance for the EOA.
   * These are the funds used for x402 (perCall) payments.
   */
  async getDepositedBalance(token?: string): Promise<bigint> {
    return this.eoaClient.getDepositedTokenBalance(
      token ?? this.config.token,
    );
  }

  /**
   * Raw ERC-20 balance in the EOA wallet (not deposited).
   */
  async getWalletBalance(token?: string): Promise<bigint> {
    return this.eoaClient.getTokenBalance(token ?? this.config.token);
  }

  /** Deposit tokens into KiteAAWallet. */
  async deposit(amount: bigint, token?: string): Promise<string> {
    return this.eoaClient.depositToWallet(amount, token ?? this.config.token);
  }

  /** Withdraw tokens from KiteAAWallet back to the EOA. */
  async withdraw(amount: bigint, token?: string): Promise<string> {
    return this.eoaClient.withdrawFromWallet(
      amount,
      token ?? this.config.token,
    );
  }

  // ── Identity / Registration Status ──────────────────────────

  /**
   * Check whether an address (default: EOA) is registered on-chain.
   */
  async isRegistered(address?: string): Promise<boolean> {
    return this.eoaClient
      .getContractService()
      .isUserRegistered(address ?? this.eoaAddress);
  }

  // ── Agent & Session Registration ─────────────────────────────

  /**
   * Full one-step onboarding: register EOA → create agent → register
   * session key → optionally fund wallet.
   */
  async onboard(
    options: OnboardOptions,
    onStep?: (step: string) => void,
  ): Promise<OnboardResult> {
    return this.eoaClient.onboard(options, onStep);
  }

  /** Register an agent on-chain at a specific index. */
  async registerAgent(
    metadata: `0x${string}`,
    agentIndex = 0,
    walletContract?: string,
  ): Promise<{ txHash: string; agentId: `0x${string}` }> {
    const agentKey = await deriveAgentAccount(
      this.eoaClient.getPrivateKey(),
      agentIndex,
    );
    const agentClient = await KitePaymentClient.create({
      seedPhrase: agentKey.privateKey,
      config: this.config,
    });
    return agentClient.registerAgent(metadata, agentIndex, walletContract);
  }

  /** Register a session key for an agent on KiteAAWallet. */
  async registerSessionKey(
    agentId: `0x${string}`,
    sessionKey: string,
    sessionIndex: number,
    validUntil: number,
  ): Promise<string> {
    return this.eoaClient.registerSession(
      agentId,
      sessionKey,
      sessionIndex,
      validUntil,
    );
  }

  /** Resolve an agent by its wallet address → [agentId, metadata]. */
  async resolveAgent(address: string) {
    return this.eoaClient.resolveAgentByAddress(address);
  }

  /** Look up an agent by its on-chain ID. */
  async getAgent(agentId: `0x${string}`) {
    return this.eoaClient.getAgent(agentId);
  }

  // ── Payment Channels ─────────────────────────────────────────

  /** Open a new payment channel with a provider. */
  async openChannel(
    channelConfig: ChannelConfig,
  ): Promise<{ txHash: string; channelId: `0x${string}` }> {
    return this.paymentClient.openChannel(channelConfig);
  }

  /** Activate a payment channel (provider-side confirmation). */
  async activateChannel(channelId: `0x${string}`): Promise<string> {
    return this.paymentClient.activateChannel(channelId);
  }

  /** Initiate settlement of a payment channel. */
  async initiateSettlement(
    channelId: `0x${string}`,
    merkleRoot?: `0x${string}`,
  ): Promise<string> {
    return this.paymentClient.initiateSettlement(channelId, merkleRoot);
  }

  /** Finalize (close) a payment channel. */
  async finalizeChannel(
    channelId: `0x${string}`,
    merkleRoot?: `0x${string}`,
  ): Promise<string> {
    return this.paymentClient.finalize(channelId, merkleRoot);
  }

  /** Force-close an expired channel. */
  async forceCloseChannel(channelId: `0x${string}`): Promise<string> {
    return this.paymentClient.forceCloseExpired(channelId);
  }

  /**
   * Register a channel for a provider so that `fetchWithPayment` routes
   * through it automatically (channel payment mode).
   */
  setChannelForProvider(provider: string, channelId: `0x${string}`): void {
    this.paymentClient.setChannelForProvider(provider, channelId);
  }

  /** Get the on-chain state of a channel. */
  async getChannel(channelId: `0x${string}`): Promise<ChannelState> {
    return this.paymentClient.getChannel(channelId);
  }

  /** Get settlement state of a channel. */
  async getSettlementState(channelId: `0x${string}`) {
    return this.paymentClient.getSettlementState(channelId);
  }

  /** Submit a receipt to the channel (provider-side). */
  async submitReceipt(
    channelId: `0x${string}`,
    receipt: Receipt,
  ): Promise<string> {
    return this.paymentClient.submitReceipt(channelId, receipt);
  }

  // ── Receipts ─────────────────────────────────────────────────

  /** Sign a receipt as a provider (for channel payment proofs). */
  async signReceiptAsProvider(
    channelId: `0x${string}`,
    callCost: bigint,
    consumerAddress: string,
    requestHash?: string,
    responseHash?: string,
  ): Promise<Receipt> {
    return this.paymentClient.signReceiptAsProvider(
      channelId,
      callCost,
      consumerAddress,
      requestHash,
      responseHash,
    );
  }

  /** Verify and store a receipt. */
  async verifyAndStoreReceipt(
    channelId: `0x${string}`,
    receipt: Receipt,
    providerAddress: string,
    ratePerCall: bigint,
  ): Promise<{ valid: boolean; reason?: string }> {
    return this.paymentClient.verifyAndStoreReceipt(
      channelId,
      receipt,
      providerAddress,
      ratePerCall,
    );
  }

  /** Get all stored receipts for a channel. */
  getChannelReceipts(channelId: `0x${string}`): Receipt[] {
    return this.paymentClient.getReceipts(channelId);
  }

  // ── Batch Sessions ────────────────────────────────────────────

  /** Start a batch payment session with a provider. */
  startBatchSession(
    provider: string,
    deposit: bigint,
    limits?: BatchLimits,
  ): BatchSession {
    return this.paymentClient.startBatchSession(provider, deposit, limits);
  }

  /** End a batch payment session. */
  endBatchSession(
    sessionId: string,
    reason?: BatchEndReason,
  ) {
    return this.paymentClient.endBatchSession(sessionId, reason);
  }

  /** Get a batch session by ID. */
  getBatchSession(sessionId: string): BatchSession | null {
    return this.paymentClient.getBatchSession(sessionId);
  }

  /** Get all active batch sessions. */
  getActiveBatchSessions(): BatchSession[] {
    return this.paymentClient.getActiveBatchSessions();
  }

  /** Check if a batch session can afford a call. */
  canAffordBatchCall(sessionId: string, callCost: bigint): boolean {
    return this.paymentClient.canAffordBatchCall(sessionId, callCost);
  }

  // ── Payment Decision Engine ───────────────────────────────────

  /**
   * Run the payment decision engine against a payment request.
   *
   * The engine runs up to 3 tiers:
   *   1. Rule-based (always)
   *   2. Cost model
   *   3. LLM (if `openaiApiKey` is in ctx and mode allows it)
   *
   * @returns `"approve"` or `"reject"` with a reason and the tier that decided.
   */
  async decidePayment(
    ctx: DecisionContext,
    mode?: DecisionMode,
  ): Promise<DecisionResult> {
    return decide(ctx, mode);
  }

  /** Run only the rule-based tier of the decision engine. */
  checkPaymentRules(
    ctx: DecisionContext,
  ): { decision: Decision; reason?: string } {
    return checkRules(ctx);
  }

  // ── Usage Tracking ────────────────────────────────────────────

  /** Get all payment usage logs for this session. */
  getUsageLogs(): UsageLog[] {
    return this.paymentClient.getUsageLogs();
  }

  /** Get the total amount spent in this session. */
  getTotalSpent(): bigint {
    return this.paymentClient.getTotalSpent();
  }

  // ── Subgraph Indexer ─────────────────────────────────────────

  /** Get all agents registered by an owner address. */
  async getAgentsByOwner(ownerAddress: string): Promise<IndexedAgent[]> {
    return getAgentsByOwner(ownerAddress);
  }

  /** Get a single agent by its on-chain ID. */
  async getIndexedAgent(agentId: string): Promise<IndexedAgent | null> {
    return getAgentById(agentId);
  }

  /** Get all session keys registered for an agent. */
  async getSessionsByAgent(agentId: string): Promise<IndexedSession[]> {
    return getSessionsByAgent(agentId);
  }

  /** Get payment history for an agent. */
  async getPaymentHistory(agentId: string): Promise<IndexedPayment[]> {
    return getPaymentsByAgent(agentId);
  }

  /** Get recent payments across all agents (global feed). */
  async getRecentPayments(limit = 20): Promise<IndexedPayment[]> {
    return getRecentPayments(limit);
  }

  /** Get session key events for an agent. */
  async getSessionKeyEvents(agentId: string) {
    return getSessionKeyAdded(agentId);
  }

  // ── Credential Store (vars) ───────────────────────────────────

  /** Get a stored variable from the local vars store. */
  static getVar(key: string): string | undefined {
    return getVar(key);
  }

  /** Store a variable in the local vars store. */
  static setVar(key: string, value: string): void {
    setVar(key, value);
  }

  /** Delete a stored variable. */
  static deleteVar(key: string): boolean {
    return deleteVar(key);
  }

  /** List all stored variable names. */
  static listVars(): string[] {
    return listVars();
  }

  /** Check if a variable is stored. */
  static hasVar(key: string): boolean {
    return hasVar(key);
  }

  /** Get the path to the vars file. */
  static getVarsPath(): string {
    return getVarsPath();
  }

  /** Get the kite config directory. */
  static getKiteDir(): string {
    return getKiteDir();
  }

  /** Resolve a variable (vars store → env → throw). */
  static resolveVar(key: string): string {
    return resolveVar(key);
  }

  // ── Token Utilities ───────────────────────────────────────────

  /**
   * Format a token amount from base units to human-readable string.
   * @param amount  Amount in base units (wei)
   * @param decimals Token decimals (default: 18)
   */
  static formatAmount(amount: bigint, decimals = 18): string {
    return formatUnits(amount, decimals);
  }

  /**
   * Parse a human-readable token amount to base units.
   * @param amount   Human-readable amount (e.g. "0.25")
   * @param decimals Token decimals (default: 18)
   */
  static parseAmount(amount: string, decimals = 18): bigint {
    return parseUnits(amount, decimals);
  }

  /** Look up a token by symbol or address from the built-in TOKENS list. */
  static getToken(symbolOrAddress: string) {
    const lower = symbolOrAddress.toLowerCase();
    return (
      TOKENS.find(
        (t) =>
          t.symbol.toLowerCase() === lower ||
          t.address.toLowerCase() === lower,
      ) ?? null
    );
  }

  // ── Advanced access ───────────────────────────────────────────

  /**
   * Access the underlying KitePaymentClient for advanced use cases.
   * Prefer the KiteSettleClient methods when possible.
   */
  getPaymentClient(): KitePaymentClient {
    return this.paymentClient;
  }

  /** Access the EOA-level KitePaymentClient. */
  getEoaClient(): KitePaymentClient {
    return this.eoaClient;
  }
}
