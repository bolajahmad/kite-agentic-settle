/**
 * routes/tools.ts
 *
 * Three-fold tool API mounted at /api/tools:
 *
 * ── 1. Tool Schemas (for AI framework integration) ──────────────────────
 *
 *   GET /api/tools/schema
 *       Raw tool definitions (name, description, inputSchema)
 *
 *   GET /api/tools/schema/openai
 *       OpenAI function-calling format  →  { type: "function", function: {...} }
 *       Use with: client.chat.completions.create({ tools: ... })
 *
 *   GET /api/tools/schema/anthropic
 *       Anthropic tool-use format  →  { name, description, input_schema }
 *       Use with: client.messages.create({ tools: ... })
 *
 *   GET /api/tools/schema/langchain
 *       Same as OpenAI (LangChain accepts the OpenAI function format)
 *
 * ── 2. Generic Invocation (function-call proxy) ─────────────────────────
 *
 *   POST /api/tools/invoke
 *   Body: { tool: string, args: Record<string,any> }
 *   Headers: X-Credential (optional; overrides args.credential)
 *
 *       Accepts an OpenAI-style tool_call response body too:
 *   Body: { function: { name: string, arguments: string } }
 *
 * ── 3. Typed HTTP Proxies (one endpoint per tool) ───────────────────────
 *
 *   POST /api/tools/call-api         →  call_paid_api
 *   GET  /api/tools/balance          →  check_balance  (?address=0x…&token=0x…)
 *   GET  /api/tools/usage            →  get_usage_logs (?limit=N)
 *   POST /api/tools/register-agent   →  register_agent
 *   GET  /api/tools/resolve/:agentId →  resolve_agent
 *   POST /api/tools/deposit          →  deposit_to_wallet
 *   GET  /api/tools/session/:key     →  get_session_info
 *   GET  /api/tools/channel/:id      →  get_channel_info
 */

import { Router, type Request, type Response } from "express";
import {
  TOOL_DEFINITIONS,
  toOpenAIFunctions,
  toAnthropicTools,
  toLangChainTools,
  executeTool,
} from "../services/tools-client.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────

/** Resolve credential from X-Credential header > body.credential > env */
function resolveCredential(req: Request): string | undefined {
  return (
    (req.headers["x-credential"] as string | undefined) ??
    (req.body?.credential as string | undefined) ??
    process.env.AGENT_CREDENTIAL ??
    process.env.DEPLOYER_PRIVATE_KEY
  );
}

async function runTool(
  res: Response,
  toolName: string,
  args: Record<string, unknown>,
) {
  try {
    const result = await executeTool(toolName, args);
    res.json({ success: true, tool: toolName, result });
  } catch (err: any) {
    const status = err.message?.includes("requires a credential") ? 401 : 500;
    res.status(status).json({ success: false, tool: toolName, error: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. TOOL SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/tools/schema
 * Native tool definitions (MCP / SDK format).
 */
router.get("/schema", (_req, res) => {
  res.json({
    version: "0.1.0",
    tools: TOOL_DEFINITIONS,
  });
});

/**
 * GET /api/tools/schema/openai
 * OpenAI function-calling format.
 *
 * Usage in your agent:
 *   const { tools } = await fetch('http://localhost:4000/api/tools/schema/openai').then(r => r.json());
 *   const response = await openai.chat.completions.create({ model: 'gpt-4o', tools, messages });
 */
router.get("/schema/openai", (_req, res) => {
  res.json({
    version: "0.1.0",
    format: "openai-function-calling",
    tools: toOpenAIFunctions(),
  });
});

/**
 * GET /api/tools/schema/anthropic
 * Anthropic tool-use format.
 *
 * Usage in your agent:
 *   const { tools } = await fetch('http://localhost:4000/api/tools/schema/anthropic').then(r => r.json());
 *   const response = await anthropic.messages.create({ model: 'claude-opus-4-5', tools, messages });
 */
router.get("/schema/anthropic", (_req, res) => {
  res.json({
    version: "0.1.0",
    format: "anthropic-tool-use",
    tools: toAnthropicTools(),
  });
});

/**
 * GET /api/tools/schema/langchain
 * OpenAI-compatible format (what LangChain's formatToOpenAITool expects).
 *
 * Usage:
 *   const { tools } = await fetch('http://localhost:4000/api/tools/schema/langchain').then(r => r.json());
 *   const model = new ChatOpenAI().bindTools(tools);
 */
router.get("/schema/langchain", (_req, res) => {
  res.json({
    version: "0.1.0",
    format: "langchain-openai-compat",
    tools: toLangChainTools(),
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. GENERIC INVOCATION  (function-call proxy)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/tools/invoke
 *
 * Accepts two body shapes:
 *
 * Shape A — SDK native:
 *   { "tool": "call_paid_api", "args": { "url": "https://...", ... } }
 *
 * Shape B — OpenAI tool_call result (pass the raw tool_call object):
 *   { "function": { "name": "call_paid_api", "arguments": "{\"url\":\"...\"}" } }
 *
 * Headers:
 *   X-Credential: <private-key-hex>   (optional, overrides args.credential)
 *
 * Response:
 *   { success: true, tool: "call_paid_api", result: { ... } }
 */
router.post("/invoke", async (req: Request, res: Response) => {
  let toolName: string | undefined;
  let args: Record<string, unknown> = {};

  // Shape B: OpenAI tool_call
  if (req.body?.function?.name) {
    toolName = req.body.function.name;
    try {
      args =
        typeof req.body.function.arguments === "string"
          ? JSON.parse(req.body.function.arguments)
          : req.body.function.arguments ?? {};
    } catch {
      res.status(400).json({ error: "function.arguments is not valid JSON" });
      return;
    }
  } else {
    // Shape A: SDK native
    toolName = req.body?.tool;
    args = req.body?.args ?? {};
  }

  if (!toolName) {
    res.status(400).json({
      error: "Provide either { tool, args } or { function: { name, arguments } }",
    });
    return;
  }

  // Inject credential from header (wins over body.credential)
  const headerCred = req.headers["x-credential"] as string | undefined;
  if (headerCred) args = { ...args, credential: headerCred };

  await runTool(res, toolName, args);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. TYPED HTTP PROXIES  (one per tool, strongly typed request/response)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/tools/call-api
 * Proxy for the `call_paid_api` tool.
 *
 * Body: { url, method?, body?, autopay?, maxAmount?, agentId?, sessionKey? }
 * Header X-Credential: session key private key (hex)
 */
router.post("/call-api", async (req: Request, res: Response) => {
  await runTool(res, "call_paid_api", {
    ...req.body,
    credential: resolveCredential(req),
  });
});

/**
 * GET /api/tools/balance?address=0x…&token=0x…
 * Proxy for the `check_balance` tool.
 */
router.get("/balance", async (req: Request, res: Response) => {
  await runTool(res, "check_balance", {
    address: req.query.address as string,
    token: req.query.token as string | undefined,
  });
});

/**
 * GET /api/tools/usage?limit=N
 * Proxy for the `get_usage_logs` tool.
 */
router.get("/usage", async (req: Request, res: Response) => {
  await runTool(res, "get_usage_logs", {
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });
});

/**
 * POST /api/tools/register-agent
 * Proxy for the `register_agent` tool.
 *
 * Body: { agentURI: string }
 * Header X-Credential: EOA private key (hex)
 */
router.post("/register-agent", async (req: Request, res: Response) => {
  await runTool(res, "register_agent", {
    agentURI: req.body.agentURI,
    credential: resolveCredential(req),
  });
});

/**
 * GET /api/tools/resolve/:agentId
 * Proxy for the `resolve_agent` tool.
 */
router.get("/resolve/:agentId", async (req: Request, res: Response) => {
  await runTool(res, "resolve_agent", { agentId: req.params.agentId });
});

/**
 * POST /api/tools/deposit
 * Proxy for the `deposit_to_wallet` tool.
 *
 * Body: { amount: string (wei), token?: string }
 * Header X-Credential: EOA private key (hex)
 */
router.post("/deposit", async (req: Request, res: Response) => {
  await runTool(res, "deposit_to_wallet", {
    amount: req.body.amount,
    token: req.body.token,
    credential: resolveCredential(req),
  });
});

/**
 * GET /api/tools/session/:key
 * Proxy for the `get_session_info` tool.
 */
router.get("/session/:key", async (req: Request, res: Response) => {
  await runTool(res, "get_session_info", { sessionKey: req.params.key });
});

/**
 * GET /api/tools/channel/:id
 * Proxy for the `get_channel_info` tool.
 */
router.get("/channel/:id", async (req: Request, res: Response) => {
  await runTool(res, "get_channel_info", { channelId: req.params.id });
});

export default router;
