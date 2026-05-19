/**
 * mcp-server.ts
 *
 * Exposes the Kite Agent Pay SDK as an MCP (Model Context Protocol) server
 * over SSE (Server-Sent Events) transport so AI agents and IDEs that speak
 * MCP can discover and call all SDK tools directly:
 *
 *   Claude Desktop  →  { "mcpServers": { "kite": { "url": "http://localhost:4000/mcp/sse" } } }
 *   Cursor          →  mcp.json / .cursor/mcp.json
 *   Continue.dev    →  config.json mcpServers block
 *   OpenClaw / any MCP client
 *
 * Protocol endpoints mounted by server.ts:
 *   GET  /mcp/sse       — SSE stream (client connects here, keeps alive)
 *   POST /mcp/messages  — JSON-RPC messages from the client
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp";
import {
  CallToolRequestSchema,
  isInitializeRequest,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { executeTool, TOOL_DEFINITIONS } from "./tools-client.js";

// -- MCP Server factory ---------------------------------------------------
interface McpServerDefaults {
  /** agentId captured from the SSE/HTTP connection URL (?agentId=N). */
  agentId?: string;
}

function createMcpServer(defaults: McpServerDefaults = {}): Server {
  const server = new Server(
    { name: "kite-agent-pay", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Merge session-level defaults first; explicit args take precedence.
    const mergedArgs: Record<string, unknown> = {
      ...(defaults.agentId !== undefined ? { agentId: defaults.agentId } : {}),
      ...(args as Record<string, unknown>),
    };

    try {
      const result = await executeTool(name, mergedArgs);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, bigintReplacer, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: (error as Error).message }),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

// ── Session store (one transport per SSE connection) ─────────────────────
interface HttpSession {
  transport: StreamableHTTPServerTransport;
  agentId?: string;
}
const activeSessions = new Map<string, HttpSession>();

// -- Express handler logic -------------------------------------------------
export async function handleMcp(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && activeSessions.has(sessionId)) {
    await activeSessions.get(sessionId)!.transport.handleRequest(req, res, req.body);
    return;
  }

  if (sessionId && !activeSessions.has(sessionId)) {
    res.status(404).json({ error: `Session not found: ${sessionId}` });
    return;
  }

  if (!isInitializeRequest(req.body)) {
    res.status(404).json({
      error: "First request must be an InitializeRequest to establish session",
    });
    return;
  }

  const agentId = req.query.agentId as string | undefined;

  const newSessionid = randomUUID();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => newSessionid,
  });

  activeSessions.set(newSessionid, { transport, agentId });
  res.on("close", () => activeSessions.delete(newSessionid));

  if (agentId) {
    console.error(`[mcp] session created  id=${newSessionid}  agentId=${agentId}`);
  }

  await createMcpServer({ agentId }).connect(transport);
  await transport.handleRequest(req, res, req.body);
}

interface SseSession {
  transport: SSEServerTransport;
  server: Server;
}
const sseSessions = new Map<string, SseSession>();

// ── Express handlers ──────────────────────────────────────────────────────
// ── GET /mcp/sse ──────────────────────────────────────────────────────────
//
// Client opens a persistent SSE connection here. The SDK:
//   1. Sets the correct SSE response headers (Content-Type: text/event-stream etc.)
//   2. Assigns a sessionId
//   3. Sends the sessionId to the client as the first SSE event so the client
//      knows which ?sessionId= to use when POSTing messages
//
// The connection stays open until the client disconnects or the server closes it.
export async function handleMcpSse(req: Request, res: Response): Promise<void> {
  const agentId = req.query.agentId as string | undefined;

  const transport = new SSEServerTransport("/mcp/messages", res);

  const server = createMcpServer({ agentId });
  await server.connect(transport);

  const { sessionId } = transport;
  sseSessions.set(sessionId, { transport, server });

  console.error(
    `[mcp/sse] session opened  id=${sessionId}  agentId=${agentId ?? "(none)"}  total=${sseSessions.size}`,
  );

  // Clean up when the client closes the connection (tab close, network drop, etc.)
  res.on("close", () => {
    sseSessions.delete(sessionId);
    console.error(
      `[mcp/sse] session closed  id=${sessionId}  total=${sseSessions.size}`,
    );
  });
}

// ── POST /mcp/messages ────────────────────────────────────────────────────
//
// Every JSON-RPC message from the client arrives here.
// The client must include ?sessionId=<id> so we can route the message
// to the correct SSE transport instance.
//
// The transport.handlePostMessage() call:
//   1. Parses the JSON-RPC body
//   2. Passes the request to the connected Server for handling
//   3. Sends the JSON-RPC response back through the SSE stream (not the HTTP response)
//   4. Returns 202 Accepted on the POST response itself
export async function handleMcpMessage(
  req: Request,
  res: Response,
): Promise<void> {
  const sessionId = req.query.sessionId as string | undefined;

  if (!sessionId) {
    res.status(400).json({
      error: "Missing required query parameter: sessionId",
      hint: "Connect to GET /mcp/sse first to receive a sessionId",
    });
    return;
  }

  const session = sseSessions.get(sessionId);
  if (!session) {
    res.status(404).json({
      error: `No active session: ${sessionId}`,
      hint: "Session may have expired — reconnect via GET /mcp/sse",
    });
    return;
  }

  await session.transport.handlePostMessage(req, res, req.body);
}

// ── Helpers ───────────────────────────────────────────────────────────────

function bigintReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}
