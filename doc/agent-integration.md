# Kite Agent Payment PoC - Agent Integration Guide

This document explains how to connect AI agents to the backend APIs using the **WDK/Tether SDK** and MCP/X402 payment flow. Agents should be compatible with clients like **Claude Desktop, OpenClaw, and Cursor**.

---

## **Purpose**

Agents in this system:

1. Make off-chain service requests to APIs.
2. Handle 402 Payment Required responses from services.
3. Obtain payment authorization from the **Kite MCP server**.
4. Settle payments through the facilitator.
5. Retry service requests once payment is confirmed.
6. Maintain session usage and enforce limits.

---

## **Architecture**

```mermaid
flowchart TD
    Client["AI Client (Claude/OpenClaw)"]
    Agent["WDK Agent / Tether SDK"]
    Backend["Kite Agent Payment Backend API"]
    MCP["Kite MCP Server"]
    Service["Off-chain Service (Mock or Real)"]
    Facilitator["x402 On-chain Facilitator"]

    Client -->|Execute Agent| Agent
    Agent -->|Call Service API| Service
    Service -->|402 Payment Required| Agent
    Agent -->|MCP authorizePayment| Backend
    Backend -->|Settle via Facilitator| Facilitator
    Facilitator -->|Confirm on-chain transfer| Backend
    Backend -->|Return Service Response| Agent
    Agent -->|Return Result| Client