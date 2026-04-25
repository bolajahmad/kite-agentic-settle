// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

// ─── Interfaces ────────────────────────────────────────────────────────────

interface IKiteAAWallet {
    function withdrawForChannel(
        address user,
        address token,
        uint256 amount
    ) external;

    function refundFromChannel(
        address user,
        address token,
        uint256 amount
    ) external;

    function getUserBalance(
        address user,
        address token
    ) external view returns (uint256);

    function identityRegistry() external view returns (address);

    function isRegistered(address user) external view returns (bool);

    function isProviderBlocked(
        address user,
        address provider
    ) external view returns (bool);
}

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
}

/**
 * @title PaymentChannel
 * @notice Manages payment channels between agent consumers and providers.
 *         Supports prepaid (escrow) and postpaid (credit) modes.
 *
 *         Session validation is fully delegated to IdentityRegistry —
 *         this contract never holds session state. The consumer's identity
 *         (EOA / user) is read from the registry at channel open time.
 *
 *         Uses a challenge-based settlement model:
 *           Open → Active → SettlementPending → Closed
 *
 *         During the challenge window ANYONE can submit a higher valid receipt.
 *         After the window closes, `finalize()` settles based on the highest
 *         receipt seen.
 *
 *         Merkle roots are stored for audit / attestation purposes only —
 *         they do NOT determine payment amounts.
 */
contract PaymentChannel is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    enum ChannelStatus {
        Open,
        Active,
        SettlementPending,
        Closed
    }
    enum PaymentMode {
        Prepaid,
        Postpaid
    }

    struct Channel {
        bytes32 channelId;
        address consumer; // session key that opened the channel
        address user; // EOA (derived from session at open)
        address walletContract; // KiteAAWallet holding the user's funds
        address provider;
        address token;
        PaymentMode mode;
        uint256 deposit;
        uint256 maxSpend;
        uint256 maxDuration;
        uint256 openedAt;
        uint256 expiresAt;
        uint256 maxPerCall;
        uint256 settledAmount;
        bytes32 usageMerkleRoot;
        ChannelStatus status;
        uint256 settlementDeadline;
        uint256 highestClaimedCost;
        uint256 highestSequenceNumber;
        address settlementInitiator;
    }

    mapping(bytes32 => Channel) public channels;
    uint256 public totalChannels;

    // walletContract => token => locked amount
    mapping(address => mapping(address => uint256)) public lockedFunds;

    uint256 public constant CHALLENGE_WINDOW = 1 hours;
    uint256 public constant CLOSE_GRACE_PERIOD = 5 minutes;

    // ─── Events ────────────────────────────────────────────────────────

    event ChannelOpened(
        bytes32 indexed channelId,
        address indexed consumer,
        address indexed provider,
        address token,
        PaymentMode mode,
        uint256 deposit,
        uint256 maxSpend,
        uint256 maxDuration,
        uint256 maxPerCall,
        address walletContract
    );
    event ChannelActivated(bytes32 indexed channelId);
    event SettlementInitiated(
        bytes32 indexed channelId,
        address indexed initiator,
        uint256 claimedAmount,
        uint256 settlementDeadline
    );
    event ReceiptSubmitted(
        bytes32 indexed channelId,
        address indexed submitter,
        uint256 sequenceNumber,
        uint256 cumulativeCost
    );
    event ChannelFinalized(
        bytes32 indexed channelId,
        uint256 payment,
        uint256 refund,
        bytes32 usageMerkleRoot
    );
    event FundsLocked(
        address indexed wallet,
        address indexed token,
        uint256 amount
    );
    event FundsUnlocked(
        address indexed wallet,
        address indexed token,
        uint256 amount
    );

    // ─── Modifiers ─────────────────────────────────────────────────────

    modifier onlyChannelParty(bytes32 channelId) {
        Channel storage ch = channels[channelId];
        require(
            msg.sender == ch.consumer || msg.sender == ch.provider,
            "Not a channel party"
        );
        _;
    }

    modifier channelInStatus(bytes32 channelId, ChannelStatus expected) {
        require(
            channels[channelId].status == expected,
            "Invalid channel status"
        );
        _;
    }

    // ─── Channel Lifecycle ─────────────────────────────────────────────

    /**
     * @notice Open a new payment channel.
     *         `msg.sender` MUST be an active session key registered in
     *         IdentityRegistry (via the wallet contract).
     *
     *         Session limits are enforced:
     *           - maxPerCall ≤ session.valueLimit
     *           - maxSpend   ≤ session.maxValueAllowed
     *           - channel expiry ≤ session.validUntil
     *           - provider ∉ session.blockedProviders
     *
     *         The EOA `user` and `walletContract` are derived from the session
     *         rule — callers do not pass them.
     *
     * @param provider       Provider agent address
     * @param token          ERC20 token address
     * @param mode           Prepaid or Postpaid
     * @param deposit        Amount to lock (> 0 for prepaid, 0 for postpaid)
     * @param maxSpend       Hard cap on total payment
     * @param maxDuration    Channel duration in seconds
     * @param maxPerCall     Ceiling on cost for any single API call
     * @param walletContract The KiteAAWallet where msg.sender is a registered session key
     */
    function openChannel(
        address provider,
        address token,
        PaymentMode mode,
        uint256 deposit,
        uint256 maxSpend,
        uint256 maxDuration,
        uint256 maxPerCall,
        address walletContract
    ) external nonReentrant returns (bytes32 channelId) {
        require(
            provider != address(0) && provider != msg.sender,
            "Invalid provider"
        );
        require(token != address(0), "Invalid token");
        require(maxDuration > 0 && maxDuration <= 30 days, "Invalid duration");
        require(maxPerCall > 0, "maxPerCall must be > 0");
        require(walletContract != address(0), "Wallet contract required");

        // ── Session validation via IdentityRegistry ────────────────────
        IKiteAAWallet wallet = IKiteAAWallet(walletContract);
        address registry = wallet.identityRegistry();
        require(registry != address(0), "Wallet has no IdentityRegistry");

        IIdentityRegistry identityRegistry = IIdentityRegistry(registry);
        (
            bool active, // agentId
            ,
            address user,
            address sessionWallet,
            uint256 valueLimit,
            uint256 maxValueAllowed,
            uint256 validUntil
        ) = identityRegistry.validateSession(msg.sender);

        require(active, "Session key is not active");
        require(block.timestamp <= validUntil, "Session key expired");
        require(
            sessionWallet == walletContract,
            "Session not registered to this wallet"
        );
        require(
            maxPerCall <= valueLimit,
            "maxPerCall exceeds session valueLimit"
        );
        require(
            maxSpend <= maxValueAllowed,
            "maxSpend exceeds session maxValueAllowed"
        );
        require(
            block.timestamp + maxDuration <= validUntil,
            "Channel duration exceeds session validity"
        );
        require(
            !wallet.isProviderBlocked(user, provider),
            "Provider is blocked by this user"
        );
        // ─────────────────────────────────────────────────────────────────

        if (mode == PaymentMode.Prepaid) {
            require(deposit > 0, "Prepaid requires deposit");
            require(maxSpend > 0, "Max spend must be > 0");
            require(deposit <= maxSpend, "Deposit exceeds maxSpend");
            require(
                deposit <= wallet.getUserBalance(user, token),
                "Insufficient wallet balance for deposit"
            );
            wallet.withdrawForChannel(user, token, deposit);
            lockedFunds[walletContract][token] += deposit;
            emit FundsLocked(walletContract, token, deposit);
        } else {
            require(deposit == 0, "Postpaid must have 0 deposit");
            require(maxSpend > 0, "Max spend must be > 0");
        }

        totalChannels++;
        channelId = keccak256(
            abi.encodePacked(
                msg.sender,
                provider,
                token,
                totalChannels,
                block.timestamp
            )
        );

        channels[channelId] = Channel({
            channelId: channelId,
            consumer: msg.sender,
            user: user,
            walletContract: walletContract,
            provider: provider,
            token: token,
            mode: mode,
            deposit: deposit,
            maxSpend: maxSpend,
            maxDuration: maxDuration,
            openedAt: block.timestamp,
            expiresAt: block.timestamp + maxDuration,
            maxPerCall: maxPerCall,
            settledAmount: 0,
            usageMerkleRoot: bytes32(0),
            status: ChannelStatus.Open,
            settlementDeadline: 0,
            highestClaimedCost: 0,
            highestSequenceNumber: 0,
            settlementInitiator: address(0)
        });

        emit ChannelOpened(
            channelId,
            msg.sender,
            provider,
            token,
            mode,
            deposit,
            maxSpend,
            maxDuration,
            maxPerCall,
            walletContract
        );
    }

    /**
     * @notice Provider acknowledges the channel, moving it to Active.
     */
    function activateChannel(
        bytes32 channelId
    ) external channelInStatus(channelId, ChannelStatus.Open) {
        Channel storage ch = channels[channelId];
        require(msg.sender == ch.provider, "Only provider can activate");
        ch.status = ChannelStatus.Active;
        emit ChannelActivated(channelId);
    }

    // ─── Settlement ────────────────────────────────────────────────────

    /**
     * @notice Initiate settlement. Either party can call this.
     *         Opens the challenge window so anyone can submit a higher receipt.
     *
     *         Pass sequenceNumber = 0 and cumulativeCost = 0 with empty signature
     *         to claim zero usage.
     */
    function initiateSettlement(
        bytes32 channelId,
        uint256 sequenceNumber,
        uint256 cumulativeCost,
        uint256 timestamp,
        bytes calldata providerSignature,
        bytes32 merkleRoot
    ) external nonReentrant onlyChannelParty(channelId) {
        Channel storage ch = channels[channelId];
        require(
            ch.status == ChannelStatus.Active ||
                ch.status == ChannelStatus.Open,
            "Channel not settleable"
        );

        if (cumulativeCost > 0 || sequenceNumber > 0) {
            _verifyReceipt(
                ch,
                channelId,
                sequenceNumber,
                cumulativeCost,
                timestamp,
                providerSignature
            );
            ch.highestClaimedCost = cumulativeCost;
            ch.highestSequenceNumber = sequenceNumber;
        }

        ch.usageMerkleRoot = merkleRoot;
        ch.status = ChannelStatus.SettlementPending;
        ch.settlementDeadline = block.timestamp + CHALLENGE_WINDOW;
        ch.settlementInitiator = msg.sender;

        emit SettlementInitiated(
            channelId,
            msg.sender,
            cumulativeCost,
            ch.settlementDeadline
        );
    }

    /**
     * @notice Submit a higher receipt during the challenge window. Permissionless.
     */
    function submitReceipt(
        bytes32 channelId,
        uint256 sequenceNumber,
        uint256 cumulativeCost,
        uint256 timestamp,
        bytes calldata providerSignature
    )
        external
        nonReentrant
        channelInStatus(channelId, ChannelStatus.SettlementPending)
    {
        Channel storage ch = channels[channelId];
        require(
            block.timestamp <= ch.settlementDeadline,
            "Challenge window closed"
        );
        require(
            cumulativeCost > ch.highestClaimedCost,
            "Not higher than current claim"
        );

        _verifyReceipt(
            ch,
            channelId,
            sequenceNumber,
            cumulativeCost,
            timestamp,
            providerSignature
        );
        ch.highestClaimedCost = cumulativeCost;
        ch.highestSequenceNumber = sequenceNumber;

        emit ReceiptSubmitted(
            channelId,
            msg.sender,
            sequenceNumber,
            cumulativeCost
        );
    }

    /**
     * @notice Finalize settlement after the challenge window closes.
     *         Anyone can call this.
     */
    function finalize(
        bytes32 channelId,
        bytes32 merkleRoot
    )
        external
        nonReentrant
        channelInStatus(channelId, ChannelStatus.SettlementPending)
    {
        Channel storage ch = channels[channelId];
        require(
            block.timestamp > ch.settlementDeadline,
            "Challenge window still open"
        );

        if (merkleRoot != bytes32(0)) {
            ch.usageMerkleRoot = merkleRoot;
        }

        _settle(channelId, ch.highestClaimedCost);
    }

    /**
     * @notice Force-close an expired channel. Anyone can call after expiry + grace period.
     */
    function forceCloseExpired(bytes32 channelId) external nonReentrant {
        Channel storage ch = channels[channelId];
        require(
            ch.status == ChannelStatus.Active ||
                ch.status == ChannelStatus.Open,
            "Channel not closeable"
        );
        require(
            block.timestamp >= ch.expiresAt + CLOSE_GRACE_PERIOD,
            "Not yet expired + grace"
        );

        ch.status = ChannelStatus.SettlementPending;
        ch.settlementDeadline = block.timestamp + CHALLENGE_WINDOW;
        ch.settlementInitiator = msg.sender;

        emit SettlementInitiated(
            channelId,
            msg.sender,
            0,
            ch.settlementDeadline
        );
    }

    // ─── Internal ──────────────────────────────────────────────────────

    function _verifyReceipt(
        Channel storage ch,
        bytes32 channelId,
        uint256 sequenceNumber,
        uint256 cumulativeCost,
        uint256 timestamp,
        bytes calldata providerSignature
    ) internal view {
        require(sequenceNumber > 0, "Invalid sequence number");
        require(cumulativeCost > 0, "Cost must be > 0");
        require(cumulativeCost <= ch.maxSpend, "Exceeds max spend");
        require(
            cumulativeCost <= (sequenceNumber * ch.maxPerCall),
            "Cumulative exceeds maxPerCall ceiling"
        );

        bytes32 receiptHash = getReceiptHash(
            channelId,
            sequenceNumber,
            cumulativeCost,
            timestamp
        );
        address signer = receiptHash.toEthSignedMessageHash().recover(
            providerSignature
        );
        require(signer == ch.provider, "Invalid provider signature");
    }

    function _settle(bytes32 channelId, uint256 amount) internal {
        Channel storage ch = channels[channelId];

        if (ch.mode == PaymentMode.Prepaid) {
            uint256 payment = amount > ch.deposit ? ch.deposit : amount;
            uint256 refund = ch.deposit - payment;

            if (payment > 0) {
                IERC20(ch.token).safeTransfer(ch.provider, payment);
            }

            if (refund > 0 && ch.walletContract != address(0)) {
                // Approve wallet to pull refund back from PaymentChannel
                IERC20(ch.token).approve(ch.walletContract, refund);
                IKiteAAWallet(ch.walletContract).refundFromChannel(
                    ch.user,
                    ch.token,
                    refund
                );
            } else if (refund > 0) {
                IERC20(ch.token).safeTransfer(ch.consumer, refund);
            }

            lockedFunds[ch.walletContract][ch.token] -= ch.deposit;
            emit FundsUnlocked(ch.walletContract, ch.token, ch.deposit);

            ch.settledAmount = payment;
            emit ChannelFinalized(
                channelId,
                payment,
                refund,
                ch.usageMerkleRoot
            );
        } else {
            if (amount > 0) {
                IERC20(ch.token).safeTransferFrom(
                    ch.consumer,
                    ch.provider,
                    amount
                );
            }
            ch.settledAmount = amount;
            emit ChannelFinalized(channelId, amount, 0, ch.usageMerkleRoot);
        }

        ch.status = ChannelStatus.Closed;
    }

    // ─── View Functions ────────────────────────────────────────────────

    function getChannel(
        bytes32 channelId
    )
        external
        view
        returns (
            address consumer,
            address user,
            address provider,
            address token,
            PaymentMode mode,
            uint256 deposit,
            uint256 maxSpend,
            uint256 maxDuration,
            uint256 openedAt,
            uint256 expiresAt,
            uint256 maxPerCall,
            uint256 settledAmount,
            ChannelStatus status,
            uint256 settlementDeadline,
            uint256 highestClaimedCost,
            uint256 highestSequenceNumber,
            address walletContract
        )
    {
        Channel storage ch = channels[channelId];
        return (
            ch.consumer,
            ch.user,
            ch.provider,
            ch.token,
            ch.mode,
            ch.deposit,
            ch.maxSpend,
            ch.maxDuration,
            ch.openedAt,
            ch.expiresAt,
            ch.maxPerCall,
            ch.settledAmount,
            ch.status,
            ch.settlementDeadline,
            ch.highestClaimedCost,
            ch.highestSequenceNumber,
            ch.walletContract
        );
    }

    function isChannelExpired(bytes32 channelId) external view returns (bool) {
        return block.timestamp >= channels[channelId].expiresAt;
    }

    function getChannelTimeRemaining(
        bytes32 channelId
    ) external view returns (uint256) {
        Channel storage ch = channels[channelId];
        if (block.timestamp >= ch.expiresAt) return 0;
        return ch.expiresAt - block.timestamp;
    }

    function getReceiptHash(
        bytes32 channelId,
        uint256 sequenceNumber,
        uint256 cumulativeCost,
        uint256 timestamp
    ) public pure returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    channelId,
                    sequenceNumber,
                    cumulativeCost,
                    timestamp
                )
            );
    }

    function getLockedFunds(
        address wallet,
        address token
    ) external view returns (uint256) {
        return lockedFunds[wallet][token];
    }

    function getSettlementState(
        bytes32 channelId
    )
        external
        view
        returns (
            uint256 deadline,
            uint256 highestCost,
            uint256 highestSeq,
            address initiator,
            bool challengeOpen
        )
    {
        Channel storage ch = channels[channelId];
        return (
            ch.settlementDeadline,
            ch.highestClaimedCost,
            ch.highestSequenceNumber,
            ch.settlementInitiator,
            ch.status == ChannelStatus.SettlementPending &&
                block.timestamp <= ch.settlementDeadline
        );
    }
}
