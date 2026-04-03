import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { resolveVar } from "./vars.js";
/**
 * Load agents.json from the given path (or default to project root).
 *
 * Seed values starting with "$" are resolved via the vars store
 * (~/.kite-agent-pay/vars.json) first, then fall back to env vars.
 */
export function loadAgents(filePath) {
    const p = filePath || resolve(process.cwd(), "agents.json");
    if (!existsSync(p)) {
        throw new Error(`agents.json not found at ${p}\n` +
            `  Run:  npx kite init`);
    }
    const raw = readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw);
    // Resolve $VAR references in seed fields (vars store → env → error)
    for (const [id, agent] of Object.entries(parsed.agents)) {
        parsed.agents[id].seed = resolveVar(agent.seed);
    }
    return parsed;
}
// Get a specific agent or the default
export function getAgent(agents, id) {
    const agentId = id || agents.defaultAgent;
    const agent = agents.agents[agentId];
    if (!agent) {
        const available = Object.keys(agents.agents).join(", ");
        throw new Error(`Agent "${agentId}" not found. Available: ${available}`);
    }
    return { ...agent, id: agentId };
}
