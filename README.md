# Kite Agent Payment PoC

This project is a proof-of-concept for an **AI Agent Payment Gateway** on Kite. It demonstrates how AI agents can make **controlled, on-chain payments** for off-chain services using the **x402 protocol** and **MCP integration**, with optional **Merkle/ZK proofs** for batched payments.

## Goals

- Allow AI agents to make payments on behalf of users for API services.
- Enforce **agent-level and session-level spending rules** via **on-chain AA wallet session keys**.
- Implement **Kite Passport** identity binding with three-layer identity architecture (User → Agent → Session).
- Provide **full transparency** for payments via a frontend dashboard.
- Enable **batched payments and reputation-based incentives**.
- **Merkle proof system** for verifiable usage logs anchored on-chain.
- Set standards for the Kite ecosystem where SDK gaps exist.

---

## Architecture Overview

### High-Level Flow

      +-----------------+
      |   User Wallet   |
      |  (Kite Passport)|
      +--------+--------+
               |
        authorize MCP
               |
               v
      +-----------------+
      |  AI Agent (MCP) |
      +--------+--------+
               |
  Intercepts service calls
  +------------+-----------------+
  | Backend Policy Engine / API  |
  | - Enforces Session rules     |
  | - Returns 402 Payment Req.   |
  | - Logs usage for Merkle/ZK   |
  +------------+-----------------+
               |
    Payment handled via MCP / x402
               |
               v
      +-----------------+
      | Service Provider|
      |  (API / RPC)    |
      +-----------------+
               |
     Optionally anchor usage logs
               v
      +-----------------+
      |   Blockchain    |
      |  (Merkle/ZK)    |
      +-----------------+


### Components

1. **Frontend (NextJS)**
   - Dashboard: display sessions, payments, usage logs.
   - Policy configuration UI.
   - Agent management interface.

2. **Backend (Node/Express)**
   - API endpoints for agents (`/api/agent`), services (`/api/service`), and payments (`/api/payment`).
   - Middleware to enforce **policy rules**.
   - MCP integration to handle `get_payer_addr`, `approve_payment`, and `batch payments`.
   - Optional **Merkle/ZK aggregator** for usage proofs.

3. **Smart Contracts (Solidity / Hardhat, deployed on Kite Chain)**
   - **KiteAgentWallet.sol** — AA-style wallet with `addSessionKeyRule()` for per-agent spending enforcement.
   - **AgentRegistry.sol** — On-chain agent + session key registration with DID-style identity resolution.
   - **AnchorMerkle.sol** — Anchors Merkle roots of aggregated usage logs for auditable batch payments.

4. **AI Agent MCP SDK**
   - Agent intercepts API calls.
   - Requests payment authorization via MCP.
   - Handles session limits, logs usage, optionally submits batched payments.

---

## Full Architecture Diagram

```mermaid
flowchart TB
    A[User EOA / Kite Passport] -->|Sign Standing Intent| W[KiteAgentWallet AA Contract]
    W -->|addSessionKeyRule| R[AgentRegistry Contract]
    A -->|Authorize MCP| B[AI Agent MCP SDK]
    B -->|Intercept API Calls| C[Backend Policy Engine]
    C -->|Return 402 Payment Required| B
    B -->|Session Signature + x402| D[Service Provider API]
    D -->|Verify via Facilitator| F[x402 Facilitator]
    F -->|Execute Transfer via AA Wallet| W
    D -->|Deliver Service| B
    C -->|Log Usage| E[Merkle Aggregator]
    E -->|Anchor Merkle Root| M[AnchorMerkle.sol on Kite Chain]
    B -->|Update Frontend| G[NextJS Dashboard]