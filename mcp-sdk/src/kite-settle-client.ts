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

import { formatUnits, parseUnits, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { BatchEndReason, BatchLimits } from "./batch.js";
import type { KiteClientOptions } from "./client.js";
import { KitePaymentClient } from "./client.js";
import { KITE_TESTNET, TOKENS } from "./config.js";
import { ContractService } from "./contracts.js";
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
  IndexedChannel,
  IndexedPayment,
  IndexedSession,
} from "./indexer.js";
import {
  getAgentById,
  getAgentsByOwner,
  getChannelById,
  getChannelsByAgent,
  getPaymentsByAgent,
  getRecentPayments,
  getSessionByKey,
  getSessionKeyAdded,
  getSessionsByAgent,
  getUserAgentsWithActiveSessions,
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
  getCredential,
  getKiteDir,
  getVar,
  getVarsPath,
  hasVar,
  listVars,
  resolveVar,
  setVar,
} from "./vars.js";
import { deriveSessionAccount, deriveSessionForAgent } from "./wallet.js";

// ── Re-export supporting types so consumers need only this module ──

export type {
  BatchSession,
  ChannelConfig,
  ChannelState,
  DecisionContext,
  DecisionMode,
  DecisionResult,
  IndexedAgent,
  IndexedChannel,
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

// ── Module-level helpers ───────────────────────────────────────────

/** Parse `text` as JSON; return the raw string if it is not valid JSON. */
function _tryParseJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ── Balance types ──────────────────────────────────────────────────

/** Balance of one token for a given address. */
export interface TokenBalance {
  /** Token contract address. `zeroAddress` (0x000…) means native gas token. */
  token: string;
  symbol: string;
  decimals: number;
  /** Raw ERC-20 / native balance sitting in the EOA wallet. */
  walletBalance: bigint;
  walletBalanceFormatted: string;
  /** Balance deposited into the ClientAgentVault (spendable by agents). */
  depositedBalance: bigint;
  depositedBalanceFormatted: string;
}

/** Full balance snapshot returned by `client.balance()`. */
export interface BalanceResult {
  eoaAddress: string;
  aaWalletAddress: string;
  tokens: TokenBalance[];
}

// ── Session types ──────────────────────────────────────────────────

/**
 * Enriched session snapshot: raw indexer data + computed spent/remaining.
 * Returned by `client.listSessions()` and `client.getSessionInfo()`.
 */
export interface SessionInfo {
  sessionKey: string;
  sessionId: string;
  agentId: string;
  /** Effective human-readable status (accounts for expiry). */
  status: string;
  /** Unix seconds (as string). */
  validUntil: string;
  /** ISO-8601 formatted expiry datetime. */
  validUntilFormatted: string;
  /** Lifetime spend cap in wei (as string) — from the session's spending rule budget. */
  maxAmount: string;
  /** Lifetime spend cap formatted (e.g. "10.0"). */
  maxAmountFormatted: string;
  /** Per-transaction value limit in wei (as string). */
  valueLimit: string;
  /** Per-transaction value limit formatted. */
  valueLimitFormatted: string;
  /** Amount spent in the current spending window in wei (from ClientAgentVault on-chain). */
  spent: string;
  spentFormatted: string;
  /** Remaining capacity in the current window in wei (budget − spent). */
  remaining: string;
  remainingFormatted: string;
  blockedAgents: string[];
  createdAt: string;
  /** Raw spending rules from the ClientAgentVault contract. Empty if none configured. */
  spendingRules: Array<{
    timeWindow: string;
    budget: string;
    budgetFormatted: string;
    amountUsed: string;
    amountUsedFormatted: string;
    remainingInWindow: string;
    remainingInWindowFormatted: string;
    windowStartTime: string;
  }>;
}

// ── Channel types ──────────────────────────────────────────────────

/**
 * Enriched channel snapshot with formatted amounts and human-readable status.
 * Returned by `client.listChannels()` and `client.getChannelInfo()`.
 */
export interface ChannelInfo {
  channelId: string;
  /** Human-readable status (e.g. "Active", "Expired", "Settlement Pending"). */
  status: string;
  provider: string;
  agentId: string;
  sessionKey: string;
  eoaAddress: string;
  walletContract: string;
  token: string;
  deposit: string;
  depositFormatted: string;
  maxSpend: string;
  maxSpendFormatted: string;
  maxPerCall: string;
  maxPerCallFormatted: string;
  settledAmount: string;
  settledAmountFormatted: string;
  refundAmount: string;
  refundAmountFormatted: string;
  openedAt: string;
  expiresAt: string;
  closedAt: string | null;
  settlementDeadline: string | null;
  highestClaimedCost: string | null;
  highestSequenceNumber: string | null;
  usageMerkleRoot: string | null;
}

// ── callPaidApi types ─────────────────────────────────────────────

/**
 * Options for the high-level `callPaidApi` helper.
 * Pass these to `client.callPaidApi(url, options)` to make a single
 * paid API call without manually handling 402 challenges.
 */
export interface CallPaidApiOptions {
  /** HTTP method (default: "GET"). */
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** Serialised request body for POST/PUT. */
  body?: string;
  /** Additional request headers. */
  headers?: Record<string, string>;
  /**
   * Payment routing mode.
   * - "perCall" — always sign a fresh x402 EIP-712 payment per request.
   * - "batch"   — route through an active batch session if one exists.
   * - "channel" — route through an active payment channel if one exists.
   * - "auto"    — prefer batch → channel → perCall automatically (default).
   */
  mode?: "perCall" | "batch" | "channel" | "auto";
  /** Cap on the maximum payment amount (wei). Throws if the offer exceeds this. */
  maxAmount?: bigint;
  /**
   * Whether to automatically pay when a 402 challenge is received.
   * When `false` the method returns immediately with `status: 402` instead
   * of making a payment. Default: `true`.
   */
  autopay?: boolean;
  /**
   * Optional hook invoked when a 402 challenge is received, before any
   * payment is attempted. Return `false` to abort the payment (the method
   * returns with `status: 402`). Useful for the CLI decision engine or any
   * UI that needs user confirmation.
   *
   * When omitted (or when `autopay` is `true`) all payments are approved
   * automatically up to `maxAmount`.
   */
  onPaymentRequired?: (request: PaymentRequest) => Promise<boolean>;
  /**
   * Optional hook invoked after a successful payment. Receives the raw
   * `PaymentResult` from the interceptor. Useful for logging and receipt
   * formatting in the CLI.
   */
  onPayment?: (result: PaymentResult) => void;
}

/** Structured result from `callPaidApi`. */
export interface CallPaidApiResult {
  /** HTTP status code of the final response. */
  status: number;
  /** Parsed JSON body (or raw string if not valid JSON). */
  data: unknown;
  /**
   * Payment details. `null` when no payment was required (non-402 response)
   * or when `autopay` was disabled.
   */
  payment: {
    method: "perCall" | "channel" | "batch";
    /** Amount paid in wei as a decimal string. */
    amount: string;
    /** Session key address used to sign the payment. */
    sessionKey?: string;
    /** Recipient address (provider). */
    recipient?: string;
    /** Payment nonce as decimal string. */
    nonce?: string;
    /** On-chain tx hash (present for legacy direct-settlement paths). */
    txHash?: string;
  } | null;
}

// ── Status helpers (shared by CLI + SDK methods) ──────────────────

/**
 * Compute the effective human-readable status for a session,
 * accounting for expiry even when the indexer still shows "ACTIVE".
 */
export function effectiveSessionStatus(session: IndexedSession): string {
  const now = Math.floor(Date.now() / 1000);
  const upper = session.status.trim().toUpperCase();
  if (upper === "ACTIVE" && Number(session.validUntil) <= now) return "Expired";
  const s = session.status.trim().toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : "Unknown";
}

/**
 * Compute the human-readable label for a channel's status,
 * accounting for expiry even when the indexer still shows "ACTIVE".
 */
export function effectiveChannelStatus(
  status: string,
  expiresAt?: string | number | null,
): string {
  const expiresAtNum = Number(expiresAt);
  if (
    Number.isFinite(expiresAtNum) &&
    expiresAtNum > 0 &&
    expiresAtNum < Math.floor(Date.now() / 1000)
  ) {
    return "Expired";
  }
  switch (status.toUpperCase()) {
    case "OPEN":
      return "Pending Activation";
    case "ACTIVE":
      return "Active";
    case "SETTLEMENT_PENDING":
      return "Settlement Pending";
    case "CLOSED":
      return "Closed";
    default:
      return status || "Unknown";
  }
}

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
   * Session key address to load in agent mode.
   *
   * If omitted, the SDK auto-selects the first on-chain session for the
   * agent that is currently active, not expired, and has remaining capacity.
   */
  sessionKey?: string;
  /**
   * Legacy session index (optional). This is no longer required by callers.
   * When provided with no `sessionKey`, it is ignored and an available
   * on-chain session is auto-selected.
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
  /**
   * Allow explicit sessionKey loading even if indexer/limits mark it unavailable.
   * Intended for channel lifecycle actions (e.g., settlement) where the
   * channel-bound session key must be used regardless of current spend/expiry.
   */
  allowUnavailableSession?: boolean;
}

export interface AgentMetadataSummary {
  name?: string;
  shortDescription?: string;
  raw?: Record<string, unknown>;
}

// ── Internal helpers ───────────────────────────────────────────────

/** Map an `IndexedChannel` to a fully enriched `ChannelInfo`. */
function enrichChannel(ch: IndexedChannel): ChannelInfo {
  const fmt18 = (raw: string | null | undefined) =>
    formatUnits(BigInt(raw ?? "0"), 18);
  return {
    channelId: ch.channelId,
    status: effectiveChannelStatus(ch.status, ch.expiresAt),
    provider: ch.provider,
    agentId: ch.agent?.agentId ?? "",
    sessionKey: ch.session?.sessionKey ?? "",
    eoaAddress: ch.user?.address ?? ch.user?.id ?? "",
    walletContract: ch.walletContract ?? "",
    token: ch.token,
    deposit: ch.deposit,
    depositFormatted: fmt18(ch.deposit),
    maxSpend: ch.maxSpend,
    maxSpendFormatted: fmt18(ch.maxSpend),
    maxPerCall: ch.maxPerCall,
    maxPerCallFormatted: fmt18(ch.maxPerCall),
    settledAmount: ch.settledAmount,
    settledAmountFormatted: fmt18(ch.settledAmount),
    refundAmount: ch.refundAmount,
    refundAmountFormatted: fmt18(ch.refundAmount),
    openedAt: ch.openedAt,
    expiresAt: ch.expiresAt,
    closedAt: ch.closedAt ?? null,
    settlementDeadline: ch.settlementDeadline ?? null,
    highestClaimedCost: ch.highestClaimedCost ?? null,
    highestSequenceNumber: ch.highestSequenceNumber ?? null,
    usageMerkleRoot: ch.usageMerkleRoot ?? null,
  };
}

// ── KiteSettleClient ───────────────────────────────────────────────

export class KiteSettleClient {
  /**
   * EOA-level payment client (used for wallet ops and deriving keys).
   * Null in agent-only mode (session key loaded from vars, no EOA key available)
   * and in read-only mode (no credential supplied).
   */
  private readonly eoaClient: KitePaymentClient | null;

  /**
   * Active payment client (session key for x402, agent key for channels).
   * Null only in read-only mode — subgraph / static methods still work.
   */
  private readonly paymentClient: KitePaymentClient | null;

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
    config: KiteConfig,
    eoaClient: KitePaymentClient | null,
    paymentClient: KitePaymentClient | null,
    eoaAddress: string,
    sessionKeyAddress: string | undefined,
    sessionKeyPrivateKey: `0x${string}` | undefined,
  ) {
    this.config = config;
    this.eoaClient = eoaClient;
    this.paymentClient = paymentClient;
    this.eoaAddress = eoaAddress;
    this.address = sessionKeyAddress ?? eoaAddress;
    this.sessionKeyAddress = sessionKeyAddress;
    this.sessionKeyPrivateKey = sessionKeyPrivateKey;
  }

  // ── Private guards ─────────────────────────────────────────────

  /**
   * Returns the EOA-level client, or throws if unavailable.
   * Required for write operations that must be signed by the wallet owner:
   * deposit, withdraw, onboard, registerAgent, registerSessionKey, updateAgentURI.
   */
  private requireEoaClient(): KitePaymentClient {
    if (!this.eoaClient) {
      throw new Error(
        "This operation requires an EOA credential (wallet owner key).\n" +
          "  Run: npx kite init  to store your seed phrase or private key.",
      );
    }
    return this.eoaClient;
  }

  /**
   * Returns the active payment client (session key or EOA), or throws if
   * none is available (read-only mode). Required for any on-chain call or
   * signed payment.
   */
  private requirePaymentClient(): KitePaymentClient {
    if (!this.paymentClient) {
      throw new Error(
        "This operation requires a wallet credential.\n" +
          "  Run: npx kite init  to store your seed phrase or private key.",
      );
    }
    return this.paymentClient;
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
      sessionKey,
      sessionSeed,
      config,
      defaultPaymentMode = "auto",
      allowUnavailableSession = false,
    } = options;

    // ── Agent mode ─────────────────────────────────────────────────────
    if (agentId !== undefined) {
      return KiteSettleClient._createFromStoredSession(
        BigInt(agentId),
        sessionKey,
        defaultPaymentMode,
        sessionSeed,
        config,
        allowUnavailableSession,
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
    const agents = await getUserAgentsWithActiveSessions(eoaClient.address);
    const getAgent = agents?.agents?.[0];
    if (getAgent) {
      try {
        return await KiteSettleClient._createFromStoredSession(
          BigInt(getAgent.agentId),
          undefined,
          defaultPaymentMode,
          sessionSeed,
          config,
        );
      } catch {
        // Session key not yet stored in vars (agent registered on-chain but
        // `kite onboard` not completed, or session key was deleted).
        // Fall through to EOA-only mode so read and wallet operations still work.
      }
    }

    return new KiteSettleClient(
      eoaClient.config,
      eoaClient,
      eoaClient,
      eoaClient.address,
      undefined,
      undefined,
    );
  }

  /**
   * Create a read-only client with no signing capability.
   *
   * Suitable for subgraph queries, static utilities, and any operation that
   * does NOT require message signing or on-chain writes. Calling a method
   * that requires a credential on a read-only client throws a clear error.
   *
   * @example
   * const client = KiteSettleClient.createReadOnly();
   * const agents = await client.getAgentsByOwner("0xabc...");
   */
  static createReadOnly(config?: Partial<KiteConfig>): KiteSettleClient {
    const fullConfig: KiteConfig = {
      ...KITE_TESTNET,
      ...config,
      contracts: {
        ...KITE_TESTNET.contracts,
        ...config?.contracts,
      },
    };
    return new KiteSettleClient(
      fullConfig,
      null,
      null,
      "",
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
    sessionKey: string | undefined,
    defaultPaymentMode: KiteClientOptions["defaultPaymentMode"],
    _sessionSeed?: string | undefined,
    config?: Partial<KiteConfig> | undefined,
    allowUnavailableSession: boolean = false,
  ): Promise<KiteSettleClient> {
    const fullConfig: KiteConfig = {
      ...KITE_TESTNET,
      ...config,
      contracts: {
        ...KITE_TESTNET.contracts,
        ...config?.contracts,
      },
    };
    const readCs = new ContractService(fullConfig, null, "");

    const onchainSessions = await readCs.getAgentSessionsFromRegistry(agentId);
    if (onchainSessions.length === 0) {
      throw new Error(
        `No session key found for agentId=${agentId}.\n` +
          `  Run: npx kite onboard  to register an agent and create a session key.`,
      );
    }

    const indexedSessions = await getSessionsByAgent(
      `0x${agentId.toString(16)}`,
      onchainSessions.length,
      0,
    ).catch(() => [] as IndexedSession[]);
    const indexedByKey = new Map(
      indexedSessions.map((s) => [s.sessionKey.toLowerCase(), s]),
    );

    const now = Math.floor(Date.now() / 1000);
    const selectedSessionKey = sessionKey
      ? ((sessionKey.startsWith("0x")
          ? sessionKey.toLowerCase()
          : `0x${sessionKey.toLowerCase()}`) as `0x${string}`)
      : undefined;

    let selectedIndex = -1;

    if (selectedSessionKey) {
      selectedIndex = onchainSessions.findIndex(
        (key) => key.toLowerCase() === selectedSessionKey,
      );
      if (selectedIndex === -1) {
        throw new Error(
          `Session key ${selectedSessionKey} not found for agentId=${agentId}.`,
        );
      }

      if (!allowUnavailableSession) {
        const indexed = indexedByKey.get(selectedSessionKey.toLowerCase());
        if (!indexed) {
          throw new Error(
            `Session key ${selectedSessionKey} was not found in the indexer for agentId=${agentId}.`,
          );
        }
        if (indexed.status.toUpperCase() !== "ACTIVE") {
          throw new Error(
            `Session key ${selectedSessionKey} is ${indexed.status.toLowerCase()} in the indexer.`,
          );
        }
        if (Number(indexed.validUntil) <= now) {
          throw new Error(`Session key ${selectedSessionKey} is expired.`);
        }

        const [active, , , , , maxValueAllowed, validUntil] =
          (await readCs.validateSession(selectedSessionKey)) as any;
        const spent = await readCs
          .getSessionSpent(selectedSessionKey)
          .catch(() => 0n);
        if (!active) {
          throw new Error(`Session key ${selectedSessionKey} is not active.`);
        }
        if (Number(validUntil) <= now) {
          throw new Error(`Session key ${selectedSessionKey} is expired.`);
        }
        if (spent >= maxValueAllowed) {
          throw new Error(
            `Session key ${selectedSessionKey} has no remaining capacity.`,
          );
        }
      }
    } else {
      for (let i = 0; i < onchainSessions.length; i++) {
        const key = onchainSessions[i];
        try {
          const indexed = indexedByKey.get(key.toLowerCase());
          if (!indexed) continue;
          if (indexed.status.toUpperCase() !== "ACTIVE") continue;
          if (Number(indexed.validUntil) <= now) continue;

          const [active, , , , , maxValueAllowed, validUntil] =
            (await readCs.validateSession(key)) as any;
          if (!active || Number(validUntil) <= now) continue;
          const spent = await readCs.getSessionSpent(key).catch(() => 0n);
          if (spent < maxValueAllowed) {
            selectedIndex = i;
            break;
          }
        } catch {
          // Skip invalid / partially indexed sessions and continue scanning.
        }
      }
    }

    if (selectedIndex === -1) {
      if (selectedSessionKey) {
        throw new Error(
          `Session key ${selectedSessionKey} is unavailable for payments (inactive, expired, or exhausted).`,
        );
      }
      throw new Error(
        `No available active session key with remaining capacity found for agentId=${agentId}.`,
      );
    }

    const resolvedSessionKey = onchainSessions[selectedIndex].toLowerCase();
    const resolvedSessionIndex = selectedIndex;
    const pkVar = `SESSION_${agentId}_${resolvedSessionIndex}_PRIVATE_KEY`;

    // ── Resolve session private key (plain — no encryption) ──────────
    let sessionPrivateKey: `0x${string}` | undefined = getVar(pkVar) as
      | `0x${string}`
      | undefined;

    if (!sessionPrivateKey) {
      for (let i = 0; i < onchainSessions.length; i++) {
        const maybeAddress = getVar(`SESSION_${agentId}_${i}_ADDRESS`);
        if (maybeAddress?.toLowerCase() === resolvedSessionKey) {
          const maybePk = getVar(`SESSION_${agentId}_${i}_PRIVATE_KEY`) as
            | `0x${string}`
            | undefined;
          if (maybePk) {
            sessionPrivateKey = maybePk;
            break;
          }
        }
      }
    }

    if (!sessionPrivateKey) {
      const keyPrefix = `SESSION_${agentId}_`;
      const keySuffix = `_PRIVATE_KEY`;
      for (const keyName of listVars()) {
        if (!keyName.startsWith(keyPrefix) || !keyName.endsWith(keySuffix)) {
          continue;
        }
        const maybePk = getVar(keyName) as `0x${string}` | undefined;
        if (!maybePk) continue;
        try {
          const addr = privateKeyToAccount(maybePk).address.toLowerCase();
          if (addr === resolvedSessionKey) {
            sessionPrivateKey = maybePk;
            setVar(pkVar, maybePk);
            break;
          }
        } catch {
          // Ignore malformed private key entries and continue scanning.
        }
      }
    }

    if (!sessionPrivateKey) {
      // Fallback: re-derive deterministically from a stored EOA private key.
      // Useful for agents onboarded before the plain-key migration, or when
      // the session private key var was manually deleted.
      const eoaKeyCandidates = [getCredential(), getVar("DEPLOYER_KEY")].filter(
        Boolean,
      ) as string[];

      outer: for (const eoaKeyHex of eoaKeyCandidates) {
        const eoaKeyBytes = new Uint8Array(
          Buffer.from(eoaKeyHex.replace(/^0x/, ""), "hex"),
        );
        for (const attempt of [
          () =>
            deriveSessionForAgent(eoaKeyBytes, agentId, resolvedSessionIndex),
          () =>
            deriveSessionAccount(
              eoaKeyBytes,
              Number(agentId),
              resolvedSessionIndex,
            ),
        ]) {
          const derived = await attempt();
          if (derived.address.toLowerCase() === resolvedSessionKey) {
            sessionPrivateKey = derived.privateKey;
            // Persist for next time so derivation isn't needed again
            setVar(pkVar, derived.privateKey);
            setVar(
              `SESSION_${agentId}_${resolvedSessionIndex}_ADDRESS`,
              derived.address,
            );
            break outer;
          }
        }
      }
    }

    if (!sessionPrivateKey) {
      throw new Error(
        `Session private key not found for agentId=${agentId}.\n` +
          `  Expected var: ${pkVar}\n` +
          `  Run: npx kite onboard  to recreate the session key.`,
      );
    }

    const [, , owner] = (await readCs.validateSession(
      resolvedSessionKey,
    )) as any;
    const eoaAddress = owner as string;

    const paymentClient = await KitePaymentClient.create({
      seedPhrase: sessionPrivateKey,
      config,
      agentId: agentId.toString(),
      defaultPaymentMode,
      sessionKey: resolvedSessionKey,
      eoaAddress,
    });

    // In agent-only mode we do NOT have the EOA private key — eoaClient is null.
    // Write operations that require the wallet owner (deposit, withdraw, onboard)
    // will throw with a clear message. Read-only ops and payment signing work fine.
    return new KiteSettleClient(
      paymentClient.config,
      null,
      paymentClient,
      eoaAddress,
      resolvedSessionKey,
      sessionPrivateKey,
    );
  }

  /**
   * Build an agent-mode client from the vars store.
   *
   * Convenience wrapper around `create({ agentId, sessionKey, sessionSeed })`.
   *
   * @param agentId      On-chain agentId (NFT tokenId from IdentityRegistry).
   * @param sessionKey   Optional explicit session key address.
   * @param sessionSeed  Decryption password. Falls back to the AGENT_SEED var.
   * @param options      Optional config / mode overrides.
   */
  static async fromAgent(
    agentId: bigint | string | number,
    sessionKey?: string,
    sessionSeed?: string,
    options: Pick<
      KiteSettleClientOptions,
      "config" | "defaultPaymentMode"
    > = {},
  ): Promise<KiteSettleClient> {
    return KiteSettleClient.create({
      agentId,
      sessionKey,
      sessionSeed,
      ...options,
    });
  }

  /**
   * Create a client from the EOA credential stored by `kite init`
   * (~/.kite-agent-pay/config.json).
   */
  static async fromStoredCredential(
    options: Omit<KiteSettleClientOptions, "credential" | "agentId"> = {},
  ): Promise<KiteSettleClient> {
    const credential = getCredential();
    if (!credential) {
      throw new Error("No credential found. Run: npx kite init");
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
      this.requireEoaClient().getPrivateKey(),
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
    return this.requirePaymentClient().fetch(url, init, options);
  }

  /**
   * Make a single paid API call and return a structured result.
   *
   * This is the high-level entry point shared by the CLI (perCall/auto
   * modes) and the MCP tool. It:
   *  1. Probes the URL — returns early if the endpoint does not require payment.
   *  2. On a 402 challenge, delegates to `fetchWithPayment` which routes
   *     via batch / channel / perCall according to `options.mode` and any
   *     active sessions / channels that were pre-registered.
   *  3. Returns a structured `CallPaidApiResult` with the response body and
   *     a payment receipt.
   *
   * The caller must have been created with a credential (agent mode or EOA
   * mode). A read-only client throws when `fetchWithPayment` is called.
   *
   * @example
   * const client = await KiteSettleClient.create({ agentId: 1n });
   * const result = await client.callPaidApi("https://api.example.com/data");
   */
  async callPaidApi(
    url: string,
    options: CallPaidApiOptions = {},
  ): Promise<CallPaidApiResult> {
    const {
      method = "GET",
      body,
      headers = {},
      mode = "auto",
      maxAmount,
      autopay = true,
      onPaymentRequired,
      onPayment,
    } = options;

    const initHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...headers,
    };
    const init: RequestInit = { method, headers: initHeaders };
    if (body && (method === "POST" || method === "PUT")) {
      init.body = body;
    }

    // ── 1. Probe: no payment headers yet ──────────────────────────────
    const probe = await globalThis.fetch(url, init);

    if (probe.status !== 402) {
      const text = await probe.text();
      return { status: probe.status, data: _tryParseJSON(text), payment: null };
    }

    // ── 2. Not paying? Return 402 early ───────────────────────────────
    if (!autopay) {
      const text = await probe.text().catch(() => "");
      return {
        status: 402,
        data: _tryParseJSON(text) ?? { error: "Payment required but autopay is disabled" },
        payment: null,
      };
    }

    // ── 3. Enforce maxAmount cap before paying ─────────────────────────
    if (maxAmount !== undefined) {
      const challengeText = await probe.text();
      const challenge = JSON.parse(challengeText) as {
        accepts?: Array<{ maxAmountRequired?: string }>;
      };
      const offered = BigInt(challenge.accepts?.[0]?.maxAmountRequired ?? "0");
      if (offered > maxAmount) {
        throw new Error(
          `Provider price ${offered} wei exceeds your maxAmount cap ${maxAmount} wei.`,
        );
      }
    }

    // ── 4. Pay via the unified interceptor ───────────────────────────
    let capturedPayment: CallPaidApiResult["payment"] = null;

    const response = await this.fetchWithPayment(url, init, {
      paymentMode: mode,
      maxPaymentPerCall: maxAmount,
      onPaymentRequired,
      onPayment: (result) => {
        capturedPayment = {
          method: result.method,
          amount: result.amount.toString(),
          txHash: result.txHash,
        };
        onPayment?.(result);
      },
    });

    const responseText = await response.text();
    return {
      status: response.status,
      data: _tryParseJSON(responseText),
      payment: capturedPayment,
    };
  }

  // ── Wallet ────────────────────────────────────────────────────

  /**
   * Deposited (KiteAAWallet) balance.
   * @param token   Token address (defaults to the configured token).
   * @param address Target address to query (defaults to `this.eoaAddress`).
   *
   * Read-only — works in agent mode and EOA mode; not available in read-only mode.
   */
  async getDepositedBalance(token?: string, address?: string): Promise<bigint> {
    return this.requirePaymentClient()
      .getContractService()
      .getDepositedTokenBalance(
        (token ?? this.config.token) as `0x${string}`,
        (address ?? this.eoaAddress) as `0x${string}`,
      );
  }

  /**
   * Raw ERC-20 wallet balance (not deposited into KiteAAWallet).
   * @param token   Token address (defaults to the configured token).
   * @param address Target address to query (defaults to `this.eoaAddress`).
   *
   * Read-only — works in agent mode and EOA mode; not available in read-only mode.
   */
  async getWalletBalance(token?: string, address?: string): Promise<bigint> {
    return this.requirePaymentClient()
      .getContractService()
      .getTokenBalance(
        (token ?? this.config.token) as `0x${string}`,
        (address ?? this.eoaAddress) as `0x${string}`,
      );
  }

  /**
   * Native (gas token) balance for an address.
   * @param address Target address (defaults to `this.eoaAddress`).
   */
  async getNativeBalance(address?: string): Promise<bigint> {
    return this.requirePaymentClient()
      .getContractService()
      .getNativeBalance((address ?? this.eoaAddress) as `0x${string}`)
      .catch(() => 0n);
  }

  /**
   * Full balance snapshot for an address: wallet balances + vault deposited balances.
   *
   * Works for any EOA — no credential required (read-only RPC calls only).
   * Use `options.address` to query a different address than this client's own EOA.
   * Use `options.tokens` to add extra token addresses on top of the default TOKENS list.
   *
   * @example
   * // Self balance
   * const result = await client.balance();
   * // External address
   * const result = await client.balance({ address: "0xabc…" });
   * // With extra token
   * const result = await client.balance({ tokens: ["0xTokenAddr"] });
   */
  async balance(options?: {
    /** EOA address to query. Defaults to this client's own EOA. */
    address?: string;
    /** Additional token addresses to include alongside the default TOKENS list. */
    tokens?: string[];
  }): Promise<BalanceResult> {
    const targetEoa = options?.address ?? this.eoaAddress;

    // Prefer the existing payment client's contract service; fall back to a
    // minimal read-only one so this works on createReadOnly() clients too.
    const cs: ContractService =
      this.paymentClient?.getContractService() ??
      new ContractService(this.config, { getAddress: () => targetEoa });

    const aaWalletAddress = await cs.resolveVaultWalletAddressFor(targetEoa);

    // Native (KITE) token is always shown.
    const nativeMeta = TOKENS.find(
      (t) => t.address.toLowerCase() === zeroAddress.toLowerCase(),
    ) ?? { address: zeroAddress, symbol: "KITE", decimals: 18 };

    // If the caller specifies tokens, show only those + native.
    // If no filter is given (empty or omitted), show all configured tokens.
    type TokenMeta = { address: string; symbol: string; decimals: number };
    let tokenList: TokenMeta[];
    if (options?.tokens && options.tokens.length > 0) {
      const requestedMeta = options.tokens.map((addr): TokenMeta => {
        const known = TOKENS.find(
          (t) => t.address.toLowerCase() === addr.toLowerCase(),
        );
        return (
          known ?? {
            address: addr,
            symbol: addr.slice(0, 8) + "…",
            decimals: 18,
          }
        );
      });
      // Prepend native, skipping duplicates.
      tokenList = [
        nativeMeta,
        ...requestedMeta.filter(
          (e) => e.address.toLowerCase() !== zeroAddress.toLowerCase(),
        ),
      ];
    } else {
      tokenList = [...TOKENS];
    }

    const results = await Promise.all(
      tokenList.map(async (meta) => {
        const isNative =
          meta.address.toLowerCase() === zeroAddress.toLowerCase();
        const [walletBalance, depositedBalance] = await Promise.all([
          isNative
            ? cs.getNativeBalance(targetEoa).catch(() => 0n)
            : cs
                .getTokenBalance(
                  meta.address as `0x${string}`,
                  targetEoa as `0x${string}`,
                )
                .catch(() => 0n),
          isNative
            ? cs.getDeposit(aaWalletAddress).catch(() => 0n)
            : cs
                .getAvailableBalance(
                  aaWalletAddress,
                  meta.address as `0x${string}`,
                )
                .catch(() => 0n),
        ]);
        return {
          token: meta.address,
          symbol: meta.symbol ?? "?",
          decimals: meta.decimals ?? 18,
          walletBalance,
          walletBalanceFormatted: formatUnits(
            walletBalance,
            meta.decimals ?? 18,
          ),
          depositedBalance,
          depositedBalanceFormatted: formatUnits(
            depositedBalance,
            meta.decimals ?? 18,
          ),
        } satisfies TokenBalance;
      }),
    );

    return { eoaAddress: targetEoa, aaWalletAddress, tokens: results };
  }

  /** Access low-level contract helpers for advanced CLI and SDK flows. */
  getContractService(): ContractService {
    return this.requirePaymentClient().getContractService();
  }

  /** Deposit tokens into the configured wallet contract. Requires EOA credential. */
  async deposit(amount: bigint, token?: string): Promise<string> {
    return this.requireEoaClient().depositToWallet(
      amount,
      token ?? this.config.token,
    );
  }

  /** Withdraw tokens from the configured wallet contract back to the EOA. Requires EOA credential. */
  async withdraw(amount: bigint, token?: string): Promise<string> {
    return this.requireEoaClient().withdrawFromWallet(
      amount,
      token ?? this.config.token,
    );
  }

  // ── Identity / Registration Status ──────────────────────────

  /**
   * Check legacy KiteAAWallet registration status for an address.
   * Note: onboarding no longer depends on this flag.
   */
  async isRegistered(address?: string): Promise<boolean> {
    return this.requirePaymentClient()
      .getContractService()
      .isUserRegistered(address ?? this.eoaAddress);
  }

  // ── Agent & Session Registration ─────────────────────────────

  /**
   * Full onboarding: ensure AA wallet → register agentId → create session key + session rule.
   * Requires EOA credential.
   */
  async onboard(
    options: OnboardOptions,
    onStep?: (step: string) => void,
  ): Promise<OnboardResult> {
    return this.requireEoaClient().onboard(options, onStep);
  }

  /** Register an agent on-chain at a specific index. Requires EOA credential. */
  async registerAgent(
    metadata: `0x${string}`,
    agentIndex = 0,
    walletContract?: string,
  ): Promise<{ txHash: string; agentId: bigint }> {
    return this.requireEoaClient()
      .getContractService()
      .registerAgentOnRegistry(metadata);
  }

  /**
   * Register a session key rule on IdentityRegistry for an existing agent.
   * The session key must already exist on the vault.
   */
  async registerSessionKey(
    agentId: bigint,
    sessionKey: string,
    sessionIndex: number,
    validUntil: number,
  ): Promise<string> {
    const cs = this.requireEoaClient().getContractService();
    let walletContract = this.config.contracts.kiteAAWallet;

    if (this.config.contracts.walletFactory) {
      const resolved = await cs.getWalletFromFactory(this.eoaAddress);
      if (
        resolved &&
        resolved !== "0x0000000000000000000000000000000000000000"
      ) {
        walletContract = resolved;
      }
    }

    if (!walletContract) {
      throw new Error(
        "Unable to resolve wallet contract for session registration. Configure contracts.walletFactory or contracts.kiteAAWallet.",
      );
    }

    return cs.registerSessionOnRegistry({
      agentId,
      sessionKey,
      user: this.eoaAddress,
      walletContract,
      validUntil: BigInt(validUntil),
      blockedAgents: [],
    });
  }

  /** Resolve an agent by its on-chain ID → owner address. */
  async resolveAgent(agentId: bigint | string) {
    const id = typeof agentId === "string" ? BigInt(agentId) : agentId;
    return this.requirePaymentClient()
      .getContractService()
      .getAgentOwner(id)
      .catch(() => null);
  }

  /** Derive owner AA wallet (ClientVault) from the active EOA address. */
  async getOwnerAAWalletAddress(): Promise<string> {
    return this.requirePaymentClient()
      .getContractService()
      .resolveOwnerVaultWalletAddress();
  }

  /** Look up an agent by its on-chain ID (agentId = bigint tokenId). */
  async getAgent(agentId: bigint) {
    return this.requirePaymentClient()
      .getContractService()
      .getAgentURI(agentId);
  }

  /**
   * Decode agentURI metadata when it is JSON, base64 JSON, or data URI with base64 JSON.
   * Returns null when metadata cannot be decoded into a JSON object.
   */
  decodeAgentMetadataURI(agentURI: string): AgentMetadataSummary | null {
    const trimmed = agentURI.trim();
    const parseObject = (text: string): Record<string, unknown> | null => {
      try {
        const parsed = JSON.parse(text);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          !Array.isArray(parsed)
        ) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // ignore parsing errors and try other decode paths
      }
      return null;
    };

    const extractSummary = (
      obj: Record<string, unknown>,
    ): AgentMetadataSummary => {
      const name = typeof obj.name === "string" ? obj.name.trim() : undefined;
      const descValue =
        typeof obj.description === "string"
          ? obj.description
          : typeof obj.shortDescription === "string"
            ? obj.shortDescription
            : undefined;

      const shortDescription = descValue?.replace(/\s+/g, " ").trim();
      return {
        name: name || undefined,
        shortDescription: shortDescription || undefined,
        raw: obj,
      };
    };

    if (trimmed.startsWith("{")) {
      const obj = parseObject(trimmed);
      return obj ? extractSummary(obj) : null;
    }

    const dataUriPrefix = "data:application/json;base64,";
    if (trimmed.toLowerCase().startsWith(dataUriPrefix)) {
      const b64 = trimmed.slice(dataUriPrefix.length);
      try {
        const obj = parseObject(Buffer.from(b64, "base64").toString("utf8"));
        return obj ? extractSummary(obj) : null;
      } catch {
        return null;
      }
    }

    try {
      const obj = parseObject(Buffer.from(trimmed, "base64").toString("utf8"));
      return obj ? extractSummary(obj) : null;
    } catch {
      return null;
    }
  }

  /** Update the agentURI stored on IdentityRegistry. Requires EOA credential. */
  async updateAgentURI(agentId: bigint, newURI: string): Promise<string> {
    return this.requireEoaClient()
      .getContractService()
      .setAgentURI(agentId, newURI);
  }

  // ── Payment Channels ─────────────────────────────────────────

  /** Open a new payment channel with a provider. */
  async openChannel(
    channelConfig: ChannelConfig,
  ): Promise<{ txHash: string; channelId: `0x${string}` }> {
    const resolvedConfig = { ...channelConfig };

    if (!resolvedConfig.walletContract && this.sessionKeyAddress) {
      const walletContract = await this.requirePaymentClient()
        .getContractService()
        .resolveWalletContractForSession(this.sessionKeyAddress)
        .catch(() => null);
      if (walletContract) {
        resolvedConfig.walletContract = walletContract;
      }
    }

    return this.requirePaymentClient().openChannel(resolvedConfig);
  }

  /** Activate a payment channel (provider-side confirmation). */
  async activateChannel(channelId: `0x${string}`): Promise<string> {
    return this.requirePaymentClient().activateChannel(channelId);
  }

  /** Initiate settlement of a payment channel. */
  async initiateSettlement(
    channelId: `0x${string}`,
    merkleRoot?: `0x${string}`,
  ): Promise<string> {
    return this.requirePaymentClient().initiateSettlement(
      channelId,
      merkleRoot,
    );
  }

  /**
   * Initiate settlement with an explicit provider-signed receipt claim.
   * Useful for CLI flows that reconstruct receipts from local persisted state.
   */
  async initiateSettlementWithReceipt(
    channelId: `0x${string}`,
    sequenceNumber: number,
    cumulativeCost: bigint,
    timestamp: number,
    providerSignature: `0x${string}`,
    merkleRoot?: `0x${string}`,
  ): Promise<string> {
    return this.requirePaymentClient()
      .getContractService()
      .initiateSettlement(
        channelId,
        sequenceNumber,
        cumulativeCost,
        timestamp,
        providerSignature,
        merkleRoot,
      );
  }

  /** Finalize (close) a payment channel. */
  async finalizeChannel(
    channelId: `0x${string}`,
    merkleRoot?: `0x${string}`,
  ): Promise<string> {
    return this.requirePaymentClient().finalize(channelId, merkleRoot);
  }

  /** Force-close an expired channel. */
  async forceCloseChannel(channelId: `0x${string}`): Promise<string> {
    return this.requirePaymentClient().forceCloseExpired(channelId);
  }

  /**
   * Register a channel for a provider so that `fetchWithPayment` routes
   * through it automatically (channel payment mode).
   */
  setChannelForProvider(provider: string, channelId: `0x${string}`): void {
    this.requirePaymentClient().setChannelForProvider(provider, channelId);
  }

  /** Get the on-chain state of a channel. */
  async getChannel(channelId: `0x${string}`): Promise<ChannelState> {
    return this.requirePaymentClient().getChannel(channelId);
  }

  /** Get settlement state of a channel. */
  async getSettlementState(channelId: `0x${string}`) {
    return this.requirePaymentClient().getSettlementState(channelId);
  }

  /** Submit a receipt to the channel (provider-side). */
  async submitReceipt(
    channelId: `0x${string}`,
    receipt: Receipt,
  ): Promise<string> {
    return this.requirePaymentClient().submitReceipt(channelId, receipt);
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
    return this.requirePaymentClient().signReceiptAsProvider(
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
    return this.requirePaymentClient().verifyAndStoreReceipt(
      channelId,
      receipt,
      providerAddress,
      ratePerCall,
    );
  }

  /** Get all stored receipts for a channel. */
  getChannelReceipts(channelId: `0x${string}`): Receipt[] {
    return this.requirePaymentClient().getReceipts(channelId);
  }

  // ── Batch Sessions ────────────────────────────────────────────

  /** Start a batch payment session with a provider. */
  startBatchSession(
    provider: string,
    deposit: bigint,
    limits?: BatchLimits,
  ): BatchSession {
    return this.requirePaymentClient().startBatchSession(
      provider,
      deposit,
      limits,
    );
  }

  /** End a batch payment session. */
  endBatchSession(sessionId: string, reason?: BatchEndReason) {
    return this.requirePaymentClient().endBatchSession(sessionId, reason);
  }

  /** Get a batch session by ID. */
  getBatchSession(sessionId: string): BatchSession | null {
    return this.requirePaymentClient().getBatchSession(sessionId);
  }

  /** Get all active batch sessions. */
  getActiveBatchSessions(): BatchSession[] {
    return this.requirePaymentClient().getActiveBatchSessions();
  }

  /** Check if a batch session can afford a call. */
  canAffordBatchCall(sessionId: string, callCost: bigint): boolean {
    return this.requirePaymentClient().canAffordBatchCall(sessionId, callCost);
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
    return this.requirePaymentClient().getUsageLogs();
  }

  /** Get the total amount spent in this session. */
  getTotalSpent(): bigint {
    return this.requirePaymentClient().getTotalSpent();
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

  /**
   * Build a lightweight read-only ContractService from this instance's config.
   * Works even when the client was created with `createReadOnly()` (no credential).
   */
  private readOnlyCs(): ContractService {
    return (
      this.paymentClient?.getContractService() ??
      new ContractService(this.config, { getAddress: () => "" })
    );
  }

  /**
   * Fetch on-chain spending data for a session from the ClientAgentVault.
   * Returns the first spending rule's budget/usage (the common case) plus the
   * full rules array.  Falls back to `fallbackMaxAmount` / `0n` when no rules
   * are configured or when the contract call fails.
   */
  private async resolveSessionSpend(
    cs: ContractService,
    walletContract: `0x${string}`,
    sessionId: string,
    fallbackMaxAmount: bigint,
  ): Promise<{
    maxAmount: bigint;
    spent: bigint;
    spendingRules: SessionInfo["spendingRules"];
  }> {
    const rules = await cs
      .getVaultSpendingRules(walletContract, sessionId as `0x${string}`)
      .catch(
        () =>
          [] as Awaited<ReturnType<ContractService["getVaultSpendingRules"]>>,
      );

    const enrichedRules: SessionInfo["spendingRules"] = rules.map((r) => {
      const budget = r.rule.budget;
      const used = r.usage.amountUsed;
      const rem = budget > used ? budget - used : 0n;
      return {
        timeWindow: r.rule.timeWindow.toString(),
        budget: budget.toString(),
        budgetFormatted: formatUnits(budget, 18),
        amountUsed: used.toString(),
        amountUsedFormatted: formatUnits(used, 18),
        remainingInWindow: rem.toString(),
        remainingInWindowFormatted: formatUnits(rem, 18),
        windowStartTime: r.usage.currentTimeWindowStartTime.toString(),
      };
    });

    if (enrichedRules.length === 0) {
      return { maxAmount: fallbackMaxAmount, spent: 0n, spendingRules: [] };
    }

    // Use the first rule as the primary budget/spent (most deployments have one).
    const primary = rules[0];
    return {
      maxAmount: primary.rule.budget,
      spent: primary.usage.amountUsed,
      spendingRules: enrichedRules,
    };
  }

  /**
   * List enriched session snapshots for an agent, including spent/remaining amounts.
   *
   * @param agentId  On-chain agentId (numeric or hex string).
   * @param options  Pagination and optional agentId normalization.
   */
  async listSessions(
    agentId: string | bigint | number,
    options: { limit?: number; offset?: number } = {},
  ): Promise<SessionInfo[]> {
    const entityId = `0x${BigInt(agentId).toString(16)}`;
    const { limit = 10, offset = 0 } = options;
    const sessions = await getSessionsByAgent(entityId, limit, offset);

    const cs = this.readOnlyCs();
    // Resolve wallet contract once per agent — all sessions share the same vault.
    const agent = await getAgentById(`0x${BigInt(agentId).toString(16)}`).catch(
      () => null,
    );
    const agentWallet = (agent?.owner.aaWallet.address ||
      zeroAddress) as `0x${string}`;

    return Promise.all(
      sessions.map(async (session) => {
        const fallbackMax = BigInt(session.maxLimit ?? "0");
        const { maxAmount, spent, spendingRules } = agentWallet
          ? await this.resolveSessionSpend(
              cs,
              agentWallet,
              session.sessionId,
              fallbackMax,
            )
          : {
              maxAmount: fallbackMax,
              spent: 0n,
              spendingRules: [] as SessionInfo["spendingRules"],
            };

        const remaining = maxAmount > spent ? maxAmount - spent : 0n;
        return {
          sessionKey: session.sessionKey,
          sessionId: session.sessionId,
          agentId: session.agent?.agentId ?? session.agentId ?? String(agentId),
          status: effectiveSessionStatus(session),
          validUntil: session.validUntil,
          validUntilFormatted: new Date(Number(session.validUntil) * 1000)
            .toISOString()
            .replace("T", " ")
            .replace(".000Z", " UTC"),
          maxAmount: maxAmount.toString(),
          maxAmountFormatted: formatUnits(maxAmount, 18),
          valueLimit: session.valueLimit ?? "0",
          valueLimitFormatted: formatUnits(
            BigInt(session.valueLimit ?? "0"),
            18,
          ),
          spent: spent.toString(),
          spentFormatted: formatUnits(spent, 18),
          remaining: remaining.toString(),
          remainingFormatted: formatUnits(remaining, 18),
          blockedAgents: session.blockedAgents ?? [],
          createdAt: session.createdAt,
          spendingRules,
        } satisfies SessionInfo;
      }),
    );
  }

  /**
   * Get an enriched snapshot for a single session key.
   * Returns `null` if not found in the indexer.
   */
  async getSessionInfo(sessionKey: string): Promise<SessionInfo | null> {
    const session = await getSessionByKey(sessionKey).catch(() => null);
    if (!session) return null;

    const cs = this.readOnlyCs();
    const rawAgentId = session.agent?.agentId ?? session.agentId;
    const agent = await getAgentById(
      `0x${BigInt(rawAgentId).toString(16)}`,
    ).catch(() => null);
    const agentWallet = (agent?.owner.aaWallet.address ||
      zeroAddress) as `0x${string}`;

    const fallbackMax = BigInt(session.maxLimit ?? "0");
    const { maxAmount, spent, spendingRules } = agentWallet
      ? await this.resolveSessionSpend(
          cs,
          agentWallet,
          session.sessionId,
          fallbackMax,
        )
      : {
          maxAmount: fallbackMax,
          spent: 0n,
          spendingRules: [] as SessionInfo["spendingRules"],
        };

    const remaining = maxAmount > spent ? maxAmount - spent : 0n;

    return {
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      agentId: rawAgentId ?? "",
      status: effectiveSessionStatus(session),
      validUntil: session.validUntil,
      validUntilFormatted: new Date(Number(session.validUntil) * 1000)
        .toISOString()
        .replace("T", " ")
        .replace(".000Z", " UTC"),
      maxAmount: maxAmount.toString(),
      maxAmountFormatted: formatUnits(maxAmount, 18),
      valueLimit: session.valueLimit ?? "0",
      valueLimitFormatted: formatUnits(BigInt(session.valueLimit ?? "0"), 18),
      spent: spent.toString(),
      spentFormatted: formatUnits(spent, 18),
      remaining: remaining.toString(),
      remainingFormatted: formatUnits(remaining, 18),
      blockedAgents: session.blockedAgents ?? [],
      createdAt: session.createdAt,
      spendingRules,
    };
  }

  /**
   * List enriched channel snapshots for an agent.
   *
   * @param agentId  On-chain agentId (numeric or hex string).
   * @param options  Pagination options.
   */
  async listChannels(
    agentId: string | bigint | number,
    options: { limit?: number; offset?: number } = {},
  ): Promise<ChannelInfo[]> {
    const entityId = `0x${BigInt(agentId).toString(16)}`;
    const { limit = 10, offset = 0 } = options;
    const channels = await getChannelsByAgent(entityId, limit, offset);
    return channels.map((ch) => enrichChannel(ch));
  }

  /**
   * Get an enriched snapshot for a single channel by its channelId.
   * Returns `null` if not found in the indexer.
   */
  async getChannelInfo(channelId: string): Promise<ChannelInfo | null> {
    const ch = await getChannelById(channelId).catch(() => null);
    if (!ch) return null;
    return enrichChannel(ch);
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
   * Throws if the client is in read-only mode (no credential).
   */
  getPaymentClient(): KitePaymentClient {
    return this.requirePaymentClient();
  }

  /**
   * Access the EOA-level KitePaymentClient.
   * Throws if the client was created in agent-only or read-only mode.
   */
  getEoaClient(): KitePaymentClient {
    return this.requireEoaClient();
  }
}
