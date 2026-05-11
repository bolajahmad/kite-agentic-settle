# Subgraph Architecture Diagrams

## 1. Entity Relationship Diagram (Updated)

```
┌─────────────┐
│    User     │ (EOA)
│   (0x...)   │
└──────┬──────┘
       │
       │ owner
       ▼
┌─────────────────┐
│   AAWallet      │
│ (ERC-4337 Acct) │
└────────┬────────┘
         │
         │
    ┌────┴────────┬──────────────────┐
    │             │                  │
    │ agents      │ sessions         │
    ▼             ▼                  ▼
┌────────────┐  ┌──────────┐   ┌──────────┐
│   Agent    │  │ Session  │   │  Session │
│ (ERC-721)  │  │  Key 1   │   │  Key 2   │
└────────┬───┘  └─────┬────┘   └─────┬────┘
         │            │              │
         │ sessions   │ channels      │ channels
         ▼            ▼              ▼
      ┌─────────────────────────┐
      │   Channel (or direct)   │
      │  (PaymentChannel)       │
      └────────────┬────────────┘
                   │
                   │ settlements
                   ▼
              ┌─────────┐
              │ Payment │
              └─────────┘
```

---

## 2. Event Flow Diagram

### Agent Registration Flow

```
IdentityRegistry.register(agentURI)
         │
         ▼ 
    ┌─────────────────────────┐
    │ handleAgentRegistered   │
    └──────────┬──────────────┘
               │
         ┌─────┴──────┐
         ▼            ▼
      Agent(id)    User(owner)
      
IdentityRegistry.AgentWalletSet(agentId, walletContract, user)
         │
         ▼
    ┌──────────────────────────┐
    │ handleAgentWalletSet    │
    └────────────┬─────────────┘
                 │
            ┌────┴────┐
            ▼         ▼
         AAWallet   Link Agent→AAWallet
```

### Session Registration Flow

```
ClientAgentVault.createSession(sessionId, agent, rules)
         │ (on-chain state)
         │
IdentityRegistry.registerSession(agentId, sessionKey, user, 
                                  walletContract, validUntil, blockedAgents)
         │
         ▼
    ┌─────────────────────────────┐
    │ handleSessionRegistered     │
    └──────────┬──────────────────┘
               │
        ┌──────┴───────────┬──────────────┐
        ▼                  ▼              ▼
     Session         Ensure User   Ensure AAWallet
     (sessionKey)    (if missing)   (if missing)
```

### Payment Channel & Settlement Flow

```
PaymentChannel.ChannelOpened(channelId, consumer/sessionKey, ...)
         │
         ▼
    ┌──────────────────────┐
    │ handleChannelOpened  │
    └─────────┬────────────┘
              │
        ┌─────┴─────────┐
        ▼               ▼
    Load Session   Create Channel
    (from consumer) (with user/agent
                     from session)

PaymentChannel.ChannelFinalized(channelId, payment, refund)
         │
         ▼
    ┌─────────────────────────┐
    │ handleChannelFinalized  │
    └──────────┬──────────────┘
               │
        ┌──────┴──────┐
        ▼             ▼
    Create Payment   Update User Stats
    (track cost)    (totalSpent++)
```

### Reputation Flow

```
AttestationRegistry.FeedbackGiven(agentId, giver, value, tags)
         │
         ▼
    ┌──────────────────────┐
    │ handleFeedbackGiven  │
    └────────┬─────────────┘
             │
        ┌────┴───────┐
        ▼            ▼
   Attestation   Update Agent
   (giver→value) (feedbackCount++)
                 (reputationScore += value)

AttestationRegistry.ValidationRequested(requestKey, agentId, validator)
         │
         ▼
    ┌──────────────────────────┐
    │ handleValidationRequested│
    └─────────┬────────────────┘
              │
              ▼
         Validation(PENDING)

AttestationRegistry.ValidationResponded(requestKey, validator, response)
         │
         ▼
    ┌──────────────────────────┐
    │ handleValidationResponded│
    └────────┬─────────────────┘
             │
             ▼
        Validation(RESPONDED)
        (response stored)
```

---

## 3. Data Derivation Chain

### From EOA to Payments

```
┌─ User (EOA) ─────────────────────────────────────┐
│                                                   │
│  ┌─ AAWallet #1 ────────────────────────────┐  │
│  │                                            │  │
│  │  ┌─ Agent #1 ──────────────────────────┐ │  │
│  │  │                                      │ │  │
│  │  │  ┌─ Session #1A ─────────────────┐  │ │  │
│  │  │  │                                │  │ │  │
│  │  │  │  ┌─ Channel #1A1 ──────────┐  │  │ │  │
│  │  │  │  │                          │  │  │ │  │
│  │  │  │  │  ┌─ Payment (settled) ─┐│  │  │ │  │
│  │  │  │  │  │ amount: 100 USDT     ││  │  │ │  │
│  │  │  │  │  └──────────────────────┘│  │  │ │  │
│  │  │  │  └──────────────────────────┘  │  │ │  │
│  │  │  │                                │  │ │  │
│  │  │  │  ┌─ Channel #1A2 ──────────┐  │  │ │  │
│  │  │  │  │ (more channels)         │  │  │ │  │
│  │  │  │  └──────────────────────────┘  │  │ │  │
│  │  │  └────────────────────────────────┘  │  │ │  │
│  │  │                                      │  │ │  │
│  │  │  ┌─ Session #1B ─────────────────┐  │  │ │  │
│  │  │  │ (more sessions)               │  │  │ │  │
│  │  │  └────────────────────────────────┘  │  │ │  │
│  │  └──────────────────────────────────────┘  │  │
│  │                                             │  │
│  │  ┌─ Agent #2 ──────────────────────────┐  │  │
│  │  │ (more agents)                       │  │  │
│  │  └──────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
│  ┌─ AAWallet #2 ────────────────────────────┐  │
│  │ (more wallets, if multi-chain)          │  │
│  └─────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────┘
```

---

## 4. Data Flow During Channel Lifecycle

```
Timeline: User → Agent → Session → Channel → Payment

T0: Agent Registration
    User registers agent
    ↓
    Agent created (owner=User)
    
T1: Wallet Assignment
    IdentityRegistry.AgentWalletSet
    ↓
    AAWallet created (owner=User)
    Agent linked to AAWallet
    
T2: Session Creation
    On vault: ClientAgentVault.createSession()
    On registry: IdentityRegistry.registerSession()
    ↓
    Session created (agent, user, aaWallet, validUntil)
    
T3: Channel Open
    PaymentChannel.ChannelOpened()
    ↓
    Channel created (session, agent, user, aaWallet, provider)
    Channel status = OPEN
    
T4: Channel Active
    PaymentChannel.ChannelActivated()
    ↓
    Channel status = ACTIVE
    User can now use session to make payments
    
T5: Settlement Initiated
    PaymentChannel.SettlementInitiated()
    ↓
    Channel status = SETTLEMENT_PENDING
    Receipts track cumulative cost
    
T6: Channel Finalized
    PaymentChannel.ChannelFinalized(payment, refund)
    ↓
    Channel status = CLOSED
    Payment created (derives user, agent, session from channel)
    User stats updated (totalSpent += payment, totalRefunded += refund)
```

---

## 5. Query Resolution Graph

### Query: Get all payments by a user

```
users(where: { address: "0x..." })
  │
  ├─→ AAWallets (derived from User.id)
  │     │
  │     ├─→ Agents (where Agent.aaWallet = AAWallet.id)
  │     │     │
  │     │     ├─→ Sessions (where Session.agent = Agent.id)
  │     │     │     │
  │     │     │     └─→ Channels (where Channel.session = Session.id)
  │     │     │           │
  │     │     │           └─→ Payments (where Payment.channel = Channel.id)
  │     │     │                 │
  │     │     │                 ├─ amount
  │     │     │                 ├─ token
  │     │     │                 ├─ recipient
  │     │     │                 └─ timestamp
  │     │     │
  │     │     └─→ Attestations (where Attestation.agent = Agent.id)
  │     │           │
  │     │           ├─ value
  │     │           ├─ giver
  │     │           ├─ tag1
  │     │           └─ tag2
```

### GraphQL Query
```graphql
query GetUserPaymentHistory($eoa: String!) {
  users(where: { address: $eoa }) {
    address
    totalSpent
    totalRefunded
    aaWallets {
      agents {
        agentId
        feedbackCount
        reputationScore
        sessions {
          validUntil
          channels {
            provider
            payments {
              amount
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

## 6. Reputation Aggregation Flow

```
Individual Feedback
  ├─ Attestation 1: giver=0xA, value=80 (out of 100)
  ├─ Attestation 2: giver=0xB, value=90
  ├─ Attestation 3: giver=0xC, value=75 (revoked)
  └─ Attestation 4: giver=0xD, value=85

                    ↓
         
Validation Requests
  ├─ Validator=0xE: response=POSITIVE (response=1)
  └─ Validator=0xF: response=NEGATIVE (response=0)

                    ↓
         
Agent Reputation Summary
  ├─ feedbackCount = 3 (excludes revoked)
  ├─ reputationScore = 80+90+85 = 255 (sum of active attestations)
  ├─ avgRating = 255/3 = 85 (calculated by client)
  ├─ validationScore = (1+0)/2 = 50% (calculated by client)
  └─ overallTrust = weighted avg of reputation + validation

                    ↓

Query: Agent Reputation Profile
  ├─ agent.feedbackCount → 3
  ├─ agent.reputationScore → 255
  ├─ agent.attestations[all] → [feedback array]
  └─ agent.validations[all] → [validation array]
```

---

## 7. No Direct AA Wallet Derivation (Unlike Old SDK)

### ❌ OLD APPROACH (GokiteAASDK derivation)
```
EOA address → GokiteAASDK.getAccountAddress() → Derived AA wallet
Problem: Requires SDK to query; not stored on-chain
```

### ✅ NEW APPROACH (Event-based indexing)
```
IdentityRegistry.AgentWalletSet event emits:
  → (agentId, walletContract, user)
  → Subgraph creates AAWallet(address=walletContract, owner=user)
  → Relationship established directly from event
  
Benefit: No derivation needed; all relationships stored and queryable
```

---

## 8. Complete Lifecycle Example

```
Step 1: Alice registers an agent
        IdentityRegistry.register("ipfs://...")
        → Agent(15, owner=Alice)
        → User(Alice)

Step 2: Agent 15 is linked to Alice's AA wallet
        IdentityRegistry.AgentWalletSet(15, 0x4d90..., Alice)
        → AAWallet(0x4d90..., owner=Alice)
        → Agent(15).aaWallet = 0x4d90...

Step 3: Alice creates a session key for Agent 15
        ClientAgentVault.createSession(sessionId_15, 0x1C19..., rules)
        IdentityRegistry.registerSession(15, 0x1C19..., Alice, 0x4d90..., ...)
        → Session(0x1C19..., agent=15, user=Alice, aaWallet=0x4d90...)

Step 4: Bob opens a payment channel with Agent 15
        PaymentChannel.ChannelOpened(ch_001, 0x1C19..., Bob, ...)
        → Channel(ch_001, session=0x1C19..., agent=15, user=Alice, aaWallet=0x4d90...)

Step 5: Bob makes 5 API calls using the channel
        (PaymentChannel tracks cumulative cost via receipts)

Step 6: Channel settles with 100 USDT to Bob
        PaymentChannel.ChannelFinalized(ch_001, 100, 0 refund)
        → Payment(ch_001_settle, channel=ch_001, user=Alice, 
                  agent=15, amount=100)
        → User(Alice).totalSpent += 100

Step 7: Charlie gives Agent 15 positive feedback
        AttestationRegistry.FeedbackGiven(15, Charlie, 85, "responsive")
        → Attestation(15_Charlie_1, agent=15, giver=Charlie, value=85)
        → Agent(15).feedbackCount = 1
        → Agent(15).reputationScore = 85
```

