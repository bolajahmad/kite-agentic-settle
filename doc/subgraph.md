# Kite Agent Pay — Subgraph

The `subgraph/` package is a [The Graph](https://thegraph.com) subgraph that indexes all on-chain events from the Kite smart contracts into a queryable GraphQL API. It is the indexing layer that the `@kite-agentic-pay/sdk` uses to power agent/session/channel/payment history queries without hitting an RPC node for every read.

---

## What It Indexes

The subgraph listens to events from three contracts and builds a relational data model:

| Contract | Events indexed |
|---|---|
| `IdentityRegistry` | Agent registration, URI updates, wallet links, session creation/revocation |
| `PaymentChannel` | Channel open, activate, settlement, receipts, finalization |
| `AttestationRegistry` | Reputation feedback, validation requests/responses, Merkle anchors |

A dynamic template (`ClientVault`) is also registered for each new AA wallet encountered, enabling indexing of per-user vault transfers.

---

## Network and Deployment

**Network:** `kite-ai-testnet` (Chain ID `2368`)

**Contract start blocks** (from `subgraph.yaml`):

| Contract | Address | Start Block |
|---|---|---|
| IdentityRegistry | `0xE4C30627C02791bF12241021f2fC320b43991cb1` | 21096127 |
| PaymentChannel | `0x8EC6B059178485a37FF3f3AE6351994A6597d4Fb` | 21096127 |
| AttestationRegistry | `0x2F72b719679FD0b92712D03a1E16909F18d55660` | 21096127 |

---

## Data Model (Entities)

### `User`

Represents an EOA (externally owned account). Created the first time an address appears as an agent owner or channel participant.

| Field | Type | Description |
|---|---|---|
| `id` | ID | EOA address (hex) |
| `address` | Bytes | EOA address |
| `aaWallet` | AAWallet | Primary AA wallet |
| `agents` | Agent[] | All agents owned |
| `sessions` | Session[] | All sessions linked to this EOA |
| `totalChannelsOpened` | BigInt | Lifetime channel count |
| `totalSpent` | BigInt | Lifetime spend (all channels) |
| `totalRefunded` | BigInt | Lifetime refunds |

---

### `Agent`

Represents one agent NFT minted on `IdentityRegistry`. `id` is the `tokenId` as hex.

| Field | Type | Description |
|---|---|---|
| `id` | ID | tokenId as hex |
| `agentId` | BigInt | Numeric token ID |
| `metadata` | String | agentURI (ERC-8004 registration JSON) |
| `owner` | User | NFT owner |
| `aaWallet` | AAWallet | Linked AA wallet |
| `active` | Boolean | Whether agent is active |
| `sessions` | Session[] | All registered session keys |
| `attestations` | Attestation[] | Reputation feedback received |
| `reputationScore` | BigInt | Aggregate score (computed) |
| `feedbackCount` | BigInt | Total feedback entries |

---

### `AAWallet`

Represents a GokiteAccount (AA wallet) contract instance. Derived from `IdentityRegistry.AgentWalletSet` events — no derivation logic needed in the subgraph.

| Field | Type | Description |
|---|---|---|
| `id` | ID | Contract address |
| `address` | Bytes | Contract address |
| `owner` | User | EOA owner |
| `indexed` | Boolean | Whether dynamic ClientVault template was created |
| `agents` | Agent[] | Agents using this wallet |
| `sessions` | Session[] | Sessions using this wallet |

---

### `Session`

Represents a registered session key. `id` is the session key address as hex.

| Field | Type | Description |
|---|---|---|
| `id` | ID | Session key address |
| `sessionKey` | Bytes | Session key address |
| `sessionId` | Bytes | `keccak256(abi.encodePacked(sessionKey, agentId, validUntil))` |
| `user` | User | EOA owner |
| `agent` | Agent | Associated agent NFT |
| `aaWallet` | AAWallet | AA wallet this session uses |
| `validUntil` | BigInt | Expiry timestamp |
| `valueLimit` | BigInt | Per-transaction limit |
| `maxLimit` | BigInt | Total session budget |
| `status` | String | `ACTIVE`, `REVOKED`, or `EXPIRED` |
| `blockedAgents` | BigInt[] | Agent IDs blocked from using this session |
| `payments` | Payment[] | Payments made through this session |
| `channels` | Channel[] | Channels opened with this session |

---

### `SessionIndex`

A lookup from on-chain `sessionId` (bytes32) to a `Session` entity. Used by dynamic ClientVault mappings where events only carry the `sessionId`, not the session key address directly.

| Field | Type | Description |
|---|---|---|
| `id` | ID | sessionId as hex |
| `session` | Session | The matching session entity |

---

### `Channel`

Represents a payment channel. `id` is the `channelId` (bytes32) as hex.

| Field | Type | Description |
|---|---|---|
| `id` | ID | channelId as hex |
| `channelId` | Bytes | On-chain channelId |
| `user` | User | EOA consumer |
| `agent` | Agent | Agent that opened the channel |
| `session` | Session | Session key that opened the channel |
| `aaWallet` | AAWallet | Consumer's AA wallet |
| `provider` | Bytes | Provider EOA address |
| `token` | Bytes | ERC-20 token address |
| `mode` | String | `PREPAID` or `POSTPAID` |
| `deposit` | BigInt | Locked deposit |
| `maxSpend` | BigInt | Spend cap |
| `maxPerCall` | BigInt | Per-call cap |
| `settledAmount` | BigInt | Final settled amount |
| `refundAmount` | BigInt | Refund to consumer |
| `status` | String | `OPEN`, `ACTIVE`, `SETTLEMENT_PENDING`, `CLOSED` |
| `openedAt` | BigInt | Channel open timestamp |
| `expiresAt` | BigInt | Calculated expiry |
| `receipts` | Receipt[] | All receipts submitted |
| `payments` | Payment[] | Settlement payments |

---

### `Receipt`

One EIP-712 signed receipt submitted during channel operation or settlement.

| Field | Type | Description |
|---|---|---|
| `id` | ID | `channelId-sequenceNumber` |
| `channel` | Channel | Parent channel |
| `sequenceNumber` | BigInt | Monotonically increasing call counter |
| `cumulativeCost` | BigInt | Total cost accumulated up to this receipt |
| `submitter` | Bytes | Who submitted this receipt |

---

### `Payment`

A settled payment, either per-call (x402) or channel finalization.

| Field | Type | Description |
|---|---|---|
| `id` | ID | Unique ID |
| `session` | Session | Session that authorized the payment |
| `agent` | Agent | Agent identity |
| `user` | User | EOA consumer |
| `channel` | Channel | Channel (null for per-call payments) |
| `recipient` | Bytes | Provider receiving the payment |
| `token` | Bytes | ERC-20 token |
| `amount` | BigInt | Amount paid |
| `nonce` | BigInt | Payment nonce (per-call) |
| `change` | BigInt | Refund amount |
| `type` | String | `PerCall` or `Channel` |
| `txHash` | Bytes | Transaction hash |

---

### `Attestation`

A reputation feedback entry on the `AttestationRegistry`.

| Field | Type | Description |
|---|---|---|
| `id` | ID | Unique ID |
| `agent` | Agent | Agent receiving feedback |
| `giver` | Bytes | Address that gave feedback |
| `value` | BigInt | Numeric feedback value |
| `tag` | String | Feedback tag (e.g. `quality`, `latency`) |
| `endpoint` | String | API endpoint referenced |
| `isRevoked` | Boolean | Whether feedback was retracted |
| `createdAt` | BigInt | Timestamp |

---

## Event Handlers

### `identity-registry.ts`

| Event | Handler | Effect |
|---|---|---|
| `Registered` | `handleAgentRegistered` | Create `Agent` + `User` entities |
| `URIUpdated` | `handleURIUpdated` | Update `Agent.metadata` |
| `AgentWalletSet` | `handleAgentWalletSet` | Create/update `AAWallet`, link to agent, start `ClientVault` dynamic template |
| `SessionRegistered` | `handleSessionRegistered` | Create `Session` + `SessionIndex` entities |
| `SessionRevoked` | `handleSessionRevoked` | Set `Session.status = REVOKED` |

### `payment-channel.ts`

| Event | Handler | Effect |
|---|---|---|
| `ChannelOpened` | `handleChannelOpened` | Create `Channel`, increment `User.totalChannelsOpened` |
| `ChannelActivated` | `handleChannelActivated` | Set `Channel.status = ACTIVE` |
| `SettlementInitiated` | `handleSettlementInitiated` | Set `Channel.status = SETTLEMENT_PENDING` |
| `ReceiptSubmitted` | `handleReceiptSubmitted` | Create `Receipt` entity |
| `ChannelFinalized` | `handleChannelFinalized` | Set `Channel.status = CLOSED`, create `Payment`, update `User.totalSpent/totalRefunded` |

### `attestation-registry.ts`

| Event | Handler | Effect |
|---|---|---|
| `FeedbackGiven` | `handleFeedbackGiven` | Create `Attestation`, increment `Agent.feedbackCount` |
| `FeedbackRevoked` | `handleFeedbackRevoked` | Set `Attestation.isRevoked = true` |
| `ValidationRequested` | `handleValidationRequested` | Create `Validation` entity |
| `ValidationResponded` | `handleValidationResponded` | Update `Validation` with score |
| `MerkleRootAnchored` | `handleMerkleRootAnchored` | Create `MerkleRoot` entity |

---

## Building and Deploying

```bash
cd subgraph
npm install

# Generate AssemblyScript types from schema and ABIs
npm run codegen

# Build the WebAssembly mappings
npm run build

# Deploy to hosted service / Goldsky
npm run deploy
```

### Goldsky deployment (recommended)

Kite uses [Goldsky](https://goldsky.com) for subgraph hosting on the Kite AI Testnet:

```bash
# Install Goldsky CLI
npm install -g @goldsky/cli
goldsky login

# Deploy
goldsky subgraph deploy kite-agentic-pay/1.0.0 --path .
```

---

## Querying the Subgraph

The SDK's `indexer.ts` module wraps all common queries. You can also query directly via GraphQL.

### Example: Get all agents for an owner

```graphql
query GetAgentsByOwner($owner: String!) {
  agents(where: { owner: $owner }) {
    agentId
    metadata
    active
    sessions {
      sessionKey
      status
      validUntil
      valueLimit
    }
    aaWallet {
      address
    }
  }
}
```

### Example: Get payment history for an agent

```graphql
query GetPayments($agentId: String!) {
  payments(where: { agent: $agentId }, orderBy: timestamp, orderDirection: desc) {
    id
    type
    amount
    recipient
    token
    txHash
    timestamp
    session {
      sessionKey
    }
    channel {
      channelId
      provider
    }
  }
}
```

### Example: Get channel detail

```graphql
query GetChannel($channelId: String!) {
  channel(id: $channelId) {
    status
    deposit
    settledAmount
    refundAmount
    maxSpend
    maxPerCall
    openedAt
    expiresAt
    provider
    user {
      address
    }
    receipts(orderBy: sequenceNumber, orderDirection: desc, first: 1) {
      sequenceNumber
      cumulativeCost
    }
  }
}
```

---

## Architecture Notes

- **`SessionIndex` entity** exists because dynamic `ClientVault` event handlers receive a `sessionId` (bytes32 hash), not the session key address. This lookup table resolves `sessionId → Session`.
- **Dynamic templates** (`ClientVault`) are created for each new AA wallet address encountered in `AgentWalletSet` events. This allows the subgraph to index per-user vault transfers without knowing wallet addresses at deploy time.
- **`indexed` flag** on `AAWallet` tracks whether the dynamic template has already been started, preventing duplicate template registrations.
- **Session status** (`ACTIVE`, `REVOKED`, `EXPIRED`) — `EXPIRED` is not set by an event; it must be computed by the consumer by comparing `validUntil` against the current timestamp.
