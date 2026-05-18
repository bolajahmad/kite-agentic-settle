# x402 Payment Flow Migration: KiteAAWallet → ClientAgentVault

## Status: Documented — NOT YET IMPLEMENTED

---

## 0. Background

Sessions are now created on `ClientAgentVault` (the GokiteAccount SDK AA proxy) and
identified by an identity record on `IdentityRegistry`.  The vault holds user funds,
enforces spending rules, and executes transfers.

However, the x402 per-call payment flow — the code path that runs every time the agent
makes an HTTP request to a protected API — still points at the **legacy `KiteAAWallet`
contract** that is no longer the fund custodian.

This means:
- The agent signs a `Payment` EIP-712 message bound to `KiteAAWallet`.
- The backend calls `KiteAAWallet.executePayment(...)`.
- `KiteAAWallet` tries to debit from its internal `balances[user]` mapping.
- The user has no balance there — funds are in `ClientAgentVault`.
- The settlement **fails on-chain** (or succeeds against a stale balance that no longer
  tracks real holdings).

---

## 1. How the Flow Works Today (Broken Path)

### 1.1 Backend — 402 Challenge (`backend/src/middlewares/x402.ts`)

```
GET /api/protected-route
→ 402 {
    x402Version: 1,
    accepts: [{
      scheme: "kite-programmable",
      network: "kite-testnet",
      maxAmountRequired: "1000000000000000000",  // 1 USDT in 18-dec
      payTo: <FACILITATOR_RECIPIENT_ADDRESS>,
      asset: <USDT_TOKEN_ADDRESS>,
      resource: "...",
      settlementContract: <KITE_AA_WALLET_ADDRESS>   // ← WRONG
    }]
  }
```

### 1.2 Agent — Sign & Encode (`mcp-sdk/src/interceptor.ts :: payViaX402`)

```typescript
// EIP-712 domain bound to the SHARED KiteAAWallet contract (wrong)
domain: {
  name: "KiteAAWallet",
  version: "1",
  chainId,
  verifyingContract: kiteAAWallet,            // ← one shared contract
},
types: {
  Payment: [
    { name: "agentId",    type: "uint256" },
    { name: "sessionKey", type: "address" },
    { name: "recipient",  type: "address" },
    { name: "token",      type: "address" },
    { name: "amount",     type: "uint256" },
    { name: "nonce",      type: "uint256" },  // ← uint256 bitmap nonce
    { name: "deadline",   type: "uint256" },
  ],
},

// Encoded as base64 JSON in X-PAYMENT header:
payload = {
  scheme: "kite-programmable",
  version: "1",
  chainId,
  settlementContract: kiteAAWallet,           // ← shared contract address
  agentId,
  sessionKey,
  recipient,
  token,
  amount,
  nonce,           // uint256
  deadline,        // uint256
  signature,
}
```

### 1.3 Backend — Decode & Settle

**`backend/src/services/facilitator.ts`**

```
decodeX402Header(header)
  → base64 → JSON → X402PaymentPayload { agentId, sessionKey, recipient, token,
                                          amount, nonce, deadline, signature, ... }
validatePaymentPayload(...)
  → check deadline, amount <= maxRequired, recipient == payTo
  → isNonceUsedOnChain(sessionKey, nonce)          // KiteAAWallet.isNonceUsed
settleX402Payment(payload)
  → executePaymentOnChain(agentId, sessionKey, recipient, token, amount, nonce, deadline, sig)
```

**`backend/src/services/contract-service.ts`**

```typescript
// Gets the single shared contract instance
const wallet = getKiteAAWallet();                   // ← shared, wrong contract

// Submits on-chain
await wallet.executePayment(agentId, sessionKey, recipient, token, amount, nonce, deadline, sig);

// Replay check
await wallet.isNonceUsed(sessionKey, nonce);        // uint256 nonce lookup
```

---

## 2. How the Flow Must Work (Correct Architecture)

### 2.1 Key Architectural Differences

| Concern                  | Before (KiteAAWallet)                           | After (ClientAgentVault)                                                    |
|--------------------------|------------------------------------------------|-----------------------------------------------------------------------------|
| Fund custody             | `KiteAAWallet.balances[user][token]`           | `ClientAgentVault` token balance (one vault per EOA)                        |
| Settlement contract      | Single shared `KITE_AA_WALLET_ADDRESS`         | Per-user `walletContract` from `IdentityRegistry.validateSession`           |
| Session identifier       | `(agentId, sessionKey)` tuple                  | `sessionId = keccak256(encodePacked(sessionKey, agentId, validUntil))`      |
| EIP-712 domain           | `{ name: "KiteAAWallet", verifyingContract: kiteAAWallet }` | `{ name: "...", verifyingContract: userVaultAddress }` (TBD — see §2.3)  |
| Signed type              | `Payment { agentId, sessionKey, recipient, token, amount, nonce, deadline }` | EIP-3009 `TransferWithAuthorization { from, to, token, value, validAfter, validBefore, nonce }` |
| Nonce format             | `uint256` bitmap                               | `bytes32` (EIP-3009 unique nonce, not a counter or bitmap)                  |
| Spend-limit enforcement  | Backend validates manually; contract checks `getSessionRule` | Vault enforces `checkSpendingRules` inside `executeTransferWithAuthorization` |
| Provider allowlist       | `blockedProviders` mapping on `KiteAAWallet`   | `targetProviders` (hashed) in vault `Rule[]`                                |
| On-chain function called | `KiteAAWallet.executePayment(...)`             | `ClientAgentVault.executeTransferWithAuthorization(sessionId, auth, sig, metadata)` |

### 2.2 ClientAgentVault Settlement Functions

From `mcp-sdk/src/abis.ts` (`clientAgentVaultAbi`):

```solidity
function executeTransferWithAuthorization(
    bytes32 sessionId,
    (address from, address to, address token, uint256 value, uint256 validAfter,
     uint256 validBefore, bytes32 nonce) auth,
    bytes signature,
    bytes metadata
) external

function executeTransferWithAuthorizationAndProvider(
    bytes32 sessionId,
    (address from, address to, address token, uint256 value, uint256 validAfter,
     uint256 validBefore, bytes32 nonce) auth,
    bytes signature,
    bytes32 serviceProvider,   // keccak256(abi.encodePacked(providerAddress))
    bytes metadata
) external
```

- `sessionId` — the session the agent is operating under (vault enforces its rules).
- `auth` — EIP-3009 `TransferWithAuthorization` struct; `from` = vault address, `to` = provider `payTo`, `nonce` = random `bytes32`.
- `signature` — the session key's EIP-3009 signature.
- `serviceProvider` — hashed provider address for allowlist enforcement (use `executeTransferWithAuthorizationAndProvider` when provider restriction is desired).
- `metadata` — arbitrary bytes passed through (can include agentId, resource URL, etc.).

### 2.3 EIP-3009 Signing Domain

The `TransferWithAuthorization` type is defined by EIP-3009 and is typically implemented on the **token contract** (e.g., USDC/USDT on many chains). However, the Kite vault implements its own version. The domain needs to be confirmed from the deployed contract — two likely options:

**Option A — Vault as verifying contract:**
```typescript
domain: {
  name: "ClientAgentVault",    // or whatever name the vault uses
  version: "1",
  chainId,
  verifyingContract: walletContract,  // user's specific vault address
}
```

**Option B — Token's own EIP-3009:**
The vault directly calls the token's `transferWithAuthorization`, meaning the signature must be over the token's EIP-712 domain.

> **Action needed before implementation:** Call `vault.DOMAIN_SEPARATOR()` or
> `vault.TRANSFER_WITH_AUTHORIZATION_TYPEHASH()` on the deployed vault to confirm
> the domain name and version. The ABI already exposes `TRANSFER_WITH_AUTHORIZATION_TYPEHASH`.

The `TransferWithAuthorization` type struct is standard:
```typescript
types: {
  TransferWithAuthorization: [
    { name: "from",        type: "address" },
    { name: "to",         type: "address" },
    { name: "value",      type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore",type: "uint256" },
    { name: "nonce",      type: "bytes32" },
  ],
}
```

Note: the `token` field present in the vault ABI struct is NOT part of the standard EIP-3009
`TransferWithAuthorization` type. Confirm whether the vault adds `token` to the signed
message or whether it is implicit (single-token vault).

---

## 3. Required Changes — File by File

### 3.1 `backend/src/middlewares/x402.ts` — 402 Challenge

**Current:**
```typescript
settlementContract: process.env.KITE_AA_WALLET_ADDRESS ?? "",
```

**Required:**
The challenge must NOT reference a single shared `settlementContract` anymore because
each user has their own vault. The client already knows its vault address (stored in
vars as `AGENT_<id>_WALLET`).

Two approaches:

**Approach A — Remove `settlementContract` from challenge entirely.**
The client derives its own vault address and does not rely on the challenge to tell it
which contract to call. The payload it sends back carries `walletContract`.

**Approach B — Keep `settlementContract` as a hint but as a per-request lookup.**
Not feasible here because the backend does not know which agent is calling until after
it decodes the X-PAYMENT header.

→ **Use Approach A.** Remove `settlementContract` from the 402 challenge.
The client is responsible for knowing its own vault address.

---

### 3.2 `mcp-sdk/src/interceptor.ts :: payViaX402` — Agent Signing

This is the most significant change.

**Current signing:**
```typescript
// Signs "Payment" type against KiteAAWallet domain
const signature = await account.signTypedData({
  domain: { name: "KiteAAWallet", version: "1", chainId, verifyingContract: kiteAAWallet },
  types: { Payment: [...] },
  primaryType: "Payment",
  message: { agentId, sessionKey, recipient, token, amount, nonce, deadline },
});
```

**Required signing:**
```typescript
// 1. Resolve walletContract for this agent (from vars or IdentityRegistry)
const walletContract = getVar(`AGENT_${agentId}_WALLET`) as `0x${string}`;
//    OR: cs.resolveWalletContractForSession(sessionKey)

// 2. Derive sessionId
const validUntil = ...; // must be known — stored in vars from session create
const sessionId = deriveSessionId(sessionKey, agentId, validUntil);

// 3. Build EIP-3009 TransferWithAuthorization auth struct
const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));  // random bytes32
const validAfter = 0n;
const validBefore = BigInt(Math.floor(Date.now() / 1000) + 300); // 5-min window

// 4. Sign against vault's domain (domain name TBD — verify from contract)
const signature = await account.signTypedData({
  domain: {
    name: "ClientAgentVault",   // or token domain — TBD
    version: "1",
    chainId: BigInt(chainId),
    verifyingContract: walletContract,
  },
  types: {
    TransferWithAuthorization: [
      { name: "from",        type: "address" },
      { name: "to",         type: "address" },
      { name: "value",      type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore",type: "uint256" },
      { name: "nonce",      type: "bytes32" },
    ],
  },
  primaryType: "TransferWithAuthorization",
  message: {
    from:        walletContract as `0x${string}`,  // vault IS the "from"
    to:          offer.payTo as `0x${string}`,
    value:       amount,
    validAfter,
    validBefore,
    nonce:       nonce as `0x${string}`,
  },
});
```

**Required payload structure (X-PAYMENT header):**
```typescript
const payload = {
  scheme:          "kite-programmable",
  version:         "2",                      // bump version to distinguish from legacy
  chainId,
  walletContract,                            // user's ClientAgentVault address
  sessionId,                                 // bytes32 session identifier
  sessionKey,                                // session key address (for backend lookup)
  agentId,                                   // agent NFT tokenId
  auth: {
    from:        walletContract,
    to:          offer.payTo,
    token:       offer.asset,                // included for completeness
    value:       amount.toString(),          // string to survive JSON serialisation
    validAfter:  validAfter.toString(),
    validBefore: validBefore.toString(),
    nonce,                                   // bytes32 hex string
  },
  signature,
};
```

**Additional data the interceptor needs to have available:**

- `walletContract` — the user's vault address. Must be loaded from vars (`AGENT_<id>_WALLET`)
  or resolved from `IdentityRegistry.validateSession`. The interceptor currently has
  `this.contractService` available — add a method to resolve it.
- `validUntil` — needed to derive `sessionId`. Must be stored in vars during `session create`
  as `SESSION_<agentId>_<index>_VALID_UNTIL`.
- The `sessionId` derivation must use `deriveSessionId` from `utils/session-id.ts`.

---

### 3.3 `backend/src/services/facilitator.ts` — Decode & Validate

**Current `X402PaymentPayload` type (implicit from usage):**
```typescript
{
  scheme, version, chainId,
  settlementContract,   // shared KiteAAWallet
  agentId, sessionKey,
  recipient, token, amount, nonce, deadline,
  signature,
}
```

**Required `X402PaymentPayload` type:**
```typescript
{
  scheme, version, chainId,
  walletContract,       // user's ClientAgentVault address
  sessionId,            // bytes32
  sessionKey,           // session key address
  agentId,
  auth: {
    from, to, token, value,
    validAfter, validBefore,
    nonce,              // bytes32
  },
  signature,
}
```

**`validatePaymentPayload` changes:**
- Replace `deadline` check with `validBefore` check: `auth.validBefore > now`.
- Replace `isNonceUsedOnChain(sessionKey, nonce)` with... TBD (see §3.4 note on replay).
- Validate `auth.to == payTo` (recipient).
- Validate `auth.value <= maxAmountRequired`.
- Validate `walletContract != zero` and `sessionId != zero32`.
- Optional: call `ClientAgentVault.checkSpendingRules(sessionId, amount, hashedProvider)`
  as a pre-flight before submitting. This avoids an on-chain revert and gives a cleaner
  error to the agent.

**`settleX402Payment` changes:**
- Replace `executePaymentOnChain(...)` with `executeTransferWithAuthorizationOnChain(...)`.
- Must look up `walletContract` from the payload (not a shared env var).

---

### 3.4 `backend/src/services/contract-service.ts` — On-Chain Calls

**Functions to REMOVE (or deprecate):**
- `executePaymentOnChain(agentId, sessionKey, recipient, token, amount, nonce, deadline, sig)`
  — calls `KiteAAWallet.executePayment`.
- `isNonceUsedOnChain(sessionKey, nonce)` — calls `KiteAAWallet.isNonceUsed` with `uint256`.
- `getSessionRuleFromChain(sessionKeyAddress)` — calls `KiteAAWallet.getSessionRule`.
- `revokeSessionKeyOnChain(sessionKeyAddress)` — calls `KiteAAWallet.revokeSessionKey`.
- `addSessionKeyRuleOnChain(...)` — calls `KiteAAWallet.addSessionKeyRule`.

**Functions to ADD:**

```typescript
// New contract factory — takes the vault address dynamically, not from env
function getClientAgentVault(vaultAddress: string, signerOrProvider?) {
  return new ethers.Contract(vaultAddress, ClientAgentVaultABI, signerOrProvider ?? getSigner());
}

// Settlement — called by facilitator after validation
async function executeTransferWithAuthorizationOnChain(
  walletContract: string,
  sessionId: string,       // bytes32 hex
  auth: {
    from: string; to: string; token: string;
    value: bigint; validAfter: bigint; validBefore: bigint;
    nonce: string;         // bytes32 hex
  },
  signature: string,
  metadata: string,        // bytes hex, e.g. encode agentId + resourceUrl
): Promise<{ txHash: string; blockNumber: number }>

// Optional provider-restricted variant
async function executeTransferWithAuthorizationAndProviderOnChain(
  walletContract: string,
  sessionId: string,
  auth: { ... },
  signature: string,
  serviceProvider: string, // bytes32 = keccak256(abi.encodePacked(providerAddress))
  metadata: string,
): Promise<{ txHash: string; blockNumber: number }>

// Replay protection — EIP-3009 nonces are bytes32 and tracked per-vault
// The vault likely exposes: authorizationState(authorizer, nonce) → uint8
// 0 = Unused, 1 = Used, 2 = Canceled
async function isAuthorizationUsedOnChain(
  walletContract: string,
  authorizer: string,      // the vault address (auth.from)
  nonce: string,           // bytes32 hex
): Promise<boolean>
```

**ABI file to ADD:**

Create `backend/src/contracts/abi/ClientAgentVaultABI.ts` with at minimum:
```typescript
export const ClientAgentVaultABI = [
  // Settlement
  {
    name: "executeTransferWithAuthorization",
    type: "function",
    inputs: [
      { name: "sessionId", type: "bytes32" },
      {
        name: "auth", type: "tuple",
        components: [
          { name: "from",        type: "address" },
          { name: "to",         type: "address" },
          { name: "token",      type: "address" },
          { name: "value",      type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore",type: "uint256" },
          { name: "nonce",      type: "bytes32" },
        ],
      },
      { name: "signature", type: "bytes" },
      { name: "metadata",  type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // Replay check (confirm exact name from contract)
  {
    name: "authorizationState",
    type: "function",
    inputs: [
      { name: "authorizer", type: "address" },
      { name: "nonce",      type: "bytes32" },
    ],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
  // Session check (already in mcp-sdk abis)
  {
    name: "sessionExists",
    type: "function",
    inputs: [{ name: "sessionId", type: "bytes32" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  // Spending rules check
  {
    name: "checkSpendingRules",
    type: "function",
    inputs: [
      { name: "sessionId",         type: "bytes32" },
      { name: "normalizedAmount",  type: "uint256" },
      { name: "serviceProvider",   type: "bytes32" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
];
```

> **Note on replay protection:** EIP-3009 uses a `bytes32` nonce (not a counter or bitmap).
> The contract tracks which nonces have been used. The standard function is
> `authorizationState(address authorizer, bytes32 nonce) → uint8`.
> Confirm this is exposed on the deployed vault. If not, omit the pre-flight check and
> rely on the on-chain revert — settlement is idempotent from the agent's perspective.

---

### 3.5 `mcp-sdk/src/vars.ts` — Store `validUntil` per Session

During `session create` and `onboard`, `validUntil` must be persisted so the interceptor
can derive `sessionId` later without a registry lookup:

```typescript
// In cmdSessionCreate (sessions.ts) and onboardAgent (onboard.ts), after session creation:
setVar(`SESSION_${agentId}_${sessionIndex}_VALID_UNTIL`, validUntil.toString());
```

The interceptor then reads:
```typescript
const validUntil = BigInt(getVar(`SESSION_${agentId}_${sessionIndex}_VALID_UNTIL`) ?? "0");
```

---

## 4. End-to-End Flow After Migration

```
[Agent] ─────────────────────────────────────────────────────────────────────────────
1. GET /api/endpoint
   ← 402 { accepts: [{ scheme: "kite-programmable", payTo, asset, maxAmountRequired }] }
      (no settlementContract — removed)

2. Load walletContract from vars: AGENT_14_WALLET = "0xVaultAddr..."
   Load sessionId: deriveSessionId(sessionKey, agentId, validUntil)
   Generate bytes32 nonce = randomBytes(32)
   Set validBefore = now + 300s

3. signTypedData({
     domain:  { name: "ClientAgentVault"(?), verifyingContract: "0xVaultAddr..." },
     type:    TransferWithAuthorization,
     message: { from: "0xVaultAddr...", to: payTo, value: amount,
                validAfter: 0, validBefore, nonce }
   }) → signature

4. X-PAYMENT = base64({
     scheme: "kite-programmable", version: "2",
     walletContract: "0xVaultAddr...",
     sessionId, sessionKey, agentId,
     auth: { from, to, token, value, validAfter, validBefore, nonce },
     signature,
   })

5. GET /api/endpoint  (retry with X-PAYMENT header)

[Backend] ────────────────────────────────────────────────────────────────────────────
6. Decode X-PAYMENT header → X402PaymentPayload (version 2)
   Validate: validBefore > now, auth.value <= maxAmountRequired, auth.to == payTo

7. (Optional pre-flight) Check nonce not already used:
   vault.authorizationState("0xVaultAddr...", nonce) == 0

8. (Optional pre-flight) Check spending rules:
   vault.checkSpendingRules(sessionId, normalizedAmount, hashedProvider) == true

9. Settle on-chain:
   getClientAgentVault("0xVaultAddr...").executeTransferWithAuthorization(
     sessionId,
     { from: vaultAddr, to: payTo, token, value: amount, validAfter, validBefore, nonce },
     signature,
     metadata,           // e.g. abi.encode(agentId, resourceUrl)
   )
   → receipt.hash

10. Return 200 with service response + X-Payment-TxHash header
```

---

## 5. Open Questions (Must Resolve Before Implementation)

### Q1: EIP-712 domain for `TransferWithAuthorization` on the vault
**Question:** What domain name and version does the deployed `ClientAgentVault` use for
`TransferWithAuthorization` signatures?
**How to resolve:** Call `vault.DOMAIN_SEPARATOR()` and reverse-engineer the preimage,
or look at the vault source code on KiteScan.
The mcp-sdk ABI already exposes `TRANSFER_WITH_AUTHORIZATION_TYPEHASH` — can use that
to confirm the typehash is standard EIP-3009.

### Q2: Does `auth` include a `token` field in the signed message?
**Question:** The vault ABI has `token` in the `auth` struct, but standard EIP-3009
`TransferWithAuthorization` does NOT include `token` in the signed type (it is implied
by the token contract's domain). Does the vault add `token` to the signed type?
**How to resolve:** Check `TRANSFER_WITH_AUTHORIZATION_TYPEHASH` on-chain. If the
typehash matches `keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")` then `token` is NOT signed. If it includes `token`, the type is different.

### Q3: `authorizationState` vs an alternate replay-check function
**Question:** Does the vault expose `authorizationState(address, bytes32)` for nonce
pre-flight checks, or does it use a different name?
**How to resolve:** Query the ABI on KiteScan or look at the vault source.

### Q4: `metadata` encoding convention
**Question:** What should the `metadata` bytes argument contain? Is it validated on-chain
or just emitted in an event?
**How to resolve:** Check vault source. Likely opaque bytes — encode `agentId` and
`resourceUrl` as ABI-encoded data for off-chain indexing.

### Q5: `serviceProvider` hashing for `executeTransferWithAuthorizationAndProvider`
**Question:** The vault uses `keccak256(abi.encodePacked(providerAddress))` for provider
hashing. Should x402 payments use the `AndProvider` variant, or the base variant?
**Decision needed:** If the vault already enforces provider rules via `checkSpendingRules`
inside `executeTransferWithAuthorization`, the `AndProvider` variant adds a second
explicit allowlist check. Use the base variant unless there is a specific need for the
extra allowlist enforcement at the function-call level.

---

## 6. Implementation Order

When ready to implement, do it in this order to keep a working state at each step:

1. **Backend: Add `ClientAgentVaultABI.ts`** — just the ABI file, no logic changes.
2. **Backend: Add `getClientAgentVault()` and `executeTransferWithAuthorizationOnChain()`** to `contract-service.ts` — additive only, do not remove old functions yet.
3. **Backend: Add new `X402PaymentPayload` type (v2)** and update `decodeX402Header` to handle both `version: "1"` (old) and `version: "2"` (new) — backward compatible.
4. **Backend: Update `settleX402Payment`** to branch on version: v2 → new vault path, v1 → old KiteAAWallet path (for rollback safety).
5. **SDK: Store `validUntil` in vars** during `session create` and `onboard`.
6. **SDK: Update `payViaX402`** to build the EIP-3009 payload (resolve walletContract + sessionId + sign + encode v2 payload).
7. **Backend: Update `requireX402Payment`** middleware to remove `settlementContract` from 402 challenge.
8. **Test end-to-end** on testnet.
9. **Remove legacy KiteAAWallet payment code** once all paths are confirmed working.
