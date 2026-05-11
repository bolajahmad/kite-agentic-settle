# Subgraph Refactoring Summary

## Overview
Redesigned the Kite subgraph to work without KiteAAWallet and properly index the ClientAgentVault (ERC-4337) architecture with full AttestationRegistry support.

---

## Files Changed

### 1. `/subgraph/schema.graphql`
**Major restructuring:**

- **Removed entities**: No KiteAAWallet-specific types
- **New entities**:
  - `AAWallet` - Tracks derived AA wallets per EOA (owner field)
  - `Attestation` - Reputation feedback (agent, giver, value, tags, status)
  - `Validation` - Third-party validation requests/responses
  - `MerkleRoot` - Off-chain performance proofs anchored on-chain

- **Updated entities**:
  - `Agent`: Now links to `AAWallet` instead of storing wallet address
  - `Session`: Now has `aaWallet` field, properly typed `blockedAgents: [BigInt!]`
  - `User`: Removed `wallet` field (replaced with `aaWallets` derivation), added stats (`totalChannelsOpened`, `totalSpent`, `totalRefunded`)
  - `Channel`: Changed `walletContract: Bytes` → `aaWallet: AAWallet!`, added `payments` derivation
  - `Payment`: Now properly links to `session`, added to `channel.payments` derivation

### 2. `/subgraph/src/identity-registry.ts`
**Complete rewrite with new logic:**

- `handleAgentRegistered()`: Creates Agent + ensures User exists
- `handleAgentWalletSet()`: Creates/updates `AAWallet` entity, links Agent to wallet
- `handleSessionRegistered()`: Creates Session with `aaWallet` reference, ensures User exists
- `handleSessionRevoked()`: Marks session REVOKED, handles edge case where session not yet indexed
- All handlers properly create entity relationships for IdentityRegistry → AAWallet → Agent → Session chain

### 3. `/subgraph/src/payment-channel.ts`
**Redesigned without KiteAAWallet dependency:**

- `handleChannelOpened()`: Derives user/agent from session, creates AAWallet if needed, links properly
- `handleChannelActivated()`: Status update only
- `handleSettlementInitiated()`: Tracks settlement pending status
- `handleReceiptSubmitted()`: Creates Receipt, updates channel's highest claimed cost
- `handleChannelFinalized()`: Creates Payment entity, updates User stats (totalSpent, totalRefunded)
- **Key change**: No longer reads from KiteAAWallet; all data derived from Session relationships

### 4. `/subgraph/src/attestation-registry.ts` (NEW FILE)
**Complete implementation of reputation tracking:**

- `handleFeedbackGiven()`: Creates Attestation, updates Agent.feedbackCount + reputationScore
- `handleFeedbackRevoked()`: Marks attestation REVOKED, decrements Agent.feedbackCount
- `handleResponseAppended()`: Handles agent responses to feedback
- `handleValidationRequested()`: Creates Validation (PENDING status)
- `handleValidationResponded()`: Updates Validation with response (YES/NO/ABSTAIN) and tag
- `handleMerkleRootAnchored()`: Creates MerkleRoot linking on-chain proof to IPFS URI

### 5. `/subgraph/subgraph.yaml`
**Updated datasources and event signatures:**

- **IdentityRegistry**:
  - Fixed event signature: `SessionRegistered(indexed uint256,indexed address,indexed address,address,uint256,uint256[])`
  - Updated entities list to match new schema
  
- **PaymentChannel**:
  - Added `ReceiptSubmitted` event handler (was missing)
  - Updated entities list to include User, AAWallet
  - Removed obsolete `PaymentExecuted` from KiteAAWallet
  
- **AttestationRegistry** (NEW):
  - Address: `0x95b4e0e5A4F7d10F77f5FB4C1E9Ea3a5e0e5C5C1` (update when deployed)
  - All 6 event handlers: FeedbackGiven, FeedbackRevoked, ResponseAppended, ValidationRequested, ValidationResponded, MerkleRootAnchored

### 6. `/subgraph/docs/subgraph-architecture.md` (NEW)
**Comprehensive documentation:**

- Data flow diagrams
- AA wallet indexing strategy
- Schema changes explained
- Query examples
- Deployment steps
- Notes on implementation

---

## Key Architecture Changes

### Before (KiteAAWallet-based)
```
User.wallet (single address)
  ↓
KiteAAWallet (indexed directly)
  ↓
Payments (tracked in KiteAAWallet events)
```

### After (IdentityRegistry + AAWallet)
```
User (EOA)
  ↓
IdentityRegistry.AgentWalletSet event captures:
  - walletContract (AA wallet address)
  - user (EOA owner)
  ↓
AAWallet entity (created from event)
  ↓
Agent (linked to AAWallet)
  ↓
Session (linked to AAWallet)
  ↓
Channel (linked via Session)
  ↓
Payment (derived from Channel settlement)
```

---

## AA Wallet Indexing Strategy

**Challenge**: AA wallet addresses are derived per EOA, not stored on-chain directly.

**Solution**: Index from `IdentityRegistry.AgentWalletSet` events
- Event explicitly pairs `(agentId, walletContract, user)`
- We create `AAWallet(address=walletContract, owner=user)`
- No derivation needed; event provides the mapping

**Querying**:
```graphql
# Get all activity for an EOA
users(where: { address: "0x..." }) {
  aaWallets { address agents { sessions { channels { payments } } } }
}
```

---

## Event Handler Logic Flow

### Session Creation → Registration → Payment
```
1. IdentityRegistry.Registered(agentId, owner, uri)
   → Creates Agent(agentId, owner)

2. IdentityRegistry.AgentWalletSet(agentId, wallet, user)
   → Creates AAWallet(wallet, user)
   → Links Agent → AAWallet

3. IdentityRegistry.SessionRegistered(agentId, sessionKey, user, wallet, validUntil)
   → Creates Session(sessionKey, agent, user, aaWallet)

4. PaymentChannel.ChannelOpened(channelId, consumer/sessionKey, provider, wallet)
   → Loads Session (from consumer/sessionKey)
   → Creates Channel(session, user, agent, aaWallet)

5. PaymentChannel.ChannelFinalized(channelId, payment, refund)
   → Creates Payment(channel, user, agent, session, amount)
   → Updates User(totalSpent, totalRefunded)
```

### Reputation Tracking
```
1. AttestationRegistry.FeedbackGiven(agentId, giver, value, tags)
   → Creates Attestation(agent, giver, value, tags)
   → Updates Agent.feedbackCount++, reputationScore += value

2. AttestationRegistry.ValidationRequested(requestKey, agentId, validator)
   → Creates Validation(agent, validator, PENDING)

3. AttestationRegistry.ValidationResponded(requestKey, validator, response)
   → Updates Validation(response, RESPONDED)

4. AttestationRegistry.MerkleRootAnchored(agentId, merkleRoot, ipfsURI)
   → Creates MerkleRoot(agent, merkleRoot, ipfsURI)
```

---

## Migration Checklist

- [x] Schema redesigned (removed KiteAAWallet, added AAWallet/Attestation/Validation/MerkleRoot)
- [x] IdentityRegistry handlers updated (proper AAWallet linking)
- [x] PaymentChannel handlers updated (no KiteAAWallet dependency)
- [x] AttestationRegistry handlers implemented (new file)
- [x] subgraph.yaml updated (correct event signatures, new datasource)
- [x] Documentation created (architecture, queries, deployment)
- [ ] Update contract addresses in subgraph.yaml for production
- [ ] Verify ABIs are up-to-date
- [ ] Deploy and test on staging

---

## Testing Queries

### Verify User → AAWallet chain
```graphql
{
  users(first: 1) {
    id
    address
    aaWallets {
      id
      address
      agents {
        id
        agentId
      }
    }
  }
}
```

### Verify Agent → Session → Payment chain
```graphql
{
  agents(first: 1) {
    id
    feedbackCount
    sessions {
      id
      status
      channels {
        id
        payments {
          amount
          timestamp
        }
      }
    }
  }
}
```

### Verify Reputation tracking
```graphql
{
  agents(first: 1) {
    reputationScore
    feedbackCount
    attestations(where: { status: "ACTIVE" }) {
      giver
      value
      tag1
      tag2
    }
  }
}
```

---

## Next Steps

1. **Update contract addresses** in `subgraph.yaml` with actual deployed addresses
2. **Generate TypeScript types**: `npm run codegen`
3. **Build**: `npm run build`
4. **Deploy**: `npm run deploy`
5. **Monitor indexing** on TheGraph dashboard
6. **Test queries** against staging endpoint

