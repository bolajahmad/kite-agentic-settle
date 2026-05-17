#!/usr/bin/env node
/**
 * server.ts — @kite-agentic-pay/mcp-server entry point
 *
 * Standalone Express server exposing:
 *
 *   MCP (Model Context Protocol) transports:
 *     GET  /mcp/sse       — SSE stream (Claude Desktop, Cursor, Continue.dev, …)
 *     POST /mcp/messages  — JSON-RPC POST channel for SSE sessions
 *     POST /mcp           — Streamable HTTP transport (modern MCP clients)
 *
 *   Tool schema endpoints (for AI framework integration):
 *     GET  /api/tools/schema              — Raw tool definitions
 *     GET  /api/tools/schema/openai       — OpenAI function-calling format
 *     GET  /api/tools/schema/anthropic    — Anthropic tool-use format
 *     GET  /api/tools/schema/langchain    — LangChain-compatible OpenAI format
 *
 *   Typed HTTP tool proxies (one endpoint per tool):
 *     POST /api/tools/invoke              — Generic proxy (all tools)
 *     POST /api/tools/call-api            — call_paid_api
 *     GET  /api/tools/balance             — check_balance
 *     GET  /api/tools/usage               — get_usage_logs
 *     GET  /api/tools/resolve/:agentId    — resolve_agent
 *     GET  /api/tools/session/:key        — get_session_info
 *     GET  /api/tools/channel/:id         — get_channel_info
 *
 *   Health:
 *     GET  /health
 *
 * Usage:
 *   npx @kite-agentic-pay/mcp-server          # start on default port 3100
 *   PORT=4001 npx @kite-agentic-pay/mcp-server
 *
 * Claude Desktop config:
 *   { "mcpServers": { "kite": { "url": "http://localhost:3100/mcp/sse" } } }
 */

import "dotenv/config";
import bodyParser from "body-parser";
import cors from "cors";
import express, { type Request, type Response } from "express";
import { handleMcp, handleMcpMessage, handleMcpSse } from "./mcp.js";
import {
  executeTool,
  TOOL_DEFINITIONS,
  toAnthropicTools,
  toLangChainTools,
  toOpenAIFunctions,
} from "./tools.js";

const app = express();
const PORT = process.env.PORT ?? 3100;

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(bodyParser.json());

// ── Health ─────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "@kite-agentic-pay/mcp-server", timestamp: Date.now() });
});

// ── MCP transports ─────────────────────────────────────────────────────────
app.get("/mcp/sse", handleMcpSse);
app.post("/mcp/messages", handleMcpMessage);
app.post("/mcp", handleMcp);

// ── Tool helpers ───────────────────────────────────────────────────────────

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
): Promise<void> {
  try {
    const result = await executeTool(toolName, args);
    res.json({ success: true, tool: toolName, result });
  } catch (err: unknown) {
    const msg = (err as Error).message ?? "Unknown error";
    const status = msg.includes("requires a credential") ? 401 : 500;
    res.status(status).json({ success: false, tool: toolName, error: msg });
  }
}

// ── Tool schema endpoints ──────────────────────────────────────────────────

app.get("/api/tools/schema", (_req, res) => {
  res.json({ version: "0.1.0", tools: TOOL_DEFINITIONS });
});

app.get("/api/tools/schema/openai", (_req, res) => {
  res.json({ version: "0.1.0", format: "openai-function-calling", tools: toOpenAIFunctions() });
});

app.get("/api/tools/schema/anthropic", (_req, res) => {
  res.json({ version: "0.1.0", format: "anthropic-tool-use", tools: toAnthropicTools() });
});

app.get("/api/tools/schema/langchain", (_req, res) => {
  res.json({ version: "0.1.0", format: "langchain-openai-compat", tools: toLangChainTools() });
});

// ── Generic tool invocation ────────────────────────────────────────────────

/**
 * POST /api/tools/invoke
 *
 * Shape A — SDK native:
 *   { "tool": "call_paid_api", "args": { "url": "https://...", ... } }
 *
 * Shape B — OpenAI tool_call result (raw):
 *   { "function": { "name": "call_paid_api", "arguments": "{\"url\":\"...\"}" } }
 */
app.post("/api/tools/invoke", async (req: Request, res: Response) => {
  let toolName: string | undefined;
  let args: Record<string, unknown> = {};

  if (req.body?.function?.name) {
    // Shape B: OpenAI tool_call
    toolName = req.body.function.name as string;
    try {
      args =
        typeof req.body.function.arguments === "string"
          ? (JSON.parse(req.body.function.arguments) as Record<string, unknown>)
          : (req.body.function.arguments as Record<string, unknown>) ?? {};
    } catch {
      res.status(400).json({ error: "function.arguments is not valid JSON" });
      return;
    }
  } else {
    // Shape A: SDK native
    toolName = req.body?.tool as string | undefined;
    args = (req.body?.args as Record<string, unknown>) ?? {};
  }

  if (!toolName) {
    res.status(400).json({
      error: "Provide either { tool, args } or { function: { name, arguments } }",
    });
    return;
  }

  const headerCred = req.headers["x-credential"] as string | undefined;
  if (headerCred) args = { ...args, credential: headerCred };

  await runTool(res, toolName, args);
});

// ── Typed HTTP tool proxies ───────────────────────────────────────────────

/** POST /api/tools/call-api  →  call_paid_api */
app.post("/api/tools/call-api", async (req: Request, res: Response) => {
  await runTool(res, "call_paid_api", {
    ...req.body,
    credential: resolveCredential(req),
  });
});

/** GET /api/tools/balance?address=0x…&token=0x…  →  check_balance */
app.get("/api/tools/balance", async (req: Request, res: Response) => {
  await runTool(res, "check_balance", {
    address: req.query.address as string,
    token: req.query.token as string | undefined,
  });
});

/** GET /api/tools/usage?limit=N  →  get_usage_logs */
app.get("/api/tools/usage", async (req: Request, res: Response) => {
  await runTool(res, "get_usage_logs", {
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });
});

/** GET /api/tools/resolve/:agentId  →  resolve_agent */
app.get("/api/tools/resolve/:agentId", async (req: Request, res: Response) => {
  await runTool(res, "resolve_agent", { agentId: req.params.agentId });
});

/** GET /api/tools/session/:key  →  get_session_info */
app.get("/api/tools/session/:key", async (req: Request, res: Response) => {
  await runTool(res, "get_session_info", { sessionKey: req.params.key });
});

/** GET /api/tools/channel/:id  →  get_channel_info */
app.get("/api/tools/channel/:id", async (req: Request, res: Response) => {
  await runTool(res, "get_channel_info", { channelId: req.params.id });
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.error(`[kite-mcp] server listening on http://localhost:${PORT}`);
  console.error(`[kite-mcp]   MCP SSE      →  GET  http://localhost:${PORT}/mcp/sse`);
  console.error(`[kite-mcp]   MCP HTTP     →  POST http://localhost:${PORT}/mcp`);
  console.error(`[kite-mcp]   Tool schema  →  GET  http://localhost:${PORT}/api/tools/schema`);
  console.error(`[kite-mcp]   Health       →  GET  http://localhost:${PORT}/health`);
});
