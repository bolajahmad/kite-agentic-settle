# Subgraph Redesign - Quick Reference

## What Changed

| Aspect | Before | After |
|--------|--------|-------|
| **Payment Tracking** | KiteAAWallet events | IdentityRegistry → Session → Channel |
| **User Tracking** | Wallet contract tracking | EOA tracking via agent owner |
| **AA Wallet Link** | Direct KiteAAWallet | AgentWalletSet event (not derived) |
| **Reputation** | Not tracked | Full AttestationRegistry integration |
| **Sessions** | Basic tracking | Full relationship to agents & wallets |

---

## Architecture at a Glance

```
EOA Owner
  ↓
Agent (ERC-721 on IdentityRegistry)
  ↓
AAWallet (from AgentWalletSet event)
  ↓
Session (from SessionRegistered event)
  ↓
Channel (from ChannelOpened event)
  ↓
Payment (from ChannelFinalized event)
  ↓
Reputation (from AttestationRegistry events)
```

---

## File Changes

### Core Files Modified
```
schema.graphql                    (Restructured)
src/identity-registry.ts          (Rewritten)
src/payment-channel.ts            (Redesigned)
subgraph.yaml                     (Updated)
```

### New Files
```
src/attestation-registry.ts       (NEW)
docs/subgraph-architecture.md     (NEW)
REFACTORING_SUMMARY.md            (NEW)
DEPLOYMENT_CHECKLIST.md           (NEW)
ARCHITECTURE_DIAGRAMS.md          (NEW)
README_REDESIGN.md                (NEW)
STATUS_REPORT.md                  (NEW)
```

---

## Quick Deployment

```bash
cd subgraph

# 1. Update contract addresses in subgraph.yaml
# IdentityRegistry, PaymentChannel, AttestationRegistry

# 2. Build & deploy
npm install
npm run codegen
npm run build
npm run deploy

# 3. Test
# Run queries from DEPLOYMENT_CHECKLIST.md
```

---

## Key Entities

### AAWallet (NEW)
```graphql
type AAWallet {
  id: ID!              # Wallet address
  address: Bytes!
  owner: User!         # EOA
  agents: [Agent!]     # Linked agents
  sessions: [Session!] # Active sessions
}
```

### Agent (Updated)
```graphql
type Agent {
  id: ID!
  agentId: BigInt!
  metadata: String
  owner: User!
  aaWallet: AAWallet   # ← NEW: Links to AA wallet
  feedbackCount: BigInt! # ← NEW: Reputation count
  reputationScore: BigInt # ← NEW: Aggregated score
  attestations: [Attestation!] # ← NEW: Feedback array
}
```

### Session (Updated)
```graphql
type Session {
  sessionKey: Bytes!
  user: User!
  agent: Agent!
  aaWallet: AAWallet!  # ← NEW: Links to AA wallet
  validUntil: BigInt!
  blockedAgents: [BigInt!] # ← UPDATED: Proper type
  status: String!
}
```

### Attestation (NEW)
```graphql
type Attestation {
  id: ID!
  agent: Agent!
  giver: Bytes!
  value: BigInt!
  valueDecimals: Int!
  tag1: String
  tag2: String
  status: String  # "ACTIVE" or "REVOKED"
}
```

### Validation (NEW)
```graphql
type Validation {
  id: ID!
  agent: Agent!
  validator: Bytes!
  response: Int  # 0=No, 1=Yes, 2=Abstain
  status: String # "PENDING" or "RESPONDED"
}
```

---

## Event Handlers

### IdentityRegistry
```
handleAgentRegistered(event)    → Create Agent + User
handleAgentWalletSet(event)     → Create AAWallet + link
handleSessionRegistered(event)  → Create Session
handleSessionRevoked(event)     → Mark revoked
handleURIUpdated(event)         → Update metadata
```

### PaymentChannel
```
handleChannelOpened(event)      → Create Channel
handleChannelActivated(event)   → Update status
handleSettlementInitiated(event) → Track settlement
handleReceiptSubmitted(event)   → Track receipts
handleChannelFinalized(event)   → Create Payment + update stats
```

### AttestationRegistry (NEW)
```
handleFeedbackGiven(event)      → Create Attestation
handleFeedbackRevoked(event)    → Mark revoked
handleResponseAppended(event)   → Track responses
handleValidationRequested(event) → Create Validation
handleValidationResponded(event) → Update response
handleMerkleRootAnchored(event) → Create MerkleRoot
```

---

## Query Templates

### Get User Activity
```graphql
{
  users(where: { address: "0x..." }) {
    totalSpent
    totalRefunded
    aaWallets { agents { sessions { channels { payments { amount } } } } }
  }
}
```

### Get Agent Reputation
```graphql
{
  agents(where: { id: "15" }) {
    feedbackCount
    reputationScore
    attestations { giver value tag1 }
  }
}
```

### Get Payment History
```graphql
{
  payments(first: 100, orderBy: timestamp, orderDirection: desc) {
    amount token timestamp user { address } agent { agentId }
  }
}
```

---

## AA Wallet Indexing (Key Innovation)

### Problem
```
AA wallet addresses derived per EOA
Not stored on-chain
Can't query from events directly
```

### Solution
```
IdentityRegistry.AgentWalletSet event emits:
  (agentId, walletContract, user)
  
Subgraph captures: AAWallet(address=walletContract, owner=user)

Result: All relationships queryable without derivation
```

---

## Common Issues & Fixes

| Issue | Fix |
|-------|-----|
| Event not found | Check YAML event signature matches contract |
| Type mismatch | Run `npm run codegen` to regenerate types |
| Query returns null | Verify entity exists & relationships linked |
| Slow indexing | Check contract address & startBlock |
| No data | Ensure events emitted after startBlock |

---

## Documentation Map

```
subgraph/
├── schema.graphql                    ← Entity definitions
├── src/
│   ├── identity-registry.ts         ← Agent & session indexing
│   ├── payment-channel.ts           ← Payment tracking
│   └── attestation-registry.ts      ← Reputation indexing
├── subgraph.yaml                    ← Datasource config
└── docs/
    ├── README_REDESIGN.md           ← Start here
    ├── subgraph-architecture.md     ← Deep dive
    ├── ARCHITECTURE_DIAGRAMS.md     ← Visual guide
    ├── DEPLOYMENT_CHECKLIST.md      ← How to deploy
    ├── REFACTORING_SUMMARY.md       ← What changed
    ├── STATUS_REPORT.md             ← Current status
    └── DEPLOYMENT_CHECKLIST.md      ← Testing guide
```

**Start with**: `README_REDESIGN.md`  
**For deployment**: `DEPLOYMENT_CHECKLIST.md`  
**For understanding**: `subgraph-architecture.md`

---

## Success Criteria

✅ All test queries return data  
✅ User → AAWallet → Agent chain resolves  
✅ Session links to correct AAWallet  
✅ Payments derive user from session  
✅ Reputation aggregates from attestations  
✅ No indexing errors  
✅ Query response < 100ms  

---

## Contract Addresses to Update

```yaml
# subgraph/subgraph.yaml

IdentityRegistry:
  address: "0x986A171fd6CE1Dc89d104E2b2a424Df9d4ef7524"  # Verify

PaymentChannel:
  address: "0xa00dDA4C326e045aF948cc1dD45A464c09db3Af8"   # Verify

AttestationRegistry:
  address: "0x95b4e0e5A4F7d10F77f5FB4C1E9Ea3a5e0e5C5C1"  # ← UPDATE THIS
```

---

## Timeline

- ✅ **Complete** - Schema & handlers
- ✅ **Complete** - Documentation
- ⏳ **Next** - Verify contract addresses
- ⏳ **Next** - Deploy & test
- ⏳ **Next** - Monitor production

---

## Support

- Questions? → See `subgraph-architecture.md`
- How to deploy? → See `DEPLOYMENT_CHECKLIST.md`
- What's different? → See `REFACTORING_SUMMARY.md`
- Visual learner? → See `ARCHITECTURE_DIAGRAMS.md`

**All documentation in**: `/subgraph/` folder

