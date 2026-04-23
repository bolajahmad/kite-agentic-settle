// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @dev Minimal interface for pulling/refunding funds from KiteAAWallet and
 *      reading session key rules.
 */
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

    /**
     * @notice Returns all fields of a session key rule (matches the auto-generated
     *         public getter for the `sessionKeys` mapping in KiteAAWallet).
     *         `blockedProviders` is the address[] stored in the rule.
     */
    function sessionKeys(
        address sessionKey
    )
        external
        view
        returns (
            address user,
            bytes32 agentId,
            uint256 sessionIndex,
            bytes32 metadataHash,
            uint256 valueLimit,
            uint256 maxValueAllowed,
            uint256 validUntil,
            bool active
        );

    /**
     * @notice Returns true when `provider` appears in the session key's
     *         blockedProviders list.
     */
    function isProviderBlocked(
        address sessionKey,
        address provider
    ) external view returns (bool);

    /**
     * @notice Returns the deposited token balance for `user` inside the wallet.
     */
    function getUserBalance(
        address user,
        address token
    ) external view returns (uint256);
}

/**
 * @title PaymentChannel
 * @notice Manages payment channels between agent consumers and providers.
 *         Supports prepaid (escrow) and postpaid (credit) modes.
 *
 *         Uses a challenge-based settlement model:
 *           Open → Active → SettlementPending → Closed
 *
 *         When either party initiates settlement, a challenge window opens.
 *         During this window ANYONE can submit a higher valid receipt (permissionless).
 *         After the window closes, `finalize()` settles based on the highest
 *         receipt seen, ensuring neither party can cheat — even if the other
 *         is offline at settlement time.
 *
 *         Merkle roots are stored for audit / attestation / reputation purposes
 *         only — they do NOT determine payment amounts.
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
        address consumer; // agent/session-key address (makes API calls)
        address walletContract; // KiteAAWallet contract; user (EOA) is derived from session key
        address provider; // provider agent's address
        address token; // ERC20 token for payment
        PaymentMode mode;
        uint256 deposit; // locked funds (0 for postpaid)
        uint256 maxSpend; // hard cap on total payment
        uint256 maxDuration; // seconds
        uint256 openedAt;
        uint256 expiresAt;
        uint256 maxPerCall; // ceiling on cost for any single API call
        uint256 settledAmount; // final settlement amount (set on finalize)
        bytes32 usageMerkleRoot; // optional: root for off-chain audit / attestation
        ChannelStatus status;
        // Settlement state
        uint256 settlementDeadline; // challenge window end timestamp
        uint256 highestClaimedCost; // best valid cumulativeCost submitted so far
        uint256 highestSequenceNumber; // sequence number of the best receipt
        address settlementInitiator; // who started settlement
    }

    mapping(bytes32 => Channel) public channels;
    uint256 public totalChannels;

    // Tracks which KiteAAWallet funds are locked in channels
    // wallet address => token => locked amount
    mapping(address => mapping(address => uint256)) public lockedFunds;

    // Challenge window: how long parties have to submit counter-evidence
    uint256 public constant CHALLENGE_WINDOW = 1 hours;
    // Grace period after expiry before anyone can force-close
    uint256 public constant CLOSE_GRACE_PERIOD = 5 minutes;

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
     *         `msg.sender` must be a registered, non-expired session key in `walletContract`.
     *         The session key's limits are enforced:
     *           - maxPerCall  ≤ sessionKey.valueLimit
     *           - maxSpend    ≤ sessionKey.dailyLimit
     *           - channel expiry ≤ sessionKey.validUntil
     *           - provider    ∉ sessionKey.blockedProviders
     *         The EOA `user` is derived from the session key — callers do not pass it.
     *         For prepaid mode the deposit is pulled from the user's KiteAAWallet balance.
     * @param provider        The provider agent address
     * @param token           ERC20 token address
     * @param mode            Prepaid (escrow) or Postpaid (credit)
     * @param deposit         Amount to lock (must be > 0 for prepaid, 0 for postpaid)
     * @param maxSpend        Hard cap on total payment
     * @param maxDuration     Channel duration in seconds
     * @param maxPerCall      Ceiling on cost for any single API call
     * @param walletContract  The KiteAAWallet contract where msg.sender is registered
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

        // ── Session key validation ────────────────────────────────────────────
        // msg.sender is the session key. The EOA (user) is encoded inside the rule.
        IKiteAAWallet wallet = IKiteAAWallet(walletContract);
        (
            address user, // agentId // sessionIndex // metadataHash
            ,
            ,
            ,
            uint256 valueLimit,
            uint256 maxValueAllowed,
            uint256 validUntil,
            bool active
        ) = wallet.sessionKeys(msg.sender);

        require(active, "Session key is not active");
        require(block.timestamp <= validUntil, "Session key expired");
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
            !wallet.isProviderBlocked(msg.sender, provider),
            "Provider is blocked by this session"
        );
        // ─────────────────────────────────────────────────────────────────────

        if (mode == PaymentMode.Prepaid) {
            require(deposit > 0, "Prepaid requires deposit");
            require(maxSpend > 0, "Max spend must be > 0");
            require(deposit <= maxSpend, "Deposit exceeds maxSpend");
            require(
                deposit <= wallet.getUserBalance(user, token),
                "Insufficient wallet balance for deposit"
            );
            // Pull funds from the EOA's KiteAAWallet balance — the agent itself
            // holds no tokens; all funds live in the wallet contract.
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

    // ─── Settlement Phase ──────────────────────────────────────────────

    /**
     * @notice Initiate settlement on a channel. Either party can call this.
     *         Opens a challenge window during which anyone can submit a higher receipt.
     *
     *         To claim zero usage (no calls made), pass sequenceNumber = 0 and
     *         cumulativeCost = 0 with an empty signature. The provider can still
     *         submit a valid receipt during the challenge window.
     *
     * @param channelId         The channel to settle
     * @param sequenceNumber    Receipt sequence number (0 for empty claim)
     * @param cumulativeCost    Claimed total cost (0 for empty claim)
     * @param timestamp         Receipt timestamp (ignored if empty claim)
     * @param providerSignature Provider's signature (empty bytes for zero claim)
     * @param merkleRoot        Optional merkle root for audit
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

        // If a receipt is provided (non-zero claim), verify it
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
     * @notice Submit a receipt during the challenge window. PERMISSIONLESS —
     *         anyone holding a valid provider-signed receipt can call this.
     *         Only updates state if the submitted receipt is higher than the current best.
     *
     * @param channelId         The channel in settlement
     * @param sequenceNumber    Receipt sequence number
     * @param cumulativeCost    Total cost from receipt (must be > current highest)
     * @param timestamp         Receipt timestamp
     * @param providerSignature Provider's signature over the receipt
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
     * @notice Finalize settlement after the challenge window has closed.
     *         Anyone can call this. Pays based on the highest valid receipt
     *         submitted during the challenge window.
     *
     * @param channelId The channel to finalize
     * @param merkleRoot Optional final merkle root for audit (overrides if non-zero)
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
     * @notice Force-close an expired channel by initiating settlement.
     *         Anyone can call this after expiry + grace period.
     *         Starts the challenge window so provider can still submit receipts.
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
            // Refund unused deposit back to the EOA's KiteAAWallet balance.
            // The EOA (user) is derived from the session key stored in the wallet contract.
            if (refund > 0 && ch.walletContract != address(0)) {
                (address settleUser, , , , , , , ) = IKiteAAWallet(
                    ch.walletContract
                ).sessionKeys(ch.consumer);
                // Approve KiteAAWallet to pull the refund back
                IERC20(ch.token).approve(ch.walletContract, refund);
                IKiteAAWallet(ch.walletContract).refundFromChannel(
                    settleUser,
                    ch.token,
                    refund
                );
            } else if (refund > 0) {
                // Fallback: refund directly to consumer
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
            // Postpaid: pull payment from consumer
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
