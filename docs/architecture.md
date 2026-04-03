# Kite Agent Payment – Architecture

## Components

1. **Frontend (NextJS)**
   - Displays:
     - Agent list
     - Active sessions
     - Payment history
   - Allows users to configure:
     - Session limits
     - Allowed services
   - Calls backend APIs for data

2. **Backend (Node/Express)**
   - **Agent API**: agent registration and session management
   - **Service API**: mocks real APIs returning 402
   - **Payment API**: submits payments to x402 facilitator, anchors Merkle roots
   - **Wallet API**: balance, deposit, withdraw, session key rules
   - **Registry API**: agent/session resolution by domain, address, session key
   - **Channel API**: open, activate, close, dispute, force-close payment channels
   - **Policy Middleware**: enforces session/agent rules
   - **Merkle aggregator**: collects usage logs and anchors roots on-chain

3. **AI Agent MCP SDK**
   - Intercepts API requests
   - Checks session limits and allowed services
   - Requests payment via MCP / x402
   - Updates backend with usage logs

4. **Smart Contracts (Kite Chain / Hardhat)**
   - **KiteAAWallet.sol** — AA-style smart contract wallet owned by the user. Holds shared stablecoin funds. Agents operate via session keys with on-chain spending rules (`addSessionKeyRule`). Enforces per-transaction limits, daily caps, and whitelisted recipients.
   - **AgentRegistry.sol** — On-chain registry mapping agent DIDs to wallet addresses and session keys. Exposes `getAgent()`, `resolveAgentByAddress()`, and `getAgentBySession()` for permissionless identity resolution.
   - **AnchorMerkle.sol** — Stores Merkle roots of aggregated agent usage logs. Enables batch payment verification and auditable proof of service consumption.
   - **PaymentChannel.sol** — Bidirectional payment channels between consumer and provider agents. Supports prepaid (deposit up front) and postpaid (pull on close) modes. Uses ECDSA-signed receipts with cumulative cost for off-chain usage tracking. Includes dispute resolution with 1-hour timeout and force-close for expired channels.

5. **Service Provider API**
   - Returns 402 Payment Required if no X-PAYMENT
   - Receives and validates X-PAYMENT header
   - Sends service response after payment confirmed

---

## Payment Types

1. **Per-call (x402)** — Each API call triggers a payment via x402 header. Suited for low-frequency or untrusted agents.
2. **Batched calls** — Multiple calls aggregated into a single settlement. Reduces on-chain transactions.
3. **Time-based session (PaymentChannel)** — Consumer opens a channel with deposit and max duration. Provider signs receipts per call with cumulative cost. Settlement happens once at channel close using the last valid receipt.
4. **Subscription** — Recurring time-based channels with auto-renewal.

Types 1-2 are per-call payment patterns. Types 3-4 use payment channels with signed receipts.

### Signed Receipt Flow (PaymentChannel)

1. Consumer opens channel on-chain (deposit + rate + duration)
2. Provider activates the channel
3. Per API call, provider signs a receipt: `{channelId, sequenceNumber, cumulativeCost, timestamp}`
4. Consumer verifies: signature, sequence continuity, cumulative consistency, rate bounds, budget
5. On session end, consumer submits last receipt to close channel on-chain
6. Contract verifies provider signature and settles: provider gets cumulativeCost, consumer gets remainder
7. Either party can dispute within grace period; force-close available after expiry

---

## Data Flow Diagram

```mermaid
flowchart TB
    U[User EOA / Kite Passport] -->|Sign Standing Intent| W[KiteAAWallet AA Contract]
    W -->|addSessionKeyRule| R[AgentRegistry Contract]
    U -->|Authorize MCP| A[Agent MCP SDK]
    A -->|Intercept API| B[Backend Policy Engine]
    B -->|Return 402| A
    A -->|Session Signature + x402| S[Service API]
    S -->|Verify Payment| F[x402 Facilitator]
    F -->|Execute Transfer via AA Wallet| W
    F -->|Confirm to Service| S
    A -->|Open Channel| PC[PaymentChannel.sol]
    S -->|Sign Receipt| A
    A -->|Close with Receipt| PC
    B -->|Log Usage| M[Merkle Aggregator]
    M -->|Anchor Root| C[AnchorMerkle.sol on Kite Chain]
    B -->|Update Frontend| D[NextJS Dashboard]