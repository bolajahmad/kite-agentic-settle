import { keccak256, toBytes } from "viem";
import { createSignedReceipt } from "./receipt.js";
import type { BatchSession, Receipt } from "./types.js";

export interface BatchLimits {
  maxDurationSeconds?: number; // auto-expire session after N seconds
  maxCalls?: number;           // auto-expire session after N calls
  maxDeposit?: bigint;         // cap on deposit amount
}

export type BatchEndReason = "manual" | "time-limit" | "budget-exhausted" | "max-calls";

// Manages A2 batched payment sessions.
// Flow: deposit upfront -> make calls (accumulate signed receipts) -> settle batch
// Before each call the manager checks that the deposit has not been exhausted.
export class BatchManager {
  private sessions: Map<string, BatchSession> = new Map();
  // provider (lowercase) -> sessionId for quick lookup
  private providerSessions: Map<string, string> = new Map();
  // limits per session
  private sessionLimits: Map<string, BatchLimits> = new Map();

  // Start a new batch session with a provider.
  // The deposit should already be transferred on-chain before calling this.
  startSession(
    consumer: string,
    provider: string,
    deposit: bigint,
    limits?: BatchLimits
  ): BatchSession {
    if (limits?.maxDeposit && deposit > limits.maxDeposit) {
      throw new Error(`Deposit ${deposit} exceeds max allowed ${limits.maxDeposit}`);
    }

    const raw = `${consumer}:${provider}:${Date.now()}`;
    const sessionId = keccak256(toBytes(raw));

    const session: BatchSession = {
      sessionId,
      consumer,
      provider: provider.toLowerCase(),
      deposit,
      cumulativeCost: 0n,
      nonce: 0,
      receipts: [],
      createdAt: Math.floor(Date.now() / 1000),
    };

    this.sessions.set(sessionId, session);
    this.providerSessions.set(provider.toLowerCase(), sessionId);
    if (limits) this.sessionLimits.set(sessionId, limits);
    return session;
  }

  hasActiveSession(provider: string): boolean {
    return this.providerSessions.has(provider.toLowerCase());
  }

  getSessionForProvider(provider: string): BatchSession | null {
    const sid = this.providerSessions.get(provider.toLowerCase());
    if (!sid) return null;
    return this.sessions.get(sid) || null;
  }

  getSession(sessionId: string): BatchSession | null {
    return this.sessions.get(sessionId) || null;
  }

  // Check if the session can afford an additional call of the given cost
  canAfford(sessionId: string, callCost: bigint): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    return session.cumulativeCost + callCost <= session.deposit;
  }

  // Check why a session would be blocked (for detailed error messages)
  checkSessionHealth(sessionId: string, callCost: bigint): { ok: boolean; reason?: BatchEndReason; detail?: string } {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, reason: "manual", detail: "Session not found" };

    const limits = this.sessionLimits.get(sessionId);

    // Time limit
    if (limits?.maxDurationSeconds) {
      const elapsed = Math.floor(Date.now() / 1000) - session.createdAt;
      if (elapsed >= limits.maxDurationSeconds) {
        return {
          ok: false,
          reason: "time-limit",
          detail: `Session expired: ${elapsed}s elapsed, limit is ${limits.maxDurationSeconds}s`,
        };
      }
    }

    // Max calls
    if (limits?.maxCalls && session.nonce >= limits.maxCalls) {
      return {
        ok: false,
        reason: "max-calls",
        detail: `Max calls reached: ${session.nonce}/${limits.maxCalls}`,
      };
    }

    // Budget
    if (session.cumulativeCost + callCost > session.deposit) {
      return {
        ok: false,
        reason: "budget-exhausted",
        detail: `Deposit exhausted: deposit=${session.deposit}, spent=${session.cumulativeCost}, callCost=${callCost}`,
      };
    }

    return { ok: true };
  }

  // Remaining deposit that hasn't been committed to calls yet
  remainingDeposit(sessionId: string): bigint {
    const session = this.sessions.get(sessionId);
    if (!session) return 0n;
    return session.deposit - session.cumulativeCost;
  }

  // Record a call in the batch session and produce a signed receipt.
  // Throws if session limits are exceeded (time, calls, budget).
  async recordCall(
    sessionId: string,
    callCost: bigint,
    privateKey: Uint8Array,
    signerAddress: string,
    providerAddress: string,
    requestHash?: string,
    responseHash?: string
  ): Promise<Receipt> {
    const health = this.checkSessionHealth(sessionId, callCost);
    if (!health.ok) {
      throw new Error(`Batch session blocked [${health.reason}]: ${health.detail}`);
    }

    const session = this.sessions.get(sessionId)!;

    session.nonce += 1;
    session.cumulativeCost += callCost;

    const receipt = await createSignedReceipt(privateKey, {
      requestHash: requestHash || "",
      responseHash: responseHash || "",
      callCost,
      cumulativeCost: session.cumulativeCost,
      nonce: session.nonce,
      timestamp: Math.floor(Date.now() / 1000),
      sessionId,
      provider: providerAddress,
      consumer: signerAddress,
    });

    session.receipts.push(receipt);
    return receipt;
  }

  // End a batch session. Returns the final receipt (highest cumulative cost)
  // which the provider can settle on-chain.
  endSession(sessionId: string, reason: BatchEndReason = "manual"): {
    session: BatchSession;
    finalReceipt: Receipt | null;
    refund: bigint;
    reason: BatchEndReason;
  } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`No batch session ${sessionId}`);
    }

    const finalReceipt = session.receipts.length > 0
      ? session.receipts[session.receipts.length - 1]
      : null;

    const refund = session.deposit - session.cumulativeCost;

    this.sessions.delete(sessionId);
    this.providerSessions.delete(session.provider);
    this.sessionLimits.delete(sessionId);

    return { session, finalReceipt, refund, reason };
  }

  // Get all active sessions
  getActiveSessions(): BatchSession[] {
    return Array.from(this.sessions.values());
  }
}
