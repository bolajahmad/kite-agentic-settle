/**
 * tools-client.ts
 *
 * Stateless tool-execution service used by all three API surfaces:
 *   - MCP SSE server        (AI agents: Claude Desktop, Cursor, OpenClaw…)
 *   - Function-call proxies (OpenAI / Anthropic tool-use format)
 *   - REST HTTP proxies     (any HTTP client or Langchain tool)
 *
 * Payment operations delegate to the KiteSettleClient SDK, which loads
 * session private keys from the server's vars store (set during `kite onboard`).
 * No private key is ever required in tool call arguments.
 *
 * On-chain read operations use the backend's existing ContractService.
 */

import {
  getIdentityRegistry,
  getProvider,
} from "./contract-service.js";
import { getUsageLogs } from "./usage-aggregator.js";

// ── Tool definitions (mirrored from mcp-sdk/src/tools.ts) ───────────
// Kept inline so the backend has no build-time dependency on the SDK.

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "check_balance",
    description:
      "Check deposited (KiteAAWallet) balance and raw ERC-20 balance for an address.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "EOA address to check (0x…)" },
        token: {
          type: "string",
          description: "ERC-20 token address (defaults to DmUSDT)",
        },
      },
      required: ["address"],
    },
  },
  {
    name: "call_paid_api",
    description:
      "Call a paid API endpoint on behalf of an agent. The SDK resolves the active session key " +
      "automatically from the server's credential store — no private key is required in the request. " +
      "Handles x402 payment negotiation (EIP-712 programmable settlement) for perCall, batch, and " +
      "channel modes. Returns the API response and a payment receipt.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The API endpoint URL to call" },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "DELETE"],
          default: "GET",
        },
        body: {
          type: "string",
          description: "Request body for POST/PUT requests",
        },
        autopay: {
          type: "boolean",
          default: true,
          description: "Automatically pay if 402 is returned",
        },
        maxAmount: {
          type: "string",
          description: "Maximum payment (wei string, optional spending cap)",
        },
        agentId: {
          type: "string",
          description:
            "On-chain agentId (tokenId from IdentityRegistry). Required — the server loads the " +
            "active session key automatically from its credential store.",
        },
        sessionKey: {
          type: "string",
          description:
            "Optional: session key address (0x…) to use. When omitted, the server auto-selects " +
            "an active session for the given agentId.",
        },
        mode: {
          type: "string",
          enum: ["perCall", "batch", "channel", "auto"],
          default: "auto",
          description:
            "Payment routing mode. 'auto' prefers batch → channel → perCall based on active sessions.",
        },
      },
      required: ["url", "agentId"],
    },
  },
  {
    name: "get_usage_logs",
    description:
      "Retrieve payment usage logs recorded by this backend (all agents).",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max number of log entries to return (default: 50)",
        },
      },
    },
  },
  {
    name: "resolve_agent",
    description:
      "Look up agent NFT details (URI, owner) from IdentityRegistry by tokenId.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description: "Agent tokenId (numeric string)",
        },
      },
      required: ["agentId"],
    },
  },
  {
    name: "get_session_info",
    description:
      "List session keys for an agent (paginated) or look up a single session key. " +
      "Returns status, spend limits, amounts used/remaining and expiry for each session. " +
      "Pass agentId (without sessionKey) for a paginated list. Pass sessionKey to get one session.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description: "Agent tokenId — required when sessionKey is omitted (list mode).",
        },
        sessionKey: {
          type: "string",
          description: "Session key address (0x…). When provided, returns only this session.",
        },
        limit: {
          type: "number",
          description: "Max sessions to return in list mode (default: 10).",
        },
        offset: {
          type: "number",
          description: "Pagination offset for list mode (default: 0).",
        },
      },
    },
  },
  {
    name: "get_channel_info",
    description:
      "List payment channels for an agent (paginated) or look up a single channel. " +
      "Returns status, deposit, spend limits, provider and settlement info. " +
      "Pass agentId (without channelId) for a paginated list. Pass channelId to get one channel.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description: "Agent tokenId — required when channelId is omitted (list mode).",
        },
        channelId: {
          type: "string",
          description: "Channel ID (bytes32 hex). When provided, returns only this channel.",
        },
        limit: {
          type: "number",
          description: "Max channels to return in list mode (default: 10).",
        },
        offset: {
          type: "number",
          description: "Pagination offset for list mode (default: 0).",
        },
      },
    },
  },
];

// ── OpenAI function-calling schema ─────────────────────────────────────────

export function toOpenAIFunctions() {
  return TOOL_DEFINITIONS.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

// ── Anthropic tool-use schema ──────────────────────────────────────────────

export function toAnthropicTools() {
  return TOOL_DEFINITIONS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}

// ── LangChain / generic OpenAI-compat schema ────────────────────────────────
// LangChain's `formatToOpenAITool` accepts the same shape as OpenAI functions.

export function toLangChainTools() {
  return toOpenAIFunctions();
}

// ── Tool execution ────────────────────────────────────────────────────────

export type ToolArgs = Record<string, unknown>;

/**
 * Execute a named tool with the given arguments.
 */
export async function executeTool(
  toolName: string,
  args: ToolArgs,
): Promise<unknown> {
  switch (toolName) {
    // ─── call_paid_api ───────────────────────────────────────────────────
    case "call_paid_api": {
      const url = args.url as string;
      const method = (args.method as string | undefined) ?? "GET";
      const body = args.body as string | undefined;
      const autopay = args.autopay !== false;
      const maxAmount = args.maxAmount
        ? BigInt(args.maxAmount as string)
        : undefined;
      const agentId = args.agentId as string | undefined;
      const sessionKeyAddr = args.sessionKey as string | undefined;
      const mode = (args.mode as string | undefined) ?? "auto";

      if (!agentId) {
        throw new Error(
          "call_paid_api requires 'agentId'. " +
            "The server resolves the active session automatically — no private key is needed.",
        );
      }

      const { KiteSettleClient } = await import("@kite-agentic-pay/sdk");

      // Build an agent-mode client: loads the session private key from the
      // vars store (set during `kite onboard`). No credential in the request.
      const client = await KiteSettleClient.create({
        agentId: BigInt(agentId),
        sessionKey: sessionKeyAddr,
        defaultPaymentMode: mode as "perCall" | "batch" | "channel" | "auto",
      });

      return client.callPaidApi(url, {
        method: method as "GET" | "POST" | "PUT" | "DELETE",
        body,
        autopay,
        maxAmount,
        mode: mode as "perCall" | "batch" | "channel" | "auto",
      });
    }

    // ─── check_balance ────────────────────────────────────────────────────
    case "check_balance": {
      const address = args.address as string;
      if (!address)
        throw new Error("check_balance requires an 'address' argument");
      const token = args.token as string | undefined;

      const { KiteSettleClient } = await import("@kite-agentic-pay/sdk");
      const client = KiteSettleClient.createReadOnly();
      const result = await client.balance({
        address,
        tokens: token ? [token] : undefined,
      });

      return {
        eoaAddress: result.eoaAddress,
        aaWallet: result.aaWalletAddress,
        tokens: result.tokens.map((t) => ({
          token: t.token,
          symbol: t.symbol,
          walletBalance: t.walletBalance.toString(),
          walletBalanceFormatted: t.walletBalanceFormatted,
          depositedBalance: t.depositedBalance.toString(),
          depositedBalanceFormatted: t.depositedBalanceFormatted,
        })),
      };
    }

    // ─── get_usage_logs ───────────────────────────────────────────────────
    case "get_usage_logs": {
      const limit = (args.limit as number | undefined) ?? 50;
      const logs = getUsageLogs();
      const sliced = logs.slice(-limit);
      return { count: sliced.length, logs: sliced };
    }

    // ─── resolve_agent ────────────────────────────────────────────────────
    case "resolve_agent": {
      const agentId = BigInt(args.agentId as string);
      const provider = getProvider();
      const registry = getIdentityRegistry(provider);

      const [uri, owner] = await Promise.all([
        registry.agentURI(agentId),
        registry.ownerOf(agentId),
      ]);

      return { agentId: agentId.toString(), agentURI: uri, owner };
    }

    // ─── get_session_info ─────────────────────────────────────────────────
    case "get_session_info": {
      const sessionKey = args.sessionKey as string | undefined;
      const agentId = args.agentId as string | undefined;
      const limit = (args.limit as number | undefined) ?? 10;
      const offset = (args.offset as number | undefined) ?? 0;

      const { KiteSettleClient } = await import("@kite-agentic-pay/sdk");
      const client = KiteSettleClient.createReadOnly();

      if (sessionKey) {
        const session = await client.getSessionInfo(sessionKey);
        if (!session) return { found: false, sessionKey };
        return { found: true, sessions: [session] };
      }

      if (!agentId) throw new Error("get_session_info requires 'agentId' or 'sessionKey'");
      const sessions = await client.listSessions(agentId, { limit, offset });
      return { agentId, limit, offset, count: sessions.length, sessions };
    }

    // ─── get_channel_info ─────────────────────────────────────────────────
    case "get_channel_info": {
      const channelId = args.channelId as string | undefined;
      const agentId = args.agentId as string | undefined;
      const limit = (args.limit as number | undefined) ?? 10;
      const offset = (args.offset as number | undefined) ?? 0;

      const { KiteSettleClient } = await import("@kite-agentic-pay/sdk");
      const client = KiteSettleClient.createReadOnly();

      if (channelId) {
        const channel = await client.getChannelInfo(channelId);
        if (!channel) return { found: false, channelId };
        return { found: true, channels: [channel] };
      }

      if (!agentId) throw new Error("get_channel_info requires 'agentId' or 'channelId'");
      const channels = await client.listChannels(agentId, { limit, offset });
      return { agentId, limit, offset, count: channels.length, channels };
    }

    default:
      throw new Error(`Unknown tool: "${toolName}"`);
  }
}


