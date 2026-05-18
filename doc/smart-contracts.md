# Kite Agent Pay — Smart Contracts

All smart contracts live in `contracts/contracts/`. They are written in Solidity 0.8.24, compiled with Hardhat (with `viaIR: true` and the optimizer enabled), and deployed to the Kite AI Testnet.

---

## Deployed Addresses

Contract addresses are the canonical source of truth in `contracts/deployments.json`:

```json
{
  "kiteTestnet": {
    "IdentityRegistry": "0xE4C30627C02791bF12241021f2fC320b43991cb1",
    "PaymentChannel":   "0x8EC6B059178485a37FF3f3AE6351994A6597d4Fb",
    "AttestationRegistry": "0x2F72b719679FD0b92712D03a1E16909F18d55660"
  },
  "usdt": {
    "address": "0x43408C22242fa6A59DE28ab7128Ea4aC121C5569"
  }
}
```

**Network:** Kite AI Testnet (Chain ID `2368`)
**RPC:** `https://rpc-testnet.gokite.ai`
**Explorer:** `https://testnet-explorer.gokite.ai`

### Token addresses (testnet)

| Symbol | Address | Decimals | Notes |
|---|---|---|---|
| DmUSDT | `0xd4a87d5531A586C247BD13F3Bb0Dd68C6253B489` | 18 | Primary demo token |
| X.USDT | `0x1b7425d288ea676FCBc65c29711fccF0B6D5c293` | 18 | Kite x402 USD |
| USDC.e | `0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e` | 6 | USDC bridge |
| USDT | `0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63` | 18 | Testnet USDT |

---

## Contract Overview

The system is composed of four contracts. Together they implement the Kite payment protocol on top of EIP-8004 (agent identity standard) and EIP-4337 (account abstraction):

```
IdentityRegistry  ←─── AgentWallet link ─────┐
       │                                      │
       │ validateSession()                    │
       ↓                                      ↓
 KiteAAWallet  ←── locks funds ───  PaymentChannel
       │
       └── AttestationRegistry (Merkle anchors)
```

---

## IdentityRegistry.sol

**Address:** `0xE4C30627C02791bF12241021f2fC320b43991cb1`

**What it is:** An ERC-721 NFT contract where each token represents one AI agent identity. Implements [EIP-8004](https://eips.ethereum.org/EIPS/eip-8004) — a standard for on-chain agent identity registries.

**Why it exists:** Provides a single, on-chain source of truth for agent identity, session keys, and spending authorisation. Both `KiteAAWallet` and `PaymentChannel` delegate all session validation to this contract — neither holds session state of its own.

### Key concepts

**Agent NFT:** Minting calls `register(registrationURI)`. The `agentId` is the auto-incrementing `tokenId`. The URI points to an ERC-8004 metadata JSON file (IPFS, HTTPS, or data URI) describing the agent.

**Agent Wallet:** Each agent is linked to a `(walletContract, user)` pair via `setAgentWallet()`. The `walletContract` is the AA wallet where the user's funds live; `user` is the EOA that owns that balance. This link is how payments reach the right user inside a multi-tenant AA wallet.

**Sessions:** Session keys are ephemeral signing keys registered against an agent. A session key carries:
- `agentId` — which agent it belongs to
- `user` — the EOA owner
- `walletContract` — which AA wallet to debit
- `validUntil` — expiry timestamp
- `blockedAgents` — list of agent IDs that cannot use this session

### Key functions

| Function | Who calls it | Description |
|---|---|---|
| `register(registrationURI)` | Agent owner | Mint agent NFT with metadata URI |
| `register()` | Agent owner | Mint without URI (set later) |
| `setAgentURI(agentId, newURI)` | Agent owner / operator | Update metadata URI |
| `setAgentWallet(agentId, walletContract, user, deadline, sig)` | Anyone with EIP-712 sig | Link agent to AA wallet |
| `registerSession(agentId, sessionKey, user, walletContract, valueLimit, maxValueAllowed, validUntil, blockedAgents)` | AA wallet (proxy) | Register a session key |
| `revokeSession(sessionKey)` | Session owner or AA wallet | Revoke an active session |
| `validateSession(sessionKey)` | PaymentChannel, KiteAAWallet | Read-only session validation |
| `isAgentBlocked(sessionKey, agentId)` | Downstream contracts | Check blocklist |

### Events

| Event | Description |
|---|---|
| `Registered(agentId, agentURI, owner)` | New agent NFT minted |
| `URIUpdated(agentId, newURI, updatedBy)` | Metadata URI changed |
| `AgentWalletSet(agentId, walletContract, user)` | Wallet link established |
| `SessionRegistered(agentId, sessionKey, user, walletContract, validUntil)` | Session created |
| `SessionRevoked(agentId, sessionKey)` | Session deactivated |

---

## KiteAAWallet.sol

**What it is:** A multi-tenant ERC-20 wallet for AI agents. Users register and deposit tokens; agents authorise payments by signing EIP-712 messages with their session keys.

**Why it exists:** Separates fund custody from payment authorisation. The EOA owner controls deposits and withdrawals; the session key authorises individual payments within the limits registered in `IdentityRegistry`. This is the x402 per-call payment model.

Any party (server, facilitator, relayer, or the agent itself) can submit a signed payment authorisation on-chain — the contract only verifies the session key signature.

### EIP-712 Payment Struct

```solidity
Payment(
  uint256 agentId,
  address sessionKey,
  address recipient,
  address token,
  uint256 amount,
  uint256 nonce,
  uint256 deadline
)
```

The session key signs this struct. The signature is included in the `X-PAYMENT` header on API calls.

### Key functions

| Function | Who calls it | Description |
|---|---|---|
| `register()` | EOA user | Create a user account in this wallet |
| `deposit(token, amount)` | EOA user | Deposit ERC-20 tokens |
| `withdraw(token, amount)` | EOA user | Withdraw tokens back to EOA |
| `executePayment(agentId, sessionKey, recipient, token, amount, nonce, deadline, signature)` | Anyone (facilitator/relayer) | Verify EIP-712 sig and transfer tokens to recipient |
| `lockFunds(walletContract, token, amount)` | PaymentChannel | Lock funds for a channel (prepaid mode) |
| `unlockFunds(walletContract, token, amount)` | PaymentChannel | Unlock on settlement/close |
| `addSessionKeyRule(agentId, sessionKey, user, walletContract, valueLimit, maxValueAllowed, validUntil, blockedAgents)` | EOA user | Register session + proxy to IdentityRegistry |

### Payment validation

On every `executePayment` call the contract checks:
1. Session is active and not expired (delegates to `IdentityRegistry.validateSession`)
2. Nonce has not been used (bitmap replay protection: `usedNonces[sessionKey][nonce]`)
3. Deadline has not passed
4. EIP-712 signature is valid and was signed by `sessionKey`
5. Per-call amount ≤ `valueLimit`
6. Cumulative session spend ≤ `maxValueAllowed`
7. Provider is not on the user's blocklist

### Events

| Event | Description |
|---|---|
| `PaymentExecuted(agentId, sessionKey, recipient, token, amount, nonce)` | Successful payment |
| `FundsLocked(wallet, token, amount)` | Channel deposit locked |
| `FundsUnlocked(wallet, token, amount)` | Channel funds released |

---

## PaymentChannel.sol

**Address:** `0x8EC6B059178485a37FF3f3AE6351994A6597d4Fb`

**What it is:** An on-chain payment channel contract between agent consumers and API providers. Supports prepaid (escrow) and postpaid (credit) modes. Implements a challenge-based settlement model.

**Why it exists:** Enables efficient batch and stream payment patterns. The consumer opens a channel once, makes many API calls off-chain (exchanging EIP-712 signed receipts with the provider), and settles the aggregate cost in one or two on-chain transactions — regardless of how many calls were made.

### Channel lifecycle

```
Open → Active → SettlementPending → Closed
```

| Status | Description |
|---|---|
| `Open` | Channel created on-chain, provider has not activated it yet |
| `Active` | Provider called `activateChannel()`, calls can flow |
| `SettlementPending` | Consumer or provider initiated settlement — challenge window is open |
| `Closed` | Finalized, funds distributed |

### Channel struct

Key fields:
- `consumer` — session key that opened the channel
- `user` — EOA derived from session at open time
- `walletContract` — AA wallet holding the consumer's funds
- `provider` — provider EOA address
- `token` — ERC-20 token
- `mode` — `Prepaid` (funds locked upfront) or `Postpaid` (credit)
- `deposit` — total locked amount
- `maxSpend` — absolute spend cap
- `maxPerCall` — per-call spend cap
- `maxDuration` — channel lifetime in seconds
- `usageMerkleRoot` — audit root anchored at settlement (does not determine payment)

### Settlement mechanics

1. Either party calls `initiateSettlement(channelId, sequenceNumber, cumulativeCost, receiptHash, signature)` — submits the last known valid receipt
2. The channel enters `SettlementPending` with a 1-hour challenge window
3. During the window, **anyone** can submit a higher valid receipt with `submitReceipt()` — this is the dispute mechanism
4. After the window, `finalize(channelId, merkleRoot)` settles based on the highest valid receipt seen:
   - Provider receives `highestClaimedCost`
   - Consumer gets refund of `deposit - highestClaimedCost`
5. If the provider calls `approveSettlement()` during the challenge window, the channel closes immediately (cooperative settlement, no wait)

### Key functions

| Function | Who calls it | Description |
|---|---|---|
| `openChannel(provider, token, mode, deposit, maxSpend, maxDuration, maxPerCall, sessionKey)` | Consumer (session key) | Open and lock funds |
| `activateChannel(channelId)` | Provider | Acknowledge channel, move to Active |
| `initiateSettlement(channelId, seqNum, cost, hash, sig)` | Consumer or provider | Start settlement |
| `submitReceipt(channelId, seqNum, cost, hash, sig)` | Anyone | Submit higher receipt during challenge |
| `approveSettlement(channelId, merkleRoot)` | Provider | Cooperatively close (skips challenge window) |
| `finalize(channelId, merkleRoot)` | Anyone | Settle after challenge window |

### Events

| Event | Description |
|---|---|
| `ChannelOpened(channelId, consumer, provider, token, mode, deposit, ...)` | New channel |
| `ChannelActivated(channelId)` | Provider activated |
| `SettlementInitiated(channelId, initiator, claimedAmount, deadline)` | Settlement started |
| `ReceiptSubmitted(channelId, submitter, sequenceNumber, cumulativeCost)` | Receipt in challenge |
| `ChannelFinalized(channelId, payment, refund, merkleRoot)` | Channel closed |

---

## AttestationRegistry.sol

**Address:** `0x2F72b719679FD0b92712D03a1E16909F18d55660`

**What it is:** An on-chain reputation and validation registry, implementing EIP-8004 §4 (Reputation) and §5 (Validation), plus a Kite-specific Merkle anchoring extension.

**Why it exists:** Provides a tamper-proof audit trail for agent behaviour. After channel settlement, the Merkle root of all call receipts can be anchored here, allowing any party to verify service delivery off-chain.

### Three subsystems

#### 1. Reputation Registry (EIP-8004 §4)

- Any address can give feedback to any registered agent
- Feedback includes a numeric `value`, tags, an endpoint reference, and optional URI
- Feedback can be revoked by the giver
- Agents can append a response to each feedback entry
- Enables trust signals for service discovery

#### 2. Validation Registry (EIP-8004 §5)

- Agent owners request validation from a specified validator address
- Validators respond with a score (0–100) and a response URI
- Useful for third-party audits and capability certification

#### 3. Merkle Extension (Kite-specific)

- Anyone (or an authorised submitter) can anchor a Merkle root against an agent
- Each anchor references the agent ID, root hash, log count, IPFS URI, and an optional validator
- Anchoring automatically creates a validation request so off-chain systems can confirm
- Stateless Merkle proof verification is exposed on-chain: `verifyProof(root, leaf, proof)`

### Key functions

| Function | Who calls it | Description |
|---|---|---|
| `giveFeedback(agentId, value, decimals, tag1, tag2, endpoint, uri, hash)` | Anyone | Submit reputation feedback |
| `revokeFeedback(agentId, index)` | Feedback giver | Retract a feedback entry |
| `respondToFeedback(agentId, giver, index, responseURI, responseHash)` | Agent owner | Add agent response |
| `requestValidation(agentId, validator, requestURI, requestHash, tag)` | Agent owner | Request third-party validation |
| `respondToValidation(requestHash, score, responseURI, responseHash)` | Validator | Submit validation result |
| `anchorMerkleRoot(agentId, merkleRoot, logCount, ipfsURI, validator)` | Authorized submitter | Anchor usage proof |
| `verifyProof(root, leaf, proof)` | Anyone | Stateless Merkle verification |

---

## Deployment

Contracts are deployed via `contracts/scripts/deploy.js`:

```bash
cd contracts
npx hardhat run scripts/deploy.js --network kiteTestnet
```

Deploy order:
1. `IdentityRegistry` (no dependencies)
2. `KiteAAWallet` → `setIdentityRegistry(registryAddress)`
3. `PaymentChannel(registryAddress)`
4. `AttestationRegistry(registryAddress)`
5. Saves all addresses to `contracts/deployments.json`

### Tests

```bash
cd contracts
npx hardhat test
```

Test files:
- `test/IdentityRegistry.test.js` — agent registration, wallet linking, session management
- `test/KiteAAWallet.test.js` — payment execution, spend limits, nonce replay
- `test/PaymentChannel.test.js` — channel lifecycle, settlement, dispute
- `test/AttestationRegistry.test.js` — reputation, validation, Merkle anchoring

All 87 tests pass. `AgentRegistry.test.js` is skipped (`xdescribe`) — it tests a deprecated v1 contract.
