# Kite Agent Pay — MCP Server (`kite-mcp`)

The `kite-mcp` package is a standalone server that exposes the Kite Agent Pay SDK as a set of tools consumable by AI agents through three different transports. It is the bridge between AI agent frameworks (Claude Desktop, Cursor, LangChain, OpenAI function-calling, etc.) and the Kite payment infrastructure.

Every capability the server offers is implemented by the `@kite-agentic-pay/sdk`. The MCP server is a thin, stateless wrapper — it holds no session state beyond what the SDK's local credential store provides.

---

## What It Does

An AI agent using this server can:

- **Make paid API calls** — call any x402-gated API endpoint automatically handling payment negotiation
- **Open/manage payment channels** — open channels for batch or stream payment modes
- **Check balances** — inspect deposited balance in the AA wallet
- **Inspect sessions** — list active session keys and their spend limits
- **Resolve agent identity** — look up any agent NFT from the IdentityRegistry
- **View usage logs** — audit all payments made through this server instance

No private key is ever required in a tool call argument. The server loads session keys from its own credential store (set during `kite onboard`).

---

## Transports

The server starts on port `3100` by default and exposes three parallel API surfaces:

### MCP Transports (for AI agents)

| Endpoint | Transport | Used by |
|---|---|---|
| `GET /mcp/sse` | SSE stream | Claude Desktop, Cursor, Continue.dev |
| `POST /mcp/messages` | JSON-RPC POST | SSE session control channel |
| `POST /mcp` | Streamable HTTP | Modern MCP clients |

### Tool Schema Endpoints (for AI framework integration)

| Endpoint | Format |
|---|---|
| `GET /api/tools/schema` | Raw tool definitions |
| `GET /api/tools/schema/openai` | OpenAI function-calling format |
| `GET /api/tools/schema/anthropic` | Anthropic tool-use format |
| `GET /api/tools/schema/langchain` | LangChain-compatible format |

### HTTP Tool Proxies (one endpoint per tool)

| Endpoint | Tool |
|---|---|
| `POST /api/tools/invoke` | Generic proxy (any tool) |
| `POST /api/tools/call-api` | `call_paid_api` |
| `GET /api/tools/balance` | `check_balance` |
| `GET /api/tools/usage` | `get_usage_logs` |
| `GET /api/tools/resolve/:agentId` | `resolve_agent` |
| `GET /api/tools/session/:key` | `get_session_info` |
| `GET /api/tools/channel/:id` | `get_channel_info` |

---

## Available Tools

### `call_paid_api`

The main workhorse. Calls a paid API endpoint, automatically handles the x402 payment challenge, and returns the API response along with payment metadata.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `url` | string | ✓ | API endpoint URL |
| `agentId` | string | ✓ | On-chain agent tokenId (e.g. `"1"`) |
| `method` | string | — | HTTP method (default: `GET`) |
| `body` | string | — | Request body for POST/PUT |
| `autopay` | boolean | — | Automatically pay on 402 (default: `true`) |
| `maxAmount` | string | — | Maximum payment cap in wei |
| `sessionKey` | string | — | Specific session key address (auto-selected when omitted) |
| `mode` | string | — | Payment mode: `perCall`, `batch`, `stream`, `channel`, `auto` |
| `channelId` | string | — | Existing channel ID to reuse |
| `deposit` | string | — | Initial channel deposit in wei (new channels only) |
| `maxPerCall` | string | — | Max cost cap per call in wei |
| `maxDuration` | number | — | Channel lifetime in seconds |
| `token` | string | — | ERC-20 token address override |

**Returns:** API response body, payment receipt, and `channelId` when a channel was used.

---

### `open_channel`

Opens a new payment channel on-chain with a provider. Returns `channelId` and `txHash`.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `agentId` | string | ✓ | Agent tokenId |
| `provider` | string | ✓ | Provider EOA address |
| `deposit` | string | ✓ | Initial channel deposit in wei |
| `maxSpend` | string | ✓ | Maximum total spend cap in wei |
| `maxDuration` | number | ✓ | Channel lifetime in seconds |
| `maxPerCall` | string | ✓ | Max cost per call in wei |
| `sessionKey` | string | — | Session key address (auto-selected when omitted) |
| `mode` | string | — | `prepaid` or `postpaid` (default: `prepaid`) |
| `token` | string | — | ERC-20 token address |

---

### `get_session_info`

Lists session keys for an agent or looks up a single session. Returns status, spend limits, amounts used/remaining, and expiry.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `agentId` | string | ✓ (list mode) | Agent tokenId for listing all sessions |
| `sessionKey` | string | — | Session key address for single-session lookup |
| `limit` | number | — | Max sessions to return (default: 10) |
| `offset` | number | — | Pagination offset (default: 0) |

---

### `get_channel_info`

Lists payment channels for an agent or looks up a single channel. Returns status, deposit, spend limits, provider, and settlement info.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `agentId` | string | ✓ (list mode) | Agent tokenId |
| `channelId` | string | — | Channel ID for single-channel lookup |
| `limit` | number | — | Max channels to return (default: 10) |
| `offset` | number | — | Pagination offset (default: 0) |

---

### `check_balance`

Checks the deposited balance in the KiteAAWallet and the raw ERC-20 balance for any address.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `address` | string | ✓ | EOA address to check (`0x…`) |
| `token` | string | — | ERC-20 token address (defaults to DmUSDT) |

---

### `resolve_agent`

Looks up agent NFT details directly from `IdentityRegistry` by tokenId. No credential required — this is a pure read.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `agentId` | string | ✓ | Agent tokenId (e.g. `"1"`) |

**Returns:** owner, agentURI, AA wallet address.

---

### `get_usage_logs`

Retrieves payment usage logs recorded by this MCP server instance.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `limit` | number | — | Max log entries to return (default: 50) |

---

## Setup — Running the Server

### Install and start

```bash
cd kite-mcp
npm install
npm run build

# Start on default port 3100
npx @kite-agentic-pay/mcp-server

# Start on a custom port
PORT=4001 npx @kite-agentic-pay/mcp-server
```

### Prerequisites

Before starting the server you must have run `kite onboard` at least once so the server can load session keys from `~/.kite-agent-pay/vars.json`.

```bash
npx kite init       # Store your EOA credential
npx kite onboard    # Register agent and create session keys
```

### Environment variables (optional)

```env
PORT=3100
AGENT_CREDENTIAL=0x...          # EOA private key (alternative to vars store)
DEPLOYER_PRIVATE_KEY=0x...      # Fallback credential
```

---

## Setup — Claude Desktop

Add the following to your Claude Desktop configuration file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "kite": {
      "url": "http://localhost:3100/mcp/sse"
    }
  }
}
```

Restart Claude Desktop. The Kite tools will appear in the tools list. You can then instruct Claude to call paid APIs on your behalf:

> "Call the protocol report endpoint at http://localhost:4000/api/data/protocol-report using agent ID 1 and pay automatically."

---

## Setup — Cursor / Continue.dev

Both support MCP via SSE. Add to your settings:

```json
{
  "mcp": {
    "servers": {
      "kite": {
        "url": "http://localhost:3100/mcp/sse"
      }
    }
  }
}
```

---

## Setup — OpenAI / LangChain

Fetch the tool schema in OpenAI format and pass it directly to the chat completions API:

```ts
const tools = await fetch("http://localhost:3100/api/tools/schema/openai").then(r => r.json());

const completion = await openai.chat.completions.create({
  model: "gpt-4o",
  tools,
  messages: [{ role: "user", content: "Check balance for 0xabc..." }],
});
```

When the model returns a tool call, proxy it to the server:

```ts
const result = await fetch("http://localhost:3100/api/tools/invoke", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: toolCall.function.name,
    arguments: JSON.parse(toolCall.function.arguments),
  }),
}).then(r => r.json());
```

---

## Security Notes

- The server never exposes private keys through its API
- Session keys are loaded from the local vars store (`~/.kite-agent-pay/vars.json`) — the file must be accessible to the user running the server
- For production deployments, set the `AGENT_CREDENTIAL` environment variable instead of relying on the file-based store
- The server accepts credentials via the `x-credential` request header or the `credential` field in POST bodies as a fallback — only use this in trusted environments
