# AA Onboarding Flow (Current Implementation)

This document describes the onboarding flow implemented in [mcp-sdk/src/onboard.ts](../src/onboard.ts).

## Objective

Onboarding now guarantees the following sequence:

1. Resolve AA wallet address from EOA (deterministic address via AA SDK when available)
2. Deploy AA wallet if not yet deployed
3. Register agent NFT (agentId) on IdentityRegistry
4. Derive deterministic session key from EOA + agentId + sessionIndex
5. Create session + spending rules on the AA wallet (vault)
6. Register session key/rule metadata on IdentityRegistry
7. Persist generated credentials into local vars

Additionally, when sponsorship credits are exhausted, onboarding auto-switches to token-payment mode and funds the AA wallet with the paymaster settlement token before sending the UserOperation.

## Key Behavior

## 1. Wallet Resolution and Deployment

- Preferred path: `GokiteAASDK.getAccountAddress(eoaAddress)`
- Fallback path: WalletFactory `getWallet(owner)`
- Last fallback: explicit `options.walletContract` or configured `contracts.kiteAAWallet`

If `ensureWalletDeployment` is true (default):

- With AA SDK:
  - Checks `isAccountDeloyed(aaWallet)`
  - If false, sends a bootstrap UserOperation (0-value no-op) to force deployment
- With WalletFactory only:
  - Calls `deployWallet()` when no wallet exists

## 2. Agent Registration

- Calls IdentityRegistry `register(agentURI?)`
- Parses `Registered` event
- Stores resulting `agentId`

## 3. Session Derivation

- Session key is deterministic and agent-bound:
  - input: EOA private key bytes, `agentId`, `sessionIndex`
- Computes `sessionId = keccak256(sessionKey, agentId, validUntil)`

## 4. Session Rule and Session Key Registration

- Creates vault session by calling AA wallet `createSession(sessionId, sessionKey, rules)`
- Registers session in IdentityRegistry with:
  - `agentId`
  - `sessionKey`
  - `user` (EOA)
  - `walletContract` (AA wallet)
  - `validUntil`
  - `blockedAgents`

## 5. Sponsorship and Gas Funding Fallback

For each UserOperation step (deployment bootstrap / createSession):

1. Read paymaster sponsorship state:
   - `maxSponsoredTransactions`
   - `userSponsorship(aaWallet)`
2. If sponsorship remains:
   - use `sendUserOperationAndWait(...)`
3. If exhausted:
   - resolve settlement token from AA SDK config (`settlementToken` / supportedTokens[1])
   - ensure AA wallet has sufficient settlement token balance
   - if insufficient, transfer settlement token from EOA -> AA wallet
   - send via `sendUserOperationWithPayment(...)`

This prevents the `AA33 reverted` path caused by exhausted sponsorship without settlement token liquidity.

## Onboard Options Added

`OnboardOptions` now includes:

- `ensureWalletDeployment?: boolean` (default true)
- `gasSponsoring?:`
  - `paymentTokenAddress?: 0x...`
  - `paymentTokenTopUpAmount?: bigint`
  - `minPaymentTokenBalance?: bigint`

## Output and Traceability

`OnboardResult.txHashes[]` now includes hashes for:

- wallet deployment (if created)
- gas token funding (if performed)
- agent registration
- vault session creation
- session registration

This provides an auditable onboarding trail end-to-end.
