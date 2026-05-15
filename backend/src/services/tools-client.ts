/**
 * tools-client.ts
 *
 * Stateless tool-execution service used by all three API surfaces:
 *   - MCP SSE server        (AI agents: Claude Desktop, Cursor, OpenClaw…)
 *   - Function-call proxies (OpenAI / Anthropic tool-use format)
 *   - REST HTTP proxies     (any HTTP client or Langchain tool)
 *
 * Credentials (private key or raw seed → first derived key) are accepted
 * per-call via X-Credential header or the `credential` body field.
 * This keeps every request stateless — no server-side key storage.
 *
 * On-chain operations use the backend's existing ContractService which
 * already handles the Kite testnet RPC.
 */

import { ethers } from "ethers";
import {
  getIdentityRegistry,
  getKiteAAWallet,
  getPaymentChannel,
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
      "Call a paid API endpoint. The SDK handles x402 payment negotiation automatically (EIP-712 programmable settlement). Returns the API response and a payment receipt.",
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
          description: "On-chain agentId (tokenId from IdentityRegistry)",
        },
        sessionKey: {
          type: "string",
          description: "Session key address registered on KiteAAWallet",
        },
        credential: {
          type: "string",
          description: "Session key private key (hex) used for signing",
        },
      },
      required: ["url"],
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

// ── Credential helper ─────────────────────────────────────────────────────

/**
 * Build an ethers Signer from a raw private-key hex string.
 * Accepts keys with or without the 0x prefix.
 */
function signerFromCredential(credential: string): ethers.Wallet {
  const key = credential.startsWith("0x") ? credential : `0x${credential}`;
  return new ethers.Wallet(key, getProvider());
}

// ── ERC-20 ABI (minimal, for approve + balanceOf) ─────────────────────────

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

// ── Tool execution ────────────────────────────────────────────────────────

export type ToolArgs = Record<string, unknown>;

/**
 * Execute a named tool with the given arguments.
 * `credential` (hex private key) is pulled from args or falls back to
 * the AGENT_CREDENTIAL env var so callers don't have to pass it every time.
 */
export async function executeTool(
  toolName: string,
  args: ToolArgs,
): Promise<unknown> {
  // Resolve credential: args field → header placeholder → env var
  const credential =
    (args.credential as string | undefined) ??
    process.env.AGENT_CREDENTIAL ??
    process.env.DEPLOYER_PRIVATE_KEY;

  switch (toolName) {
    // ─── call_paid_api ───────────────────────────────────────────────────
    case "call_paid_api": {
      const url = args.url as string;
      const method = (args.method as string) || "GET";
      const body = args.body as string | undefined;
      const autopay = args.autopay !== false;
      const maxAmount = args.maxAmount
        ? BigInt(args.maxAmount as string)
        : undefined;
      const agentId = (args.agentId as string) ?? "0";
      const sessionKeyAddr = args.sessionKey as string | undefined;

      // 1. Probe the endpoint
      const initHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const initOpts: RequestInit = { method, headers: initHeaders };
      if (body && (method === "POST" || method === "PUT")) {
        initOpts.body = body;
      }

      const probe = await globalThis.fetch(url, initOpts);

      if (probe.status !== 402) {
        const data = await probe.text();
        return {
          status: probe.status,
          data: tryParseJSON(data),
          payment: null,
        };
      }

      if (!autopay) {
        return { status: 402, error: "Payment required but autopay disabled" };
      }

      // 2. Parse the 402 challenge
      const challengeText = await probe.text();
      const challenge = JSON.parse(challengeText);
      const offer = challenge.accepts?.[0];
      if (!offer) throw new Error("402 response missing accepts[] array");

      const amount = BigInt(offer.maxAmountRequired);
      if (maxAmount !== undefined && amount > maxAmount) {
        throw new Error(`Price ${amount} exceeds maxAmount cap ${maxAmount}`);
      }

      // 3. Sign the EIP-712 payment (requires a session key credential)
      if (!credential) {
        throw new Error(
          "call_paid_api requires a session key credential. " +
            "Pass `credential` in args or set AGENT_CREDENTIAL env var.",
        );
      }

      const signer = signerFromCredential(credential);
      const sessionKey = sessionKeyAddr ?? signer.address;

      const nonce =
        BigInt(Date.now()) * 1_000_000n +
        BigInt(Math.floor(Math.random() * 1_000_000));
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300); // 5 min

      const chainId = Number(process.env.CHAIN_ID ?? 2368);
      const kiteAAWalletAddr = process.env.KITE_AA_WALLET_ADDRESS ?? "";

      const domain = {
        name: "KiteAAWallet",
        version: "1",
        chainId,
        verifyingContract: kiteAAWalletAddr,
      };
      const types = {
        Payment: [
          { name: "agentId", type: "uint256" },
          { name: "sessionKey", type: "address" },
          { name: "recipient", type: "address" },
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const message = {
        agentId: BigInt(agentId),
        sessionKey,
        recipient: offer.payTo,
        token: offer.asset,
        amount,
        nonce,
        deadline,
      };

      const signature = await signer.signTypedData(domain, types, message);

      const payload = JSON.stringify({
        scheme: "kite-programmable",
        version: "1",
        chainId,
        settlementContract: kiteAAWalletAddr,
        agentId,
        sessionKey,
        recipient: offer.payTo,
        token: offer.asset,
        amount: amount.toString(),
        nonce: nonce.toString(),
        deadline: deadline.toString(),
        signature,
      });
      const x402Header = Buffer.from(payload).toString("base64");

      // 4. Retry with payment proof
      const retryHeaders: Record<string, string> = {
        ...initHeaders,
        "X-PAYMENT": x402Header,
      };
      const retryOpts: RequestInit = { method, headers: retryHeaders };
      if (body && (method === "POST" || method === "PUT"))
        retryOpts.body = body;

      const retryResp = await globalThis.fetch(url, retryOpts);
      const retryData = await retryResp.text();

      return {
        status: retryResp.status,
        data: tryParseJSON(retryData),
        payment: {
          method: "perCall",
          amount: amount.toString(),
          sessionKey,
          recipient: offer.payTo,
          nonce: nonce.toString(),
        },
      };
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

// ── Helpers ───────────────────────────────────────────────────────────────

function tryParseJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
