// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

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

    enum ChannelStatus { Open, Active, SettlementPending, Closed }
    enum PaymentMode { Prepaid, Postpaid }

    struct Channel {
        bytes32 channelId;
        address consumer;          // consumer agent's session key or EOA
        address provider;          // provider agent's session key or EOA
        address token;             // ERC20 token for payment
        PaymentMode mode;
        uint256 deposit;           // locked funds (0 for postpaid)
        uint256 maxSpend;          // hard cap on total payment
        uint256 maxDuration;       // seconds
        uint256 openedAt;
        uint256 expiresAt;
        uint256 ratePerCall;       // agreed cost per API call
        uint256 settledAmount;     // final settlement amount (set on finalize)
        bytes32 usageMerkleRoot;   // optional: root for off-chain audit / attestation
        ChannelStatus status;
        // Settlement state
        uint256 settlementDeadline;    // challenge window end timestamp
        uint256 highestClaimedCost;    // best valid cumulativeCost submitted so far
        uint256 highestSequenceNumber; // sequence number of the best receipt
        address settlementInitiator;   // who started settlement
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
        uint256 ratePerCall
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
    event FundsLocked(address indexed wallet, address indexed token, uint256 amount);
    event FundsUnlocked(address indexed wallet, address indexed token, uint256 amount);

    modifier onlyChannelParty(bytes32 channelId) {
        Channel storage ch = channels[channelId];
        require(
            msg.sender == ch.consumer || msg.sender == ch.provider,
            "Not a channel party"
        );
        _;
    }

    modifier channelInStatus(bytes32 channelId, ChannelStatus expected) {
        require(channels[channelId].status == expected, "Invalid channel status");
        _;
    }

    // ─── Channel Lifecycle ─────────────────────────────────────────────

    /**
     * @notice Open a new payment channel.
     * @param provider   The provider agent address
     * @param token      ERC20 token address
     * @param mode       Prepaid (escrow) or Postpaid (credit)
     * @param deposit    Amount to lock (must be > 0 for prepaid, 0 for postpaid)
     * @param maxSpend   Hard cap on total payment (deposit acts as cap for prepaid if maxSpend > deposit)
     * @param maxDuration Channel duration in seconds
     * @param ratePerCall Agreed cost per API call in token units
     */
    function openChannel(
        address provider,
        address token,
        PaymentMode mode,
        uint256 deposit,
        uint256 maxSpend,
        uint256 maxDuration,
        uint256 ratePerCall
    ) external nonReentrant returns (bytes32 channelId) {
        require(provider != address(0) && provider != msg.sender, "Invalid provider");
        require(token != address(0), "Invalid token");
        require(maxDuration > 0 && maxDuration <= 30 days, "Invalid duration");
        require(ratePerCall > 0, "Rate must be > 0");

        if (mode == PaymentMode.Prepaid) {
            require(deposit > 0, "Prepaid requires deposit");
            require(maxSpend > 0, "Max spend must be > 0");
            IERC20(token).safeTransferFrom(msg.sender, address(this), deposit);
            lockedFunds[msg.sender][token] += deposit;
            emit FundsLocked(msg.sender, token, deposit);
        } else {
            require(deposit == 0, "Postpaid must have 0 deposit");
            require(maxSpend > 0, "Max spend must be > 0");
        }

        totalChannels++;
        channelId = keccak256(abi.encodePacked(
            msg.sender, provider, token, totalChannels, block.timestamp
        ));

        channels[channelId] = Channel({
            channelId: channelId,
            consumer: msg.sender,
            provider: provider,
            token: token,
            mode: mode,
            deposit: deposit,
            maxSpend: maxSpend,
            maxDuration: maxDuration,
            openedAt: block.timestamp,
            expiresAt: block.timestamp + maxDuration,
            ratePerCall: ratePerCall,
            settledAmount: 0,
            usageMerkleRoot: bytes32(0),
            status: ChannelStatus.Open,
            settlementDeadline: 0,
            highestClaimedCost: 0,
            highestSequenceNumber: 0,
            settlementInitiator: address(0)
        });

        emit ChannelOpened(
            channelId, msg.sender, provider, token,
            mode, deposit, maxSpend, maxDuration, ratePerCall
        );
    }

    /**
     * @notice Provider acknowledges the channel, moving it to Active.
     */
    function activateChannel(bytes32 channelId)
        external
        channelInStatus(channelId, ChannelStatus.Open)
    {
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
            ch.status == ChannelStatus.Active || ch.status == ChannelStatus.Open,
            "Channel not settleable"
        );

        // If a receipt is provided (non-zero claim), verify it
        if (cumulativeCost > 0 || sequenceNumber > 0) {
            _verifyReceipt(ch, channelId, sequenceNumber, cumulativeCost, timestamp, providerSignature);
            ch.highestClaimedCost = cumulativeCost;
            ch.highestSequenceNumber = sequenceNumber;
        }

        ch.usageMerkleRoot = merkleRoot;
        ch.status = ChannelStatus.SettlementPending;
        ch.settlementDeadline = block.timestamp + CHALLENGE_WINDOW;
        ch.settlementInitiator = msg.sender;

        emit SettlementInitiated(channelId, msg.sender, cumulativeCost, ch.settlementDeadline);
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
    ) external nonReentrant channelInStatus(channelId, ChannelStatus.SettlementPending) {
        Channel storage ch = channels[channelId];
        require(block.timestamp <= ch.settlementDeadline, "Challenge window closed");
        require(cumulativeCost > ch.highestClaimedCost, "Not higher than current claim");

        _verifyReceipt(ch, channelId, sequenceNumber, cumulativeCost, timestamp, providerSignature);

        ch.highestClaimedCost = cumulativeCost;
        ch.highestSequenceNumber = sequenceNumber;

        emit ReceiptSubmitted(channelId, msg.sender, sequenceNumber, cumulativeCost);
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
    ) external nonReentrant channelInStatus(channelId, ChannelStatus.SettlementPending) {
        Channel storage ch = channels[channelId];
        require(block.timestamp > ch.settlementDeadline, "Challenge window still open");

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
            ch.status == ChannelStatus.Active || ch.status == ChannelStatus.Open,
            "Channel not closeable"
        );
        require(
            block.timestamp >= ch.expiresAt + CLOSE_GRACE_PERIOD,
            "Not yet expired + grace"
        );

        ch.status = ChannelStatus.SettlementPending;
        ch.settlementDeadline = block.timestamp + CHALLENGE_WINDOW;
        ch.settlementInitiator = msg.sender;

        emit SettlementInitiated(channelId, msg.sender, 0, ch.settlementDeadline);
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
            cumulativeCost <= (sequenceNumber * ch.ratePerCall),
            "Cost exceeds rate * calls"
        );

        bytes32 receiptHash = getReceiptHash(
            channelId, sequenceNumber, cumulativeCost, timestamp
        );
        address signer = receiptHash.toEthSignedMessageHash().recover(providerSignature);
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
            if (refund > 0) {
                IERC20(ch.token).safeTransfer(ch.consumer, refund);
            }

            lockedFunds[ch.consumer][ch.token] -= ch.deposit;
            emit FundsUnlocked(ch.consumer, ch.token, ch.deposit);

            ch.settledAmount = payment;
            emit ChannelFinalized(channelId, payment, refund, ch.usageMerkleRoot);
        } else {
            // Postpaid: pull payment from consumer
            if (amount > 0) {
                IERC20(ch.token).safeTransferFrom(ch.consumer, ch.provider, amount);
            }
            ch.settledAmount = amount;
            emit ChannelFinalized(channelId, amount, 0, ch.usageMerkleRoot);
        }

        ch.status = ChannelStatus.Closed;
    }

    // ─── View Functions ────────────────────────────────────────────────

    function getChannel(bytes32 channelId) external view returns (
        address consumer,
        address provider,
        address token,
        PaymentMode mode,
        uint256 deposit,
        uint256 maxSpend,
        uint256 maxDuration,
        uint256 openedAt,
        uint256 expiresAt,
        uint256 ratePerCall,
        uint256 settledAmount,
        ChannelStatus status,
        uint256 settlementDeadline,
        uint256 highestClaimedCost,
        uint256 highestSequenceNumber
    ) {
        Channel storage ch = channels[channelId];
        return (
            ch.consumer, ch.provider, ch.token, ch.mode,
            ch.deposit, ch.maxSpend, ch.maxDuration, ch.openedAt, ch.expiresAt,
            ch.ratePerCall, ch.settledAmount, ch.status,
            ch.settlementDeadline, ch.highestClaimedCost, ch.highestSequenceNumber
        );
    }

    function isChannelExpired(bytes32 channelId) external view returns (bool) {
        return block.timestamp >= channels[channelId].expiresAt;
    }

    function getChannelTimeRemaining(bytes32 channelId) external view returns (uint256) {
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
        return keccak256(abi.encodePacked(
            channelId, sequenceNumber, cumulativeCost, timestamp
        ));
    }

    function getLockedFunds(address wallet, address token) external view returns (uint256) {
        return lockedFunds[wallet][token];
    }

    function getSettlementState(bytes32 channelId) external view returns (
        uint256 deadline,
        uint256 highestCost,
        uint256 highestSeq,
        address initiator,
        bool challengeOpen
    ) {
        Channel storage ch = channels[channelId];
        return (
            ch.settlementDeadline,
            ch.highestClaimedCost,
            ch.highestSequenceNumber,
            ch.settlementInitiator,
            ch.status == ChannelStatus.SettlementPending && block.timestamp <= ch.settlementDeadline
        );
    }
}
