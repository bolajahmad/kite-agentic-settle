# Subgraph Deployment & Testing Checklist

## Pre-Deployment

### 1. Contract Address Verification
- [ ] Update `IdentityRegistry` address in `subgraph.yaml`
  - Current: `0x986A171fd6CE1Dc89d104E2b2a424Df9d4ef7524`
  - Verify this is the actual deployed address

- [ ] Update `PaymentChannel` address in `subgraph.yaml`
  - Current: `0xa00dDA4C326e045aF948cc1dD45A464c09db3Af8`
  - Verify this is the actual deployed address

- [ ] Update `AttestationRegistry` address in `subgraph.yaml`
  - Current: `0x95b4e0e5A4F7d10F77f5FB4C1E9Ea3a5e0e5C5C1` (placeholder)
  - **CRITICAL**: Replace with actual deployed address

- [ ] Verify `startBlock` matches the deployment block for each contract

### 2. ABI Verification
- [ ] Verify `abis/IdentityRegistryABI.json` is up-to-date
  - Check: Contains `Registered`, `AgentWalletSet`, `SessionRegistered`, `SessionRevoked`, `URIUpdated`

- [ ] Verify `abis/PaymentChannelABI.json` is up-to-date
  - Check: Contains `ChannelOpened`, `ChannelActivated`, `SettlementInitiated`, `ReceiptSubmitted`, `ChannelFinalized`

- [ ] Verify `abis/AttestationRegistry.json` exists and is complete
  - Check: Contains `FeedbackGiven`, `FeedbackRevoked`, `ResponseAppended`, `ValidationRequested`, `ValidationResponded`, `MerkleRootAnchored`

### 3. Event Signatures Validation
Run this to verify event signatures match contracts:
```bash
cd subgraph
npm run codegen   # Will fail if event signatures don't match
```

Expected outputs:
- `generated/IdentityRegistry/IdentityRegistry.ts`
- `generated/PaymentChannel/PaymentChannel.ts`
- `generated/AttestationRegistry/AttestationRegistry.ts`

### 4. Build & Compilation
```bash
cd subgraph
npm install       # Install dependencies
npm run codegen   # Generate types from ABIs
npm run build     # Compile AssemblyScript
```

Expected outputs:
- `build/` directory with compiled WASM modules
- No TypeScript errors

---

## Deployment

### 1. Deploy to Graph Node (Staging)
```bash
npm run deploy:staging
```

Monitor logs for:
- Successful manifest validation
- Datasource initialization
- Event handler registration
- Indexing progress

### 2. Deployment Success Indicators
- [ ] No errors in deployment logs
- [ ] Subgraph shows in Graph dashboard
- [ ] Indexing progress > 0%
- [ ] No hanging transactions

### 3. Post-Deployment Wait
- Wait 2-5 minutes for initial indexing
- Monitor progress towards 100%

---

## Testing Queries

### 1. Basic Entity Queries

#### Test User Creation
```graphql
query {
  users(first: 5) {
    id
    address
    createdAt
  }
}
```
**Expected**: At least 1 user (the EOA that registered an agent)

#### Test Agent Creation
```graphql
query {
  agents(first: 5) {
    id
    agentId
    metadata
    owner { id address }
    feedbackCount
  }
}
```
**Expected**: Agents with proper owner relationships

#### Test AAWallet Tracking
```graphql
query {
  aaWallets(first: 5) {
    id
    address
    owner { id }
    agents { id agentId }
  }
}
```
**Expected**: AAWallets linked to owners and agents

### 2. Session & Channel Queries

#### Test Session Creation
```graphql
query {
  sessions(first: 5) {
    id
    sessionKey
    user { id }
    agent { id agentId }
    aaWallet { address }
    status
    validUntil
  }
}
```
**Expected**: Sessions with proper user/agent/aaWallet relationships

#### Test Channel Lifecycle
```graphql
query {
  channels(first: 5) {
    id
    channelId
    user { id }
    agent { id }
    session { id }
    aaWallet { address }
    status
    mode
    deposit
    openedAt
  }
}
```
**Expected**: Channels with derived user/agent from session

### 3. Payment Tracking

#### Test Payment Creation
```graphql
query {
  payments(first: 10) {
    id
    amount
    token
    recipient
    user { id }
    agent { id }
    session { id }
    channel { id }
    type
    timestamp
  }
}
```
**Expected**: Payments linked to channels and sessions

#### Test User Stats
```graphql
query {
  users(first: 5) {
    address
    totalChannelsOpened
    totalSpent
    totalRefunded
  }
}
```
**Expected**: Stats updated from channel settlements

### 4. Reputation Queries

#### Test Attestations
```graphql
query {
  attestations(first: 10) {
    id
    agent { id agentId }
    giver
    value
    valueDecimals
    tag1
    tag2
    status
  }
}
```
**Expected**: Feedback entries properly indexed

#### Test Agent Reputation
```graphql
query {
  agents(first: 5) {
    id
    feedbackCount
    reputationScore
    attestations(first: 10, where: { status: "ACTIVE" }) {
      value
      giver
    }
  }
}
```
**Expected**: Reputation aggregated from attestations

#### Test Validations
```graphql
query {
  validations(first: 10) {
    id
    agent { id }
    validator
    response
    status
  }
}
```
**Expected**: Validation requests and responses tracked

#### Test Merkle Roots
```graphql
query {
  merkleRoots(first: 10) {
    id
    agent { id }
    merkleRoot
    logCount
    ipfsURI
    validator
  }
}
```
**Expected**: Performance proofs anchored on-chain

### 5. Complex Relationship Queries

#### Full User Activity Chain
```graphql
query {
  users(where: { address: "0x..." }) {
    id
    address
    aaWallets {
      address
      agents {
        id
        agentId
        feedbackCount
        sessions {
          status
          channels {
            mode
            status
            payments {
              amount
              timestamp
            }
          }
        }
      }
    }
  }
}
```
**Expected**: Complete activity graph for a user

---

## Troubleshooting

### Issue: "Entity not found"
**Solution**: 
- Check that handler correctly saves entity with matching ID
- Verify ID generation is consistent (e.g., always `.toHex()`)

### Issue: "No relationship between entities"
**Solution**:
- Verify that related entity exists before linking
- Check that relationship field references correct ID
- Ensure field type matches entity ID type (String!)

### Issue: "Event not recognized"
**Solution**:
- Verify event signature in YAML matches contract ABI exactly
- Check parameter types and indexed modifiers
- Regenerate types: `npm run codegen`

### Issue: "Indexing stuck at 0%"
**Solution**:
- Check contract address is deployed to correct network
- Verify `startBlock` is correct (not after contract deployment)
- Check subgraph deployment logs for errors
- Restart indexing from dashboard

### Issue: "Type mismatch in handler"
**Solution**:
- Regenerate types: `npm run codegen`
- Verify event parameters match handler function signature
- Check BigInt vs Int types (event params are BigInt in AssemblyScript)

---

## Performance Optimization

### 1. Index Block Range
For large contracts, process events in batches:
```yaml
startBlock: 21096127      # Start after all deployments
endBlock: 21200000        # Optional: limit initial sync
```

### 2. Call Handlers (Optional Future)
For contract state queries:
```yaml
callHandlers:
  - function: sessionExists(bytes32)
    handler: handleSessionQuery
```

### 3. Block Handler (Optional Future)
For time-based aggregations:
```yaml
blockHandlers:
  - handler: handleBlock
    filter:
      kind: call
```

---

## Monitoring

### Real-time Checks
```bash
# Check subgraph health
curl -X POST https://api.thegraph.com/index-node/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{indexingStatusForCurrentVersion(subgraphName:\"org/kite\"){synced health}}"}'
```

### Common Metrics to Monitor
- **Sync Progress**: % of blocks indexed (should reach 100%)
- **Entity Count**: Total agents, sessions, payments created
- **Query Latency**: Time to execute test queries
- **Error Rate**: Any revert/handler errors

---

## Rollback Plan

If issues occur post-deployment:

1. **Revert subgraph.yaml** to previous working version
2. **Regenerate types**: `npm run codegen`
3. **Rebuild**: `npm run build`
4. **Redeploy**: `npm run deploy:staging`
5. **Verify** with basic queries

---

## Success Criteria

✅ Deployment successful if:
- [ ] All contracts indexed without errors
- [ ] User → AAWallet → Agent chain resolves correctly
- [ ] Sessions link properly to agents and aaWallets
- [ ] Payments derive user/agent from session relationships
- [ ] Reputation (attestations, validations) tracked
- [ ] All relationship queries return consistent data
- [ ] Query response time < 100ms
- [ ] No indexing lag

