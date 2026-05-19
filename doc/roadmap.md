
---

# `ROADMAP.md` – Detailed Roadmap

```markdown
# Kite Agent Payment PoC – Roadmap

## Phase 1: MVP (2-3 Weeks)
- Backend:
  - Implement `/api/agent`, `/api/service`, `/api/payment`
  - Middleware for session and policy enforcement
  - 402 Payment Required responses
  - MCP integration stubs for single payments

- Frontend:
  - NextJS dashboard
  - Agent table, session table, payment history
  - Policy configuration forms

- Agent SDK:
  - API call interception
  - MCP payment request handling
  - Logging of usage

- Smart Contracts (Hardhat, Kite Chain):
  - KiteAAWallet.sol — AA wallet with addSessionKeyRule() for per-agent spending enforcement [done]
  - AgentRegistry.sol — On-chain agent + session key registration with DID-style resolution [done]
  - AnchorMerkle.sol — Anchors Merkle roots of usage logs [done]
  - PaymentChannel.sol — Payment channels with signed receipts, prepaid/postpaid modes, dispute resolution [done]
  - Deployment scripts for Kite Ozone testnet [done]
  - Generate + anchor Merkle root from backend usage logs [done]
  - 75 contract tests passing across all 4 contracts [done]

- Backend API (41 endpoints):
  - Agent routes: register, sessions, list, revoke [done]
  - Service routes: mock 402 provider [done]
  - Payment routes: x402, verify, anchor [done]
  - Wallet routes: balance, deposit, withdraw, session rules [done]
  - Registry routes: resolve by domain/address/session [done]
  - Channel routes: open, activate, close, dispute, force-close, status [done]

- Testnet Integration:
  - Kite Passport identity binding (User → Agent → Session)
  - Kite Ozone testnet tokens (KITE + stablecoin)
  - x402 facilitator integration with AA wallet settlement

---

## Phase 2: Post-MVP / Hackathon Stretch (2 Weeks)
- Agent attestation and reputation system on AgentRegistry
- Batched payments for high-reputation agents
- Merkle/ZK proofs for off-chain usage aggregation
- KiteAAWallet factory contract (deploy per user)
- Agent MCP SDK wrapper (intercept, pay, log)
- Service-level incentives for agents
- Dynamic pricing based on usage
- Multi-agent orchestration
- Optional mainnet deployment

---

## Phase 3: Full Product / Long-Term
- Full enterprise usage
- Cross-chain payments
- ZK attestations for agent reputation
- Open API for third-party service providers