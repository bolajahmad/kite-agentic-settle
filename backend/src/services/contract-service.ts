import { ethers } from "ethers";
import { AttestationRegistryABI } from "../contracts/abi/AttestationRegistry.js";
import { ClientAgentVaultABI } from "../contracts/abi/ClientAgentVaultABI.js";
import { IdentityRegistryABI } from "../contracts/abi/IdentityRegistryABI.js";
import { KiteAAWalletABI } from "../contracts/abi/KiteAAWalletABI.js";
import { PaymentChannelABI } from "../contracts/abi/PaymentChannelABI.js";
import { getSession } from "./channel-session.js";

// ─── Provider & Signer ────────────────────────────────────────────────

const RPC_URL = process.env.KITE_TESTNET_RPC || "https://rpc-testnet.gokite.ai";
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY;

let provider: ethers.JsonRpcProvider;
let signer: ethers.Wallet | undefined;

export function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    // Use a static network to prevent ethers from polling chain-ID on every
    // request. We also disable the internal block-polling subscription because
    // the Kite testnet drops eth_newFilter immediately ("filter not found").
    provider = new ethers.JsonRpcProvider(RPC_URL, undefined, {
      staticNetwork: true,
      polling: false,
    } as any);
  }
  return provider;
}

export function getSigner(): ethers.Wallet {
  if (!signer) {
    if (!DEPLOYER_KEY) {
      throw new Error("DEPLOYER_PRIVATE_KEY not set in environment");
    }
    signer = new ethers.Wallet(DEPLOYER_KEY, getProvider());
  }
  return signer;
}

// ─── Contract Instances ───────────────────────────────────────────────

function getContractAddress(envVar: string): string {
  const addr = process.env[envVar];
  if (!addr) throw new Error(`${envVar} not set in environment`);
  return addr;
}

export function getIdentityRegistry(
  signerOrProvider?: ethers.Signer | ethers.Provider,
) {
  return new ethers.Contract(
    getContractAddress("IDENTITY_REGISTRY_ADDRESS"),
    IdentityRegistryABI,
    signerOrProvider ?? getSigner(),
  );
}

export function getKiteAAWallet(
  signerOrProvider?: ethers.Signer | ethers.Provider,
) {
  return new ethers.Contract(
    getContractAddress("KITE_AA_WALLET_ADDRESS"),
    KiteAAWalletABI,
    signerOrProvider ?? getSigner(),
  );
}

export function getClientAgentVault(
  walletContract: string,
  signerOrProvider?: ethers.Signer | ethers.Provider,
) {
  return new ethers.Contract(
    walletContract,
    ClientAgentVaultABI,
    signerOrProvider ?? getSigner(),
  );
}

export function getAttestationRegistry(
  signerOrProvider?: ethers.Signer | ethers.Provider,
) {
  return new ethers.Contract(
    getContractAddress("ATTESTATION_REGISTRY_ADDRESS"),
    AttestationRegistryABI,
    signerOrProvider ?? getSigner(),
  );
}

export function getPaymentChannel(
  signerOrProvider?: ethers.Signer | ethers.Provider,
) {
  return new ethers.Contract(
    getContractAddress("PAYMENT_CHANNEL_ADDRESS"),
    PaymentChannelABI,
    signerOrProvider ?? getSigner(),
  );
}

// ─── Identity Registry Operations ────────────────────────────────────────

export async function registerAgentOnChain(
  agentId: string,
  agentDomain: string,
  agentAddress: string,
  walletContract: string,
) {
  const registry = getIdentityRegistry();
  const agentIdBytes32 = ethers.id(agentId);
  const tx = await registry.registerAgent(
    agentIdBytes32,
    agentDomain,
    agentAddress,
    walletContract,
  );
  const receipt = await tx.wait();
  return { txHash: receipt.hash, agentIdBytes32 };
}

export async function getAgentFromChain(agentId: string) {
  const registry = getIdentityRegistry(getProvider());
  const agentIdBytes32 = ethers.id(agentId);
  const [agentDomain, agentAddress, walletContract, ownerAddr, active] =
    await registry.getAgent(agentIdBytes32);
  return { agentDomain, agentAddress, walletContract, ownerAddr, active };
}

export async function resolveAgentByDomainOnChain(domain: string) {
  const registry = getIdentityRegistry(getProvider());
  const [agentId, agentAddress, walletContract, active] =
    await registry.resolveAgentByDomain(domain);
  return { agentId, agentAddress, walletContract, active };
}

export async function registerSessionOnChain(
  agentId: string,
  sessionKeyAddress: string,
  validUntil: number,
) {
  const registry = getIdentityRegistry();
  const agentIdBytes32 = ethers.id(agentId);
  const tx = await registry.registerSession(
    agentIdBytes32,
    sessionKeyAddress,
    validUntil,
  );
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

// ─── KiteAAWallet Operations ──────────────────────────────────────────

export async function addSessionKeyRuleOnChain(
  sessionKeyAddress: string,
  agentId: string,
  valueLimit: bigint,
  dailyLimit: bigint,
  validUntil: number,
  blockedProviders: string[],
) {
  const wallet = getKiteAAWallet();
  const agentIdBytes32 = ethers.id(agentId);
  const tx = await wallet.addSessionKeyRule(
    sessionKeyAddress,
    agentIdBytes32,
    valueLimit,
    dailyLimit,
    validUntil,
    blockedProviders,
  );
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

/**
 * Execute a payment on-chain by submitting the session-key-signed EIP-712
 * authorisation.  The facilitator (backend signer) pays gas; the agent's
 * user balance in KiteAAWallet is debited.
 *
 * sig is the full 65-byte hex signature from the agent's signTypedData call.
 */
export async function executePaymentOnChain(
  agentId: bigint,
  sessionKey: string,
  recipient: string,
  token: string,
  amount: bigint,
  nonce: bigint,
  deadline: bigint,
  sig: string,
) {
  const wallet = getKiteAAWallet();
  const tx = await wallet.executePayment(
    agentId,
    sessionKey,
    recipient,
    token,
    amount,
    nonce,
    deadline,
    sig,
  );
  const receipt = await tx.wait();
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
}

export interface TransferAuthorization {
  from: string;
  to: string;
  token: string;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: string;
}

/**
 * Settle via ClientAgentVault using session-scoped TransferWithAuthorization.
 */
export async function executeTransferWithAuthorizationOnChain(
  walletContract: string,
  sessionId: string,
  auth: TransferAuthorization,
  sig: string,
  metadata: string = "0x",
) {
  const vault = getClientAgentVault(walletContract);
  const tx = await vault.executeTransferWithAuthorization(
    sessionId,
    {
      from: auth.from,
      to: auth.to,
      token: auth.token,
      value: auth.value,
      validAfter: auth.validAfter,
      validBefore: auth.validBefore,
      nonce: auth.nonce,
    },
    sig,
    metadata,
  );
  const receipt = await tx.wait();
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
}

/** Pre-flight replay check — returns true when the nonce was already consumed. */
export async function isNonceUsedOnChain(
  sessionKey: string,
  nonce: bigint,
): Promise<boolean> {
  const wallet = getKiteAAWallet(getProvider());
  return Boolean(await wallet.isNonceUsed(sessionKey, nonce));
}

/** Pre-flight replay check for vault TransferWithAuthorization nonces (bytes32). */
export async function isVaultNonceUsedOnChain(
  walletContract: string,
  nonce: string,
): Promise<boolean> {
  const vault = getClientAgentVault(walletContract, getProvider());
  return Boolean(await vault.isNonceUsed(nonce));
}

/** Read session status from IdentityRegistry. */
export async function validateSessionOnChain(sessionKey: string): Promise<{
  active: boolean;
  agentId: bigint;
  user: string;
  walletContract: string;
  validUntil: bigint;
}> {
  const registry = getIdentityRegistry(getProvider());
  const [active, agentId, user, walletContract, validUntil] =
    await registry.validateSession(sessionKey);
  return {
    active: Boolean(active),
    agentId: BigInt(agentId),
    user,
    walletContract,
    validUntil: BigInt(validUntil),
  };
}

export async function getSessionRuleFromChain(sessionKeyAddress: string) {
  const wallet = getKiteAAWallet(getProvider());
  const [agentId, valueLimit, dailyLimit, validUntil, active] =
    await wallet.getSessionRule(sessionKeyAddress);
  return {
    agentId,
    valueLimit: valueLimit.toString(),
    dailyLimit: dailyLimit.toString(),
    validUntil: Number(validUntil),
    active,
  };
}

export async function revokeSessionKeyOnChain(sessionKeyAddress: string) {
  const wallet = getKiteAAWallet();
  const tx = await wallet.revokeSessionKey(sessionKeyAddress);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

export async function depositToWallet(token: string, amount: bigint) {
  const wallet = getKiteAAWallet();
  // First approve the wallet to spend tokens
  const tokenContract = new ethers.Contract(
    token,
    ["function approve(address spender, uint256 amount) returns (bool)"],
    getSigner(),
  );
  const approveTx = await tokenContract.approve(
    await wallet.getAddress(),
    amount,
  );
  await approveTx.wait();

  const tx = await wallet.deposit(token, amount);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

// ─── AnchorMerkle Operations ──────────────────────────────────────────

export async function anchorMerkleRoot(
  merkleRoot: string,
  logCount: number,
  metadata: string,
  agentIds: string[],
) {
  const merkle = getAttestationRegistry();
  const agentIdBytes32 = agentIds.map((id) => ethers.id(id));
  const tx = await merkle.anchorRoot(
    merkleRoot,
    logCount,
    metadata,
    agentIdBytes32,
  );
  const receipt = await tx.wait();
  return {
    txHash: receipt.hash,
    anchorIndex: receipt.logs.length > 0 ? receipt.logs[0] : null,
  };
}

export async function verifyLeafOnChain(
  anchorIndex: number,
  leaf: string,
  proof: string[],
) {
  const merkle = getAttestationRegistry();
  const tx = await merkle.verifyLeaf(anchorIndex, leaf, proof);
  const receipt = await tx.wait();
  // Parse the LeafVerified event
  const iface = new ethers.Interface(AttestationRegistryABI);
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      if (parsed?.name === "LeafVerified") {
        return { valid: parsed.args.valid, txHash: receipt.hash };
      }
    } catch {
      continue;
    }
  }
  return { valid: false, txHash: receipt.hash };
}

// ─── PaymentChannel Operations ────────────────────────────────────────

export async function openChannelOnChain(
  provider: string,
  token: string,
  mode: number, // 0 = Prepaid, 1 = Postpaid
  deposit: bigint,
  maxSpend: bigint,
  maxDuration: number,
  maxPerCall: bigint,
  user: string, // EOA whose KiteAAWallet balance is debited
  walletContract: string, // KiteAAWallet contract address
) {
  const pc = getPaymentChannel();

  // No ERC20 approve needed — KiteAAWallet.withdrawForChannel transfers
  // directly from the wallet contract to PaymentChannel.

  const tx = await pc.openChannel(
    provider,
    token,
    mode,
    deposit,
    maxSpend,
    maxDuration,
    maxPerCall,
    user,
    walletContract,
  );
  const receipt = await tx.wait();

  // Extract channelId from ChannelOpened event
  const iface = new ethers.Interface(PaymentChannelABI);
  let channelId: string | undefined;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      if (parsed?.name === "ChannelOpened") {
        channelId = parsed.args.channelId;
        break;
      }
    } catch {
      continue;
    }
  }

  return { txHash: receipt.hash, channelId };
}

export async function activateChannelOnChain(channelId: string) {
  const pc = getPaymentChannel();
  const tx = await pc.activateChannel(channelId);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

export async function initiateSettlementOnChain(
  channelId: string,
  sequenceNumber: number,
  cumulativeCost: bigint,
  timestamp: number,
  providerSignature: string,
  merkleRoot: string = "0x0000000000000000000000000000000000000000000000000000000000000000",
) {
  const pc = getPaymentChannel();
  const tx = await pc.initiateSettlement(
    channelId,
    sequenceNumber,
    cumulativeCost,
    timestamp,
    providerSignature,
    merkleRoot,
  );
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

export async function submitReceiptOnChain(
  channelId: string,
  sequenceNumber: number,
  cumulativeCost: bigint,
  timestamp: number,
  providerSignature: string,
) {
  const pc = getPaymentChannel();
  const tx = await pc.submitReceipt(
    channelId,
    sequenceNumber,
    cumulativeCost,
    timestamp,
    providerSignature,
  );
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

export async function approveSettlementOnChain(channelId: string) {
  const pc = getPaymentChannel();
  const tx = await pc.approveSettlement(channelId);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

export async function finalizeOnChain(
  channelId: string,
  merkleRoot: string = "0x0000000000000000000000000000000000000000000000000000000000000000",
) {
  const pc = getPaymentChannel();
  const tx = await pc.finalize(channelId, merkleRoot);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

export async function forceCloseExpiredOnChain(channelId: string) {
  const pc = getPaymentChannel();
  const tx = await pc.forceCloseExpired(channelId);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

export async function getChannelOnChain(channelId: string) {
  const pc = getPaymentChannel(getProvider());
  const [
    consumer,
    user,
    provider,
    token,
    mode,
    deposit,
    maxSpend,
    maxDuration,
    openedAt,
    expiresAt,
    maxPerCall,
    settledAmount,
    status,
    settlementDeadline,
    highestClaimedCost,
    highestSequenceNumber,
    wallet,
    lastReceiptSubmitter,
  ] = await pc.getChannel(channelId);
  return {
    consumer,
    provider,
    user,
    token,
    mode: Number(mode),
    deposit: deposit.toString(),
    maxSpend: maxSpend.toString(),
    maxDuration: Number(maxDuration),
    openedAt: Number(openedAt),
    expiresAt: Number(expiresAt),
    maxPerCall: maxPerCall.toString(),
    settledAmount: settledAmount.toString(),
    status: Number(status),
    settlementDeadline: Number(settlementDeadline),
    highestClaimedCost: highestClaimedCost.toString(),
    highestSequenceNumber: Number(highestSequenceNumber),
    wallet,
    lastReceiptSubmitter,
  };
}

export async function getSettlementStateOnChain(channelId: string) {
  const pc = getPaymentChannel(getProvider());
  const [deadline, highestCost, highestSeq, initiator, challengeOpen] =
    await pc.getSettlementState(channelId);
  return {
    deadline: Number(deadline),
    highestCost: highestCost.toString(),
    highestSeq: Number(highestSeq),
    initiator,
    challengeOpen,
  };
}

export async function isChannelExpiredOnChain(
  channelId: string,
): Promise<boolean> {
  const pc = getPaymentChannel(getProvider());
  return await pc.isChannelExpired(channelId);
}

export async function getChannelTimeRemainingOnChain(
  channelId: string,
): Promise<number> {
  const pc = getPaymentChannel(getProvider());
  const remaining = await pc.getChannelTimeRemaining(channelId);
  return Number(remaining);
}

export async function getReceiptHashOnChain(
  channelId: string,
  sequenceNumber: number,
  cumulativeCost: bigint,
  timestamp: number,
): Promise<string> {
  const pc = getPaymentChannel(getProvider());
  return await pc.getReceiptHash(
    channelId,
    sequenceNumber,
    cumulativeCost,
    timestamp,
  );
}

export async function getLockedFundsOnChain(
  wallet: string,
  token: string,
): Promise<string> {
  const pc = getPaymentChannel(getProvider());
  const locked = await pc.getLockedFunds(wallet, token);
  return locked.toString();
}

// ─── Wallet Read Operations ───────────────────────────────────────────

export async function getWalletBalance(token: string): Promise<string> {
  const walletAddress = getContractAddress("KITE_AA_WALLET_ADDRESS");
  const tokenContract = new ethers.Contract(
    token,
    ["function balanceOf(address) view returns (uint256)"],
    getProvider(),
  );
  const balance = await tokenContract.balanceOf(walletAddress);
  return balance.toString();
}

export async function isSessionValidOnChain(
  sessionKeyAddress: string,
): Promise<boolean> {
  const wallet = getKiteAAWallet(getProvider());
  return await wallet.isSessionValid(sessionKeyAddress);
}

export async function getDailySpendOnChain(
  sessionKeyAddress: string,
): Promise<string> {
  const wallet = getKiteAAWallet(getProvider());
  const spend = await wallet.getDailySpend(sessionKeyAddress);
  return spend.toString();
}

// ─── Channel Auto-Activation Watcher ─────────────────────────────────

/**
 * Watch for `ChannelOpened` events whose `provider` matches our
 * `KITE_AA_WALLET_ADDRESS` and automatically call `activateChannel` so that
 * the SDK's `waitForChannelActive` poll resolves promptly.
 *
 * Uses `getLogs` polling instead of `eth_newFilter` because the Kite testnet
 * RPC drops persistent filters immediately ("filter not found").
 *
 * Returns a cleanup function that stops the polling interval.
 */
export function startChannelWatcher(): () => void {
  if (
    !process.env.PAYMENT_CHANNEL_ADDRESS ||
    !process.env.DEPLOYER_PRIVATE_KEY
  ) {
    console.log(
      "[ChannelWatcher] Skipping — PAYMENT_CHANNEL_ADDRESS or DEPLOYER_PRIVATE_KEY not set.",
    );
    return () => {};
  }
  // The channel provider is always the backend's signing address (deployer key).
  // The channel watcher must filter by that address — NOT KITE_AA_WALLET_ADDRESS.
  const providerAddress = getSigner().address;

  const pc = getPaymentChannel(getProvider());
  const iface = new ethers.Interface(PaymentChannelABI);
  const activatedChannels = new Set<string>();
  let lastBlock = 0;
  let stopped = false;

  const poll = async () => {
    if (stopped) return;
    try {
      const currentBlock = await getProvider().getBlockNumber();
      if (lastBlock === 0) {
        // On first run, only watch from current block forward
        lastBlock = currentBlock;
        return;
      }
      if (currentBlock <= lastBlock) return;

      const logs = await getProvider().getLogs({
        address: process.env.PAYMENT_CHANNEL_ADDRESS,
        fromBlock: lastBlock + 1,
        toBlock: currentBlock,
      });

      for (const log of logs) {
        let parsed: ethers.LogDescription | null = null;
        try {
          parsed = iface.parseLog({
            topics: log.topics as string[],
            data: log.data,
          });
        } catch {
          continue;
        }

        if (parsed?.name !== "ChannelOpened") continue;

        const channelId: string = parsed.args.channelId;
        const provider: string = parsed.args.provider;

        if (provider.toLowerCase() !== providerAddress.toLowerCase()) continue;
        if (activatedChannels.has(channelId)) continue;
        activatedChannels.add(channelId);

        console.log(
          `[ChannelWatcher] ChannelOpened: channelId=${channelId}, provider=${provider}. Activating...`,
        );
        activateChannelOnChain(channelId)
          .then(({ txHash }) => {
            console.log(
              `[ChannelWatcher] Channel ${channelId} activated. Tx: ${txHash}`,
            );
          })
          .catch((err: any) => {
            console.error(
              `[ChannelWatcher] Failed to activate channel ${channelId}: ${err.message}`,
            );
          });
      }

      lastBlock = currentBlock;
    } catch (err: any) {
      // Non-fatal — just log and continue polling
      console.error(`[ChannelWatcher] Poll error: ${err.message}`);
    }
  };

  const interval = setInterval(poll, 5_000);
  console.log(
    "[ChannelWatcher] Started — polling every 5s for ChannelOpened events.",
  );

  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

// ─── Settlement Cooperative Watcher ──────────────────────────────────

/**
 * Watch for settlement-related events and respond cooperatively:
 *   - SettlementInitiated: Check if consumer under-claimed, submit higher receipt if needed
 *   - ReceiptSubmitted: Log counter-receipt submissions
 *   - SettlementApproved: Log successful cooperative settlement
 *
 * Provider strategy:
 *   1. If consumer's claim matches our records → approve settlement (fast-path)
 *   2. If consumer under-claimed → submit our higher receipt
 *   3. If consumer over-claimed → submit correct receipt as defense
 *
 * Returns a cleanup function that stops the polling interval.
 */
export function startSettlementWatcher(): () => void {
  if (
    !process.env.PAYMENT_CHANNEL_ADDRESS ||
    !process.env.DEPLOYER_PRIVATE_KEY
  ) {
    console.log(
      "[SettlementWatcher] Skipping — PAYMENT_CHANNEL_ADDRESS or DEPLOYER_PRIVATE_KEY not set.",
    );
    return () => {};
  }

  const providerAddress = getSigner().address;
  const iface = new ethers.Interface(PaymentChannelABI);
  const processedSettlements = new Set<string>(); // Track processed channelIds to avoid duplicates
  let lastBlock = 0;
  let stopped = false;

  const poll = async () => {
    if (stopped) return;
    try {
      const currentBlock = await getProvider().getBlockNumber();
      if (lastBlock === 0) {
        lastBlock = currentBlock;
        return;
      }
      if (currentBlock <= lastBlock) return;

      const logs = await getProvider().getLogs({
        address: process.env.PAYMENT_CHANNEL_ADDRESS,
        fromBlock: lastBlock + 1,
        toBlock: currentBlock,
      });

      for (const log of logs) {
        let parsed: ethers.LogDescription | null = null;
        try {
          parsed = iface.parseLog({
            topics: log.topics as string[],
            data: log.data,
          });
        } catch {
          continue;
        }

        // Handle SettlementInitiated event
        if (parsed?.name === "SettlementInitiated") {
          const channelId: string = parsed.args.channelId;
          const initiator: string = parsed.args.initiator;
          const claimedAmount: bigint = parsed.args.claimedAmount;
          const settlementDeadline: bigint = parsed.args.settlementDeadline;

          // Avoid re-processing same settlement
          if (processedSettlements.has(channelId)) continue;
          processedSettlements.add(channelId);

          console.log(
            `[SettlementWatcher] SettlementInitiated: channelId=${channelId}, ` +
              `initiator=${initiator}, claimedAmount=${claimedAmount}, ` +
              `deadline=${new Date(Number(settlementDeadline) * 1000).toISOString()}`,
          );

          // Check if we are the provider for this channel (on-chain fetch)
          const channelData = await getChannelOnChain(channelId);
          if (channelData.provider.toLowerCase() !== providerAddress.toLowerCase()) {
            console.log(`[SettlementWatcher] Not our channel (provider=${channelData.provider}), ignoring`);
            continue;
          }

          // Resolve the consumer (= session key) and agent identity from on-chain,
          // mirroring the CLI pattern of using channel data rather than local state.
          const sessionKeyAddress = channelData.consumer;
          try {
            const agentInfo = await getAgentBySessionOnChain(sessionKeyAddress);
            console.log(
              `[SettlementWatcher] Agent: ${agentInfo.agentDomain} (id=${agentInfo.agentId}), ` +
                `sessionKey=${sessionKeyAddress}`,
            );
          } catch {
            console.log(`[SettlementWatcher] Session key: ${sessionKeyAddress} (agent lookup failed)`);
          }

          // Try local session first (populated by requireChannelPayment middleware).
          // Fall back gracefully when the channel was opened externally — in that
          // case the contract has already validated our signature on the receipt, so
          // we can safely approve without re-checking the amounts locally.
          const session = getSession(channelId);
          if (!session?.lastReceipt) {
            console.log(
              `[SettlementWatcher] No local receipt record for ${channelId} — ` +
                `approving (signature already verified on-chain by contract)`,
            );
            try {
              const { txHash } = await approveSettlementOnChain(channelId);
              console.log(`[SettlementWatcher] ✅ Settlement approved. Tx: ${txHash}`);
            } catch (err: any) {
              console.error(`[SettlementWatcher] ❌ Failed to approve: ${err.message}`);
              console.log(`[SettlementWatcher] Will wait for challenge window to expire naturally`);
            }
            continue;
          }

          const ourHighestCost = BigInt(session.lastReceipt.cumulativeCost);
          const ourHighestSeq = session.lastReceipt.sequenceNumber;

          console.log(
            `[SettlementWatcher] Our records: seq=${ourHighestSeq}, cost=${ourHighestCost}`,
          );
          console.log(
            `[SettlementWatcher] On-chain claim: cost=${claimedAmount}`,
          );

          // Compare amounts and decide action
          if (ourHighestCost > claimedAmount) {
            // Consumer under-claimed! Submit our higher receipt
            console.log(
              `[SettlementWatcher] ⚠️  Consumer under-claimed. Submitting higher receipt...`,
            );

            try {
              const { txHash } = await submitReceiptOnChain(
                channelId,
                ourHighestSeq,
                ourHighestCost,
                session.lastReceipt.timestamp,
                session.lastReceipt.providerSignature,
              );
              console.log(
                `[SettlementWatcher] ✅ Higher receipt submitted. Tx: ${txHash}`,
              );
            } catch (err: any) {
              console.error(
                `[SettlementWatcher] ❌ Failed to submit receipt: ${err.message}`,
              );
            }
          } else if (ourHighestCost < claimedAmount) {
            // Consumer over-claimed! This is suspicious - submit our correct receipt
            console.warn(
              `[SettlementWatcher] 🚨 Consumer over-claimed! ` +
                `Claimed ${claimedAmount} but we only have ${ourHighestCost}`,
            );
            console.warn(
              `[SettlementWatcher] Submitting our highest valid receipt as defense...`,
            );

            try {
              const { txHash } = await submitReceiptOnChain(
                channelId,
                ourHighestSeq,
                ourHighestCost,
                session.lastReceipt.timestamp,
                session.lastReceipt.providerSignature,
              );
              console.log(
                `[SettlementWatcher] ✅ Defense receipt submitted. Tx: ${txHash}`,
              );
            } catch (err: any) {
              console.error(
                `[SettlementWatcher] ❌ Failed to submit defense: ${err.message}`,
              );
            }
          } else {
            // Perfect match! Approve settlement for fast-path
            console.log(
              `[SettlementWatcher] ✅ Amounts match perfectly. Approving settlement...`,
            );

            try {
              // Call approveSettlement to skip challenge window
              const { txHash } = await approveSettlementOnChain(channelId);
              console.log(
                `[SettlementWatcher] ✅ Settlement approved (fast-path). Tx: ${txHash}`,
              );
            } catch (err: any) {
              console.error(
                `[SettlementWatcher] ❌ Failed to approve settlement: ${err.message}`,
              );
              console.log(
                `[SettlementWatcher] Will wait for challenge window to expire naturally`,
              );
            }
          }
        }

        // Handle ReceiptSubmitted event (counter-receipt)
        if (parsed?.name === "ReceiptSubmitted") {
          const channelId: string = parsed.args.channelId;
          const submitter: string = parsed.args.submitter;
          const sequenceNumber: bigint = parsed.args.sequenceNumber;
          const cumulativeCost: bigint = parsed.args.cumulativeCost;

          console.log(
            `[SettlementWatcher] ReceiptSubmitted: channelId=${channelId}, ` +
              `submitter=${submitter}, seq=${sequenceNumber}, cost=${cumulativeCost}`,
          );

          // Check if this is a counter-receipt from consumer
          const channelData = await getChannelOnChain(channelId);
          if (
            channelData.provider.toLowerCase() === providerAddress.toLowerCase() &&
            submitter.toLowerCase() !== providerAddress.toLowerCase()
          ) {
            console.log(
              `[SettlementWatcher] Consumer submitted counter-receipt. ` +
                `Consider responding if amount is incorrect.`,
            );
          }
        }

        // Handle SettlementApproved event
        if (parsed?.name === "SettlementApproved") {
          const channelId: string = parsed.args.channelId;
          const approver: string = parsed.args.approver;
          const finalAmount: bigint = parsed.args.finalAmount;

          console.log(
            `[SettlementWatcher] ✅ SettlementApproved: channelId=${channelId}, ` +
              `approver=${approver}, finalAmount=${finalAmount}`,
          );
          console.log(
            `[SettlementWatcher] Channel settled cooperatively (fast-path)`,
          );
        }

        // Handle ChannelFinalized event
        if (parsed?.name === "ChannelFinalized") {
          const channelId: string = parsed.args.channelId;
          const payment: bigint = parsed.args.payment;
          const refund: bigint = parsed.args.refund;

          console.log(
            `[SettlementWatcher] ChannelFinalized: channelId=${channelId}, ` +
              `payment=${payment}, refund=${refund}`,
          );

          // Clean up processed settlements set
          processedSettlements.delete(channelId);
        }
      }

      lastBlock = currentBlock;
    } catch (err: any) {
      // Non-fatal — just log and continue polling
      console.error(`[SettlementWatcher] Poll error: ${err.message}`);
    }
  };

  const interval = setInterval(poll, 5_000);
  console.log(
    "[SettlementWatcher] Started — polling every 5s for settlement events.",
  );

  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

export async function getAgentSessionKeysOnChain(
  agentId: string,
): Promise<string[]> {
  const wallet = getKiteAAWallet(getProvider());
  const agentIdBytes32 = ethers.id(agentId);
  return await wallet.getAgentSessionKeys(agentIdBytes32);
}

export async function withdrawFromWallet(token: string, amount: bigint) {
  const wallet = getKiteAAWallet();
  const tx = await wallet.withdraw(token, amount);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

// ─── Registry Read Operations ─────────────────────────────────────────

export async function resolveAgentByAddressOnChain(address: string) {
  const registry = getIdentityRegistry(getProvider());
  const [agentId, agentDomain, walletContract, active] =
    await registry.resolveAgentByAddress(address);
  return { agentId, agentDomain, walletContract, active };
}

export async function getAgentBySessionOnChain(sessionKey: string) {
  const registry = getIdentityRegistry(getProvider());
  const [
    agentId,
    agentDomain,
    agentAddress,
    agentActive,
    sessionActive,
    sessionValidUntil,
  ] = await registry.getAgentBySession(sessionKey);
  return {
    agentId,
    agentDomain,
    agentAddress,
    agentActive,
    sessionActive,
    sessionValidUntil: Number(sessionValidUntil),
  };
}

export async function getOwnerAgentsOnChain(
  ownerAddress: string,
): Promise<string[]> {
  const registry = getIdentityRegistry(getProvider());
  return await registry.getOwnerAgents(ownerAddress);
}

export async function deactivateAgentOnChain(agentId: string) {
  const registry = getIdentityRegistry();
  const agentIdBytes32 = ethers.id(agentId);
  const tx = await registry.deactivateAgent(agentIdBytes32);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

// ─── AnchorMerkle Read Operations ─────────────────────────────────────

export async function getAnchorOnChain(anchorIndex: number) {
  const merkle = getAttestationRegistry(getProvider());
  const [merkleRoot, timestamp, logCount, metadata] =
    await merkle.getAnchor(anchorIndex);
  return {
    merkleRoot,
    timestamp: Number(timestamp),
    logCount: Number(logCount),
    metadata,
  };
}

export async function getTotalAnchorsOnChain(): Promise<number> {
  const merkle = getAttestationRegistry(getProvider());
  const total = await merkle.totalAnchors();
  return Number(total);
}

export async function getAgentAnchorIndicesOnChain(
  agentId: string,
): Promise<number[]> {
  const merkle = getAttestationRegistry(getProvider());
  const agentIdBytes32 = ethers.id(agentId);
  const indices = await merkle.getAgentAnchorIndices(agentIdBytes32);
  return indices.map((i: bigint) => Number(i));
}

// ─── Utility ──────────────────────────────────────────────────────────

export function isContractsConfigured(): boolean {
  return !!(
    process.env.IDENTITY_REGISTRY_ADDRESS &&
    process.env.KITE_AA_WALLET_ADDRESS &&
    process.env.ATTESTATION_REGISTRY_ADDRESS &&
    process.env.PAYMENT_CHANNEL_ADDRESS &&
    process.env.DEPLOYER_PRIVATE_KEY
  );
}

export function generateSessionKey(): { address: string; privateKey: string } {
  const wallet = ethers.Wallet.createRandom();
  return { address: wallet.address, privateKey: wallet.privateKey };
}
