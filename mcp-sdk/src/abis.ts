import { parseAbi } from "viem";

// ── AgentRegistry ABI ─────────────────────────────────────────────
// Source of truth: frontend/utils/contracts/abi/AgentRegistryABI.ts

export const agentRegistryAbi = parseAbi([
  // Write
  "function registerAgent(address agentAddress, address walletContract, uint256 agentIndex, bytes metadata) external returns (bytes32)",
  "function deactivateAgent(bytes32 agentId) external",
  "function registerSession(bytes32 agentId, address sessionKey, uint256 sessionIndex, uint256 validUntil) external",
  "function deactivateSession(address sessionKey) external",
  // Read
  "function getAgent(bytes32 agentId) external view returns (bytes32 metadataHash, address agentAddress, address walletContract, address ownerAddr, uint256 agentIndex, bool active)",
  "function getAgentBySession(address sessionKey) external view returns (bytes32 agentId, bytes32 metadataHash, address agentAddress, uint256 agentIndex, uint256 sessionIndex, bool agentActive, bool sessionActive, uint256 sessionValidUntil)",
  "function getOwnerAgents(address ownerAddr) external view returns (bytes32[])",
  "function resolveAgentByAddress(address agentAddr) external view returns (bytes32 agentId, bytes32 metadataHash, address walletContract, address ownerAddr, uint256 agentIndex, bool active)",
  "function addressToAgent(address) external view returns (bytes32)",
  "function nonce() external view returns (uint256)",
  "function totalAgents() external view returns (uint256)",
  "function owner() external view returns (address)",
  // Events
  "event AgentRegistered(bytes32 indexed agentId, address indexed agentAddress, address indexed walletContract, address ownerAddress, uint256 agentIndex, bytes metadata)",
  "event AgentDeactivated(bytes32 indexed agentId)",
  "event SessionRegistered(bytes32 indexed agentId, address indexed sessionKey, uint256 sessionIndex, uint256 validUntil)",
  "event SessionDeactivated(address indexed sessionKey)",
]);

// ── KiteAAWallet ABI ──────────────────────────────────────────────
// Source of truth: frontend/utils/contracts/abi/KiteAAWalletABI.ts

export const kiteAAWalletAbi = parseAbi([
  // Write
  "function register() external",
  "function addAgentId(bytes32 agentId, address owner) external",
  "function addSessionKeyRule(address sessionKeyAddress, bytes32 agentId, uint256 sessionIndex, uint256 valueLimit, uint256 dailyLimit, uint256 validUntil, address[] blockedProviders, bytes metadata) external",
  "function deposit(address token, uint256 amount) external",
  "function withdraw(address token, uint256 amount) external",
  "function executePayment(address sessionKey, address recipient, address token, uint256 amount) external",
  "function executePaymentBySig(address sessionKey, address recipient, address token, uint256 amount, uint256 nonce, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external",
  "function revokeSessionKey(address sessionKeyAddress) external",
  "function revokeAllAgentSessions(bytes32 agentId) external",
  "function setAgentRegistry(address _registry) external",
  "function setPaymentChannel(address _paymentChannel) external",
  "function withdrawForChannel(address user, address token, uint256 amount) external",
  "function refundFromChannel(address user, address token, uint256 amount) external",
  "function updateBlockedProviders(address sessionKeyAddress, address[] newBlockedProviders) external",
  "function blockProvider(address sessionKeyAddress, address provider) external",
  "function unblockProvider(address sessionKeyAddress, address provider) external",
  // Read
  "function isRegistered(address user) external view returns (bool)",
  "function getSessionRule(address sessionKey) external view returns (address user, bytes32 agentId, uint256 valueLimit, uint256 dailyLimit, uint256 validUntil, bool active)",
  "function getSessionBlockedProviders(address sessionKey) external view returns (address[])",
  "function getAgentSessionKeys(bytes32 agentId) external view returns (address[])",
  "function getDailySpend(address sessionKey) external view returns (uint256 spent, uint256 windowStart)",
  "function isSessionValid(address sessionKey) external view returns (bool)",
  "function getUserAgentIds(address user) external view returns (bytes32[])",
  "function getUserBalance(address user, address token) external view returns (uint256)",
  "function paymentNonces(address sessionKey) external view returns (uint256)",
  "function domainSeparator() external view returns (bytes32)",
  "function agentRegistry() external view returns (address)",
  "function owner() external view returns (address)",
  // Events
  "event UserRegistered(address indexed user)",
  "event AgentLinked(address indexed user, bytes32 indexed agentId)",
  "event SessionKeyAdded(address indexed sessionKey, address indexed user, bytes32 indexed agentId, uint256 sessionIndex, bytes32 metadataHash, uint256 valueLimit, uint256 dailyLimit, uint256 validUntil, bytes metadata)",
  "event SessionKeyRevoked(address indexed sessionKey, bytes32 indexed agentId)",
  "event SessionBlockedProvidersUpdated(address indexed sessionKey, address[] blockedProviders)",
  "event ProviderBlocked(address indexed sessionKey, address indexed provider)",
  "event ProviderUnblocked(address indexed sessionKey, address indexed provider)",
  "event FundsDeposited(address indexed user, address indexed token, uint256 amount)",
  "event FundsWithdrawn(address indexed user, address indexed token, uint256 amount)",
  "event PaymentExecuted(address indexed sessionKey, bytes32 indexed agentId, address indexed recipient, address token, uint256 amount)",
  "event PaymentExecutedBySig(address indexed sessionKey, bytes32 indexed agentId, address indexed recipient, address token, uint256 amount, uint256 nonce)",
  "event AgentRegistryUpdated(address indexed registry)",
  "event PaymentChannelUpdated(address indexed paymentChannel)",
  "event ChannelFundsWithdrawn(address indexed user, address indexed token, uint256 amount)",
  "event ChannelFundsRefunded(address indexed user, address indexed token, uint256 amount)",
]);

// ── PaymentChannel ABI ────────────────────────────────────────────

export const paymentChannelAbi = parseAbi([
  "function openChannel(address provider, address token, uint8 mode, uint256 deposit, uint256 maxSpend, uint256 maxDuration, uint256 maxPerCall, address walletContract) external returns (bytes32)",
  "function activateChannel(bytes32 channelId) external",
  "function initiateSettlement(bytes32 channelId, uint256 sequenceNumber, uint256 cumulativeCost, uint256 timestamp, bytes providerSignature, bytes32 merkleRoot) external",
  "function submitReceipt(bytes32 channelId, uint256 sequenceNumber, uint256 cumulativeCost, uint256 timestamp, bytes providerSignature) external",
  "function finalize(bytes32 channelId, bytes32 merkleRoot) external",
  "function forceCloseExpired(bytes32 channelId) external",
  "function getChannel(bytes32 channelId) external view returns (address consumer, address provider, address token, uint8 mode, uint256 deposit, uint256 maxSpend, uint256 maxDuration, uint256 openedAt, uint256 expiresAt, uint256 maxPerCall, uint256 settledAmount, uint8 status, uint256 settlementDeadline, uint256 highestClaimedCost, uint256 highestSequenceNumber, address walletContract)",
  "function getReceiptHash(bytes32 channelId, uint256 sequenceNumber, uint256 cumulativeCost, uint256 timestamp) public pure returns (bytes32)",
  "function isChannelExpired(bytes32 channelId) external view returns (bool)",
  "function getChannelTimeRemaining(bytes32 channelId) external view returns (uint256)",
  "function getSettlementState(bytes32 channelId) external view returns (uint256 deadline, uint256 highestCost, uint256 highestSeq, address initiator, bool challengeOpen)",
  "function lockedFunds(address wallet, address token) external view returns (uint256)",
  "event ChannelOpened(bytes32 indexed channelId, address indexed consumer, address indexed provider, address token, uint8 mode, uint256 deposit, uint256 maxSpend, uint256 maxDuration, uint256 maxPerCall, address walletContract)",
  "event ChannelActivated(bytes32 indexed channelId)",
  "event SettlementInitiated(bytes32 indexed channelId, address indexed initiator, uint256 claimedAmount, uint256 settlementDeadline)",
  "event ReceiptSubmitted(bytes32 indexed channelId, address indexed submitter, uint256 sequenceNumber, uint256 cumulativeCost)",
  "event ChannelFinalized(bytes32 indexed channelId, uint256 payment, uint256 refund, bytes32 usageMerkleRoot)",
]);

// ── WalletFactory ABI ─────────────────────────────────────────────

export const walletFactoryAbi = parseAbi([
  "function deployWallet() external returns (address)",
  "function getWallet(address owner) external view returns (address)",
  "function totalWallets() external view returns (uint256)",
]);

// ── ERC20 ABI ─────────────────────────────────────────────────────

export const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function decimals() external view returns (uint8)",
]);
