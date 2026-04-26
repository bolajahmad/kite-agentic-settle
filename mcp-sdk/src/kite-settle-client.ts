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
import type { KiteClientOptions } from "./client.js";
import { KitePaymentClient } from "./client.js";
import { KITE_TESTNET, TOKENS } from "./config.js";
import type {
  Decision,
  DecisionContext,
  DecisionMode,
  DecisionResult,
  SessionRules,
} from "./decide.js";
import { checkRules, decide } from "./decide.js";
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
import { decryptSessionKey, deriveSessionAccount } from "./wallet.js";

// ── Re-export supporting types so consumers need only this module ──

export type {
  BatchSession,
  ChannelConfig,
  ChannelState,
  DecisionContext,
  DecisionMode,
  DecisionResult,
  IndexedAgent,
  IndexedPayment,
  IndexedSession,
  InterceptorOptions,
  KiteConfig,
  OnboardOptions,
  OnboardResult,
  PaymentRequest,
  PaymentResult,
  Receipt,
  SessionRules,
  UsageLog,
};

export { KITE_TESTNET, TOKENS };

// ── CreateOptions ──────────────────────────────────────────────────

export interface KiteSettleClientOptions {
  /**
   * EOA seed phrase or private key. Required for onboarding and EOA-level
   * operations. Must be omitted (or ignored) when `agentId` is provided.
   */
  credential?: string;
  /**
   * On-chain agentId (NFT tokenId from IdentityRegistry).
   * When provided, the SDK loads the pre-created session key from the vars
   * store. Agents are NFTs — they have no address or private key of their
   * own. All signing is done via a session key registered by the EOA.
   */
  agentId?: bigint | string | number;
  /**
   * Session key index to load from the vars store. Default: 0.
   */
  sessionIndex?: number;
  /**
   * Password used to decrypt the stored session key blob produced by
   * `kite onboard`. Falls back to the `AGENT_SEED` var if not supplied.
   */
  sessionSeed?: string;
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
}

// ── KiteSettleClient ───────────────────────────────────────────────

export class KiteSettleClient {
  /** EOA-level payment client (used for wallet ops and deriving keys). */
  private readonly eoaClient: KitePaymentClient;

  /** Active payment client (session key for x402, agent key for channels). */
  private readonly paymentClient: KitePaymentClient;

  /** Full network config in use. */
  readonly config: KiteConfig;

  /** EOA address (the top-level wallet owner). Never exposes a private key. */
  readonly eoaAddress: string;

  /**
   * Active address used for signing payments.
   * In agent mode this is the session key address. In EOA-only mode it is
   * the EOA address.
   */
  readonly address: string;

  /**
   * Session key address pre-registered on KiteAAWallet by the EOA.
   * Agents sign all transactions using this address — not a derived
   * "agent address". Agents are NFTs (IdentityRegistry tokenIds).
   */
  readonly sessionKeyAddress: string | undefined;

  /**
   * Decrypted session key private key.
   * Available only in agent mode (client built via stored session).
   * Keep this in the signing layer — never log or transmit it.
   */
  readonly sessionKeyPrivateKey: `0x${string}` | undefined;

  private constructor(
    eoaClient: KitePaymentClient,
    paymentClient: KitePaymentClient,
    eoaAddress: string,
    sessionKeyAddress: string | undefined,
    sessionKeyPrivateKey: `0x${string}` | undefined,
  ) {
    this.eoaClient = eoaClient;
    this.paymentClient = paymentClient;
    this.config = eoaClient.config;
    this.eoaAddress = eoaAddress;
    this.address = sessionKeyAddress ?? eoaAddress;
    this.sessionKeyAddress = sessionKeyAddress;
    this.sessionKeyPrivateKey = sessionKeyPrivateKey;
  }

  // ── Factories ──────────────────────────────────────────────────

  /**
   * Create a KiteSettleClient.
   *
   * Two modes:
   *
   * **Agent mode** (`agentId` provided) — loads the session key that was
   * created by the EOA during `kite onboard` and stored encrypted in the
   * vars store. The agent has no EOA private key; it signs transactions
   * exclusively with the pre-registered session key.
   *
   * **EOA mode** (`credential` provided) — uses the EOA seed/private key
   * directly. Suitable for onboarding and wallet-management operations.
   */
  static async create(
    options: KiteSettleClientOptions,
  ): Promise<KiteSettleClient> {
    const {
      agentId,
      credential,
      sessionIndex = 0,
      sessionSeed,
      config,
      defaultPaymentMode = "auto",
    } = options;

    // ── Agent mode ─────────────────────────────────────────────────────
    if (agentId !== undefined) {
      console.log("Creating from session");
      return KiteSettleClient._createFromStoredSession(
        BigInt(agentId),
        sessionIndex,
        sessionSeed,
        config,
        defaultPaymentMode,
      );
    }

    // ── EOA mode ────────────────────────────────────────────────────────
    if (!credential) {
      throw new Error(
        "Either 'agentId' or 'credential' (EOA seed/private key) must be provided.\n" +
          "  For agent-mode payments: KiteSettleClient.create({ agentId, sessionSeed })\n" +
          "  For onboarding / EOA ops: KiteSettleClient.create({ credential })",
      );
    }

    const eoaClient = await KitePaymentClient.create({
      seedPhrase: credential,
      config,
      defaultPaymentMode: "auto",
    });

    return new KiteSettleClient(
      eoaClient,
      eoaClient,
      eoaClient.address,
      undefined,
      undefined,
    );
  }

  /**
   * Load a session key from the vars store and build an agent-mode client.
   *
   * Agents are NFTs (IdentityRegistry tokenIds). They have no address or
   * private key. All on-chain signing is done by a session key that the EOA
   * registered on KiteAAWallet during `kite onboard`.
   *
   * Throws with a clear message if the session key is missing (not yet
   * created, or previously revoked).
   */
  private static async _createFromStoredSession(
    agentId: bigint,
    sessionIndex: number,
    sessionSeed: string | undefined,
    config: Partial<KiteConfig> | undefined,
    defaultPaymentMode: KiteClientOptions["defaultPaymentMode"],
  ): Promise<KiteSettleClient> {
    const addrVar = `SESSION_${agentId}_${sessionIndex}_ADDRESS`;
    const encVar = `SESSION_${agentId}_${sessionIndex}_ENCRYPTED`;
    const ownerVar = `AGENT_${agentId}_OWNER`;

    console.log({ addrVar });

    const sessionKeyAddress = getVar(addrVar);
    if (!sessionKeyAddress) {
      throw new Error(
        `Session key not found for agentId=${agentId}, sessionIndex=${sessionIndex}.\n` +
          `  Expected var: ${addrVar}\n` +
          `  The session does not exist or has been revoked.\n` +
          `  Run: npx kite onboard to create a session key for this agent.`,
      );
    }

    const encryptedBlob = getVar(encVar);
    if (!encryptedBlob) {
      throw new Error(
        `Encrypted session key blob not found for agentId=${agentId}, sessionIndex=${sessionIndex}.\n` +
          `  Expected var: ${encVar}\n` +
          `  Run: npx kite onboard to recreate the session key.`,
      );
    }

    const seed = "54041552";
    if (!seed) {
      throw new Error(
        `No session decryption seed available for agentId=${agentId}.\n` +
          `  Provide the 'sessionSeed' option, or store the decryption password:\n` +
          `    npx kite vars set AGENT_SEED`,
      );
    }

    const sessionPrivateKey = decryptSessionKey(
      encryptedBlob,
      seed,
    ) as `0x${string}`;

    // EOA address: stored by `kite onboard` as AGENT_{agentId}_OWNER.
    // Used for deposited-balance queries — never for signing.
    const eoaAddress = getVar(ownerVar) ?? sessionKeyAddress;

    const paymentClient = await KitePaymentClient.create({
      seedPhrase: sessionPrivateKey,
      config,
      defaultPaymentMode,
      sessionKey: sessionKeyAddress,
      eoaAddress,
    });

    return new KiteSettleClient(
      paymentClient,
      paymentClient,
      eoaAddress,
      sessionKeyAddress,
      sessionPrivateKey,
    );
  }

  /**
   * Build an agent-mode client from the vars store.
   *
   * Convenience wrapper around `create({ agentId, sessionIndex, sessionSeed })`.
   *
   * @param agentId      On-chain agentId (NFT tokenId from IdentityRegistry).
   * @param sessionIndex Session key index (default: 0).
   * @param sessionSeed  Decryption password. Falls back to the AGENT_SEED var.
   * @param options      Optional config / mode overrides.
   */
  static async fromAgent(
    agentId: bigint | string | number,
    sessionIndex = 0,
    sessionSeed?: string,
    options: Pick<
      KiteSettleClientOptions,
      "config" | "defaultPaymentMode"
    > = {},
  ): Promise<KiteSettleClient> {
    return KiteSettleClient.create({
      agentId,
      sessionIndex,
      sessionSeed,
      ...options,
    });
  }

  /**
   * Create a client from the EOA credential stored in the local vars store
   * (set by `kite init` / `kite vars set PRIVATE_KEY`).
   */
  static async fromStoredCredential(
    options: Omit<KiteSettleClientOptions, "credential" | "agentId"> = {},
  ): Promise<KiteSettleClient> {
    const credential = getVar("PRIVATE_KEY");
    if (!credential) {
      throw new Error("No credential found in vars store. Run: npx kite init");
    }
    return KiteSettleClient.create({ ...options, credential });
  }

  /** Generate a new BIP-39 seed phrase. */
  static generateSeedPhrase(): string {
    return KitePaymentClient.generateSeedPhrase();
  }

  // ── Identity ───────────────────────────────────────────────────

  /**
   * Derive a session key from the EOA credential.
   * This is an EOA-only operation used during onboarding to generate a key
   * before registering it on-chain. Agents (who have no EOA credential)
   * should never call this — they load the pre-created session from vars.
   */
  async deriveSession(
    agentIndex: number,
    sessionIndex: number,
  ): Promise<{ address: string; privateKey: `0x${string}` }> {
    if (this.sessionKeyPrivateKey !== undefined) {
      throw new Error(
        "deriveSession() is an EOA-only operation. " +
          "In agent mode, session keys are loaded from the vars store.",
      );
    }
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
   * Always queries against the EOA address regardless of which key is signing.
   */
  async getDepositedBalance(token?: string): Promise<bigint> {
    return this.eoaClient
      .getContractService()
      .getDepositedTokenBalance(
        (token ?? this.config.token) as `0x${string}`,
        this.eoaAddress as `0x${string}`,
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
  ): Promise<{ txHash: string; agentId: bigint }> {
    return this.eoaClient
      .getContractService()
      .registerAgentOnRegistry(metadata);
  }

  /** Register a session key for an agent on KiteAAWallet. */
  async registerSessionKey(
    agentId: bigint,
    sessionKey: string,
    sessionIndex: number,
    validUntil: number,
  ): Promise<string> {
    return this.eoaClient
      .getContractService()
      .addSessionKeyRule(
        agentId,
        sessionKey,
        BigInt(0),
        BigInt(0),
        BigInt(validUntil),
        [],
      );
  }

  /** Resolve an agent by its on-chain ID → owner address. */
  async resolveAgent(agentId: bigint | string) {
    const id = typeof agentId === "string" ? BigInt(agentId) : agentId;
    return this.eoaClient
      .getContractService()
      .getAgentOwner(id)
      .catch(() => null);
  }

  /** Look up an agent by its on-chain ID (agentId = bigint tokenId). */
  async getAgent(agentId: bigint) {
    return this.eoaClient.getContractService().getAgentURI(agentId);
  }

  /** Update the agentURI stored on IdentityRegistry for an agent the caller owns. */
  async updateAgentURI(agentId: bigint, newURI: string): Promise<string> {
    return this.eoaClient.getContractService().setAgentURI(agentId, newURI);
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
  endBatchSession(sessionId: string, reason?: BatchEndReason) {
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
  checkPaymentRules(ctx: DecisionContext): {
    decision: Decision;
    reason?: string;
  } {
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
          t.symbol.toLowerCase() === lower || t.address.toLowerCase() === lower,
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
