// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

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
 *
 *         Session keys use a blocklist model: agents can call ANY provider
 *         except those explicitly blocked. The blocklist can be updated at
 *         any time by the session owner without creating a new session.
 */
contract KiteAAWallet is Ownable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    bytes32 private constant PAYMENT_TYPEHASH = keccak256(
        "PaymentAuthorization(address sessionKey,address recipient,address token,uint256 amount,uint256 nonce,uint256 deadline)"
    );

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
        uint256 maxValueAllowed;   // lifetime cap on total spend for this session key
        uint256 validUntil;        // expiry timestamp
        address[] blockedProviders; // providers the agent is NOT allowed to pay
        bool active;
    }

    // EOA => UserAccount
    mapping(address => UserAccount) public users;
    // user => token => balance
    mapping(address => mapping(address => uint256)) public userBalances;
    // session key address => rule
    mapping(address => SessionKeyRule) public sessionKeys;
    // session key => cumulative amount spent over its lifetime
    mapping(address => uint256) public sessionSpent;
    // agent id => list of session key addresses
    mapping(bytes32 => address[]) public agentSessions;
    // session key => nonce for replay protection in executePaymentBySig
    mapping(address => uint256) public paymentNonces;

    address public agentRegistry;
    address public paymentChannel;

    event UserRegistered(address indexed user);
    event AgentLinked(address indexed user, bytes32 indexed agentId);
    event SessionKeyAdded(
        address indexed sessionKey,
        address indexed user,
        bytes32 indexed agentId,
        uint256 sessionIndex,
        bytes32 metadataHash,
        uint256 valueLimit,
        uint256 maxValueAllowed,
        uint256 validUntil,
        bytes   metadata
    );
    event SessionKeyRevoked(address indexed sessionKey, bytes32 indexed agentId);
    event SessionBlockedProvidersUpdated(address indexed sessionKey, address[] blockedProviders);
    event ProviderBlocked(address indexed sessionKey, address indexed provider);
    event ProviderUnblocked(address indexed sessionKey, address indexed provider);
    event PaymentExecuted(
        address indexed sessionKey,
        bytes32 indexed agentId,
        address indexed recipient,
        address token,
        uint256 amount
    );
    event PaymentExecutedBySig(
        address indexed sessionKey,
        bytes32 indexed agentId,
        address indexed recipient,
        address token,
        uint256 amount,
        uint256 nonce
    );
    event FundsDeposited(address indexed user, address indexed token, uint256 amount);
    event FundsWithdrawn(address indexed user, address indexed token, uint256 amount);
    event AgentRegistryUpdated(address indexed registry);
    event PaymentChannelUpdated(address indexed paymentChannel);
    event ChannelFundsWithdrawn(address indexed user, address indexed token, uint256 amount);
    event ChannelFundsRefunded(address indexed user, address indexed token, uint256 amount);

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

    constructor() Ownable(msg.sender) EIP712("KiteAAWallet", "1") {}

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

    function setPaymentChannel(address _paymentChannel) external onlyOwner {
        require(_paymentChannel != address(0), "Invalid payment channel");
        paymentChannel = _paymentChannel;
        emit PaymentChannelUpdated(_paymentChannel);
    }

    // ─── User Functions ────────────────────────────────────────────────

    /**
     * @notice Link an agentId to a user's wallet account. Can be called by:
     *         1. The registered user themselves (msg.sender == owner)
     *         2. The AgentRegistry contract (auto-linking after agent registration)
     * @param agentId The agent identifier to link
     * @param owner The EOA user that owns this agent (only used when called by registry)
     */
    function addAgentId(bytes32 agentId, address owner) external {
        // Allow the AgentRegistry to call this on behalf of the owner
        if (msg.sender == agentRegistry) {
            require(users[owner].registered, "Owner not registered");
            users[owner].agentIds.push(agentId);
            emit AgentLinked(owner, agentId);
            return;
        }
        // Otherwise, only the registered user themselves
        require(users[msg.sender].registered, "Not registered");
        users[msg.sender].agentIds.push(agentId);
        emit AgentLinked(msg.sender, agentId);
    }

    function addSessionKeyRule(
        address sessionKeyAddress,
        bytes32 agentId,
        uint256 sessionIndex,
        uint256 valueLimit,
        uint256 maxValueAllowed,
        uint256 validUntil,
        address[] calldata blockedProviders,
        bytes calldata metadata
    ) external onlyRegistered {
        require(sessionKeyAddress != address(0), "Invalid session key");
        require(validUntil > block.timestamp, "Expiry must be in future");
        require(valueLimit > 0, "Value limit must be > 0");
        require(maxValueAllowed >= valueLimit, "maxValueAllowed must be >= valueLimit");

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
            maxValueAllowed: maxValueAllowed,
            validUntil: validUntil,
            blockedProviders: blockedProviders,
            active: true
        });

        agentSessions[agentId].push(sessionKeyAddress);

        // Sync to AgentRegistry
        if (agentRegistry != address(0)) {
            IAgentRegistry(agentRegistry).registerSession(agentId, sessionKeyAddress, sessionIndex, validUntil);
        }

        emit SessionKeyAdded(sessionKeyAddress, msg.sender, agentId, sessionIndex, mHash, valueLimit, maxValueAllowed, validUntil, metadata);
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

    // ─── Session Blocklist Management ──────────────────────────────────

    /**
     * @notice Replace the entire blocked providers list for a session key.
     *         Only the session's owner (EOA) can update this.
     */
    function updateBlockedProviders(
        address sessionKeyAddress,
        address[] calldata newBlockedProviders
    ) external onlyRegistered {
        SessionKeyRule storage rule = sessionKeys[sessionKeyAddress];
        require(rule.user == msg.sender, "Not session owner");
        require(rule.active, "Session not active");
        rule.blockedProviders = newBlockedProviders;
        emit SessionBlockedProvidersUpdated(sessionKeyAddress, newBlockedProviders);
    }

    /**
     * @notice Add a single provider to the blocklist. No-op if already blocked.
     */
    function blockProvider(address sessionKeyAddress, address provider) external onlyRegistered {
        SessionKeyRule storage rule = sessionKeys[sessionKeyAddress];
        require(rule.user == msg.sender, "Not session owner");
        require(rule.active, "Session not active");

        // Check if already blocked
        for (uint256 i = 0; i < rule.blockedProviders.length; i++) {
            if (rule.blockedProviders[i] == provider) return; // already blocked
        }
        rule.blockedProviders.push(provider);
        emit ProviderBlocked(sessionKeyAddress, provider);
    }

    /**
     * @notice Remove a single provider from the blocklist.
     */
    function unblockProvider(address sessionKeyAddress, address provider) external onlyRegistered {
        SessionKeyRule storage rule = sessionKeys[sessionKeyAddress];
        require(rule.user == msg.sender, "Not session owner");
        require(rule.active, "Session not active");

        address[] storage blocked = rule.blockedProviders;
        for (uint256 i = 0; i < blocked.length; i++) {
            if (blocked[i] == provider) {
                blocked[i] = blocked[blocked.length - 1];
                blocked.pop();
                emit ProviderUnblocked(sessionKeyAddress, provider);
                return;
            }
        }
    }

    /**
     * @notice Returns true when `provider` appears in the session key's
     *         blockedProviders list. Called by PaymentChannel during openChannel.
     */
    function isProviderBlocked(address sessionKeyAddress, address provider)
        external
        view
        returns (bool)
    {
        address[] storage blocked = sessionKeys[sessionKeyAddress].blockedProviders;
        for (uint256 i = 0; i < blocked.length; i++) {
            if (blocked[i] == provider) return true;
        }
        return false;
    }

    /**
     * @notice Called by the PaymentChannel contract to lock funds for a channel.
     *         The agent opens the channel, but funds are pulled from the EOA's
     *         (user's) balance inside this wallet contract.
     * @param user   The EOA whose balance is debited.
     * @param token  ERC20 token.
     * @param amount Amount to lock in the channel.
     */
    function withdrawForChannel(
        address user,
        address token,
        uint256 amount
    ) external nonReentrant {
        require(msg.sender == paymentChannel, "Only PaymentChannel");
        require(users[user].registered, "User not registered");
        require(userBalances[user][token] >= amount, "Insufficient balance for channel");
        userBalances[user][token] -= amount;
        IERC20(token).safeTransfer(paymentChannel, amount);
        emit ChannelFundsWithdrawn(user, token, amount);
    }

    /**
     * @notice Called by the PaymentChannel contract to return unused deposit
     *         back to the EOA's balance after channel settlement.
     * @param user   The EOA to credit.
     * @param token  ERC20 token.
     * @param amount Amount to return.
     */
    function refundFromChannel(
        address user,
        address token,
        uint256 amount
    ) external nonReentrant {
        require(msg.sender == paymentChannel, "Only PaymentChannel");
        require(users[user].registered, "User not registered");
        IERC20(token).safeTransferFrom(paymentChannel, address(this), amount);
        userBalances[user][token] += amount;
        emit ChannelFundsRefunded(user, token, amount);
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

        // Recipient blocklist check (blocked providers cannot receive payments)
        for (uint256 i = 0; i < rule.blockedProviders.length; i++) {
            require(rule.blockedProviders[i] != recipient, "Recipient is blocked");
        }

        // Lifetime session spend cap
        require(sessionSpent[sessionKey] + amount <= rule.maxValueAllowed, "Exceeds session limit");
        sessionSpent[sessionKey] += amount;

        // Deduct from the user's balance
        require(userBalances[rule.user][token] >= amount, "Insufficient user balance");
        userBalances[rule.user][token] -= amount;

        // Execute transfer
        IERC20(token).safeTransfer(recipient, amount);

        emit PaymentExecuted(sessionKey, rule.agentId, recipient, token, amount);
    }

    /**
     * @notice Execute a payment authorised by the session key holder via EIP-712 signature.
     *         Called by a facilitator (e.g. the provider's backend). The facilitator pays
     *         gas; the session key owner's balance in this contract is debited.
     * @param sessionKey The session key that signed the authorisation
     * @param recipient  The service provider receiving payment
     * @param token      The ERC20 stablecoin address
     * @param amount     The payment amount
     * @param nonce      Must equal paymentNonces[sessionKey] (replay protection)
     * @param deadline   Unix timestamp after which the signature is invalid
     * @param v          ECDSA recovery id
     * @param r          ECDSA signature component
     * @param s          ECDSA signature component
     */
    function executePaymentBySig(
        address sessionKey,
        address recipient,
        address token,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant onlyActiveSession(sessionKey) {
        require(block.timestamp <= deadline, "Signature expired");
        require(nonce == paymentNonces[sessionKey], "Invalid nonce");

        // Recover signer from EIP-712 digest
        bytes32 structHash = keccak256(abi.encode(
            PAYMENT_TYPEHASH,
            sessionKey,
            recipient,
            token,
            amount,
            nonce,
            deadline
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, v, r, s);
        require(signer == sessionKey, "Invalid signature");

        SessionKeyRule storage rule = sessionKeys[sessionKey];

        // Per-transaction limit
        require(amount <= rule.valueLimit, "Exceeds per-tx limit");

        // Recipient blocklist check
        for (uint256 i = 0; i < rule.blockedProviders.length; i++) {
            require(rule.blockedProviders[i] != recipient, "Recipient is blocked");
        }

        // Lifetime session spend cap
        require(sessionSpent[sessionKey] + amount <= rule.maxValueAllowed, "Exceeds session limit");
        sessionSpent[sessionKey] += amount;

        // Deduct from the user's balance
        require(userBalances[rule.user][token] >= amount, "Insufficient user balance");
        userBalances[rule.user][token] -= amount;

        // Increment nonce to prevent replay
        paymentNonces[sessionKey] += 1;

        // Execute transfer
        IERC20(token).safeTransfer(recipient, amount);

        emit PaymentExecutedBySig(sessionKey, rule.agentId, recipient, token, amount, nonce);
    }

    function getSessionRule(address sessionKey) external view returns (
        address user,
        bytes32 agentId,
        uint256 valueLimit,
        uint256 maxValueAllowed,
        uint256 validUntil,
        bool active
    ) {
        SessionKeyRule storage rule = sessionKeys[sessionKey];
        return (rule.user, rule.agentId, rule.valueLimit, rule.maxValueAllowed, rule.validUntil, rule.active);
    }

    function getSessionBlockedProviders(address sessionKey) external view returns (address[] memory) {
        return sessionKeys[sessionKey].blockedProviders;
    }

    function getAgentSessionKeys(bytes32 agentId) external view returns (address[] memory) {
        return agentSessions[agentId];
    }

    function getSessionSpent(address sessionKey) external view returns (uint256 spent) {
        return sessionSpent[sessionKey];
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

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
