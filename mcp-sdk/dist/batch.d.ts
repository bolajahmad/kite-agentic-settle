import type { BatchSession, Receipt } from "./types.js";
export interface BatchLimits {
    maxDurationSeconds?: number;
    maxCalls?: number;
    maxDeposit?: bigint;
}
export type BatchEndReason = "manual" | "time-limit" | "budget-exhausted" | "max-calls";
export declare class BatchManager {
    private sessions;
    private providerSessions;
    private sessionLimits;
    startSession(consumer: string, provider: string, deposit: bigint, limits?: BatchLimits): BatchSession;
    hasActiveSession(provider: string): boolean;
    getSessionForProvider(provider: string): BatchSession | null;
    getSession(sessionId: string): BatchSession | null;
    canAfford(sessionId: string, callCost: bigint): boolean;
    checkSessionHealth(sessionId: string, callCost: bigint): {
        ok: boolean;
        reason?: BatchEndReason;
        detail?: string;
    };
    remainingDeposit(sessionId: string): bigint;
    recordCall(sessionId: string, callCost: bigint, privateKey: Uint8Array, signerAddress: string, providerAddress: string, requestHash?: string, responseHash?: string): Promise<Receipt>;
    endSession(sessionId: string, reason?: BatchEndReason): {
        session: BatchSession;
        finalReceipt: Receipt | null;
        refund: bigint;
        reason: BatchEndReason;
    };
    getActiveSessions(): BatchSession[];
}
