# Kite Agent Pay — Provider Backend (`backend/`)

The `backend` package is a **reference implementation** of how a service provider integrates with the Kite Agent Pay protocol. It is a simulation — not a production data service — but it accurately shows every pattern a real provider must implement to monetise API endpoints using Kite.

If you are building a service that wants to charge AI agents for access, this is the template to follow.

---

## What It Simulates

The backend exposes three categories of endpoints, each demonstrating a different payment model:

| Route prefix | Payment model | Description |
|---|---|---|
| `/api/data/*` | **x402 per-call** | Each request requires a fresh signed payment receipt |
| `/api/stream/*` | **Channel-based** | Multi-step protocol: first call opens a channel, subsequent calls accumulate receipts |
| `/api/flex/*` | **Dual-mode** | Accepts either x402 per-call OR channel payment — consumer chooses |

The server runs on port `4000` by default.

---

## Starting the Backend

```bash
cd backend
npm install
cp .env.example .env   # fill in contract addresses and deployer key
npm run dev
```

### Required environment variables

```env
# RPC
KITE_TESTNET_RPC=https://rpc-testnet.gokite.ai

# Deployer key — used for on-chain settlement calls
DEPLOYER_PRIVATE_KEY=0x...

# Contract addresses (from contracts/deployments.json)
IDENTITY_REGISTRY_ADDRESS=0xE4C30627C02791bF12241021f2fC320b43991cb1
KITE_AA_WALLET_ADDRESS=<your deployed KiteAAWallet address>
PAYMENT_CHANNEL_ADDRESS=0x8EC6B059178485a37FF3f3AE6351994A6597d4Fb
ATTESTATION_REGISTRY_ADDRESS=0x2F72b719679FD0b92712D03a1E16909F18d55660

# Token addresses
DM_USDT_TOKEN=0xd4a87d5531A586C247BD13F3Bb0Dd68C6253B489
PAYMENT_TOKEN_ADDRESS=0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63

# Address that receives payments (typically the deployer)
FACILITATOR_RECIPIENT_ADDRESS=0x...
DEPLOYER_ADDRESS=0x...
```

---

## Payment Models Explained

### x402 Per-Call (`/api/data/*`)

This is the simplest model. Every request must carry a valid `X-PAYMENT` header containing an EIP-712 signed receipt authorising the stated amount.

**Flow:**

```
Agent → GET /api/data/protocol-report
Provider → 402 Payment Required
           X-Payment-Offers: [{ token, amount, recipient }]

Agent signs receipt with session key
Agent → GET /api/data/protocol-report
         X-PAYMENT: <signed receipt>
Provider → validates receipt on-chain via KiteAAWallet.executePayment()
Provider → 200 OK + data
```

**Endpoint pricing:**

| Endpoint | DmUSDT | PaymentToken |
|---|---|---|
| `GET /api/data/market/:symbol` | 0.40 | 0.04 |
| `GET /api/data/intelligence` | 0.40 | 0.04 |
| `GET /api/data/protocol-report` | 0.40 | 0.04 |

The `requireX402Payment` middleware handles the challenge/validation logic. The provider only needs to supply a payment config (token, amount, recipient) and attach the middleware.

---

### Channel-Based (`/api/stream/*`)

Channel endpoints implement the full multi-step protocol:

**Step 1 — No channel header present:**
Provider returns `402` with both x402 and channel metadata (`channelOptions`). The consumer must open a channel first.

**Step 2 — First request with `X-Channel-Id`:**
Provider verifies the channel is active on-chain (calls `PaymentChannel.channels(channelId)`), then returns data plus a signed receipt (`seq=1`).

**Step 3 — Subsequent requests with `X-Channel-Id` + `X-Last-Receipt-*`:**
Provider validates receipt continuity (sequence number, cumulative cost), returns data and a new signed receipt.

All receipts use the same EIP-712 digest that `PaymentChannel.sol` verifies during settlement.

**Endpoint pricing (discounted vs per-call):**

| Endpoint | Rate per call |
|---|---|
| `GET /api/stream/market/:symbol` | 0.05 DmUSDT |
| `GET /api/stream/intelligence` | 0.20 DmUSDT |
| `GET /api/stream/protocol-report` | 0.40 DmUSDT |

The `requireChannelPayment` middleware handles all of the above steps. It needs only the rate config.

---

### Dual-Mode Flex (`/api/flex/*`)

Flex endpoints advertise both payment models in the same `402` response. The consumer picks whichever mode it prefers. The provider logic handles both paths transparently.

This is the recommended model for production providers — it maximises consumer compatibility.

---

## Background Watchers

When the server starts it launches two background processes:

### Channel Watcher (`startChannelWatcher`)

Polls for channels that have been opened by consumers and activates them on-chain. When a consumer opens a channel by calling `PaymentChannel.openChannel()`, the provider must call `activateChannel()` to acknowledge it. This watcher does that automatically.

### Settlement Watcher (`startSettlementWatcher`)

Polls for channels in `SettlementPending` status and calls `approveSettlement()` — the provider's acknowledgement that the claimed amount is correct. Cooperative settlement skips the 1-hour challenge window and closes the channel immediately, triggering refund of any unused deposit to the consumer's AA wallet.

---

## How a Real Provider Implements This

A production service replacing this simulation would:

1. **Replace the data controllers** (`backend/src/controllers/data.ts`, `channel-data.ts`) with calls to real data sources or AI models.

2. **Keep the middleware unchanged** — `requireX402Payment` and `requireChannelPayment` are generic and handle all on-chain verification. They are not simulation-specific.

3. **Configure the payment parameters** (token, amount, recipient) to match their real pricing model.

4. **Run the background watchers** in their deployment to activate channels and approve settlements.

5. **Keep the deployer key** (`DEPLOYER_PRIVATE_KEY`) secure — this is the key that calls `activateChannel` and `approveSettlement` on-chain. In production, consider using a dedicated settlement address separate from the main deployer.

---

## API Routes Summary

| Method | Path | Payment | Description |
|---|---|---|---|
| `GET` | `/api/health` | None | Health check, contract config status |
| `GET` | `/api/data/market/:symbol` | x402 | Simulated market data for a trading pair |
| `GET` | `/api/data/intelligence` | x402 | Simulated AI on-chain intelligence signals |
| `GET` | `/api/data/protocol-report` | x402 | Simulated DeFi protocol analytics |
| `GET` | `/api/stream/market/:symbol` | Channel | Market data via payment channel |
| `GET` | `/api/stream/intelligence` | Channel | Intelligence feed via payment channel |
| `GET` | `/api/stream/protocol-report` | Channel | Protocol report via payment channel |
| `GET` | `/api/flex/*` | x402 or Channel | Dual-mode — consumer chooses |

Additional routes registered in the server but used primarily by the MCP SDK demos:

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/agent/*` | Agent registration and session management |
| `GET` | `/api/registry/*` | On-chain identity resolution |
| `GET` | `/api/channel/*` | Channel state queries |
| `POST` | `/api/payment/*` | Manual payment execution |
| `GET` | `/api/service/*` | Service discovery / metadata |
| `GET` | `/api/wallet/*` | Wallet balance queries |
| `GET` | `/api/tools/*` | Internal tool execution (MCP-adjacent) |

---

## Contract Service (`backend/src/services/contract-service.ts`)

Thin wrapper over ethers.js for all on-chain interactions. Uses a static-network provider to avoid polling (the Kite testnet drops `eth_newFilter` immediately).

Key functions:

- `getIdentityRegistry()` — validates sessions before payment
- `getKiteAAWallet()` — executes per-call payments
- `getPaymentChannel()` — activates channels, approves settlements, finalizes
- `getClientAgentVault(address)` — reads user-specific vault state
- `getAttestationRegistry()` — submits Merkle roots after settlement

All functions accept an optional `signerOrProvider` to switch between read-only and write mode.
