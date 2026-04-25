// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

// ─── IdentityRegistry Interface ────────────────────────────────────────────

interface IIdentityRegistry {
    function validateSession(
        address sessionKey
    )
        external
        view
        returns (
            bool active,
            uint256 agentId,
            address user,
            address walletContract,
            uint256 valueLimit,
            uint256 maxValueAllowed,
            uint256 validUntil
        );

    function isAgentBlocked(
        address sessionKey,
        uint256 agentId
    ) external view returns (bool);

    function ownerOf(uint256 tokenId) external view returns (address);

    function registerSession(
        uint256 agentId,
        address sessionKey,
        address user,
        address walletContract,
        uint256 valueLimit,
        uint256 maxValueAllowed,
        uint256 validUntil,
        uint256[] calldata blockedAgents
    ) external;

    function revokeSession(address sessionKey) external;
}

/**
 * @title KiteAAWallet
 * @notice Multi-tenant wallet for Kite agents.
 *
 *         Users register and deposit ERC-20 tokens. AI agents authorise
 *         payments off-chain by signing an EIP-712 "Payment" message.
 *         Any party (server, facilitator, relayer, or the agent itself)
 *         can submit that signed authorisation on-chain — the contract
 *         only verifies that the session key's signature is valid.
 *
 *         This is the x402 per-call payment model and works with any
 *         ERC-20 token (USDC, USDT, DAI, etc.) without requiring the
 *         token to support EIP-3009 or EIP-2612.
 *
 *         Sessions live entirely on IdentityRegistry — this contract
 *         stores no session rules of its own.
 *         PaymentChannel uses this wallet as an escrow for streaming /
 *         batch payment channels.
 */
contract KiteAAWallet is Ownable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // ─── EIP-712 Payment authorisation ───────────────────────────────

    bytes32 private constant PAYMENT_TYPEHASH =
        keccak256(
            "Payment(uint256 agentId,address sessionKey,address recipient,address token,"
            "uint256 amount,uint256 nonce,uint256 deadline)"
        );

    // ─── Storage ──────────────────────────────────────────────────────

    struct UserAccount {
        bool registered;
    }

    /// @dev user ⟶ registered flag
    mapping(address => UserAccount) public users;

    /// @dev user ⟶ token ⟶ balance held in this wallet
    mapping(address => mapping(address => uint256)) public userBalances;

    /// @dev sessionKey ⟶ cumulative lifetime spend (enforces maxValueAllowed)
    mapping(address => uint256) public sessionSpent;

    /// @dev sessionKey ⟶ nonce ⟶ already consumed  (bitmap replay protection)
    mapping(address => mapping(uint256 => bool)) public usedNonces;

    /// @dev user ⟶ provider ⟶ blocked flag (user-level provider blocklist)
    mapping(address => mapping(address => bool)) public blockedProviders;

    address public identityRegistry;
    address public paymentChannel;

    // ─── Events ───────────────────────────────────────────────────────

    event UserRegistered(address indexed user);
    event FundsDeposited(
        address indexed user,
        address indexed token,
        uint256 amount
    );
    event FundsWithdrawn(
        address indexed user,
        address indexed token,
        uint256 amount
    );
    event ChannelFundsWithdrawn(
        address indexed user,
        address indexed token,
        uint256 amount
    );
    event ChannelFundsRefunded(
        address indexed user,
        address indexed token,
        uint256 amount
    );
    /// @dev Emitted for every settled x402 payment.
    event PaymentExecuted(
        address indexed sessionKey,
        uint256 indexed agentId,
        address indexed recipient,
        address token,
        uint256 amount,
        uint256 nonce
    );
    event IdentityRegistryUpdated(address indexed registry);
    event PaymentChannelUpdated(address indexed channel);
    event BlockedProvidersUpdated(
        address indexed user,
        address indexed provider
    );

    // ─── Modifiers ────────────────────────────────────────────────────

    modifier onlyRegistered() {
        require(users[msg.sender].registered, "Not registered");
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────

    constructor() Ownable(msg.sender) EIP712("KiteAAWallet", "1") {}

    // ─── Admin ────────────────────────────────────────────────────────

    function setIdentityRegistry(address _registry) external onlyOwner {
        require(_registry != address(0), "Invalid registry");
        identityRegistry = _registry;
        emit IdentityRegistryUpdated(_registry);
    }

    function setPaymentChannel(address _channel) external onlyOwner {
        require(_channel != address(0), "Invalid channel");
        paymentChannel = _channel;
        emit PaymentChannelUpdated(_channel);
    }

    // ─── x402 Payment ─────────────────────────────────────────────────

    /**
     * @notice Execute a payment authorised off-chain by the session key.
     *
     *         The signed payload includes the agentId — only an agent owned
     *         by the session's user can produce a valid signature for that
     *         session. Even if the session private key leaks, the attacker
     *         must also control an agent NFT belonging to the same user.
     *
     * @param agentId     The IdentityRegistry NFT tokenId of the paying agent
     * @param sessionKey  Address of the session key that signed the payment
     * @param recipient   Token recipient (service provider)
     * @param token       Any ERC-20 token
     * @param amount      Amount in token base units
     * @param nonce       Any unique uint256; bitmap replay protection
     * @param deadline    UNIX timestamp after which the signature is void
     * @param sig         65-byte EIP-712 signature from the session key
     */
    function executePayment(
        uint256 agentId,
        address sessionKey,
        address recipient,
        address token,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes calldata sig
    ) external nonReentrant {
        require(block.timestamp <= deadline, "Signature expired");
        require(!usedNonces[sessionKey][nonce], "Nonce already used");

        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    PAYMENT_TYPEHASH,
                    agentId,
                    sessionKey,
                    recipient,
                    token,
                    amount,
                    nonce,
                    deadline
                )
            )
        );

        address signer = ECDSA.recover(digest, sig);
        require(signer == sessionKey, "Invalid signature");

        // Mark nonce consumed before external call (re-entrancy safety)
        usedNonces[sessionKey][nonce] = true;

        _validateAndDebit(agentId, sessionKey, recipient, token, amount, nonce);
    }

    // ─── Session management (proxy to IdentityRegistry) ───────────────

    /**
     * @notice Register a session key rule for the caller's agent.
     *         Sessions are stored on IdentityRegistry — not in this wallet.
     * @param blockedAgents  agentIds that may NOT use this session key.
     */
    function addSessionKeyRule(
        uint256 agentId,
        address sessionKey,
        uint256 valueLimit,
        uint256 maxValueAllowed,
        uint256 validUntil,
        uint256[] calldata blockedAgents
    ) external onlyRegistered {
        IIdentityRegistry(identityRegistry).registerSession(
            agentId,
            sessionKey,
            msg.sender,
            address(this),
            valueLimit,
            maxValueAllowed,
            validUntil,
            blockedAgents
        );
    }

    function revokeSessionKey(address sessionKey) external onlyRegistered {
        IIdentityRegistry(identityRegistry).revokeSession(sessionKey);
    }

    // ─── User-level provider blocklist ────────────────────────────────

    /**
     * @notice Set or unset a provider address in the caller's blocked list.
     *         Payments to a blocked provider are rejected regardless of
     *         which session key is used.
     */
    function setBlockedProvider(
        address provider,
        bool blocked
    ) external onlyRegistered {
        require(provider != address(0), "Invalid provider");
        blockedProviders[msg.sender][provider] = blocked;
        emit BlockedProvidersUpdated(msg.sender, provider);
    }

    /**
     * @notice Batch update the blocked provider list.
     */
    function setBlockedProviders(
        address[] calldata providers,
        bool blocked
    ) external onlyRegistered {
        for (uint256 i = 0; i < providers.length; i++) {
            require(providers[i] != address(0), "Invalid provider");
            blockedProviders[msg.sender][providers[i]] = blocked;
            emit BlockedProvidersUpdated(msg.sender, providers[i]);
        }
    }

    function isProviderBlocked(
        address user,
        address provider
    ) external view returns (bool) {
        return blockedProviders[user][provider];
    }

    // ─── User lifecycle ───────────────────────────────────────────────
    function register() external {
        require(!users[msg.sender].registered, "Already registered");
        users[msg.sender].registered = true;
        emit UserRegistered(msg.sender);
    }

    function deposit(address token, uint256 amount) external onlyRegistered {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        userBalances[msg.sender][token] += amount;
        emit FundsDeposited(msg.sender, token, amount);
    }

    function withdraw(
        address token,
        uint256 amount
    ) external onlyRegistered nonReentrant {
        require(
            userBalances[msg.sender][token] >= amount,
            "Insufficient balance"
        );
        userBalances[msg.sender][token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit FundsWithdrawn(msg.sender, token, amount);
    }

    // ─── PaymentChannel integration ───────────────────────────────────

    function withdrawForChannel(
        address user,
        address token,
        uint256 amount
    ) external nonReentrant {
        require(msg.sender == paymentChannel, "Only PaymentChannel");
        require(users[user].registered, "User not registered");
        require(
            userBalances[user][token] >= amount,
            "Insufficient balance for channel"
        );
        userBalances[user][token] -= amount;
        IERC20(token).safeTransfer(paymentChannel, amount);
        emit ChannelFundsWithdrawn(user, token, amount);
    }

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

    // ─── Views ────────────────────────────────────────────────────────

    function getUserBalance(
        address user,
        address token
    ) external view returns (uint256) {
        return userBalances[user][token];
    }

    function isRegistered(address user) external view returns (bool) {
        return users[user].registered;
    }

    function getSessionSpent(
        address sessionKey
    ) external view returns (uint256) {
        return sessionSpent[sessionKey];
    }

    /// @notice Pre-flight replay check — returns true if this nonce was already used.
    function isNonceUsed(
        address sessionKey,
        uint256 nonce
    ) external view returns (bool) {
        return usedNonces[sessionKey][nonce];
    }

    // ─── Internal ─────────────────────────────────────────────────────

    function _validateAndDebit(
        uint256 agentId,
        address sessionKey,
        address recipient,
        address token,
        uint256 amount,
        uint256 nonce
    ) internal {
        (
            bool active,
            uint256 sessionAgentId,
            address user,
            address walletContract,
            uint256 valueLimit,
            uint256 maxValueAllowed,
            uint256 validUntil
        ) = IIdentityRegistry(identityRegistry).validateSession(sessionKey);

        require(active, "Session key not active");
        require(block.timestamp <= validUntil, "Session key expired");
        require(walletContract == address(this), "Session not for this wallet");
        require(amount <= valueLimit, "Exceeds per-tx limit");

        // The agentId in the signed payload must own this session (session.agentId == agentId)
        require(sessionAgentId == agentId, "Agent/session mismatch");

        // The agent must be owned by the session's user (prevents cross-user agent usage)
        require(
            IIdentityRegistry(identityRegistry).ownerOf(agentId) == user,
            "Agent not owned by session user"
        );

        // This agentId must not be in the session's blocked list
        require(
            !IIdentityRegistry(identityRegistry).isAgentBlocked(
                sessionKey,
                agentId
            ),
            "Agent is blocked for this session"
        );

        // The recipient must not be in the user's blocked provider list
        require(
            !blockedProviders[user][recipient],
            "Recipient is blocked by user"
        );

        require(
            sessionSpent[sessionKey] + amount <= maxValueAllowed,
            "Exceeds session limit"
        );

        sessionSpent[sessionKey] += amount;

        require(userBalances[user][token] >= amount, "Insufficient balance");
        userBalances[user][token] -= amount;

        IERC20(token).safeTransfer(recipient, amount);
        emit PaymentExecuted(
            sessionKey,
            agentId,
            recipient,
            token,
            amount,
            nonce
        );
    }

    receive() external payable {}
}
