export interface AgentRules {
    maxPerCall: string;
    maxPerSession: string;
    allowedProviders: string[];
    blockedProviders: string[];
    requireApprovalAbove: string;
}
export interface BatchConfig {
    maxDeposit: string;
    maxDurationSeconds: number;
    maxCalls: number;
}
export interface AgentConfig {
    name: string;
    seed: string;
    wallet: string;
    rules: AgentRules;
    batch?: BatchConfig;
}
export interface AgentsFile {
    defaultAgent: string;
    agents: Record<string, AgentConfig>;
}
/**
 * Load agents.json from the given path (or default to project root).
 *
 * Seed values starting with "$" are resolved via the vars store
 * (~/.kite-agent-pay/vars.json) first, then fall back to env vars.
 */
export declare function loadAgents(filePath?: string): AgentsFile;
export declare function getAgent(agents: AgentsFile, id?: string): AgentConfig & {
    id: string;
};
