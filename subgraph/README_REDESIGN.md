# Subgraph Redesign - Complete Summary

## What Was Done

The Kite subgraph has been completely redesigned to work with the **ClientAgentVault (ERC-4337) architecture** without KiteAAWallet, properly tracking payments and executions through IdentityRegistry and PaymentChannel events, and adding full AttestationRegistry (reputation) support.

---

## Problem Solved

### Original Issue
- **KiteAAWallet** was removed from the loop
- Without it, there was no direct way to track payments and user activities
- AA wallet addresses are derived per EOA and not stored on-chain

### Solution Implemented
- Track everything via **IdentityRegistry events**, which explicitly capture:
  - Agent ownership (Registered event)
  - AA wallet assignment (AgentWalletSet event)
  - Session registration (SessionRegistered event)
- Link all payments through **SessionKey** → **Session** → **Agent** → **User** relationships
- Index **AttestationRegistry** for reputation tracking

---

## Files Modified/Created

### Modified Files
1. **`subgraph/schema.graphql`** (Major restructure)
   - Removed KiteAAWallet-specific fields
   - Added AAWallet, Attestation, Validation, MerkleRoot entities
   - Updated all relationships for new architecture

2. **`subgraph/src/identity-registry.ts`** (Complete rewrite)
   - Properly creates AAWallet from AgentWalletSet events
   - Tracks user creation from agent registration
   - Links sessions to their AA wallets

3. **`subgraph/src/payment-channel.ts`** (Redesigned)
   - Derives user/agent from session relationships
   - No KiteAAWallet dependency
   - Properly tracks channel payments

4. **`subgraph/subgraph.yaml`** (Updated)
   - Fixed SessionRegistered event signature
   - Added AttestationRegistry datasource
   - Updated all entity lists

### Created Files
1. **`subgraph/src/attestation-registry.ts`** (NEW)
   - Complete reputation indexing
   - Feedback, validation, and merkle root tracking

2. **`subgraph/docs/subgraph-architecture.md`** (NEW)
   - Comprehensive architecture guide
   - Data flow diagrams
   - Query examples

3. **`subgraph/REFACTORING_SUMMARY.md`** (NEW)
   - Detailed change log
   - Before/after comparison
   - Handler logic flow

4. **`subgraph/DEPLOYMENT_CHECKLIST.md`** (NEW)
   - Pre-deployment verification steps
   - Testing queries
   - Troubleshooting guide

5. **`subgraph/ARCHITECTURE_DIAGRAMS.md`** (NEW)
   - Visual entity relationships
   - Event flow diagrams
   - Complete lifecycle examples

---

## Key Architecture Changes

### AA Wallet Tracking
**Strategy: Event-based, not derived**

Instead of:
```typescript
aaWallet = sdk.getAccountAddress(eoa)  // Requires SDK derivation
```

Use:
```solidity
IdentityRegistry.AgentWalletSet(agentId, walletContract, user)
// Event tells us: walletContract is the AA wallet for user
```

Subgraph creates: `AAWallet(address=walletContract, owner=user)`

### Data Relationships
```
User (EOA)
  ↓ (from agent registration)
Agent (ERC-721)
  ↓ (from AgentWalletSet event)
AAWallet (ERC-4337 account)
  ↓ (from registerSession event)
Session (spending rules)
  ↓ (from ChannelOpened event)
Channel (payment stream)
  ↓ (from ChannelFinalized event)
Payment (settled transaction)
```

### User Tracking Without KiteAAWallet
**Before**: KiteAAWallet tracked user balances and payments directly

**After**: 
1. User created from `Registered(owner)` event
2. User linked to AAWallet via `AgentWalletSet(walletContract, user)`
3. User linked to Payments via Session → Channel → Payment chain
4. User stats (totalSpent, totalRefunded) updated from Channel settlements

---

## New Features Added

### 1. Reputation Tracking (AttestationRegistry)
- **Attestations**: Feedback ratings with tags (e.g., "responsive", "fast")
- **Validations**: Third-party validation requests/responses
- **MerkleRoots**: Anchored performance proofs linked to IPFS

### 2. Agent Reputation Aggregation
- `Agent.feedbackCount`: Total feedback entries
- `Agent.reputationScore`: Sum of feedback values (can be made more sophisticated)

### 3. User Activity Statistics
- `User.totalChannelsOpened`: Number of payment channels
- `User.totalSpent`: Sum of all payments
- `User.totalRefunded`: Total refunds received

### 4. Enhanced Session Tracking
- Sessions now properly link to AAWallet
- Blocked agents properly tracked as BigInt[]
- Session status tracked (ACTIVE, REVOKED, EXPIRED)

---

## Event Handler Logic

### IdentityRegistry
```
Registered(agentId, owner, uri)
  → Create Agent(agentId, owner, metadata)
  → Ensure User(owner) exists

AgentWalletSet(agentId, walletContract, user)
  → Create AAWallet(walletContract, owner=user)
  → Link Agent(agentId).aaWallet = walletContract

SessionRegistered(agentId, sessionKey, user, walletContract, validUntil, blockedAgents)
  → Create Session(sessionKey, agent, user, aaWallet, validUntil, blockedAgents)
  → Ensure User(user) exists
  → Ensure AAWallet(walletContract) exists
```

### PaymentChannel
```
ChannelOpened(channelId, consumer/sessionKey, provider, walletContract, ...)
  → Load Session(consumer)
  → Create Channel(channelId, session, agent, user, aaWallet, provider)
  → Increment User.totalChannelsOpened

ChannelFinalized(channelId, payment, refund)
  → Load Channel(channelId)
  → Create Payment(channel, user, agent, session, amount=payment)
  → Update User.totalSpent += payment
  → Update User.totalRefunded += refund
```

### AttestationRegistry
```
FeedbackGiven(agentId, giver, value, tag1, tag2)
  → Create Attestation(agent, giver, value, tag1, tag2)
  → Update Agent.feedbackCount++
  → Update Agent.reputationScore += value

ValidationRequested(requestKey, agentId, validator)
  → Create Validation(agent, validator, PENDING)

ValidationResponded(requestKey, validator, response)
  → Update Validation(response, RESPONDED)

MerkleRootAnchored(agentId, merkleRoot, ipfsURI)
  → Create MerkleRoot(agent, merkleRoot, ipfsURI)
```

---

## GraphQL Query Examples

### Get User Activity
```graphql
{
  users(where: { address: "0x..." }) {
    totalChannelsOpened
    totalSpent
    totalRefunded
    aaWallets {
      address
      agents {
        agentId
        feedbackCount
        reputationScore
        sessions {
          channels {
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

### Get Agent Reputation
```graphql
{
  agents(where: { id: "15" }) {
    feedbackCount
    reputationScore
    attestations {
      giver
      value
      tag1
      tag2
    }
    attestations(where: { status: "ACTIVE" }) {
      # Only active (non-revoked) feedback
    }
  }
}
```

### Track Payment History
```graphql
{
  payments(orderBy: timestamp, orderDirection: desc) {
    id
    amount
    token
    timestamp
    user { address }
    agent { agentId }
    channel { provider }
  }
}
```

---

## Deployment Steps

1. **Update contract addresses** in `subgraph/subgraph.yaml`
   - IdentityRegistry: `0x986A171...`
   - PaymentChannel: `0xa00dDA4...`
   - AttestationRegistry: `0x95b4e0...` (actual address needed)

2. **Verify ABIs** in `subgraph/abis/`
   - IdentityRegistryABI.json ✓
   - PaymentChannelABI.json ✓
   - AttestationRegistry.json ✓

3. **Build & deploy**
   ```bash
   cd subgraph
   npm install
   npm run codegen   # Generate types
   npm run build     # Compile
   npm run deploy    # Deploy to Graph
   ```

4. **Monitor indexing**
   - Check Dashboard for sync progress
   - Run test queries from DEPLOYMENT_CHECKLIST.md

---

## Benefits of New Architecture

✅ **No SDK Derivation Needed**
- AA wallet addresses captured from events, not derived

✅ **Complete Payment Tracking**
- All payments linked through session relationships
- No KiteAAWallet dependency

✅ **User Activity Auditable**
- All user activity queryable through AAWallet → Agent → Session chain
- Stats tracked (totalSpent, totalRefunded)

✅ **Reputation System**
- Feedback, validation, and merkle proofs indexed
- Agent reputation aggregated from attestations

✅ **Multi-Chain Ready**
- Each EOA can have multiple AAWallets across chains
- Subgraph structure supports multi-chain expansion

✅ **Flexible Querying**
- Complex relationship queries possible
- Can trace activity from EOA through entire payment pipeline

---

## Documentation Provided

1. **`subgraph-architecture.md`** - Technical deep dive
2. **`REFACTORING_SUMMARY.md`** - Change log and before/after
3. **`DEPLOYMENT_CHECKLIST.md`** - Step-by-step deployment & testing
4. **`ARCHITECTURE_DIAGRAMS.md`** - Visual relationships and flows

---

## Next Steps

1. ✅ Schema updated
2. ✅ Event handlers implemented
3. ✅ Documentation created
4. ⏳ **Update contract addresses** (user action)
5. ⏳ **Verify ABIs** (user action)
6. ⏳ **Deploy to Graph** (user action)
7. ⏳ **Test queries** (user action)
8. ⏳ **Monitor indexing** (ongoing)

---

## Questions?

Refer to:
- **Architecture questions** → `subgraph-architecture.md`
- **Implementation details** → `REFACTORING_SUMMARY.md`
- **Deployment issues** → `DEPLOYMENT_CHECKLIST.md`
- **Visual understanding** → `ARCHITECTURE_DIAGRAMS.md`

