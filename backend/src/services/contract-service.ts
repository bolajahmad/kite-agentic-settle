import { ethers } from "ethers";
import { AgentRegistryABI } from "../contracts/abi/AgentRegistryABI.js";
import { KiteAAWalletABI } from "../contracts/abi/KiteAAWalletABI.js";
import { AnchorMerkleABI } from "../contracts/abi/AnchorMerkleABI.js";
import { PaymentChannelABI } from "../contracts/abi/PaymentChannelABI.js";

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

export function getAgentRegistry(signerOrProvider?: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(
    getContractAddress("AGENT_REGISTRY_ADDRESS"),
    AgentRegistryABI,
    signerOrProvider ?? getSigner()
  );
}

export function getKiteAAWallet(signerOrProvider?: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(
    getContractAddress("KITE_AA_WALLET_ADDRESS"),
    KiteAAWalletABI,
    signerOrProvider ?? getSigner()
  );
}

export function getAnchorMerkle(signerOrProvider?: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(
    getContractAddress("ANCHOR_MERKLE_ADDRESS"),
    AnchorMerkleABI,
    signerOrProvider ?? getSigner()
  );
}

export function getPaymentChannel(signerOrProvider?: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(
    getContractAddress("PAYMENT_CHANNEL_ADDRESS"),
    PaymentChannelABI,
    signerOrProvider ?? getSigner()
  );
}

// ─── Agent Registry Operations ────────────────────────────────────────

export async function registerAgentOnChain(
  agentId: string,
  agentDomain: string,
  agentAddress: string,
  walletContract: string
) {
  const registry = getAgentRegistry();
  const agentIdBytes32 = ethers.id(agentId);
  const tx = await registry.registerAgent(
    agentIdBytes32,
    agentDomain,
    agentAddress,
    walletContract
  );
  const receipt = await tx.wait();
  return { txHash: receipt.hash, agentIdBytes32 };
}

export async function getAgentFromChain(agentId: string) {
  const registry = getAgentRegistry(getProvider());
  const agentIdBytes32 = ethers.id(agentId);
  const [agentDomain, agentAddress, walletContract, ownerAddr, active] =
    await registry.getAgent(agentIdBytes32);
  return { agentDomain, agentAddress, walletContract, ownerAddr, active };
}

export async function resolveAgentByDomainOnChain(domain: string) {
  const registry = getAgentRegistry(getProvider());
  const [agentId, agentAddress, walletContract, active] =
    await registry.resolveAgentByDomain(domain);
  return { agentId, agentAddress, walletContract, active };
}

export async function registerSessionOnChain(
  agentId: string,
  sessionKeyAddress: string,
  validUntil: number
) {
  const registry = getAgentRegistry();
  const agentIdBytes32 = ethers.id(agentId);
  const tx = await registry.registerSession(
    agentIdBytes32,
    sessionKeyAddress,
    validUntil
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
  blockedProviders: string[]
) {
  const wallet = getKiteAAWallet();
  const agentIdBytes32 = ethers.id(agentId);
  const tx = await wallet.addSessionKeyRule(
    sessionKeyAddress,
    agentIdBytes32,
    valueLimit,
    dailyLimit,
    validUntil,
    blockedProviders
  );
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

export async function executePaymentOnChain(
  sessionKeyAddress: string,
  recipient: string,
  token: string,
  amount: bigint
) {
  const wallet = getKiteAAWallet();
  const tx = await wallet.executePayment(
    sessionKeyAddress,
    recipient,
    token,
    amount
  );
  const receipt = await tx.wait();
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
}

/**
 * Facilitator path: settle an x402 programmable-settlement payment by submitting
 * the session-key-signed EIP-712 authorisation to the contract.
 * The facilitator (backend signer) pays gas; the session key's user balance is debited.
 */
export async function executePaymentBySigOnChain(
  sessionKey: string,
  recipient: string,
  token: string,
  amount: bigint,
  nonce: bigint,
  deadline: bigint,
  v: number,
  r: string,
  s: string
) {
  const wallet = getKiteAAWallet();
  const tx = await wallet.executePaymentBySig(
    sessionKey,
    recipient,
    token,
    amount,
    nonce,
    deadline,
    v,
    r as `0x${string}`,
    s as `0x${string}`
  );
  const receipt = await tx.wait();
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
}

export async function getPaymentNonceFromChain(sessionKey: string): Promise<bigint> {
  const wallet = getKiteAAWallet(getProvider());
  return BigInt(await wallet.paymentNonces(sessionKey));
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
    getSigner()
  );
  const approveTx = await tokenContract.approve(await wallet.getAddress(), amount);
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
  agentIds: string[]
) {
  const merkle = getAnchorMerkle();
  const agentIdBytes32 = agentIds.map((id) => ethers.id(id));
  const tx = await merkle.anchorRoot(
    merkleRoot,
    logCount,
    metadata,
    agentIdBytes32
  );
  const receipt = await tx.wait();
  return { txHash: receipt.hash, anchorIndex: receipt.logs.length > 0 ? receipt.logs[0] : null };
}

export async function verifyLeafOnChain(
  anchorIndex: number,
  leaf: string,
  proof: string[]
) {
  const merkle = getAnchorMerkle();
  const tx = await merkle.verifyLeaf(anchorIndex, leaf, proof);
  const receipt = await tx.wait();
  // Parse the LeafVerified event
  const iface = new ethers.Interface(AnchorMerkleABI);
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
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
  user: string,        // EOA whose KiteAAWallet balance is debited
  walletContract: string // KiteAAWallet contract address
) {
  const pc = getPaymentChannel();

  // No ERC20 approve needed — KiteAAWallet.withdrawForChannel transfers
  // directly from the wallet contract to PaymentChannel.

  const tx = await pc.openChannel(provider, token, mode, deposit, maxSpend, maxDuration, maxPerCall, user, walletContract);
  const receipt = await tx.wait();

  // Extract channelId from ChannelOpened event
  const iface = new ethers.Interface(PaymentChannelABI);
  let channelId: string | undefined;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === "ChannelOpened") {
        channelId = parsed.args.channelId;
        break;
      }
    } catch { continue; }
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
  merkleRoot: string = "0x0000000000000000000000000000000000000000000000000000000000000000"
) {
  const pc = getPaymentChannel();
  const tx = await pc.initiateSettlement(
    channelId, sequenceNumber, cumulativeCost, timestamp, providerSignature, merkleRoot
  );
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

export async function submitReceiptOnChain(
  channelId: string,
  sequenceNumber: number,
  cumulativeCost: bigint,
  timestamp: number,
  providerSignature: string
) {
  const pc = getPaymentChannel();
  const tx = await pc.submitReceipt(
    channelId, sequenceNumber, cumulativeCost, timestamp, providerSignature
  );
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

export async function finalizeOnChain(
  channelId: string,
  merkleRoot: string = "0x0000000000000000000000000000000000000000000000000000000000000000"
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
    consumer, provider, token, mode, deposit, maxSpend, maxDuration,
    openedAt, expiresAt, maxPerCall, settledAmount, status,
    settlementDeadline, highestClaimedCost, highestSequenceNumber
  ] = await pc.getChannel(channelId);
  return {
    consumer, provider, token,
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

export async function isChannelExpiredOnChain(channelId: string): Promise<boolean> {
  const pc = getPaymentChannel(getProvider());
  return await pc.isChannelExpired(channelId);
}

export async function getChannelTimeRemainingOnChain(channelId: string): Promise<number> {
  const pc = getPaymentChannel(getProvider());
  const remaining = await pc.getChannelTimeRemaining(channelId);
  return Number(remaining);
}

export async function getReceiptHashOnChain(
  channelId: string,
  sequenceNumber: number,
  cumulativeCost: bigint,
  timestamp: number
): Promise<string> {
  const pc = getPaymentChannel(getProvider());
  return await pc.getReceiptHash(channelId, sequenceNumber, cumulativeCost, timestamp);
}

export async function getLockedFundsOnChain(wallet: string, token: string): Promise<string> {
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
    getProvider()
  );
  const balance = await tokenContract.balanceOf(walletAddress);
  return balance.toString();
}

export async function isSessionValidOnChain(sessionKeyAddress: string): Promise<boolean> {
  const wallet = getKiteAAWallet(getProvider());
  return await wallet.isSessionValid(sessionKeyAddress);
}

export async function getDailySpendOnChain(sessionKeyAddress: string): Promise<string> {
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
  if (!process.env.PAYMENT_CHANNEL_ADDRESS || !process.env.DEPLOYER_PRIVATE_KEY) {
    console.log("[ChannelWatcher] Skipping — PAYMENT_CHANNEL_ADDRESS or DEPLOYER_PRIVATE_KEY not set.");
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
          parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
        } catch { continue; }

        if (parsed?.name !== "ChannelOpened") continue;

        const channelId: string = parsed.args.channelId;
        const provider: string = parsed.args.provider;

        if (provider.toLowerCase() !== providerAddress.toLowerCase()) continue;
        if (activatedChannels.has(channelId)) continue;
        activatedChannels.add(channelId);

        console.log(`[ChannelWatcher] ChannelOpened: channelId=${channelId}, provider=${provider}. Activating...`);
        activateChannelOnChain(channelId)
          .then(({ txHash }) => {
            console.log(`[ChannelWatcher] Channel ${channelId} activated. Tx: ${txHash}`);
          })
          .catch((err: any) => {
            console.error(`[ChannelWatcher] Failed to activate channel ${channelId}: ${err.message}`);
          });
      }

      lastBlock = currentBlock;
    } catch (err: any) {
      // Non-fatal — just log and continue polling
      console.error(`[ChannelWatcher] Poll error: ${err.message}`);
    }
  };

  const interval = setInterval(poll, 5_000);
  console.log("[ChannelWatcher] Started — polling every 5s for ChannelOpened events.");

  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

export async function getAgentSessionKeysOnChain(agentId: string): Promise<string[]> {
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
  const registry = getAgentRegistry(getProvider());
  const [agentId, agentDomain, walletContract, active] =
    await registry.resolveAgentByAddress(address);
  return { agentId, agentDomain, walletContract, active };
}

export async function getAgentBySessionOnChain(sessionKey: string) {
  const registry = getAgentRegistry(getProvider());
  const [agentId, agentDomain, agentAddress, agentActive, sessionActive, sessionValidUntil] =
    await registry.getAgentBySession(sessionKey);
  return {
    agentId,
    agentDomain,
    agentAddress,
    agentActive,
    sessionActive,
    sessionValidUntil: Number(sessionValidUntil),
  };
}

export async function getOwnerAgentsOnChain(ownerAddress: string): Promise<string[]> {
  const registry = getAgentRegistry(getProvider());
  return await registry.getOwnerAgents(ownerAddress);
}

export async function deactivateAgentOnChain(agentId: string) {
  const registry = getAgentRegistry();
  const agentIdBytes32 = ethers.id(agentId);
  const tx = await registry.deactivateAgent(agentIdBytes32);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

// ─── AnchorMerkle Read Operations ─────────────────────────────────────

export async function getAnchorOnChain(anchorIndex: number) {
  const merkle = getAnchorMerkle(getProvider());
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
  const merkle = getAnchorMerkle(getProvider());
  const total = await merkle.totalAnchors();
  return Number(total);
}

export async function getAgentAnchorIndicesOnChain(agentId: string): Promise<number[]> {
  const merkle = getAnchorMerkle(getProvider());
  const agentIdBytes32 = ethers.id(agentId);
  const indices = await merkle.getAgentAnchorIndices(agentIdBytes32);
  return indices.map((i: bigint) => Number(i));
}

// ─── Utility ──────────────────────────────────────────────────────────

export function isContractsConfigured(): boolean {
  return !!(
    process.env.AGENT_REGISTRY_ADDRESS &&
    process.env.KITE_AA_WALLET_ADDRESS &&
    process.env.ANCHOR_MERKLE_ADDRESS &&
    process.env.DEPLOYER_PRIVATE_KEY
  );
}

export function generateSessionKey(): { address: string; privateKey: string } {
  const wallet = ethers.Wallet.createRandom();
  return { address: wallet.address, privateKey: wallet.privateKey };
}
