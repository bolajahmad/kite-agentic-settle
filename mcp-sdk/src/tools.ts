/**
 * MCP tool definitions for Kite Agent Pay SDK
 *
 * These tools expose the SDK's capabilities so that AI agents
 * (via MCP) can discover and invoke them.
 */

import { KitePaymentClient } from "./index.js";
import type { PaymentRequest, InterceptorOptions } from "./types.js";

// ── Tool Definitions ───────────────────────────────────────────────

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const TOOLS: McpToolDefinition[] = [
  {
    name: "call_paid_api",
    description: "Call a paid API endpoint. The SDK handles 402 payment negotiation automatically. Returns the API response data and a payment receipt if payment was made.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The API endpoint URL to call" },
        method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"], default: "GET" },
        body: { type: "string", description: "Request body for POST/PUT requests" },
        autopay: { type: "boolean", default: true, description: "Whether to automatically pay if 402 is returned" },
        maxAmount: { type: "string", description: "Maximum payment amount in wei (optional spending cap)" },
      },
      required: ["url"],
    },
  },
  {
    name: "check_balance",
    description: "Check the agent's token balance on the Kite network.",
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string", description: "Token contract address (defaults to KTT)" },
      },
    },
  },
  {
    name: "get_usage_logs",
    description: "Get the agent's API call usage logs including amounts paid, services called, and transaction hashes.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max number of logs to return" },
      },
    },
  },
  {
    name: "get_total_spent",
    description: "Get the total amount of tokens the agent has spent across all API calls in this session.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "register_agent",
    description: "Register this agent on the Kite AgentRegistry contract with a name and domain.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Agent name (e.g. 'weather-bot')" },
        domain: { type: "string", description: "Agent domain (e.g. 'weather-bot.kite')" },
      },
      required: ["name", "domain"],
    },
  },
  {
    name: "resolve_agent",
    description: "Look up an agent by domain name on the Kite AgentRegistry.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Agent domain to look up (e.g. 'weather-bot.kite')" },
      },
      required: ["domain"],
    },
  },
  {
    name: "deposit_to_wallet",
    description: "Deposit tokens into the KiteAAWallet (shared treasury) for use in API payments.",
    inputSchema: {
      type: "object",
      properties: {
        amount: { type: "string", description: "Amount in wei to deposit" },
      },
      required: ["amount"],
    },
  },
];

// ── Tool Handler ───────────────────────────────────────────────────

export async function handleTool(
  client: KitePaymentClient,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (toolName) {
    case "call_paid_api": {
      const url = args.url as string;
      const method = (args.method as string) || "GET";
      const body = args.body as string | undefined;
      const autopay = args.autopay !== false;
      const maxAmount = args.maxAmount ? BigInt(args.maxAmount as string) : undefined;

      const fetchOpts: InterceptorOptions = {};
      if (!autopay) fetchOpts.autoPayEnabled = false;
      if (maxAmount) fetchOpts.maxPaymentPerCall = maxAmount;

      const init: RequestInit = { method };
      if (body && (method === "POST" || method === "PUT")) {
        init.body = body;
        init.headers = { "Content-Type": "application/json" };
      }

      const response = await client.fetch(url, init, fetchOpts);
      const responseBody = await response.text();

      let parsed: unknown;
      try { parsed = JSON.parse(responseBody); } catch { parsed = responseBody; }

      const logs = client.getUsageLogs();
      const lastLog = logs.length > 0 ? logs[logs.length - 1] : null;

      return {
        status: response.status,
        data: parsed,
        payment: lastLog ? {
          amount: lastLog.amount.toString(),
          txHash: lastLog.txHash,
          timestamp: lastLog.timestamp,
        } : null,
      };
    }

    case "check_balance": {
      const balance = await client.getTokenBalance(args.token as string | undefined);
      return {
        address: client.address,
        balance: balance.toString(),
        formatted: `${Number(balance) / 1e18} KTT`,
      };
    }

    case "get_usage_logs": {
      const logs = client.getUsageLogs();
      const limit = args.limit as number | undefined;
      const sliced = limit ? logs.slice(-limit) : logs;
      return sliced.map((log) => ({
        ...log,
        amount: log.amount.toString(),
      }));
    }

    case "get_total_spent": {
      const total = client.getTotalSpent();
      return {
        total: total.toString(),
        formatted: `${Number(total) / 1e18} KTT`,
        callCount: client.getUsageLogs().length,
      };
    }

    case "register_agent": {
      const name = args.name as string;
      const domain = args.domain as string;
      const result = await client.registerAgent(name, domain);
      return {
        agentId: result.agentIdBytes32,
        txHash: result.txHash,
      };
    }

    case "resolve_agent": {
      const domain = args.domain as string;
      const agent = await client.resolveAgentByDomain(domain);
      return agent;
    }

    case "deposit_to_wallet": {
      const amount = BigInt(args.amount as string);
      const txHash = await client.depositToWallet(amount);
      return { txHash, amount: amount.toString() };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
