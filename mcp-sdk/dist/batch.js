import { keccak256, toBytes } from "viem";
import { createSignedReceipt } from "./receipt.js";
// Manages A2 batched payment sessions.
// Flow: deposit upfront -> make calls (accumulate signed receipts) -> settle batch
// Before each call the manager checks that the deposit has not been exhausted.
export class BatchManager {
    sessions = new Map();
    // provider (lowercase) -> sessionId for quick lookup
    providerSessions = new Map();
    // limits per session
    sessionLimits = new Map();
    // Start a new batch session with a provider.
    // The deposit should already be transferred on-chain before calling this.
    startSession(consumer, provider, deposit, limits) {
        if (limits?.maxDeposit && deposit > limits.maxDeposit) {
            throw new Error(`Deposit ${deposit} exceeds max allowed ${limits.maxDeposit}`);
        }
        const raw = `${consumer}:${provider}:${Date.now()}`;
        const sessionId = keccak256(toBytes(raw));
        const session = {
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
        if (limits)
            this.sessionLimits.set(sessionId, limits);
        return session;
    }
    hasActiveSession(provider) {
        return this.providerSessions.has(provider.toLowerCase());
    }
    getSessionForProvider(provider) {
        const sid = this.providerSessions.get(provider.toLowerCase());
        if (!sid)
            return null;
        return this.sessions.get(sid) || null;
    }
    getSession(sessionId) {
        return this.sessions.get(sessionId) || null;
    }
    // Check if the session can afford an additional call of the given cost
    canAfford(sessionId, callCost) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return false;
        return session.cumulativeCost + callCost <= session.deposit;
    }
    // Check why a session would be blocked (for detailed error messages)
    checkSessionHealth(sessionId, callCost) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return { ok: false, reason: "manual", detail: "Session not found" };
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
    remainingDeposit(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return 0n;
        return session.deposit - session.cumulativeCost;
    }
    // Record a call in the batch session and produce a signed receipt.
    // Throws if session limits are exceeded (time, calls, budget).
    async recordCall(sessionId, callCost, privateKey, signerAddress, providerAddress, requestHash, responseHash) {
        const health = this.checkSessionHealth(sessionId, callCost);
        if (!health.ok) {
            throw new Error(`Batch session blocked [${health.reason}]: ${health.detail}`);
        }
        const session = this.sessions.get(sessionId);
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
    endSession(sessionId, reason = "manual") {
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
    getActiveSessions() {
        return Array.from(this.sessions.values());
    }
}
