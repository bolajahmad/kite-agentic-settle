// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title KiteAgentWallet
 * @notice AA-style smart contract wallet for Kite's agentic payment system.
 *         The user (owner) holds shared stablecoin funds. Multiple AI agents
 *         operate via session keys, each bound by on-chain spending rules.
 *
 *         Implements Kite's three-layer identity model:
 *         - User Identity (owner) — root authority, can revoke everything
 *         - Agent Identity (agentId) — delegated, bound to session keys
 *         - Session Identity (sessionKey) — ephemeral, per-task, auto-expires
 */
contract KiteAAWallet is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct SessionKeyRule {
        bytes32 agentId;
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

    // session key address => rule
    mapping(address => SessionKeyRule) public sessionKeys;
    // session key => daily spend tracking
    mapping(address => DailySpend) public dailySpends;
    // agent id => list of session key addresses
    mapping(bytes32 => address[]) public agentSessions;

    address public agentRegistry;

    event SessionKeyAdded(
        address indexed sessionKey,
        bytes32 indexed agentId,
        uint256 valueLimit,
        uint256 dailyLimit,
        uint256 validUntil
    );
    event SessionKeyRevoked(address indexed sessionKey, bytes32 indexed agentId);
    event PaymentExecuted(
        address indexed sessionKey,
        bytes32 indexed agentId,
        address indexed recipient,
        address token,
        uint256 amount
    );
    event FundsDeposited(address indexed token, uint256 amount);
    event FundsWithdrawn(address indexed token, uint256 amount);
    event AgentRegistryUpdated(address indexed registry);

    modifier onlyActiveSession(address sessionKey) {
        SessionKeyRule storage rule = sessionKeys[sessionKey];
        require(rule.active, "Session key not active");
        require(block.timestamp <= rule.validUntil, "Session key expired");
        _;
    }

    constructor(address _owner) Ownable(_owner) {}

    // ─── Owner Functions ───────────────────────────────────────────────

    function setAgentRegistry(address _registry) external onlyOwner {
        require(_registry != address(0), "Invalid registry");
        agentRegistry = _registry;
        emit AgentRegistryUpdated(_registry);
    }

    function addSessionKeyRule(
        address sessionKeyAddress,
        bytes32 agentId,
        uint256 valueLimit,
        uint256 dailyLimit,
        uint256 validUntil,
        address[] calldata allowedRecipients
    ) external onlyOwner {
        require(sessionKeyAddress != address(0), "Invalid session key");
        require(validUntil > block.timestamp, "Expiry must be in future");
        require(valueLimit > 0, "Value limit must be > 0");
        require(dailyLimit >= valueLimit, "Daily limit must be >= value limit");

        sessionKeys[sessionKeyAddress] = SessionKeyRule({
            agentId: agentId,
            valueLimit: valueLimit,
            dailyLimit: dailyLimit,
            validUntil: validUntil,
            allowedRecipients: allowedRecipients,
            active: true
        });

        agentSessions[agentId].push(sessionKeyAddress);

        emit SessionKeyAdded(sessionKeyAddress, agentId, valueLimit, dailyLimit, validUntil);
    }

    function revokeSessionKey(address sessionKeyAddress) external onlyOwner {
        SessionKeyRule storage rule = sessionKeys[sessionKeyAddress];
        require(rule.active, "Already revoked");
        rule.active = false;
        emit SessionKeyRevoked(sessionKeyAddress, rule.agentId);
    }

    function revokeAllAgentSessions(bytes32 agentId) external onlyOwner {
        address[] storage sessions = agentSessions[agentId];
        for (uint256 i = 0; i < sessions.length; i++) {
            if (sessionKeys[sessions[i]].active) {
                sessionKeys[sessions[i]].active = false;
                emit SessionKeyRevoked(sessions[i], agentId);
            }
        }
    }

    function deposit(address token, uint256 amount) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit FundsDeposited(token, amount);
    }

    function withdraw(address token, uint256 amount) external onlyOwner nonReentrant {
        IERC20(token).safeTransfer(owner(), amount);
        emit FundsWithdrawn(token, amount);
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
        // Only the session key holder or the owner can trigger execution
        require(
            msg.sender == sessionKey || msg.sender == owner(),
            "Not authorized"
        );

        SessionKeyRule storage rule = sessionKeys[sessionKey];

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

        // Execute transfer
        IERC20(token).safeTransfer(recipient, amount);

        emit PaymentExecuted(sessionKey, rule.agentId, recipient, token, amount);
    }

    // ─── View Functions ────────────────────────────────────────────────

    function getSessionRule(address sessionKey) external view returns (
        bytes32 agentId,
        uint256 valueLimit,
        uint256 dailyLimit,
        uint256 validUntil,
        bool active
    ) {
        SessionKeyRule storage rule = sessionKeys[sessionKey];
        return (rule.agentId, rule.valueLimit, rule.dailyLimit, rule.validUntil, rule.active);
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
}
