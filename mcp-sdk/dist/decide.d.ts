import type { PaymentRequest } from "./types.js";
import type { AgentRules } from "./agents.js";
export type Decision = "approve" | "reject" | "unclear";
export type DecisionMode = "auto" | "rules" | "ai" | "cli";
export interface DecisionContext {
    request: PaymentRequest;
    rules: AgentRules;
    balance: bigint;
    totalSpentThisSession: bigint;
    callCount: number;
    openaiApiKey?: string;
    model?: string;
}
export interface DecisionResult {
    decision: "approve" | "reject";
    reason: string;
    tier: "rules" | "cost" | "llm" | "cli";
}
export declare function checkRules(ctx: DecisionContext): {
    decision: Decision;
    reason?: string;
};
export declare function checkCostModel(ctx: DecisionContext): {
    decision: Decision;
    reason?: string;
};
export declare function askLLM(ctx: DecisionContext): Promise<{
    decision: Decision;
    reason?: string;
}>;
export declare function decide(ctx: DecisionContext, mode?: DecisionMode): Promise<DecisionResult>;
