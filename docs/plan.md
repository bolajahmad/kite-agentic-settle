Kite Settle
ClientAgentVault Migration
Implementation Plan

Scope 3 contracts + SDK layer
Priority Session rules → Vault
Goal Gasless session key ops
Status Dev — pre-deploy

0. Overview & Goals
   This document is the complete implementation plan for migrating KiteAAWallet to the Kite ClientAgentVault SDK. It covers every contract change, every SDK-side change, and the exact order to implement them.

0.1 What We Are Replacing
Concern Before (KiteAAWallet) After (ClientAgentVault)
Fund custody KiteAAWallet balances mapping ClientAgentVault token balance
Gas abstraction Send KITE to session key Kite bundler + paymaster
Session registration registerSession() on IdentityRegistry createSession() on vault + registerSession() for identity only
Spend limits (per-window) maxValueAllowed on SessionRule addSpendingRules() on vault
Spend limits (lifetime) maxValueAllowed enforced in wallet addMasterBudgetRule() on vault
Per-call cap valueLimit on SessionRule maxPerCall on PaymentChannel (unchanged)
Session expiry validUntil on SessionRule validUntil on IdentityRegistry (kept)
Blocked providers blockedProviders mapping in wallet IdentityRegistry (kept)
Channel deposit withdrawForChannel() custom call ERC-20 transferFrom(vault → channel)
Channel refund refundFromChannel() custom call ERC-20 transfer(channel → vault)

0.2 What Does NOT Change
IdentityRegistry — agentId NFT, session key → agent mapping, validUntil, blockedAgents
PaymentChannel settlement logic — challenge window, approveSettlement, submitReceipt, finalize
Receipt verification — \_verifyReceipt is unchanged
Provider-side calls — provider backend calls contracts directly, no changes
ERC-8004 feedback flow — session key signs, relayer submits via executeForSession

0.3 Architecture After Migration

"EOA (owner — setup only)
└── IdentityRegistry
├── agentId NFT (ERC-721)
├── session key → { agentId, user, walletContract, validUntil, blockedAgents }
└── validateSession(sessionKey) → identity only, no spend limits

└── ClientAgentVault (SDK-generated proxy)
├── token balances (USDC, USDT, etc.)
├── createSession(sessionKey, ...)
├── addSpendingRules([{ timeWindow, budget, targetProviders }])
├── addMasterBudgetRule({ lifetime cap })
├── checkSpendingRules(token, amount, provider) → bool
└── execute / executeBatch → PaymentChannel calls

└── PaymentChannel
├── openChannel — pulls deposit via transferFrom(vault, this, amount)
├── \_settle — pushes refund via transfer(vault, refund)
└── validateSession → IdentityRegistry +"

1. Pre-Work — Fetch Vault ABIs
   Before writing any code, fetch the exact function signatures from the deployed implementation contract. Do not assume parameter names or types.

1.1 Functions to Fetch
Open KiteScan and expand each of these write functions to get exact param types:
createSession — session key address + any spending params it takes. Critical: does it overlap with IdentityRegistry.registerSession or is it purely vault-scoped?
addSpendingRules — exact struct: { timeWindow, budget, initialWindowStartTime, targetProviders } — confirm field names and types
configureSpendingRule — is this a single-rule variant of addSpendingRules?
addMasterBudgetRule — struct shape for lifetime budget cap
executeTransferWithAuthorizationAndProvider — full signature. This may be the native payment primitive that replaces x402 executePayment
checkSpendingRules — confirm it takes (token, amount, provider) → bool
getSessionAgent — takes (address sessionKey) → address? Or (uint256 agentId)?

1.2 Create a Vault ABI File
Create src/abis/ClientAgentVault.abi.ts with the confirmed signatures. All subsequent code imports from this file. Example structure:

"// src/abis/ClientAgentVault.abi.ts
export const CLIENT_AGENT_VAULT_ABI = [
// paste confirmed ABI entries here after fetching from KiteScan
{
name: 'createSession',
type: 'function',
inputs: [ /* confirmed params */ ],
outputs: [],
},
// ... etc
] as const;"

2. IdentityRegistry Changes
   2.1 Remove valueLimit and maxValueAllowed from SessionRule
   These two fields move to the vault. The IdentityRegistry keeps identity only.

File: contracts/IdentityRegistry.sol
CHANGE — SessionRule struct:

"// BEFORE
struct SessionRule {
uint256 agentId;
address user;
address walletContract;
uint256 valueLimit; // ← REMOVE
uint256 maxValueAllowed; // ← REMOVE
uint256 validUntil;
uint256[] blockedAgents;
bool active;
}

// AFTER
struct SessionRule {
uint256 agentId;
address user;
address walletContract; // ClientAgentVault address
uint256 validUntil;
uint256[] blockedAgents;
bool active;
}"

2.2 Update registerSession Signature

"// BEFORE
function registerSession(
uint256 agentId,
address sessionKey,
address user,
address walletContract,
uint256 valueLimit, // ← REMOVE
uint256 maxValueAllowed, // ← REMOVE
uint256 validUntil,
uint256[] calldata blockedAgents
) external

// AFTER
function registerSession(
uint256 agentId,
address sessionKey,
address user,
address walletContract,
uint256 validUntil,
uint256[] calldata blockedAgents
) external"

2.3 Update validateSession Return Values

"// BEFORE
function validateSession(address sessionKey)
external view
returns (
bool active,
uint256 agentId,
address user,
address walletContract,
uint256 valueLimit, // ← REMOVE
uint256 maxValueAllowed, // ← REMOVE
uint256 validUntil
)

// AFTER
function validateSession(address sessionKey)
external view
returns (
bool active,
uint256 agentId,
address user,
address walletContract,
uint256 validUntil
)"

2.4 Update Requires in registerSession
Remove the two requires that validated valueLimit and maxValueAllowed:

"// REMOVE these two lines:
require(valueLimit > 0, 'valueLimit must be > 0');
require(maxValueAllowed >= valueLimit, 'maxValueAllowed must be >= valueLimit');

// ADD vault existence check instead:
require(walletContract != address(0), 'walletContract required');
// Optionally verify the vault recognises this session:
// require(IClientAgentVault(walletContract).sessionExists(sessionKey), 'Vault session not set');
// Note: only add the above if vault.createSession is called BEFORE registerSession"

2.5 Update SessionRegistered Event

"// BEFORE
event SessionRegistered(
uint256 indexed agentId,
address indexed sessionKey,
address user,
address walletContract,
uint256 valueLimit, // ← REMOVE
uint256 maxValueAllowed, // ← REMOVE
uint256 validUntil
);

// AFTER
event SessionRegistered(
uint256 indexed agentId,
address indexed sessionKey,
address user,
address walletContract,
uint256 validUntil
);"

3. PaymentChannel Changes
   3.1 Replace IKiteAAWallet with IClientAgentVault
   The PaymentChannel currently uses a custom IKiteAAWallet interface with withdrawForChannel and refundFromChannel. These are replaced by direct ERC-20 transfers. The interface slims down to only what PaymentChannel actually needs to query.

"// REMOVE entire IKiteAAWallet interface

// ADD minimal vault interface
interface IClientAgentVault {
function checkSpendingRules(
address token,
uint256 amount,
address provider
) external view returns (bool);

    function sessionExists(address sessionKey) external view returns (bool);

}

// KEEP IIdentityRegistry interface but update validateSession return values
interface IIdentityRegistry {
function validateSession(address sessionKey)
external view
returns (
bool active,
uint256 agentId,
address user,
address walletContract,
uint256 validUntil // valueLimit + maxValueAllowed removed
);
function isAgentBlocked(address sessionKey, uint256 agentId) external view returns (bool);
}"

3.2 Add identityRegistry as Immutable Constructor Param
Currently PaymentChannel gets the registry address from wallet.identityRegistry(). ClientAgentVault does not expose this. Fix by passing it at deploy time.

"contract PaymentChannel is ReentrancyGuard, EIP712 {

    address public immutable identityRegistry;

    constructor(address _identityRegistry) EIP712('PaymentChannel', '1') {
        require(_identityRegistry != address(0), 'Invalid registry');
        identityRegistry = _identityRegistry;
    }

    // ... rest of contract

}"

3.3 Update openChannel — Session Validation
Replace the multi-field destructure with the updated validateSession return values. Replace valueLimit/maxValueAllowed checks with vault.checkSpendingRules.

"// BEFORE — in openChannel
(
bool active,
, // agentId
address user,
address sessionWallet,
uint256 valueLimit, // ← gone
uint256 maxValueAllowed, // ← gone
uint256 validUntil
) = identityRegistry.validateSession(msg.sender);

require(maxPerCall <= valueLimit, 'maxPerCall exceeds session valueLimit');
require(maxSpend <= maxValueAllowed, 'maxSpend exceeds session maxValueAllowed');

// AFTER
(
bool active,
, // agentId
address user,
address sessionWallet,
uint256 validUntil
) = IIdentityRegistry(identityRegistry).validateSession(msg.sender);

// Spending rule check now delegated to vault
require(
IClientAgentVault(walletContract).checkSpendingRules(token, maxSpend, provider),
'Exceeds vault spending rules'
);"

3.4 Update openChannel — Prepaid Deposit
Replace the custom withdrawForChannel call with a standard ERC-20 transferFrom. The vault must have approved PaymentChannel before openChannel is called — this is done in the SDK batch UserOp.

"// BEFORE
wallet.withdrawForChannel(user, token, deposit);
lockedFunds[walletContract][token] += deposit;

// AFTER
// Vault must have approved this contract for at least `deposit` before calling
IERC20(token).safeTransferFrom(walletContract, address(this), deposit);
lockedFunds[walletContract][token] += deposit;
// FundsLocked event unchanged"

3.5 Update \_settle — Refund Path
Replace refundFromChannel custom call with a direct transfer back to the vault. The vault receives the token and its balance increases automatically.

"// BEFORE — in \_settle, Prepaid mode
if (refund > 0 && ch.walletContract != address(0)) {
IERC20(ch.token).approve(ch.walletContract, refund);
IKiteAAWallet(ch.walletContract).refundFromChannel(ch.user, ch.token, refund);
} else if (refund > 0) {
IERC20(ch.token).safeTransfer(ch.consumer, refund);
}

// AFTER — direct transfer to vault, no custom interface
if (refund > 0) {
IERC20(ch.token).safeTransfer(ch.walletContract, refund);
}
// Vault balance increases. No approval needed. No custom call needed."

3.6 Update \_settle — Postpaid Mode
Postpaid mode currently pulls from ch.consumer (the session key). It should pull from ch.walletContract (the vault). The vault must have a standing approval.

"// BEFORE — Postpaid
if (amount > 0) {
IERC20(ch.token).safeTransferFrom(ch.consumer, ch.provider, amount);
}

// AFTER — pull from vault, not session key
if (amount > 0) {
IERC20(ch.token).safeTransferFrom(ch.walletContract, ch.provider, amount);
}
// Vault must have approved PaymentChannel for maxSpend at channel open time"

3.7 Add executeForSession Dispatcher (Gasless Session Key Calls)
Add this function to allow provider backend or any relayer to submit calls on behalf of the session key. Session key signs off-chain, relayer pays gas.

"bytes32 private constant FORWARD_TYPEHASH = keccak256(
'ForwardedCall(bytes32 channelId,bytes4 selector,bytes32 paramsHash,uint256 nonce,uint256 deadline)'
);
mapping(address => uint256) public sessionNonces;

function executeForSession(
address sessionKey,
bytes32 channelId,
bytes4 selector,
bytes calldata params,
uint256 nonce,
uint256 deadline,
bytes calldata sig
) external nonReentrant {
require(block.timestamp <= deadline, 'Expired');
require(sessionNonces[sessionKey] == nonce, 'Invalid nonce');

    bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
        FORWARD_TYPEHASH, channelId, selector, keccak256(params), nonce, deadline
    )));
    require(ECDSA.recover(digest, sig) == sessionKey, 'Invalid sig');

    (bool active,,,,) = IIdentityRegistry(identityRegistry).validateSession(sessionKey);
    require(active, 'Session not active');

    sessionNonces[sessionKey]++;

    if (selector == this.initiateSettlement.selector) {
        (uint256 seq, uint256 cost, uint256 ts, bytes memory provSig, bytes32 root) =
            abi.decode(params, (uint256, uint256, uint256, bytes, bytes32));
        _initiateSettlementFor(sessionKey, channelId, seq, cost, ts, provSig, root);
    } else if (selector == this.approveSettlement.selector) {
        _approveSettlementFor(sessionKey, channelId);
    } else if (selector == this.submitReceipt.selector) {
        (uint256 seq, uint256 cost, uint256 ts, bytes memory provSig) =
            abi.decode(params, (uint256, uint256, uint256, bytes));
        _submitReceiptFor(sessionKey, channelId, seq, cost, ts, provSig);
    } else {
        revert('Unsupported selector');
    }

}"

3.8 Refactor Settlement Functions to Internal \_\*For Variants
Each public settlement function keeps its signature for direct callers (provider backend). It calls an internal variant that accepts an explicit caller address. executeForSession calls the internal variants with the session key address.

"// Pattern — apply to initiateSettlement, approveSettlement, submitReceipt

// Public function — direct callers (provider) pay gas, msg.sender used
function initiateSettlement(
bytes32 channelId, uint256 seq, uint256 cost,
uint256 ts, bytes calldata provSig, bytes32 merkleRoot
) external nonReentrant onlyChannelParty(channelId) {
\_initiateSettlementFor(msg.sender, channelId, seq, cost, ts, provSig, merkleRoot);
}

// Internal variant — caller is explicit, used by executeForSession
function \_initiateSettlementFor(
address caller, bytes32 channelId,
uint256 seq, uint256 cost, uint256 ts,
bytes memory provSig, bytes32 merkleRoot
) internal {
Channel storage ch = channels[channelId];
require(caller == ch.consumer || caller == ch.provider, 'Not a channel party');
// ... rest of logic using `caller` instead of msg.sender
}"

4. KiteAAWallet — Deprecation

4.1 What KiteAAWallet Did That Now Lives Elsewhere

KiteAAWallet Function Replaced By Where
register() Vault deployment via SDK SDK + gokite-aa-sdk
deposit(token, amount) Transfer direct to vault address ERC-20 transfer
withdraw(token, amount) withdrawDepositTo() on vault ClientAgentVault
executePayment() executeTransferWithAuthorizationAndProvider() ClientAgentVault
addSessionKeyRule() createSession() + addSpendingRules() + registerSession() Vault + IdentityRegistry
revokeSessionKey() removeSession() on vault + revokeSession() on registry Both
setBlockedProvider() Stays in IdentityRegistry blockedAgents IdentityRegistry
withdrawForChannel() ERC-20 transferFrom(vault, channel, amount) PaymentChannel
refundFromChannel() ERC-20 transfer(channel, vault, amount) PaymentChannel
isRegistered() vault.sessionExists() ClientAgentVault
getUserBalance() vault.getAvailableBalance(token) ClientAgentVault
isProviderBlocked() IdentityRegistry.isAgentBlocked() IdentityRegistry
identityRegistry() Hardcoded in PaymentChannel constructor PaymentChannel

5. SDK / Backend Changes
   5.1 Session Setup — Batch UserOp
   When a user creates a new session, three things must happen atomically in one UserOp batch:
   vault.createSession(sessionKey, ...) — register session key in vault
   vault.addSpendingRules([...]) — set budget, time window, allowed providers
   identityRegistry.registerSession(agentId, sessionKey, user, vault, validUntil, blockedAgents) — register identity

"// src/session/createSession.ts
import { encodeFunctionData, type Address } from 'viem';
import { CLIENT_AGENT_VAULT_ABI } from '../abis/ClientAgentVault.abi';
import { IDENTITY_REGISTRY_ABI } from '../abis/IdentityRegistry.abi';

export async function createSessionGasless(
sdk: GokiteAASDK,
aaWallet: Address,
signFunction: (hash: string) => Promise<string>,
params: {
agentId: bigint;
sessionKey: Address;
validUntil: number;
budget: bigint; // max spend per timeWindow
timeWindow: bigint; // seconds, e.g. 86400n for 24hrs
targetProviders: Address[]; // [] = all allowed
blockedAgents: bigint[];
token: Address;
}
) {
const now = BigInt(Math.floor(Date.now() / 1000));

const createSessionData = encodeFunctionData({
abi: CLIENT_AGENT_VAULT_ABI,
functionName: 'createSession',
args: [params.sessionKey /*, confirm other args from ABI */],
});

const addSpendingRulesData = encodeFunctionData({
abi: CLIENT_AGENT_VAULT_ABI,
functionName: 'addSpendingRules',
args: [[{
      timeWindow: params.timeWindow,
      budget: params.budget,
      initialWindowStartTime: now,
      targetProviders: params.targetProviders,
    }]],
});

const registerSessionData = encodeFunctionData({
abi: IDENTITY_REGISTRY_ABI,
functionName: 'registerSession',
args: [
params.agentId,
params.sessionKey,
ownerAddress, // EOA user
aaWallet, // walletContract = vault
BigInt(params.validUntil),
params.blockedAgents,
],
});

return sdk.sendUserOperationAndWait(
aaWallet,
{
targets: [aaWallet, aaWallet, IDENTITY_REGISTRY_ADDRESS],
values: [0n, 0n, 0n],
callDatas: [createSessionData, addSpendingRulesData, registerSessionData],
},
signFunction,
undefined,
paymasterAddress,
{ maxRetries: 80, interval: 6000 },
);
}"

5.2 Open Channel — Batch approve + openChannel
PaymentChannel.openChannel calls transferFrom(vault, channel, deposit). The vault must approve PaymentChannel first. Batch both into one UserOp.

"// src/channel/openChannel.ts
export async function openChannelGasless(
sdk: GokiteAASDK,
aaWallet: Address,
signFunction: (hash: string) => Promise<string>,
params: {
provider: Address;
token: Address;
mode: 0 | 1; // 0 = Prepaid, 1 = Postpaid
deposit: bigint;
maxSpend: bigint;
maxDuration: bigint;
maxPerCall: bigint;
}
) {
const approveData = encodeFunctionData({
abi: ERC20_ABI,
functionName: 'approve',
args: [PAYMENT_CHANNEL_ADDRESS, params.maxSpend], // approve maxSpend not just deposit
// maxSpend covers both prepaid deposit and postpaid settlement
});

const openChannelData = encodeFunctionData({
abi: PAYMENT_CHANNEL_ABI,
functionName: 'openChannel',
args: [
params.provider,
params.token,
params.mode,
params.deposit,
params.maxSpend,
params.maxDuration,
params.maxPerCall,
aaWallet, // walletContract = vault
],
});

return sdk.sendUserOperationAndWait(
aaWallet,
{
targets: [params.token, PAYMENT_CHANNEL_ADDRESS],
values: [0n, 0n],
callDatas: [approveData, openChannelData],
},
signFunction,
undefined,
paymasterAddress,
{ maxRetries: 80, interval: 6000 },
);
}"

5.3 Gasless Settlement Calls
initiateSettlement, approveSettlement, submitReceipt — session key signs, provider backend submits via executeForSession. Session key pays no gas.

"// src/channel/settlement.ts
export async function initiateSettlementGasless(
sessionKey: WalletClient,
providerBackend: WalletClient, // pays gas
channelId: Hex,
seq: bigint, cost: bigint, ts: number,
providerSig: Hex, merkleRoot: Hex,
) {
const nonce = await publicClient.readContract({
address: PAYMENT_CHANNEL_ADDRESS,
abi: PAYMENT_CHANNEL_ABI,
functionName: 'sessionNonces',
args: [sessionKey.account.address],
});
const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

const params = encodeAbiParameters(
parseAbiParameters('uint256,uint256,uint256,bytes,bytes32'),
[seq, cost, BigInt(ts), providerSig, merkleRoot]
);

// Session key signs (free — no gas)
const sig = await sessionKey.signTypedData({
domain: { name: 'PaymentChannel', version: '1', chainId: CHAIN_ID,
verifyingContract: PAYMENT_CHANNEL_ADDRESS },
types: { ForwardedCall: [
{ name: 'channelId', type: 'bytes32' },
{ name: 'selector', type: 'bytes4' },
{ name: 'paramsHash', type: 'bytes32' },
{ name: 'nonce', type: 'uint256' },
{ name: 'deadline', type: 'uint256' },
]},
primaryType: 'ForwardedCall',
message: {
channelId,
selector: INITIATE_SETTLEMENT_SELECTOR,
paramsHash: keccak256(params),
nonce,
deadline,
},
});

// Provider backend submits (pays gas)
return providerBackend.writeContract({
address: PAYMENT_CHANNEL_ADDRESS,
abi: PAYMENT_CHANNEL_ABI,
functionName: 'executeForSession',
args: [sessionKey.account.address, channelId,
INITIATE_SETTLEMENT_SELECTOR, params, nonce, deadline, sig],
});
}"

5.4 Add sendAndWait Helper (Replace SDK Polling)
The SDK's sendUserOperationAndWait has a hardcoded polling limit. Replace it with a custom poller that waits up to 10 minutes.

"// src/utils/sendAndWait.ts
export async function sendAndWait(
sdk: GokiteAASDK,
aaWallet: Address,
request: any,
signFunction: (h: string) => Promise<string>,
paymasterAddress?: string,
maxMinutes = 10,
) {
const userOpHash = await sdk.sendUserOperation(
aaWallet, request, signFunction, undefined, paymasterAddress,
);
console.log('UserOp sent:', userOpHash);

const maxAttempts = (maxMinutes \* 60_000) / 5_000;
for (let i = 0; i < maxAttempts; i++) {
await new Promise(r => setTimeout(r, 5_000));
const res = await fetch(BUNDLER_URL, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getUserOperationReceipt',
params: [userOpHash], id: 1 }),
});
const { result } = await res.json();
console.log(`Attempt ${i+1}/${maxAttempts}: ${result ? 'confirmed' : 'pending'}`);
if (!result) continue;
if (!result.success) throw new Error(`UserOp reverted: ${result.reason}`);
return { userOpHash, txHash: result.receipt.transactionHash,
blockNumber: result.receipt.blockNumber };
}
throw new Error(`UserOp not confirmed after ${maxMinutes} minutes: ${userOpHash}`);
}"

6. Deployment Order

Step Contract Constructor Args Notes
1 IdentityRegistry (V2) None Deploy first — address needed by PaymentChannel
2 PaymentChannel (V2) \_identityRegistry = step 1 address Constructor now takes registry address
3 ClientAgentVault (via SDK) SDK handles deployment via UserOp One per user — deployed by gokite-aa-sdk
4 KiteAAWallet (V1) Keep deployed, stop using for new channels Do not redeploy — old channels still reference it

7. Testing Checklist
   7.1 IdentityRegistry
   registerSession succeeds without valueLimit / maxValueAllowed params
   validateSession returns 5 values (not 7) — no valueLimit, no maxValueAllowed
   revokeSession still works
   Old sessions (registered against V1 wallet) still validate correctly via V1 registry

7.2 PaymentChannel
openChannel — prepaid: transferFrom(vault, channel, deposit) succeeds after approve
openChannel — prepaid: reverts if vault has not approved channel
openChannel — vault.checkSpendingRules() revert propagates correctly
openChannel — session validUntil enforced correctly
\_settle — refund transfers directly to vault address, not to session key
\_settle — postpaid pulls from vault (walletContract), not consumer (session key)
executeForSession — initiateSettlement via signed session key payload
executeForSession — approveSettlement via signed session key payload
executeForSession — submitReceipt via signed session key payload
executeForSession — reverts if session key is expired
executeForSession — reverts on replayed nonce
Direct calls (provider paying gas) still work unchanged

7.3 SDK Integration
createSessionGasless — all 3 calls batch into one UserOp, all succeed
openChannelGasless — approve + openChannel batch succeeds
initiateSettlementGasless — session key signs, provider submits, channel moves to SettlementPending
approveSettlementGasless — channel finalizes immediately without waiting 1 hour
Polling: sendAndWait helper confirms within 10 minutes on testnet
Sponsorship: estimate returns sponsorshipAvailable = true before each op

7.4 End-to-End Flow
Deploy IdentityRegistry V2 + PaymentChannel V2
Create vault via SDK — verify vault address
Fund vault with test USDC
createSessionGasless — verify session in vault + registry
openChannelGasless — verify deposit locked in PaymentChannel
Simulate N API calls — accumulate receipts
initiateSettlementGasless — verify SettlementInitiated event
approveSettlementGasless — verify ChannelFinalized event
Verify provider received payment
Verify vault received refund (remaining deposit)

8. Open Questions (Resolve Before Implementing)

9. File Change Summary
   Quick reference for what changes in each file:
