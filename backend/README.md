# Kite Agent Payment PoC Backend

This project implements the **backend infrastructure** for a Kite Agent Payment PoC. It allows **AI agents** to make **controlled, authorized payments** for off-chain services using the Kite MCP / x402 protocol. This backend serves as a **bridge between agents, services, and the on-chain facilitator**.

---

## **Project Goals**

- Enable agents to interact with **off-chain services** that require payment.
- Handle **x402 Payment Required (402)** flow.
- Track **agent sessions, budgets, and payments**.
- Integrate with **Kite Chain AA wallet** (`KiteAgentWallet.sol`) and **AgentRegistry** for on-chain session key enforcement.
- Integrate with a **facilitator** to execute on-chain transfers via the AA wallet.
- Anchor usage logs on-chain via **AnchorMerkle.sol** for verifiable batch payment proofs.

---

## **Key Features**

1. **Agent Management**
   - Register agents with wallet addresses.
   - Create and manage **sessions** with per-transaction and total budget limits.

2. **Service Simulation**
   - Off-chain services return 402 responses for unpaid requests.
   - Services specify pricing, wallet address, and optional dynamic pricing.

3. **Payment Flow**
   - Agents request authorization via MCP.
   - Backend handles approval and settlement through a **facilitator**.
   - Payment logs stored and aggregated.

4. **Policy Enforcement**
   - Ensures agents cannot exceed session limits.
   - Enforces per-transaction maximum and allowed services.

5. **Usage Aggregation**
   - Logs payments and service usage for auditing and future ZK proofs.

---

## **Architecture Overview**

### **Modules**

| Module | Purpose |
|--------|---------|
| `models/` | Defines **Agent, Session, Service, PaymentLog** data structures. |
| `controllers/` | Business logic for **agents, services, and payments**. |
| `routes/` | Maps API endpoints to controllers. |
| `services/` | MCP/X402 integration stubs and usage aggregation logic. |
| `middlewares/` | Policy enforcement and error handling. |
| `server.ts` | Entry point, wires routes and middleware. |

### **High-Level Flow**

```mermaid
flowchart TD
    Agent["AI Agent (Client)"]
    MCP["MCP SDK / Kite Passport"]
    Backend["Backend API (PoC)"]
    Service["Off-chain Service (Mock or Real)"]
    Facilitator["x402 / On-chain Facilitator"]

    Agent -->|Call Service API| Service
    Service -->|402 Payment Required| Agent
    Agent -->|MCP approvePayment| Backend
    Backend -->|Settle Payment via Facilitator| Facilitator
    Facilitator -->|On-chain transfer| Service
    Backend -->|Return service response| Agent