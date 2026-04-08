import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveVar } from "./vars.js";

export interface AgentRules {
  maxPerCall: string; // wei
  maxPerSession: string; // wei
  allowedProviders: string[];
  blockedProviders: string[];
  requireApprovalAbove: string; // wei — amounts above this trigger interactive approval
}

export interface BatchConfig {
  maxDeposit: string; // wei — max deposit allowed for a single batch session
  maxDurationSeconds: number; // auto-settle batch after this many seconds
  maxCalls: number; // auto-settle batch after this many calls
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
export function loadAgents(filePath?: string): AgentsFile {
  const p = filePath || resolve(process.cwd(), "agents.json");
  if (!existsSync(p)) {
    throw new Error(
      `agents.json not found at ${p}\n` + `  Run:  npx kite init`,
    );
  }
  const raw = readFileSync(p, "utf-8");
  const parsed = JSON.parse(raw) as AgentsFile;

  // Resolve $VAR references in seed fields (vars store → env → error)
  for (const [id, agent] of Object.entries(parsed.agents)) {
    parsed.agents[id].seed = resolveVar(agent.seed);
  }

  return parsed;
}

// Get a specific agent or the default
export function getAgent(
  agents: AgentsFile,
  id?: string,
): AgentConfig & { id: string } {
  const agentId = id || agents.defaultAgent;
  const agent = agents.agents[agentId];
  if (!agent) {
    const available = Object.keys(agents.agents).join(", ");
    throw new Error(`Agent "${agentId}" not found. Available: ${available}`);
  }
  return { ...agent, id: agentId };
}
