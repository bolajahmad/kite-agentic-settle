import { parseAbi } from "viem";

// ── IdentityRegistry ABI ──────────────────────────────────────────
// ERC-8004 / ERC-721 identity + session registry.
// agentId = ERC-721 tokenId (uint256, starts at 1).

export const identityRegistryAbi = parseAbi([
  // Write
  "function register(string agentURI) external returns (uint256 agentId)",
  "function register() external returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string newURI) external",
  "function registerSession(uint256 agentId, address sessionKey, address user, address walletContract, uint256 validUntil, uint256[] blockedAgents) external",
  "function revokeSession(address sessionKey) external",
  // Read (sessions)
  "function validateSession(address sessionKey) external view returns (bool active, uint256 agentId, address user, address walletContract, uint256 validUntil)",
  "function getSession(address sessionKey) external view returns (uint256 agentId, address user, address walletContract, uint256 validUntil, uint256[] blockedAgents, bool active)",
  "function getAgentSessions(uint256 agentId) external view returns (address[])",
  "function isAgentBlocked(address sessionKey, uint256 agentId) external view returns (bool)",
  // Read (agents / ERC-721)
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function totalAgents() external view returns (uint256)",
  "function agentURI(uint256 agentId) external view returns (string)",
  // Events
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
  "event SessionRegistered(uint256 indexed agentId, address indexed sessionKey, address indexed user, address walletContract, uint256 validUntil)",
  "event SessionRevoked(uint256 indexed agentId, address indexed sessionKey)",
]);

// ── Legacy KiteAAWallet ABI (deprecated) ──────────────────────────
// Kept for backward compatibility while migrating fully to AA wallet flows.

export const kiteAAWalletAbi = parseAbi([
  // Write
  "function register() external",
  "function addSessionKeyRule(uint256 agentId, address sessionKey, uint256 valueLimit, uint256 maxValueAllowed, uint256 validUntil, uint256[] blockedAgents) external",
  "function revokeSessionKey(address sessionKey) external",
  "function deposit(address token, uint256 amount) external",
  "function withdraw(address token, uint256 amount) external",
  "function executePayment(uint256 agentId, address sessionKey, address recipient, address token, uint256 amount, uint256 nonce, uint256 deadline, bytes sig) external",
  "function setIdentityRegistry(address _registry) external",
  "function setPaymentChannel(address _channel) external",
  "function withdrawForChannel(address user, address token, uint256 amount) external",
  "function refundFromChannel(address user, address token, uint256 amount) external",
  "function setBlockedProvider(address provider, bool blocked) external",
  "function setBlockedProviders(address[] providers, bool blocked) external",
  // Read
  "function isRegistered(address user) external view returns (bool)",
  "function getUserBalance(address user, address token) external view returns (uint256)",
  "function getSessionSpent(address sessionKey) external view returns (uint256)",
  "function isNonceUsed(address sessionKey, uint256 nonce) external view returns (bool)",
  "function isProviderBlocked(address user, address provider) external view returns (bool)",
  "function identityRegistry() external view returns (address)",
  "function paymentChannel() external view returns (address)",
  "function owner() external view returns (address)",
  // Events
  "event UserRegistered(address indexed user)",
  "event FundsDeposited(address indexed user, address indexed token, uint256 amount)",
  "event FundsWithdrawn(address indexed user, address indexed token, uint256 amount)",
  "event PaymentExecuted(address indexed sessionKey, uint256 indexed agentId, address indexed recipient, address token, uint256 amount, uint256 nonce)",
  "event BlockedProvidersUpdated(address indexed user)",
  "event IdentityRegistryUpdated(address indexed registry)",
  "event PaymentChannelUpdated(address indexed channel)",
  "event ChannelFundsWithdrawn(address indexed user, address indexed token, uint256 amount)",
  "event ChannelFundsRefunded(address indexed user, address indexed token, uint256 amount)",
]);

// ── ClientAgentVault ABI (GokiteAccount) ─────────────────────────
// UUPS upgradeable ERC-4337 account with session-based spending rules.
//
// sessionId   = keccak256(abi.encodePacked(sessionKey, agentId, validUntil))
// provider    = keccak256(abi.encodePacked(providerAddress))  (bytes32 in all spending rule fields)

export const clientAgentVaultAbi = parseAbi([
  // ── Session management ─────────────────────────────────────────────────────
  "function createSession(bytes32 sessionId, address agent, (uint256 timeWindow, uint160 budget, uint96 initialWindowStartTime, bytes32[] targetProviders)[] rules) external",
  "function addSpendingRules(bytes32 sessionId, (uint256 timeWindow, uint160 budget, uint96 initialWindowStartTime, bytes32[] targetProviders)[] rules) external",
  "function removeSpendingRules(bytes32 sessionId, uint256[] indices) external",
  "function setSpendingRules(bytes32 sessionId, (uint256 timeWindow, uint160 budget, uint96 initialWindowStartTime, bytes32[] targetProviders)[] rules) external",
  "function configureSpendingRule(bytes32 sessionId, uint256[] indicesToRemove, (uint256 timeWindow, uint160 budget, uint96 initialWindowStartTime, bytes32[] targetProviders)[] rulesToAdd) external",
  "function setSessionAgent(bytes32 sessionId, address agent) external",
  "function removeSession(bytes32 sessionId) external",

  // ── Session queries ────────────────────────────────────────────────────────
  "function sessionExists(bytes32 sessionId) external view returns (bool)",
  "function getSessionAgent(bytes32 sessionId) external view returns (address)",
  "function getSpendingRules(bytes32 sessionId) external view returns ((uint256 timeWindow, uint160 budget, uint96 initialWindowStartTime, bytes32[] targetProviders, uint128 amountUsed, uint128 currentTimeWindowStartTime)[])",
  "function checkSpendingRules(bytes32 sessionId, uint256 normalizedAmount, bytes32 serviceProvider) external view returns (bool)",
  "function getUsage(bytes32 sessionId, uint256 index) external view returns (uint256)",

  // ── Master budget rules ────────────────────────────────────────────────────
  "function addMasterBudgetRule(uint256 timeWindow, uint160 budget) external",
  "function removeMasterBudgetRule(uint256 index) external",
  "function clearMasterBudgetRules() external",
  "function setMasterBudgetRules(uint256[] timeWindows, uint160[] budgets) external",
  "function getMasterBudgetRules() external view returns ((uint256 timeWindow, uint160 budget, uint96 initialWindowStartTime, bytes32[] targetProviders, uint128 amountUsed, uint128 currentTimeWindowStartTime)[])",
  "function getMasterBudgetRuleCount() external view returns (uint256)",

  // ── Token management ───────────────────────────────────────────────────────
  "function addSupportedToken(address token) external",
  "function removeSupportedToken(address token) external",
  "function isTokenSupported(address token) external view returns (bool)",
  "function getTokenDecimals(address token) external view returns (uint8)",
  "function getAvailableBalance(address token) external view returns (uint256)",

  // ── Transfers (via UserOperation) ─────────────────────────────────────────
  "function executeTransferWithAuthorization(bytes32 sessionId, (address from, address to, address token, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce) auth, bytes signature, bytes metadata) external",
  "function executeTransferWithAuthorizationAndProvider(bytes32 sessionId, (address from, address to, address token, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce) auth, bytes signature, bytes32 serviceProvider, bytes metadata) external",

  // ── ERC-4337 execution ─────────────────────────────────────────────────────
  "function execute(address dest, uint256 value, bytes func) external",
  "function executeBatch((address target, uint256 value, bytes data)[] calls) external",
  "function executeBatch(address[] dest, uint256[] value, bytes[] func) external",
  "function validateUserOp((address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature) userOp, bytes32 userOpHash, uint256 missingAccountFunds) external returns (uint256 validationData)",

  // ── ERC-4337 deposit ──────────────────────────────────────────────────────
  "function addDeposit() external payable",
  "function withdrawDepositTo(address withdrawAddress, uint256 amount) external",
  "function getDeposit() external view returns (uint256)",
  "function getNonce() external view returns (uint256)",
  "function isNonceUsed(bytes32 nonce) external view returns (bool)",

  // ── UUPS / ownership ──────────────────────────────────────────────────────
  "function initialize(address anOwner) external",
  "function upgradeToAndCall(address newImplementation, bytes data) external payable",
  "function transferOwnership(address newOwner) external",
  "function owner() external view returns (address)",
  "function entryPoint() external view returns (address)",
  "function proxiableUUID() external view returns (bytes32)",

  // ── Constants ─────────────────────────────────────────────────────────────
  "function DOMAIN_NAME() external view returns (string)",
  "function DOMAIN_VERSION() external view returns (string)",
  "function DOMAIN_SEPARATOR() external view returns (bytes32)",
  "function DOMAIN_TYPEHASH() external view returns (bytes32)",
  "function TRANSFER_WITH_AUTHORIZATION_TYPEHASH() external view returns (bytes32)",
  "function STANDARD_DECIMALS() external view returns (uint256)",
  "function UPGRADE_INTERFACE_VERSION() external view returns (string)",

  // ── Events ────────────────────────────────────────────────────────────────
  "event GokiteAccountInitialized(address indexed entryPoint, address indexed owner)",
  "event SessionCreated(bytes32 indexed sessionId, address agent)",
  "event SessionRemoved(bytes32 indexed sessionId)",
  "event SessionAgentUpdated(bytes32 indexed sessionId, address agent)",
  "event SpendingRuleAdded(bytes32 indexed sessionId, uint256 timeWindow, uint160 budget, uint96 initialWindowStartTime, bytes32[] targetProviders)",
  "event SpendingRuleRemoved(bytes32 indexed sessionId, uint256 timeWindow, uint160 budget, uint96 initialWindowStartTime, bytes32[] targetProviders)",
  "event SpendingRulesCleared(bytes32 indexed sessionId)",
  "event TransferExecuted(bytes32 indexed sessionId, address indexed token, address indexed to, uint256 amount, bytes32 nonce, bytes metadata)",
  "event UsageUpdated(bytes32 indexed sessionId, uint256 amountUsed, uint256 currentTimeWindowStartTime, uint256 chargedAmount)",
  "event MasterBudgetRuleAdded(uint256 timeWindow, uint160 budget)",
  "event MasterBudgetRuleRemoved(uint256 timeWindow, uint160 budget)",
  "event MasterBudgetRulesCleared()",
  "event MasterBudgetUsageUpdated(uint256 indexed ruleIndex, uint256 amountUsed, uint256 chargedAmount)",
  "event SupportedTokenAdded(address indexed token, uint8 decimals)",
  "event SupportedTokenRemoved(address indexed token)",
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
  "event Upgraded(address indexed implementation)",
  "event Initialized(uint64 version)",
]);

// ── PaymentChannel ABI ────────────────────────────────────────────

export const paymentChannelAbi = parseAbi([
  "function openChannel(address provider, address token, uint8 mode, uint256 deposit, uint256 maxSpend, uint256 maxDuration, uint256 maxPerCall, address walletContract) external returns (bytes32)",
  "function activateChannel(bytes32 channelId) external",
  "function initiateSettlement(bytes32 channelId, uint256 sequenceNumber, uint256 cumulativeCost, uint256 timestamp, bytes providerSignature, bytes32 merkleRoot) external",
  "function submitReceipt(bytes32 channelId, uint256 sequenceNumber, uint256 cumulativeCost, uint256 timestamp, bytes providerSignature) external",
  "function approveSettlement(bytes32 channelId) external",
  "function finalize(bytes32 channelId, bytes32 merkleRoot) external",
  "function forceCloseExpired(bytes32 channelId) external",
  "function getChannel(bytes32 channelId) external view returns (address consumer, address user, address provider, address token, uint8 mode, uint256 deposit, uint256 maxSpend, uint256 maxDuration, uint256 openedAt, uint256 expiresAt, uint256 maxPerCall, uint256 settledAmount, uint8 status, uint256 settlementDeadline, uint256 highestClaimedCost, uint256 highestSequenceNumber, address walletContract, address lastReceiptSubmitter)",
  "function getReceiptHash(bytes32 channelId, uint256 sequenceNumber, uint256 cumulativeCost, uint256 timestamp) public pure returns (bytes32)",
  "function isChannelExpired(bytes32 channelId) external view returns (bool)",
  "function getChannelTimeRemaining(bytes32 channelId) external view returns (uint256)",
  "function getSettlementState(bytes32 channelId) external view returns (uint256 deadline, uint256 highestCost, uint256 highestSeq, address initiator, bool challengeOpen)",
  "function getLockedFunds(address wallet, address token) external view returns (uint256)",
  "function lockedFunds(address wallet, address token) external view returns (uint256)",
  "event ChannelOpened(bytes32 indexed channelId, address indexed consumer, address indexed provider, address token, uint8 mode, uint256 deposit, uint256 maxSpend, uint256 maxDuration, uint256 maxPerCall, address walletContract)",
  "event ChannelActivated(bytes32 indexed channelId)",
  "event SettlementInitiated(bytes32 indexed channelId, address indexed initiator, uint256 claimedAmount, uint256 settlementDeadline)",
  "event ReceiptSubmitted(bytes32 indexed channelId, address indexed submitter, uint256 sequenceNumber, uint256 cumulativeCost)",
  "event SettlementApproved(bytes32 indexed channelId, address indexed approver, uint256 finalAmount)",
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
