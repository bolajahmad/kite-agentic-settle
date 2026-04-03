# Kite Agent Pay — Frontend Requirements Specification

## 1. Purpose

The frontend is a **NextJS dashboard** that serves as the control plane for the Kite Agent Pay ecosystem. It connects to the backend (Express, port 4000) and directly to the Kite Ozone testnet (chain ID 2368) via the user's wallet (MetaMask / Kite Passport).

Three distinct user personas interact with it:

| Persona | Role | Primary actions |
|---|---|---|
| **EOA User (Consumer Owner)** | Human who owns a KiteAAWallet and delegates spending to AI agents | Deploy wallet, register agents, set spending rules, fund agents, monitor usage, chat with agents |
| **API Provider** | Human or org that offers paid API services | Register services, set pricing, configure accepted payment modes, view earnings, manage channels |
| **AI Agent (via MCP)** | Autonomous software agent operating on behalf of the EOA user | Invisible to the UI — the frontend shows the *results* of agent activity (payments, usage logs, receipts) |

---

## 2. Authentication & Wallet Connection

### 2.1 Wallet Connection
- Connect via MetaMask, WalletConnect, or Kite Passport
- Auto-detect Kite Ozone testnet (chain ID 2368, RPC `https://rpc-testnet.gokite.ai`)
- Prompt to add network if not configured
- Display connected address + native KITE balance + KTT token balance
- The connected address becomes the `ownerAddress` for all contract interactions

### 2.2 First-Time Detection
- On connect, call `AgentRegistry.getOwnerAgents(connectedAddress)`
- If empty → show onboarding wizard (Section 3)
- If populated → show dashboard (Section 4)

---

## 3. Onboarding Flow (First-Time EOA User)

A step-by-step wizard for users who have never used the platform.

### Step 1: Deploy KiteAAWallet
- Explain: "This is your smart wallet that holds funds your AI agents can spend"
- Call wallet factory to deploy a new KiteAAWallet with `owner = connectedAddress`
- Link the wallet to AgentRegistry
- Show: deployed wallet address, etherscan-style link on Kite testnet explorer
- Option: "I already have a wallet" → paste existing KiteAAWallet address

### Step 2: Fund the Wallet
- Show current KTT balance of the wallet (read from ERC20.balanceOf)
- Input: amount to deposit
- Two-step: ERC20 approve → `KiteAAWallet.deposit(token, amount)`
- Show confirmation with tx link

### Step 3: Register First Agent
- Input fields:
  - **Agent Name**: free text (e.g., "Research Assistant")
  - **Agent Domain**: structured identifier (e.g., "research-bot.kite")
  - **Agent Address**: the BIP-32 derived address of the agent (this comes from the agent's MCP SDK — the user would get this from `npx kite whoami` or the agent platform provides it)
- On submit: call `AgentRegistry.registerAgent(agentId, domain, agentAddress, walletAddress)` where `agentId = keccak256(domain)`
- Show: registered agent ID, on-chain tx confirmation

### Step 4: Set Spending Rules
- For the newly registered agent, create a session key rule:
  - **Session Key Address**: the key the agent will sign with (can be same as agent address or a delegate)
  - **Per-Transaction Limit** (KTT): max the agent can spend per API call
  - **Daily Limit** (KTT): rolling 24h spending cap
  - **Valid Until**: date picker → converted to unix timestamp
  - **Allowed Recipients**: optional list of provider addresses the agent is allowed to pay (empty = any)
- On submit: call `KiteAAWallet.addSessionKeyRule(sessionKey, agentId, valueLimit, dailyLimit, validUntil, allowedRecipients)`
- Show summary card of the rule with all parameters

### Step 5: Done
- Show recap: wallet address, agent name, rules summary
- "Your agent can now autonomously pay for API services within these rules"
- Provide the CLI config snippet:
  ```
  npx kite vars set AGENT_1_SEED
  ```
- Link to documentation / SDK setup guide

---

## 4. EOA User Dashboard (Consumer Owner)

The primary interface after onboarding. Tabs or sidebar navigation.

### 4.1 Overview / Home
- **Wallet Summary Card**
  - KiteAAWallet address (copyable)
  - KTT balance (live, from `ERC20.balanceOf(wallet)`)
  - Locked funds across active channels (from `PaymentChannel.getLockedFunds(wallet, token)`)
  - Available balance = total - locked
  - Quick actions: Deposit, Withdraw
- **Agent Summary Cards** (one per registered agent)
  - Agent name, domain, address
  - Status: Active / Inactive (from `AgentRegistry.getAgent`)
  - Today's spend (from `KiteAAWallet.getDailySpend(sessionKey)`)
  - Daily limit utilization bar (spent / dailyLimit as percentage)
  - Active channels count
  - Active batch sessions count
  - Last activity timestamp
- **Recent Activity Feed**
  - Last 10 payments (from `PaymentExecuted` events on KiteAAWallet)
  - Each entry: timestamp, agent name, recipient address (resolve to service name if known), amount, tx hash link
- **Spending Chart**
  - Daily spend over last 30 days (aggregate `PaymentExecuted` events)
  - Breakdown by agent (stacked bars or lines)

### 4.2 Agents Management

#### Agent List
- Table: Agent Name | Domain | Address | Status | Session Keys | Daily Spend | Actions
- Actions per agent: View Details, Add Session Key, Revoke All Sessions, Deactivate

#### Agent Detail Page
- **Identity Section**
  - Agent ID (bytes32), Name, Domain, Derived Address, Wallet Contract
  - On-chain registration tx link
  - Status toggle: Active / Deactivated (calls `AgentRegistry.deactivateAgent`)
- **Session Keys Section**
  - Table: Session Key Address | Value Limit | Daily Limit | Valid Until | Active | Actions
  - Each row data from `KiteAAWallet.getSessionRule(sessionKey)`
  - Expandable row shows `allowedRecipients` list
  - Daily spend indicator per key from `KiteAAWallet.getDailySpend(sessionKey)`
  - Actions: Revoke (calls `KiteAAWallet.revokeSessionKey`)
  - "Add Session Key" button opens form (same as onboarding Step 4)
- **Payment History (per agent)**
  - Filter `PaymentExecuted` events by agent's session keys
  - Table: Timestamp | Service URL | Amount | Recipient | Method (x402/channel/batch) | Tx Hash
  - Clickable rows expand to show receipt details (request hash, response hash, nonce, signature)
- **Active Channels**
  - List active channels where this agent's session key is the consumer
  - Per channel: provider name, deposit, time remaining, cumulative cost, status badge
  - Actions: Close Channel, Dispute
- **Active Batch Sessions**
  - List batch sessions in progress
  - Per session: provider, deposit, calls made, cumulative cost, time remaining, estimated refund
  - Actions: End Session

#### Register New Agent
- Same form as onboarding Step 3
- Validates: domain uniqueness check (call `AgentRegistry.resolveAgentByDomain` — must not exist), address not already registered

### 4.3 Wallet Management

- **Balance Display**
  - Total KTT in wallet
  - Locked in active channels
  - Available (unlocked)
- **Deposit Form**
  - Amount input with "Max" button
  - Two-step tx: ERC20 approve → `KiteAAWallet.deposit(token, amount)`
  - Progress indicator: Approving... → Depositing... → Done
- **Withdraw Form** (owner only)
  - Amount input (max = available balance, cannot withdraw locked funds)
  - Calls `KiteAAWallet.withdraw(token, amount)`
- **Transaction History**
  - All `FundsDeposited` and `FundsWithdrawn` events
  - Table: Type (Deposit/Withdraw) | Amount | Timestamp | Tx Hash

### 4.4 Payment Channels

#### Active Channels
- Table: Channel ID (short) | Provider | Mode (Prepaid/Postpaid) | Deposit | Rate/Call | Time Left | Cumulative Cost | Status Badge | Actions
- Status badges:
  - Open (blue) — waiting for provider to activate
  - Active (green) — in use
  - Settling (yellow) — close in progress
  - Disputed (red) — dispute raised
  - Closed (gray) — settled
- **Open New Channel** button:
  - Provider address (autocomplete from known providers in the marketplace)
  - Mode: Prepaid (requires deposit) / Postpaid (credit)
  - Deposit amount (only for Prepaid)
  - Max duration (dropdown: 1h, 6h, 24h, 7d, custom)
  - Rate per call (KTT)
  - Calls `PaymentChannel.openChannel(...)`

#### Channel Detail Page
- All fields from `PaymentChannel.getChannel(channelId)`
- Visual timeline: Opened → Activated → Active (with elapsed time bar) → Closed/Disputed
- Receipt log: sequence-ordered list of signed receipts with cumulative cost chart
- Actions:
  - **Close Channel** — submit last receipt to close
  - **Close Empty** — close with 0 settlement (no calls made)
  - **Dispute** — raise dispute (shows: "Dispute window: 1 hour. If unresolved, channel settles with 0 to provider")
  - **Force Close** — available after expiry + 5min grace

#### Dispute Panel (when status = Disputed)
- Shows: who raised it, when, deadline countdown
- "Resolve with Receipt" — paste/select a provider-signed receipt to settle
- "Wait for Expiry" — if deadline passes, `finalizeExpiredDispute` settles at 0

### 4.5 Merkle Audit Trail

- **Anchored Roots List**
  - From `AnchorMerkle.totalAnchors()`, paginate with `getAnchor(index)`
  - Table: Index | Merkle Root | Log Count | Timestamp | Metadata
  - Per-agent filter: `AnchorMerkle.getAgentAnchorIndices(agentId)`
- **Verify a Log Entry**
  - Input: Anchor Index, Leaf Hash, Proof (JSON array of bytes32)
  - Calls `AnchorMerkle.verifyLeaf(anchorIndex, leaf, proof)`
  - Shows: Valid / Invalid with green/red indicator

### 4.6 Chat with Agent (Agent Interaction Panel)

This is how the EOA user communicates intent to their agent, which then uses the MCP SDK to execute tasks autonomously.

- **Chat Interface** (per agent)
  - Message input at bottom, conversation history above
  - The agent connects via MCP protocol — the frontend displays tool invocations and results inline
  - Example conversation:
    ```
    User: "Get me the weather forecast for Lagos for the next 3 days"
    Agent: [Calling weather-api.kite...] 
           [Payment: 0.1 KTT via x402 → tx 0xabc...]
           "Lagos forecast: 32°C tomorrow, 29°C Wed, 31°C Thu. Light showers expected Wednesday."
    ```
  - Display inline:
    - Tool calls: which MCP tool was invoked (from the 7 tool definitions), with parameters
    - Payment events: amount, method (x402/channel/batch), tx hash link, approval decision and reasoning
    - Errors: "Insufficient balance", "Price exceeds per-call limit", etc.

- **Active Context Panel** (sidebar during chat)
  - Current balance
  - Session spend so far
  - Daily limit remaining
  - Active channels with this agent
  - Active batch sessions

- **Approval Prompts**
  - When the agent's `decide` engine reaches the "cli" tier or the amount exceeds `requireApprovalAbove`, the UI shows an approval dialog:
    - Service name, URL, price, provider address
    - Agent's recommendation (from rules/cost model tier result)
    - Approve / Reject buttons
    - "Always approve this service" checkbox (adds to allowedProviders)

---

## 5. API Provider Dashboard

Providers who want to list paid services on the platform.

### 5.1 Provider Onboarding

- **Register as Provider**
  - Provider name / organization
  - Provider address (connected wallet)
  - Optionally register in AgentRegistry with a domain (e.g., "weather-co.kite")

### 5.2 Service Management

#### Register a New Service
- **Service Name**: e.g., "Real-Time Weather API"
- **Description**: markdown-supported long description
- **Base URL**: the API endpoint (e.g., `https://api.weather-co.com/v1`)
- **Endpoints**: list of paths with:
  - Path (e.g., `/forecast/{city}`)
  - Method (GET/POST)
  - Description
  - Price per call (KTT)
  - Response MIME type
- **Accepted Payment Modes**: checkboxes
  - x402 (per-call)
  - Batch session
  - Payment channel (prepaid)
  - Payment channel (postpaid)
- **x402 Configuration** (if x402 is accepted):
  - `maxAmountRequired` per call
  - `maxTimeoutSeconds`
  - Token address (defaults to KTT)
- **Category Tags**: e.g., Weather, Finance, AI/ML, Data, Compute
- **Icon/Logo**: upload

#### Service Detail / Edit Page
- Edit all fields above
- **Analytics Section**:
  - Total calls received (from backend `/api/payment/history` filtered by provider)
  - Total revenue (KTT earned)
  - Unique agents served
  - Calls per day chart
  - Revenue per day chart
- **Active Channels**
  - Channels where this provider is the `provider` party
  - Actions: Activate (for channels in "Open" status), Force Close with Receipt
- **Active Batch Sessions**
  - Sessions where this address is the provider
  - Latest receipt nonce and cumulative cost per session

### 5.3 Earnings & Settlement
- **Earnings Overview**
  - Total earned (all time)
  - Earned this month/week/day
  - Pending settlement (active channels + batch sessions not yet settled)
- **Settlement History**
  - `ChannelSettled` events where provider received funds
  - Table: Channel ID | Consumer | Amount Settled | Refund | Timestamp | Tx Hash
- **Withdraw** (if provider has a KiteAAWallet)
  - Withdraw from wallet to personal address

### 5.4 Reputation (Future / Display-Ready)
- Provider reputation score (placeholder — data source TBD, could be from Merkle-anchored reviews)
- Number of unique agents served
- Average response time
- Dispute rate (disputes / total channels)
- Uptime indicator (if health check endpoint is provided)

---

## 6. Service Marketplace (Public)

Browsable by both consumers and providers. No authentication required to browse.

### 6.1 Service Catalog
- **Search Bar**: search by name, tag, or domain
- **Filter Panel**:
  - Category (Weather, Finance, AI/ML, etc.)
  - Price range (min-max KTT per call)
  - Payment modes accepted (x402, batch, channel)
  - Provider reputation (minimum score)
  - Sort: Price (low→high), Popularity, Newest, Rating
- **Service Cards** (grid or list view):
  - Service name, provider name, icon
  - Price per call
  - Accepted payment mode badges (x402 / batch / channel)
  - Category tags
  - Provider reputation indicator
  - "10,234 calls served" indicator
  - "Try it" button (if connected) / "Connect wallet" (if not)

### 6.2 Service Detail Page
- Full description (markdown rendered)
- Endpoint documentation (path, method, params, response schema)
- Pricing table (per endpoint if varies)
- Accepted payment modes with configuration details
- Provider identity:
  - Address (with on-chain verification badge if registered in AgentRegistry)
  - Domain (if registered)
  - Wallet contract address
- **"Use this Service"** action:
  - For x402: "Your agent can call this service directly with the MCP SDK"
  - For channel: "Open a payment channel" → redirects to channel opening form with provider pre-filled
  - For batch: "Start a batch session" → configure deposit and limits
  - Provides CLI snippet:
    ```
    npx kite call --url https://api.weather-co.com/v1/forecast/lagos
    ```
- **Reviews / Ratings** (future)
  - Only agents that have verifiable payment receipts can leave ratings
  - Anchored to Merkle roots for auditability

---

## 7. Global Features

### 7.1 Transaction Explorer
- Search by: tx hash, agent address, channel ID, session ID
- Shows full transaction details: sender, recipient, amount, method, receipt, status
- Links to Kite testnet block explorer

### 7.2 Notifications
- Real-time notifications (WebSocket or polling):
  - "Agent X made a payment of 0.5 KTT to Weather API"
  - "Channel with Provider Y expires in 10 minutes"
  - "Agent Z exceeded 80% of daily spending limit"
  - "Batch session ended: time-limit reached, 0.3 KTT refund"
  - "Dispute raised on channel 0xabc — 1 hour to resolve"
  - "Payment rejected: price exceeds per-call limit"
- Notification preferences: per-event toggles for push / in-app / email

### 7.3 Settings
- **Account**: connected wallet, switch network
- **Default Token**: select ERC20 token (default: KTT)
- **Default Decision Mode**: auto / rules / ai / cli — sets the agent's behavior for payment decisions
- **API Keys**: manage `OPENAI_API_KEY` for AI decision tier (stored securely, never displayed after entry)
- **Export Data**: download payment history, usage logs as CSV/JSON

### 7.4 Help & Documentation
- Link to SDK docs
- Inline tooltips on every form field explaining the on-chain parameter
- Guided tutorials: "How to fund your agent", "How to open a payment channel", "How to dispute a charge"

---

## 8. Data Sources & Contract Integration Map

Every piece of data displayed in the UI maps to a specific contract call or backend endpoint:

| UI Element | Data Source |
|---|---|
| Wallet KTT balance | `ERC20.balanceOf(walletAddress)` |
| Locked funds | `PaymentChannel.getLockedFunds(wallet, token)` |
| Agent list | `AgentRegistry.getOwnerAgents(owner)` → `getAgent(agentId)` for each |
| Agent session keys | `KiteAAWallet.getAgentSessionKeys(agentId)` → `getSessionRule(key)` for each |
| Daily spend per key | `KiteAAWallet.getDailySpend(sessionKey)` |
| Session key validity | `KiteAAWallet.isSessionValid(sessionKey)` |
| Payment events | `KiteAAWallet` `PaymentExecuted` event logs (filtered by agent/session) |
| Channel list | Backend `GET /api/channel/:channelId` or index by consumer/provider from events |
| Channel details | `PaymentChannel.getChannel(channelId)` |
| Channel time left | `PaymentChannel.getChannelTimeRemaining(channelId)` |
| Channel expired? | `PaymentChannel.isChannelExpired(channelId)` |
| Receipt hash | `PaymentChannel.getReceiptHash(channelId, seq, cost, ts)` |
| Merkle anchors | `AnchorMerkle.totalAnchors()` → `getAnchor(index)` |
| Agent anchors | `AnchorMerkle.getAgentAnchorIndices(agentId)` |
| Leaf verification | `AnchorMerkle.verifyLeaf(anchorIndex, leaf, proof)` |
| Resolve agent by domain | `AgentRegistry.resolveAgentByDomain(domain)` |
| Resolve agent by address | `AgentRegistry.resolveAgentByAddress(addr)` |
| Resolve by session key | `AgentRegistry.getAgentBySession(sessionKey)` |
| Total agents on platform | `AgentRegistry.totalAgents()` |
| Register agent | `AgentRegistry.registerAgent(...)` (tx) |
| Register session | `AgentRegistry.registerSession(...)` (tx) |
| Add spending rule | `KiteAAWallet.addSessionKeyRule(...)` (tx) |
| Revoke session key | `KiteAAWallet.revokeSessionKey(...)` (tx) |
| Deposit | `ERC20.approve(...)` + `KiteAAWallet.deposit(...)` (2 txs) |
| Withdraw | `KiteAAWallet.withdraw(...)` (tx) |
| Open channel | `PaymentChannel.openChannel(...)` (tx, requires prior ERC20 approve) |
| Close channel | `PaymentChannel.closeChannel(...)` (tx with receipt sig) |
| Dispute channel | `PaymentChannel.disputeChannel(...)` (tx) |
| Anchor root | `AnchorMerkle.anchorRoot(...)` (tx, submitter only) |
| Backend: payment history | `GET /api/payment/history` |
| Backend: usage logs | `GET /api/payment/usage` |
| Backend: service mock | `GET /api/service/mock/:id` |

---

## 9. Agent-to-User Communication Flow

This is how the EOA human "talks to their agent" to trigger the payment flows:

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend Chat UI                          │
│                                                             │
│  User: "Research the top 5 AI papers published this week"   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Agent (MCP SDK running server-side or on device)    │   │
│  │                                                      │   │
│  │ 1. Calls Semantic Scholar API → 402 returned        │   │
│  │ 2. decide() cascade: rules → approve (0.05 KTT)    │   │
│  │ 3. client.fetch() → x402 payment → 0xabc... tx     │   │
│  │ 4. Receives paper list                               │   │
│  │ 5. Calls ArXiv summary API → 402 returned          │   │
│  │ 6. decide() cascade: rules → approve (0.1 KTT)     │   │
│  │ 7. Repeats 5 times (batch session: 5 × 0.1 = 0.5)  │   │
│  │ 8. Returns compiled research summary                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [Tool: call_paid_api] → Semantic Scholar → 0.05 KTT ✓    │
│  [Tool: call_paid_api] → ArXiv Summary × 5 → 0.5 KTT ✓   │
│  Total session spend: 0.55 KTT                             │
│                                                             │
│  Agent: "Here are the top 5 AI papers this week:           │
│          1. 'Scaling Laws for...' — Summary: ..."          │
│                                                             │
│  [Payment Summary: 6 calls, 0.55 KTT, 2 services used]    │
└─────────────────────────────────────────────────────────────┘
```

The frontend renders MCP tool invocations as inline cards showing:
- Tool name (`call_paid_api`, `check_balance`, etc.)
- Parameters (URL, amount)
- Decision result (approve/reject, which tier, reasoning)
- Payment result (success, tx hash, receipt)
- Running session total

When `requireApprovalAbove` threshold is hit, the chat pauses and shows an approval dialog before the agent can proceed.

---

## 10. Page Inventory Summary

| Page | Auth Required | Persona |
|---|---|---|
| Landing / Marketing | No | All |
| Service Marketplace (browse) | No | All |
| Service Detail Page | No | All |
| Connect Wallet | — | — |
| Onboarding Wizard (5 steps) | Wallet | Consumer Owner |
| Dashboard / Overview | Wallet | Consumer Owner |
| Agent List | Wallet | Consumer Owner |
| Agent Detail | Wallet | Consumer Owner |
| Register Agent | Wallet | Consumer Owner |
| Wallet Management | Wallet | Consumer Owner |
| Payment Channels | Wallet | Consumer Owner |
| Channel Detail | Wallet | Consumer Owner |
| Merkle Audit Trail | Wallet | Consumer Owner |
| Chat with Agent | Wallet | Consumer Owner |
| Provider Dashboard | Wallet | Provider |
| Register Service | Wallet | Provider |
| Service Analytics | Wallet | Provider |
| Earnings & Settlement | Wallet | Provider |
| Transaction Explorer | No | All |
| Settings | Wallet | All |
| Notifications | Wallet | All |

---

## 11. Tech Stack Recommendation

| Layer | Technology | Reason |
|---|---|---|
| Framework | Next.js 14+ (App Router) | SSR for marketplace SEO, client components for wallet interaction |
| Wallet | wagmi + viem + RainbowKit | Same viem instance as MCP SDK, consistent ABI usage |
| State | Zustand or TanStack Query | Lightweight, good for contract read caching |
| Styling | Tailwind + shadcn/ui | Fast iteration, consistent component library |
| Charts | Recharts or @nivo | Spending charts, utilization bars |
| Chat | Vercel AI SDK (useChat) | Already a dependency in the MCP SDK (`ai` package) — the same LLM pipe used in the decide engine can stream to the frontend |
| Real-time | WebSocket (from backend) or polling | Payment events, channel status changes, notification delivery |
| Contract types | Generated from ABIs already in `src/abis.ts` | Type-safe contract reads/writes matching the existing ABI definitions |

---

## 12. Out of Scope (Noted for Future)

- Agent reputation scoring algorithm (placeholder UI ready, algorithm TBD)
- ZK proofs for off-chain usage verification
- Cross-chain payment support
- Subscription (B2) payment channel auto-renewal
- Mainnet deployment configuration
- Mobile app / responsive wallet connect
