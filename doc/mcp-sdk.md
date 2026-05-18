# Kite Agent Pay — MCP SDK

The `mcp-sdk` package (`@kite-agentic-pay/sdk`) is the core library that powers all payment logic in this project. It serves two roles simultaneously:

- **CLI tool** — `npx kite` commands for initialising credentials, registering agents, and making paid API calls from a terminal.
- **TypeScript SDK** — importable library for backends, frontends, and the `kite-mcp` server. Every feature the MCP server exposes is implemented here first.

---

## How It Works

The SDK wraps four on-chain concerns into one cohesive developer experience:

| Layer | What it does |
|---|---|
| **Wallet / credential** | Derives an AA wallet (GokiteAccount) from an EOA seed phrase or private key |
| **Identity** | Registers the agent as an ERC-721 NFT on `IdentityRegistry`, creates session keys |
| **Payments** | Handles x402 per-call payments (EIP-712 signed receipts) and payment channel lifecycle |
| **Observability** | Queries the subgraph indexer for agent/session/channel/payment history |

The primary class is `KiteSettleClient`. For most use-cases you only need this one class.

```ts
import { KiteSettleClient } from "@kite-agentic-pay/sdk";

const client = await KiteSettleClient.fromCredential(seedPhraseOrPrivKey);
const { data } = await client.callPaidApi({ url: "https://api.example.com/data" });
```

---

## CLI — Quick Start

### Prerequisites

- Node.js 18+ / npm
- An EOA private key or seed phrase with a small amount of KITE (for gas)
- Testnet DmUSDT tokens for payments

Install globally or run via npx:

```bash
npm install -g @kite-agentic-pay/sdk
# or just use npx kite <command>
```

---

### Step 1 — `kite init` (store your keys)

```bash
npx kite init
```

Prompts for your EOA private key or seed phrase and stores it encrypted at `~/.kite-agent-pay/config.json` (permissions 0600). This file is never committed to git.

```
  KiteSettler — EOA Setup
  ──────────────────────────────────────────────────
  Enter your EOA seed phrase or private key.
  This will be stored locally in a dedicated config file (never committed to git).

  Seed phrase or private key: ████████████████
  Stored credential in /Users/you/.kite-agent-pay/config.json

  Next steps:
    npx kite onboard --name "My Agent"   — register agent on-chain
    npx kite whoami                      — verify identity
```

---

### Step 2 — `kite onboard` (register the agent)

```bash
npx kite onboard --name "My Agent" --category defi
```

This is a single command that:
1. Derives (or deploys) your AA wallet (GokiteAccount) from the EOA
2. Mints an agent NFT on `IdentityRegistry` with the provided metadata
3. Creates a session key and registers it in the AA wallet's spending rules
4. Links the session key to the agent on `IdentityRegistry`
5. Saves the agent and session keys to `~/.kite-agent-pay/vars.json`

After running this command you have a fully operational on-chain identity. All credentials are stored locally — no server holds your keys.

**Options:**

| Flag | Description |
|---|---|
| `--name <name>` | Agent display name |
| `--category <category>` | Agent category tag (e.g. `defi`, `analytics`) |
| `--agent-index <n>` | Derivation index (default: 0, increment for multiple agents) |

---

### Step 3 — `kite whoami` (verify identity)

```bash
npx kite whoami
# or for a specific agent:
npx kite whoami --agent 1
```

Displays:

```
  EOA Address:    0xabc...
  AA Wallet:      0xdef...
  Identity Status: Registered (1 agent)

    Agent ID:       1  (NFT on IdentityRegistry)
    Agent Name:     My Agent
    Session Key:    0x875...
    Session Status: Stored (run onboard to renew)
```

---

### Step 4 — Make Paid Calls

#### Per-call (x402)

```bash
npx kite call --url http://localhost:4000/api/data/protocol-report
```

The SDK intercepts the `402 Payment Required` response automatically, signs an EIP-712 receipt with the session key, and retries with the payment header.

#### Channel / batch mode

```bash
# Open a channel, make 10 calls, settle:
npx kite call --mode batch --url http://localhost:4000/api/stream/intelligence

# Open a channel, call for 30 seconds, settle:
npx kite call --mode stream --url http://localhost:4000/api/stream/market/BTCUSDT
```

#### Additional CLI commands

```bash
npx kite balance                      # Show deposited balance in AA wallet
npx kite usage                        # Show payment usage logs
npx kite fund <address> [amount]      # Send testnet tokens to AA wallet
npx kite withdraw [token] [amount]    # Withdraw from AA wallet to EOA
npx kite simulate                     # Run a local payment simulation

# Channel management (manual)
npx kite channel open
npx kite channel call
npx kite channel status
npx kite channel list
npx kite channel close
npx kite channel force-close

# Session management
npx kite session start
npx kite session revoke

# Identity
npx kite agent register
npx kite clean                        # Delete local config/credentials
```

---

## Demos

The `examples/` directory contains eight numbered demos that walk through every payment pattern, from simplest to most advanced. Run any demo with:

```bash
cd mcp-sdk
npm run demo <number>
# e.g. npm run demo 0
```

Most demos require a provider backend running at `http://localhost:4000`. Start it with `npm run dev` from the `backend/` directory.

---

### Demo 0 — Full Onboarding (`00-onboarding.ts`)

**What it shows:** The complete one-time agent setup flow. Derives the AA wallet, mints the agent NFT, creates a session key, funds the vault with native KITE and DmUSDT, then prints the final on-chain state.

**Value:** Demonstrates that setting up a paying AI agent is a handful of SDK calls — no manual contract interaction needed.

**Prerequisites:** Run `npx kite init` first. EOA must hold KITE for gas.

---

### Demo 1 — Per-Call Payment with x402 (`01-percall-payment.ts`)

**What it shows:** The fundamental payment primitive. Makes the same API call twice: once with a plain `fetch` (gets a `402`), then with `client.callPaidApi` (auto-pays via EIP-712 signed receipt and retries).

**Value:** Proves that agents can pay for API access without any prior channel setup — pure pay-as-you-go. Shows exactly what the `X-PAYMENT` header contains and how settlement flows through `KiteAAWallet`.

---

### Demo 2 — Session-Bound Channel Architecture (`02-session-bound-channel.ts`)

**What it shows:** How Kite payment channels are different from traditional state channels. Channels are bound to a session key registered in the AA wallet, which enforces per-session spending limits and time bounds.

**Value:** Explains the architectural differentiator — granular spend control, time-bounded execution, and revocable delegation without exposing the EOA.

---

### Demo 3 — Batch Channel Flow (`03-batch-channel-flow.ts`)

**What it shows:** Opens a channel on-chain once, makes up to 10 API calls through it accumulating provider-signed receipts (each with a merkle root), then settles the aggregate cost.

**Value:** Demonstrates gas efficiency — one on-chain transaction opens the channel, one closes it, regardless of how many calls are made in between.

---

### Demo 4 — Stream Channel Flow (`04-stream-channel-flow.ts`)

**What it shows:** A time-governed channel that runs API calls on a schedule (every 3 seconds) for a fixed window (30 seconds), then auto-closes when the window expires.

**Value:** Perfect for recurring tasks, monitoring feeds, and scheduled data collection within a time window. Shows the difference between count-limited (batch) and time-limited (stream) channels.

---

### Demo 5 — Channel Settlement and Finalization (`05-channel-settlement.ts`)

**What it shows:** The full channel lifecycle end-to-end: `open → activate → calls → initiateSettlement → provider approveSettlement → Closed → refund`. The provider cooperatively approves settlement immediately, skipping the challenge window.

**Value:** Shows how unused channel deposits are refunded to the AA wallet. Demonstrates the cooperative settlement path that eliminates the need to wait for the challenge window.

---

### Demo 6 — Multi-Provider Agent Workflow (`06-multi-provider-agent.ts`)

**What it shows:** A single agent identity (one session key) making paid calls to multiple providers simultaneously — a real localhost backend plus a mock analytics provider started inline.

**Value:** Proves that agent-based authentication replaces per-provider API keys. One identity, many providers, no API key juggling.

---

### Demo 7 — Observability and Transparency (`07-observability.ts`)

**What it shows:** Queries the subgraph indexer for agent, session, channel, and payment history. Inspects local channel state and unsettled calls. Prints a full cost attribution report.

**Value:** Shows that every payment is auditable and attributable — essential for compliance, debugging, and spend analysis.

---

## SDK — Entry Points

The SDK exports everything through `src/index.ts`. Key exports:

### `KiteSettleClient` (primary class)

```ts
import { KiteSettleClient } from "@kite-agentic-pay/sdk";

// Create from stored credential (set by kite init)
const client = await KiteSettleClient.create({ credential: seedOrKey });

// Create read-only (for on-chain reads, no signing)
const ro = KiteSettleClient.createReadOnly();
```

**Core methods:**

| Method | Description |
|---|---|
| `callPaidApi(options)` | Make a paid API call (handles x402 automatically) |
| `fetchWithPayment(url, opts)` | Drop-in replacement for fetch with auto-payment |
| `openChannel(options)` | Open a payment channel with a provider |
| `callOnChannel(channelId, url, opts)` | Make a call on an existing channel |
| `initiateSettlement(channelId)` | Start channel settlement |
| `finalizeChannel(channelId)` | Force-finalize after challenge window |
| `getOwnerAAWalletAddress()` | Get the AA wallet address for this EOA |
| `getDepositedBalance(token, wallet)` | Check balance in AA wallet |
| `deposit(token, amount)` | Fund the AA wallet |
| `withdraw(token, amount)` | Withdraw to EOA |
| `onboardAgent(options)` | One-step agent registration |
| `getAgentsByOwner(address)` | Query agents from indexer |
| `getSessionsByAgent(agentId)` | Query session keys from indexer |
| `getChannelsByAgent(agentId)` | Query payment channels from indexer |
| `getPaymentsByAgent(agentId)` | Query payment history from indexer |

### Other exports

```ts
// Wallet utilities
import { createKiteWallet, deriveAgentAccount, deriveSessionAccount, generateSeedPhrase } from "@kite-agentic-pay/sdk";

// Receipt utilities (for provider-side verification)
import { createSignedReceipt, verifyReceipt, validateReceipt } from "@kite-agentic-pay/sdk";

// On-chain decision engine
import { decide, checkRules } from "@kite-agentic-pay/sdk";

// Contract ABIs
import { identityRegistryAbi, paymentChannelAbi, kiteAAWalletAbi } from "@kite-agentic-pay/sdk";

// Credential / vars store
import { getCredential, setCredential, getVar, setVar } from "@kite-agentic-pay/sdk";

// Network config
import { KITE_TESTNET } from "@kite-agentic-pay/sdk";

// Types
import { ChannelStatus, PaymentMode } from "@kite-agentic-pay/sdk";
import type { SessionRules, Decision, KiteSettleClientOptions } from "@kite-agentic-pay/sdk";
```

---

## Config Files

All credentials are stored in `~/.kite-agent-pay/` (user home directory):

| File | Contents | Set by |
|---|---|---|
| `config.json` | EOA private key / seed phrase | `kite init` |
| `vars.json` | Agent IDs, session keys, wallet addresses | `kite onboard`, `kite session start` |

Both files are created with mode `0600` (owner read/write only) and should never be committed to version control.

---

## Network — Kite AI Testnet

| Parameter | Value |
|---|---|
| RPC URL | `https://rpc-testnet.gokite.ai` |
| Chain ID | `2368` |
| Bundler URL | `https://bundler-service.staging.gokite.ai/rpc/` |
| Explorer | `https://testnet-explorer.gokite.ai` |

Default token: **DmUSDT** (`0xd4a87d5531A586C247BD13F3Bb0Dd68C6253B489`, 18 decimals)
