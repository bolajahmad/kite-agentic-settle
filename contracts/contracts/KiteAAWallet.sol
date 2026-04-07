// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAgentRegistry {
    function registerSession(bytes32 agentId, address sessionKey, uint256 sessionIndex, uint256 validUntil) external;
    function deactivateSession(address sessionKey) external;
}

/**
 * @title KiteAgentWallet
 * @notice Multi-tenant AA-style smart contract wallet for Kite's agentic payment system.
 *         Multiple EOAs register on a single contract, each with isolated balances.
 *         AI agents operate via session keys, each bound by on-chain spending rules
 *         scoped to the EOA that created them.
 *
 *         Implements Kite's three-layer identity model:
 *         - User Identity (EOA) — root authority, isolated funds, can revoke everything
 *         - Agent Identity (agentId) — delegated, bound to session keys
 *         - Session Identity (sessionKey) — ephemeral, per-task, auto-expires
 */
contract KiteAAWallet is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct UserAccount {
        bool registered;
        bytes32[] agentIds;
    }

    struct SessionKeyRule {
        address user;              // EOA that owns this session
        bytes32 agentId;
        uint256 sessionIndex;      // derivation index for deterministic key regeneration
        bytes32 metadataHash;      // keccak256 of encrypted session metadata
        uint256 valueLimit;        // max per-transaction (in token units)
        uint256 dailyLimit;        // max aggregate per rolling 24h window
        uint256 validUntil;        // expiry timestamp
        address[] allowedRecipients;
        bool active;
    }

    struct DailySpend {
        uint256 amount;
        uint256 windowStart;
    }

    // EOA => UserAccount
    mapping(address => UserAccount) public users;
    // user => token => balance
    mapping(address => mapping(address => uint256)) public userBalances;
    // session key address => rule
    mapping(address => SessionKeyRule) public sessionKeys;
    // session key => daily spend tracking
    mapping(address => DailySpend) public dailySpends;
    // agent id => list of session key addresses
    mapping(bytes32 => address[]) public agentSessions;

    address public agentRegistry;

    event UserRegistered(address indexed user);
    event SessionKeyAdded(
        address indexed sessionKey,
        address indexed user,
        bytes32 indexed agentId,
        uint256 sessionIndex,
        bytes32 metadataHash,
        uint256 valueLimit,
        uint256 dailyLimit,
        uint256 validUntil,
        bytes   metadata
    );
    event SessionKeyRevoked(address indexed sessionKey, bytes32 indexed agentId);
    event PaymentExecuted(
        address indexed sessionKey,
        bytes32 indexed agentId,
        address indexed recipient,
        address token,
        uint256 amount
    );
    event FundsDeposited(address indexed user, address indexed token, uint256 amount);
    event FundsWithdrawn(address indexed user, address indexed token, uint256 amount);
    event AgentRegistryUpdated(address indexed registry);

    modifier onlyRegistered() {
        require(users[msg.sender].registered, "Not registered");
        _;
    }

    modifier onlyActiveSession(address sessionKey) {
        SessionKeyRule storage rule = sessionKeys[sessionKey];
        require(rule.active, "Session key not active");
        require(block.timestamp <= rule.validUntil, "Session key expired");
        _;
    }

    constructor() Ownable(msg.sender) {}

    // ─── User Registration ─────────────────────────────────────────────

    function register() external {
        require(!users[msg.sender].registered, "Already registered");
        users[msg.sender].registered = true;
        emit UserRegistered(msg.sender);
    }

    // ─── Admin Functions ───────────────────────────────────────────────

    function setAgentRegistry(address _registry) external onlyOwner {
        require(_registry != address(0), "Invalid registry");
        agentRegistry = _registry;
        emit AgentRegistryUpdated(_registry);
    }

    // ─── User Functions ────────────────────────────────────────────────

    function addAgentId(bytes32 agentId) external onlyRegistered {
        users[msg.sender].agentIds.push(agentId);
    }

    function addSessionKeyRule(
        address sessionKeyAddress,
        bytes32 agentId,
        uint256 sessionIndex,
        uint256 valueLimit,
        uint256 dailyLimit,
        uint256 validUntil,
        address[] calldata allowedRecipients,
        bytes calldata metadata
    ) external onlyRegistered {
        require(sessionKeyAddress != address(0), "Invalid session key");
        require(validUntil > block.timestamp, "Expiry must be in future");
        require(valueLimit > 0, "Value limit must be > 0");
        require(dailyLimit >= valueLimit, "Daily limit must be >= value limit");

        // Verify the caller owns the agent
        bool ownsAgent = false;
        bytes32[] storage userAgentIds = users[msg.sender].agentIds;
        for (uint256 i = 0; i < userAgentIds.length; i++) {
            if (userAgentIds[i] == agentId) {
                ownsAgent = true;
                break;
            }
        }
        require(ownsAgent, "Agent not owned by caller");

        bytes32 mHash = keccak256(metadata);

        sessionKeys[sessionKeyAddress] = SessionKeyRule({
            user: msg.sender,
            agentId: agentId,
            sessionIndex: sessionIndex,
            metadataHash: mHash,
            valueLimit: valueLimit,
            dailyLimit: dailyLimit,
            validUntil: validUntil,
            allowedRecipients: allowedRecipients,
            active: true
        });

        agentSessions[agentId].push(sessionKeyAddress);

        // Sync to AgentRegistry
        if (agentRegistry != address(0)) {
            IAgentRegistry(agentRegistry).registerSession(agentId, sessionKeyAddress, sessionIndex, validUntil);
        }

        emit SessionKeyAdded(sessionKeyAddress, msg.sender, agentId, sessionIndex, mHash, valueLimit, dailyLimit, validUntil, metadata);
    }

    function revokeSessionKey(address sessionKeyAddress) external onlyRegistered {
        SessionKeyRule storage rule = sessionKeys[sessionKeyAddress];
        require(rule.user == msg.sender, "Not session owner");
        require(rule.active, "Already revoked");
        rule.active = false;

        // Sync to AgentRegistry
        if (agentRegistry != address(0)) {
            IAgentRegistry(agentRegistry).deactivateSession(sessionKeyAddress);
        }

        emit SessionKeyRevoked(sessionKeyAddress, rule.agentId);
    }

    function revokeAllAgentSessions(bytes32 agentId) external onlyRegistered {
        address[] storage sessions = agentSessions[agentId];
        for (uint256 i = 0; i < sessions.length; i++) {
            SessionKeyRule storage rule = sessionKeys[sessions[i]];
            if (rule.user == msg.sender && rule.active) {
                rule.active = false;

                // Sync to AgentRegistry
                if (agentRegistry != address(0)) {
                    IAgentRegistry(agentRegistry).deactivateSession(sessions[i]);
                }

                emit SessionKeyRevoked(sessions[i], agentId);
            }
        }
    }

    function deposit(address token, uint256 amount) external onlyRegistered {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        userBalances[msg.sender][token] += amount;
        emit FundsDeposited(msg.sender, token, amount);
    }

    function withdraw(address token, uint256 amount) external onlyRegistered nonReentrant {
        require(userBalances[msg.sender][token] >= amount, "Insufficient balance");
        userBalances[msg.sender][token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit FundsWithdrawn(msg.sender, token, amount);
    }

    // ─── Session Key Execution ─────────────────────────────────────────

    /**
     * @notice Execute a payment using a session key. Called by the facilitator
     *         or directly by the session key holder.
     * @param sessionKey The session key authorizing this payment
     * @param recipient  The service provider receiving payment
     * @param token      The ERC20 stablecoin address
     * @param amount     The payment amount
     */
    function executePayment(
        address sessionKey,
        address recipient,
        address token,
        uint256 amount
    ) external nonReentrant onlyActiveSession(sessionKey) {
        SessionKeyRule storage rule = sessionKeys[sessionKey];

        // Only the session key holder or the user (EOA) who owns this session can trigger
        require(
            msg.sender == sessionKey || msg.sender == rule.user,
            "Not authorized"
        );

        // Per-transaction limit
        require(amount <= rule.valueLimit, "Exceeds per-tx limit");

        // Recipient allowlist (empty = any recipient allowed)
        if (rule.allowedRecipients.length > 0) {
            bool allowed = false;
            for (uint256 i = 0; i < rule.allowedRecipients.length; i++) {
                if (rule.allowedRecipients[i] == recipient) {
                    allowed = true;
                    break;
                }
            }
            require(allowed, "Recipient not in allowlist");
        }

        // Rolling 24h daily limit
        DailySpend storage ds = dailySpends[sessionKey];
        if (block.timestamp >= ds.windowStart + 1 days) {
            ds.amount = 0;
            ds.windowStart = block.timestamp;
        }
        require(ds.amount + amount <= rule.dailyLimit, "Exceeds daily limit");
        ds.amount += amount;

        // Deduct from the user's balance
        require(userBalances[rule.user][token] >= amount, "Insufficient user balance");
        userBalances[rule.user][token] -= amount;

        // Execute transfer
        IERC20(token).safeTransfer(recipient, amount);

        emit PaymentExecuted(sessionKey, rule.agentId, recipient, token, amount);
    }

    // ─── View Functions ────────────────────────────────────────────────

    function getSessionRule(address sessionKey) external view returns (
        address user,
        bytes32 agentId,
        uint256 valueLimit,
        uint256 dailyLimit,
        uint256 validUntil,
        bool active
    ) {
        SessionKeyRule storage rule = sessionKeys[sessionKey];
        return (rule.user, rule.agentId, rule.valueLimit, rule.dailyLimit, rule.validUntil, rule.active);
    }

    function getSessionAllowedRecipients(address sessionKey) external view returns (address[] memory) {
        return sessionKeys[sessionKey].allowedRecipients;
    }

    function getAgentSessionKeys(bytes32 agentId) external view returns (address[] memory) {
        return agentSessions[agentId];
    }

    function getDailySpend(address sessionKey) external view returns (uint256 spent, uint256 windowStart) {
        DailySpend storage ds = dailySpends[sessionKey];
        if (block.timestamp >= ds.windowStart + 1 days) {
            return (0, block.timestamp);
        }
        return (ds.amount, ds.windowStart);
    }

    function isSessionValid(address sessionKey) external view returns (bool) {
        SessionKeyRule storage rule = sessionKeys[sessionKey];
        return rule.active && block.timestamp <= rule.validUntil;
    }

    function isRegistered(address user) external view returns (bool) {
        return users[user].registered;
    }

    function getUserAgentIds(address user) external view returns (bytes32[] memory) {
        return users[user].agentIds;
    }

    function getUserBalance(address user, address token) external view returns (uint256) {
        return userBalances[user][token];
    }
}
