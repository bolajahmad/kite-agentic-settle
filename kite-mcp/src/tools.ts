/**
 * tools.ts — Kite MCP Server
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
 * On-chain reads (resolve_agent, check_balance) use the SDK's ContractService
 * via KiteSettleClient.createReadOnly() — no extra RPC config needed in the MCP package.
 */

import { KiteSettleClient } from "@kite-agentic-pay/sdk";

// ── Tool definitions ────────────────────────────────────────────────────────

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
      "Handles x402 payment negotiation for perCall, batch, stream, and channel modes. " +
      "For batch/stream/channel modes, the SDK opens a payment channel automatically " +
      "(or reuses channelId) and routes the call through it. Returns the API response, " +
      "payment receipt, and channelId (when a channel was used).",
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
          description: "Maximum payment cap in wei (optional, for perCall/auto modes)",
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
          enum: ["perCall", "batch", "stream", "channel", "auto"],
          default: "auto",
          description:
            "Payment routing mode. 'batch'/'stream'/'channel' open a payment channel and route " +
            "through it (recommended for repeated calls). 'auto' uses the x402 interceptor.",
        },
        channelId: {
          type: "string",
          description:
            "Existing channel ID (0x…) to reuse for batch/stream/channel modes. " +
            "When omitted, a new channel is opened automatically.",
        },
        deposit: {
          type: "string",
          description:
            "Initial channel deposit in wei (e.g. '10000000' for 10 DmUSDT). " +
            "Defaults to 10× the provider's per-call rate. Only used when opening a new channel.",
        },
        maxPerCall: {
          type: "string",
          description:
            "Maximum cost cap per API call in wei. Defaults to the provider's declared rate. " +
            "Only used when opening a new channel.",
        },
        maxDuration: {
          type: "number",
          description:
            "Channel lifetime in seconds. Defaults to the provider's maxDuration, or 3600. " +
            "Only used when opening a new channel.",
        },
        token: {
          type: "string",
          description: "ERC-20 token address override. Defaults to the network default (DmUSDT).",
        },
      },
      required: ["url", "agentId"],
    },
  },
  {
    name: "get_usage_logs",
    description:
      "Retrieve payment usage logs recorded by this MCP server (all agents).",
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
      "Look up agent NFT details (owner, agentURI, AA wallet) directly from the IdentityRegistry contract by tokenId. No credential required.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description: "Agent tokenId (numeric string, e.g. '1')",
        },
      },
      required: ["agentId"],
    },
  },
  {
    name: "open_channel",
    description:
      "Open a new payment channel with a provider API. Returns channelId and txHash. " +
      "Requires an active session registered via `kite onboard`. " +
      "The SDK resolves the session key automatically — no private key needed in arguments.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description:
            "On-chain agentId (tokenId). Session key is loaded automatically from the server's credential store.",
        },
        sessionKey: {
          type: "string",
          description: "Optional session key address (0x…). Auto-selected when omitted.",
        },
        provider: {
          type: "string",
          description: "Provider EOA address (0x…) — the API's on-chain identity.",
        },
        mode: {
          type: "string",
          enum: ["prepaid", "postpaid"],
          description: "Channel funding mode. Default: 'prepaid'.",
        },
        deposit: {
          type: "string",
          description:
            "Initial channel deposit in wei (e.g. '1000000' for 1 DmUSDT with 6 decimals).",
        },
        maxSpend: {
          type: "string",
          description: "Maximum total spend cap in wei.",
        },
        maxDuration: {
          type: "number",
          description: "Maximum channel lifetime in seconds.",
        },
        maxPerCall: {
          type: "string",
          description: "Maximum cost cap per single API call in wei.",
        },
        token: {
          type: "string",
          description: "ERC-20 token address (defaults to network default DmUSDT).",
        },
      },
      required: ["agentId", "provider", "deposit", "maxSpend", "maxDuration", "maxPerCall"],
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
          description:
            "Agent tokenId — required when sessionKey is omitted (list mode).",
        },
        sessionKey: {
          type: "string",
          description:
            "Session key address (0x…). When provided, returns only this session.",
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
          description:
            "Agent tokenId — required when channelId is omitted (list mode).",
        },
        channelId: {
          type: "string",
          description:
            "Channel ID (bytes32 hex). When provided, returns only this channel.",
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
  {
    name: "settle_channel_settlement",
    description:
      "Initiate settlement for one or more payment channels. " +
      "The provider (API) must agree to the submitted receipts for settlement to finalize — " +
      "this does not guarantee immediate payment. After the challenge window, call the finalize step. " +
      "Accepts channelId, sessionKey, or agentId (precedence: channelId > sessionKey > agentId). " +
      "Without channelId, only expired channels are settled unless forceActiveClose is true.",
    inputSchema: {
      type: "object",
      properties: {
        channelId: {
          type: "string",
          description:
            "Specific channel ID (0x…). Highest precedence — settles exactly this channel.",
        },
        sessionKey: {
          type: "string",
          description:
            "Session key address — settle all expired channels for this session.",
        },
        agentId: {
          type: "string",
          description:
            "Agent tokenId — settle all expired channels for this agent. Lowest precedence.",
        },
        forceActiveClose: {
          type: "boolean",
          description:
            "When true, also settle non-expired (active) channels. Default: false.",
        },
      },
    },
  },
];

// ── Schema format converters ───────────────────────────────────────────────

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

export function toAnthropicTools() {
  return TOOL_DEFINITIONS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}

// LangChain's formatToOpenAITool accepts the same shape as OpenAI functions.
export function toLangChainTools() {
  return toOpenAIFunctions();
}

// ── In-process usage log (simple ring buffer, max 1000 entries) ───────────

interface UsageLogEntry {
  tool: string;
  agentId?: string;
  url?: string;
  timestamp: number;
  success: boolean;
  error?: string;
}

const usageLogs: UsageLogEntry[] = [];

function pushUsageLog(entry: UsageLogEntry): void {
  usageLogs.push(entry);
  if (usageLogs.length > 1000) usageLogs.shift();
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

      // Channel-mode args
      const channelId = args.channelId as `0x${string}` | undefined;
      const deposit = args.deposit
        ? BigInt(args.deposit as string)
        : undefined;
      const maxPerCall = args.maxPerCall
        ? BigInt(args.maxPerCall as string)
        : undefined;
      const maxDuration = args.maxDuration as number | undefined;
      const token = args.token as string | undefined;

      if (!agentId) {
        throw new Error(
          "call_paid_api requires 'agentId'. " +
            "The server resolves the active session automatically — no private key is needed.",
        );
      }

      // Build an agent-mode client: loads the session private key from the
      // vars store (set during `kite onboard`). No credential in the request.
      // Map "stream" → "channel" for defaultPaymentMode since the client
      // option doesn't distinguish them (callPaidApi handles the routing).
      const clientMode = (mode === "stream" ? "channel" : mode) as
        | "perCall"
        | "batch"
        | "channel"
        | "auto";
      const client = await KiteSettleClient.create({
        agentId: BigInt(agentId),
        sessionKey: sessionKeyAddr,
        defaultPaymentMode: clientMode,
      });

      let result: unknown;
      let success = true;
      try {
        const callResult = await client.callPaidApi(url, {
          method: method as "GET" | "POST" | "PUT" | "DELETE",
          body,
          autopay,
          maxAmount,
          mode: mode as "perCall" | "batch" | "stream" | "channel" | "auto",
          channelId,
          deposit,
          maxPerCall,
          maxDuration,
          token,
        });

        // Surface channel info alongside the rest of the result
        result = {
          ...callResult,
          ...(callResult.channelId
            ? {
                channelId: callResult.channelId,
                channelOpened: callResult.channelOpened ?? false,
                channelOpenTxHash: callResult.channelOpenTxHash,
                channelProvider: callResult.channelProvider,
                channelAsset: callResult.channelAsset,
              }
            : {}),
        };
      } catch (err) {
        success = false;
        pushUsageLog({
          tool: "call_paid_api",
          agentId,
          url,
          timestamp: Date.now(),
          success,
          error: (err as Error).message,
        });
        throw err;
      }

      pushUsageLog({
        tool: "call_paid_api",
        agentId,
        url,
        timestamp: Date.now(),
        success,
      });
      return result;
    }

    // ─── check_balance ────────────────────────────────────────────────────
    case "check_balance": {
      const address = args.address as string;
      if (!address)
        throw new Error("check_balance requires an 'address' argument");
      const token = args.token as string | undefined;

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
      const sliced = usageLogs.slice(-limit);
      return { count: sliced.length, logs: sliced };
    }

    // ─── resolve_agent ────────────────────────────────────────────────────
    case "resolve_agent": {
      const agentIdStr = args.agentId as string;
      if (!agentIdStr) throw new Error("resolve_agent requires 'agentId'");

      const agentInfo = await KiteSettleClient.createReadOnly().getAgentInfo(
        BigInt(agentIdStr),
      );

      if (!agentInfo.owner && !agentInfo.agentURI && !agentInfo.walletContract) {
        return { agentId: agentIdStr, found: false };
      }

      return {
        agentId: agentIdStr,
        owner: agentInfo.registeredOwner ?? agentInfo.owner,
        eoaOwner: agentInfo.owner,
        agentURI: agentInfo.agentURI,
        aaWallet: agentInfo.walletContract,
        found: true,
      };
    }

    // ─── open_channel ─────────────────────────────────────────────────────
    case "open_channel": {
      const agentId = args.agentId as string;
      if (!agentId) throw new Error("open_channel requires 'agentId'");

      const provider = args.provider as string;
      if (!provider) throw new Error("open_channel requires 'provider'");

      const mode = (args.mode as "prepaid" | "postpaid" | undefined) ?? "prepaid";
      const deposit = BigInt(args.deposit as string);
      const maxSpend = BigInt(args.maxSpend as string);
      const maxDuration = Number(args.maxDuration);
      const maxPerCall = BigInt(args.maxPerCall as string);
      const token = args.token as string | undefined;
      const sessionKey = args.sessionKey as string | undefined;

      const client = await KiteSettleClient.create({
        agentId: BigInt(agentId),
        sessionKey,
      });

      const result = await client.openChannel({
        provider,
        mode,
        deposit,
        maxSpend,
        maxDuration,
        maxPerCall,
        ...(token ? { token } : {}),
      });

      pushUsageLog({
        tool: "open_channel",
        agentId,
        timestamp: Date.now(),
        success: true,
      });

      return {
        channelId: result.channelId,
        txHash: result.txHash,
        provider,
        mode,
        depositWei: deposit.toString(),
        maxSpendWei: maxSpend.toString(),
        maxPerCallWei: maxPerCall.toString(),
        maxDurationSeconds: maxDuration,
      };
    }

    // ─── get_session_info ─────────────────────────────────────────────────
    case "get_session_info": {
      const sessionKey = args.sessionKey as string | undefined;
      const agentId = args.agentId as string | undefined;
      const limit = (args.limit as number | undefined) ?? 10;
      const offset = (args.offset as number | undefined) ?? 0;

      const client = KiteSettleClient.createReadOnly();

      if (sessionKey) {
        const session = await client.getSessionInfo(sessionKey);
        if (!session) return { found: false, sessionKey };
        return { found: true, sessions: [session] };
      }

      if (!agentId)
        throw new Error("get_session_info requires 'agentId' or 'sessionKey'");
      const sessions = await client.listSessions(agentId, { limit, offset });
      return { agentId, limit, offset, count: sessions.length, sessions };
    }

    // ─── get_channel_info ─────────────────────────────────────────────────
    case "get_channel_info": {
      const channelId = args.channelId as string | undefined;
      const agentId = args.agentId as string | undefined;
      const limit = (args.limit as number | undefined) ?? 10;
      const offset = (args.offset as number | undefined) ?? 0;

      const client = KiteSettleClient.createReadOnly();

      if (channelId) {
        const channel = await client.getChannelInfo(channelId);
        if (!channel) return { found: false, channelId };
        return { found: true, channels: [channel] };
      }

      if (!agentId)
        throw new Error("get_channel_info requires 'agentId' or 'channelId'");
      const channels = await client.listChannels(agentId, { limit, offset });
      return { agentId, limit, offset, count: channels.length, channels };
    }

    // ─── settle_channel_settlement ────────────────────────────────────────
    case "settle_channel_settlement": {
      const channelId = args.channelId as `0x${string}` | undefined;
      const sessionKey = args.sessionKey as string | undefined;
      const agentId = args.agentId as string | undefined;
      const forceActiveClose =
        (args.forceActiveClose as boolean | undefined) ?? false;

      if (!channelId && !sessionKey && !agentId) {
        throw new Error(
          "settle_channel_settlement requires at least one of: channelId, sessionKey, agentId.",
        );
      }

      const results = await KiteSettleClient.initiateSettlements(
        {
          channelId,
          sessionKey,
          agentId: agentId !== undefined ? BigInt(agentId) : undefined,
        },
        { forceActiveClose },
      );

      return { settled: results.length, results };
    }

    default:
      throw new Error(`Unknown tool: "${toolName}"`);
  }
}
