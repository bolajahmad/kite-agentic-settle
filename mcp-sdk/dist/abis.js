import { parseAbi } from "viem";
export const paymentChannelAbi = parseAbi([
    "function openChannel(address provider, address token, uint8 mode, uint256 deposit, uint256 maxDuration, uint256 ratePerCall) external returns (bytes32)",
    "function activateChannel(bytes32 channelId) external",
    "function closeChannel(bytes32 channelId, uint256 sequenceNumber, uint256 cumulativeCost, uint256 timestamp, bytes providerSignature) external",
    "function closeChannelEmpty(bytes32 channelId) external",
    "function forceCloseExpired(bytes32 channelId) external",
    "function forceCloseWithReceipt(bytes32 channelId, uint256 sequenceNumber, uint256 cumulativeCost, uint256 timestamp, bytes providerSignature) external",
    "function disputeChannel(bytes32 channelId) external",
    "function resolveDispute(bytes32 channelId, uint256 sequenceNumber, uint256 cumulativeCost, uint256 timestamp, bytes providerSignature) external",
    "function getChannel(bytes32 channelId) external view returns (address consumer, address provider, address token, uint8 mode, uint256 deposit, uint256 maxDuration, uint256 openedAt, uint256 expiresAt, uint256 ratePerCall, uint256 settledAmount, uint8 status)",
    "function getReceiptHash(bytes32 channelId, uint256 sequenceNumber, uint256 cumulativeCost, uint256 timestamp) public pure returns (bytes32)",
    "function isChannelExpired(bytes32 channelId) external view returns (bool)",
    "function getChannelTimeRemaining(bytes32 channelId) external view returns (uint256)",
    "function lockedFunds(address wallet, address token) external view returns (uint256)",
    "event ChannelOpened(bytes32 indexed channelId, address indexed consumer, address indexed provider, address token, uint8 mode, uint256 deposit, uint256 maxDuration, uint256 ratePerCall)",
    "event ChannelActivated(bytes32 indexed channelId)",
    "event ChannelSettled(bytes32 indexed channelId, uint256 amount, uint256 refund)",
    "event ChannelClosed(bytes32 indexed channelId)",
]);
export const agentRegistryAbi = parseAbi([
    "function registerAgent(bytes32 agentId, string agentDomain, address agentAddress, address walletContract) external",
    "function registerSession(bytes32 agentId, address sessionKey, uint256 validUntil) external",
    "function deactivateAgent(bytes32 agentId) external",
    "function deactivateSession(address sessionKey) external",
    "function getAgent(bytes32 agentId) external view returns (string agentDomain, address agentAddress, address walletContract, address ownerAddr, bool active)",
    "function resolveAgentByDomain(string domain) external view returns (bytes32 agentId, address agentAddress, address walletContract, bool active)",
    "function resolveAgentByAddress(address agentAddr) external view returns (bytes32 agentId, string agentDomain, address walletContract, bool active)",
    "function getAgentBySession(address sessionKey) external view returns (bytes32 agentId, string agentDomain, address agentAddress, bool agentActive, bool sessionActive, uint256 sessionValidUntil)",
    "function getOwnerAgents(address ownerAddr) external view returns (bytes32[])",
]);
export const kiteAAWalletAbi = parseAbi([
    "function deposit(address token, uint256 amount) external",
    "function withdraw(address token, uint256 amount) external",
    "function executePayment(address sessionKey, address recipient, address token, uint256 amount) external",
    "function addSessionKeyRule(address sessionKeyAddress, bytes32 agentId, uint256 valueLimit, uint256 dailyLimit, uint256 validUntil, address[] allowedRecipients) external",
    "function revokeSessionKey(address sessionKeyAddress) external",
    "function setAgentRegistry(address _registry) external",
    "function getSessionRule(address sessionKey) external view returns (bytes32 agentId, uint256 valueLimit, uint256 dailyLimit, uint256 validUntil, bool active)",
    "function isSessionValid(address sessionKey) external view returns (bool)",
    "function getAgentSessionKeys(bytes32 agentId) external view returns (address[])",
    "function getDailySpend(address sessionKey) external view returns (uint256 spent, uint256 windowStart)",
]);
export const walletFactoryAbi = parseAbi([
    "function deployWallet() external returns (address)",
    "function getWallet(address owner) external view returns (address)",
    "function totalWallets() external view returns (uint256)",
]);
export const erc20Abi = parseAbi([
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address account) external view returns (uint256)",
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function transfer(address to, uint256 amount) external returns (bool)",
]);
