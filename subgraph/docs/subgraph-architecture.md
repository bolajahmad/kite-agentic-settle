# Kite Subgraph - Architecture & Indexing Guide

## Overview

The subgraph has been redesigned to work with the **ClientAgentVault (ERC-4337) architecture** without KiteAAWallet. It now tracks:

1. **Agents** - ERC-721 NFTs registered on IdentityRegistry
2. **Sessions** - Session keys with spending rules, registered on IdentityRegistry
3. **Users** - EOA owners (derived from agent registration)
4. **AAWallets** - Derived AA wallet contracts (one per EOA)
5. **Payments** - PaymentChannel-based transactions
6. **Attestations** - Reputation feedback via AttestationRegistry

---

## Data Flow

### 1. Agent Registration
```
IdentityRegistry.register(agentURI)
  ↓
  Creates: Agent(agentId, owner, metadata)
  Creates: User(owner EOA)
```

### 2. Wallet Assignment
```
IdentityRegistry.AgentWalletSet(agentId, walletContract, user)
  ↓
  Creates: AAWallet(walletContract address, owner=user)
  Links: Agent → AAWallet
```

### 3. Session Creation
```
On-chain:
  1. ClientAgentVault.createSession(sessionId, agent, rules)
     (sessionId = keccak256(encodePacked(sessionKey, agentId, validUntil)))
  
  2. IdentityRegistry.registerSession(agentId, sessionKey, user, walletContract, validUntil)
     ↓
     Creates: Session(sessionKey, agent, user, aaWallet)
     Links: Session → Agent, Session → User, Session → AAWallet
```

### 4. Payment Channel Flow
```
PaymentChannel.ChannelOpened(channelId, consumer, provider, walletContract, ...)
  ↓
  Loads: Session (from consumer address)
  Creates: Channel(sessionKey, agent, user, aaWallet, provider)
  Derives: user and agent from session relationships
  
PaymentChannel.ChannelFinalized(channelId, payment, refund)
  ↓
  Creates: Payment(channel, user, agent, session, token, amount)
  Updates: User(totalSpent, totalRefunded)
```

### 5. Reputation Attestation
```
AttestationRegistry.FeedbackGiven(agentId, giver, value, tag1, tag2)
  ↓
  Creates: Attestation(agent, giver, value, tags)
  Updates: Agent(feedbackCount, reputationScore)
  
AttestationRegistry.ValidationRequested(requestKey, agentId, validator)
  ↓
  Creates: Validation(agent, validator, status=PENDING)
  
AttestationRegistry.ValidationResponded(requestKey, validator, response)
  ↓
  Updates: Validation(response, status=RESPONDED)
  
AttestationRegistry.MerkleRootAnchored(agentId, merkleRoot, ipfsURI, validator)
  ↓
  Creates: MerkleRoot(agent, merkleRoot, ipfsURI, logCount)
```

---

## AA Wallet Indexing Strategy

### Challenge
AA wallet addresses are **derived per EOA** using GokiteAASDK:
```typescript
aaWalletAddress = aaSdk.getAccountAddress(eoaAddress)
```

Each EOA has a unique AA wallet, but the address is not stored on-chain. Instead, it's derived deterministically.

### Solution: Link via IdentityRegistry

**Every time an agent is linked to a wallet:**
```solidity
IdentityRegistry.AgentWalletSet(agentId, walletContract, user)
```

We capture:
- `walletContract` = the AA wallet address
- `user` = the EOA owner
- This event explicitly connects EOA → AA wallet

### Indexing Workflow

1. **Track AAWallet entities from AgentWalletSet events**
   - Event tells us which AA wallet is used for which user
   - Multiple agents can share the same AA wallet (same EOA)
   - Create AAWallet(address, owner=EOA)

2. **Link Sessions to AAWallets**
   - When session is registered, capture the `walletContract` parameter
   - Session knows its AAWallet
   - Payments in channels inherit the AAWallet from session

3. **Derive Activities from AAWallet**
   - For a given EOA, find all AAWallets (via AAWallet.owner)
   - For each AAWallet, find all agents (Agent.aaWallet)
   - For each agent, find all sessions (Session.agent)
   - For each session, find all channels and payments

### Example Query: All Activity for an EOA

```graphql
query GetUserActivity($eoaAddress: String!) {
  users(where: { address: $eoaAddress }) {
    address
    aaWallets {
      address
      agents {
        id
        agentId
        metadata
        sessions {
          id
          validUntil
          status
          channels {
            id
            mode
            deposit
            status
            payments {
              amount
              timestamp
              token
            }
          }
        }
      }
    }
  }
}
```

---

## Schema Changes

### New Entities

#### AAWallet
```graphql
type AAWallet {
  id: ID!              # Wallet address (hex)
  address: Bytes!
  owner: User!         # EOA that deployed this wallet
  agents: [Agent!]     # Agents using this wallet
  sessions: [Session!] # Sessions on this wallet
  createdAt: BigInt!
}
```

#### Attestation
```graphql
type Attestation {
  id: ID!              # agentId-giver-feedbackIndex
  agent: Agent!
  giver: Bytes!        # Who gave feedback
  value: BigInt!       # Reputation value
  valueDecimals: Int!
  tag1: String
  tag2: String
  status: String       # "ACTIVE" | "REVOKED"
  timestamp: BigInt!
}
```

#### Validation
```graphql
type Validation {
  id: ID!              # requestKey (hex)
  agent: Agent!
  validator: Bytes!
  response: Int        # 0=No, 1=Yes, 2=Abstain
  responseTag: String
  status: String       # "PENDING" | "RESPONDED"
}
```

#### MerkleRoot
```graphql
type MerkleRoot {
  id: ID!              # agentId-merkleRoot (hex)
  agent: Agent!
  merkleRoot: Bytes!
  logCount: BigInt!
  ipfsURI: String      # Link to off-chain data
  validator: Bytes!
  anchoredAt: BigInt!
}
```

### Updated Entities

#### Agent
- Removed: `wallet` (Bytes)
- Added: `aaWallet` (AAWallet)
- Added: `attestations` (derived from Attestation.agent)
- Added: `reputationScore` (BigInt, aggregate)
- Added: `feedbackCount` (BigInt)

#### Session
- Removed: `metadataHash` (not used)
- Added: `aaWallet` (AAWallet)
- Added: `blockedAgents` (BigInt[] instead of Bytes[])
- Changed: `valueLimit/maxLimit` tracked from vault events (not IdentityRegistry)

#### User
- Removed: `wallet` (single address)
- Added: `aaWallets` (multiple wallets per EOA possible)
- Removed: `blockedProviders`
- Removed: `totalDeposited, totalWithdrawn, lockedInChannels`
- Added: `totalChannelsOpened, totalSpent, totalRefunded`

#### Channel
- Removed: `walletContract` (Bytes)
- Added: `aaWallet` (AAWallet reference)
- Added: `payments` (derived from Payment.channel)

---

## Event Handlers

### identity-registry.ts
- `handleAgentRegistered` - Create Agent + User
- `handleAgentWalletSet` - Create/link AAWallet
- `handleSessionRegistered` - Create Session + link to AAWallet
- `handleSessionRevoked` - Mark session REVOKED
- `handleURIUpdated` - Update agent metadata

### payment-channel.ts
- `handleChannelOpened` - Create Channel, derive user/agent from session
- `handleChannelActivated` - Update channel status
- `handleSettlementInitiated` - Mark settlement pending
- `handleReceiptSubmitted` - Create Receipt, track cumulative cost
- `handleChannelFinalized` - Close channel, create Payment, update user stats

### attestation-registry.ts (NEW)
- `handleFeedbackGiven` - Create Attestation, update Agent feedback count
- `handleFeedbackRevoked` - Mark attestation REVOKED
- `handleResponseAppended` - Mark response on attestation
- `handleValidationRequested` - Create Validation (PENDING)
- `handleValidationResponded` - Update Validation (RESPONDED)
- `handleMerkleRootAnchored` - Create MerkleRoot for agent performance

---

## Deployment Steps

1. **Deploy Subgraph**
   ```bash
   cd subgraph
   npm run codegen    # Generate TS types from ABIs
   npm run build      # Compile
   npm run deploy     # Deploy to hosted service
   ```

2. **Verify ABIs**
   - Ensure `abis/IdentityRegistryABI.json` is up-to-date
   - Ensure `abis/PaymentChannelABI.json` is up-to-date
   - Ensure `abis/AttestationRegistry.json` exists

3. **Update Contract Addresses**
   - Replace `0x986A171fd6CE1Dc89d104E2b2a424Df9d4ef7524` with actual IdentityRegistry
   - Replace `0xa00dDA4C326e045aF948cc1dD45A464c09db3Af8` with actual PaymentChannel
   - Replace `0x95b4e0e5A4F7d10F77f5FB4C1E9Ea3a5e0e5C5C1` with actual AttestationRegistry

---

## Querying Examples

### Get all agents by a user
```graphql
query {
  users(where: { address: "0x..." }) {
    agents {
      id
      agentId
      metadata
      feedbackCount
      reputationScore
    }
  }
}
```

### Get agent reputation
```graphql
query {
  agents(where: { id: "15" }) {
    id
    feedbackCount
    reputationScore
    attestations(where: { status: "ACTIVE" }) {
      giver
      value
      valueDecimals
      tag1
      tag2
    }
  }
}
```

### Get user payment history
```graphql
query {
  users(where: { address: "0x..." }) {
    aaWallets {
      address
      agents {
        sessions {
          channels {
            payments {
              amount
              recipient
              token
              timestamp
            }
          }
        }
      }
    }
  }
}
```

---

## Notes

- **AAWallet Derivation**: The subgraph does NOT derive AA wallet addresses; it reads them from IdentityRegistry.AgentWalletSet events.
- **Session Data**: Spending limits (valueLimit/maxLimit) should be indexed from ClientAgentVault.createSession events (future enhancement).
- **Reputation Calculation**: The `reputationScore` is a simple sum of feedback values; more sophisticated aggregation (e.g., weighted average, time decay) can be added.
- **Merkle Proofs**: MerkleRoot entities link on-chain anchors to off-chain data via IPFS URIs for performance verification.
