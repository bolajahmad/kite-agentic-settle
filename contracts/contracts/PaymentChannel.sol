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
 *         Each channel tracks cumulative cost via signed receipts.
 *         Settlement uses the last valid signed receipt to determine total owed.
 */
contract PaymentChannel is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    enum ChannelStatus { Open, Active, Settling, Closed, Disputed }
    enum PaymentMode { Prepaid, Postpaid }

    struct Channel {
        bytes32 channelId;
        address consumer;          // consumer agent's session key or EOA
        address provider;          // provider agent's session key or EOA
        address token;             // ERC20 token for payment
        PaymentMode mode;
        uint256 deposit;           // locked funds (0 for postpaid)
        uint256 maxDuration;       // seconds
        uint256 openedAt;
        uint256 expiresAt;
        uint256 ratePerCall;       // agreed cost per API call
        uint256 settledAmount;     // final settlement amount
        ChannelStatus status;
    }

    // Receipt that the provider signs after each API call.
    // The consumer verifies and stores these off-chain.
    // Only the last receipt is needed for settlement.
    struct Receipt {
        bytes32 channelId;
        uint256 sequenceNumber;
        uint256 callCost;
        uint256 cumulativeCost;
        uint256 timestamp;
    }

    mapping(bytes32 => Channel) public channels;
    uint256 public totalChannels;

    // Tracks which KiteAAWallet funds are locked in channels
    // wallet address => token => locked amount
    mapping(address => mapping(address => uint256)) public lockedFunds;

    // Dispute timeout: if a dispute is raised, the other party has this long to respond
    uint256 public constant DISPUTE_TIMEOUT = 1 hours;
    // Grace period after expiry before anyone can force-close
    uint256 public constant CLOSE_GRACE_PERIOD = 5 minutes;

    mapping(bytes32 => uint256) public disputeDeadline;

    event ChannelOpened(
        bytes32 indexed channelId,
        address indexed consumer,
        address indexed provider,
        address token,
        PaymentMode mode,
        uint256 deposit,
        uint256 maxDuration,
        uint256 ratePerCall
    );
    event ChannelActivated(bytes32 indexed channelId);
    event ChannelSettled(bytes32 indexed channelId, uint256 amount, uint256 refund);
    event ChannelClosed(bytes32 indexed channelId);
    event ChannelDisputed(bytes32 indexed channelId, address indexed disputedBy);
    event DisputeResolved(bytes32 indexed channelId, uint256 finalAmount);
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

    // -- Channel Lifecycle --

    /**
     * @notice Open a new payment channel. For prepaid mode, the consumer must
     *         first approve this contract to transfer the deposit amount.
     * @param provider The provider agent address
     * @param token ERC20 token address
     * @param mode Prepaid (escrow) or Postpaid (credit)
     * @param deposit Amount to lock (must be > 0 for prepaid, 0 for postpaid)
     * @param maxDuration Channel duration in seconds
     * @param ratePerCall Agreed cost per API call in token units
     */
    function openChannel(
        address provider,
        address token,
        PaymentMode mode,
        uint256 deposit,
        uint256 maxDuration,
        uint256 ratePerCall
    ) external nonReentrant returns (bytes32 channelId) {
        require(provider != address(0) && provider != msg.sender, "Invalid provider");
        require(token != address(0), "Invalid token");
        require(maxDuration > 0 && maxDuration <= 30 days, "Invalid duration");
        require(ratePerCall > 0, "Rate must be > 0");

        if (mode == PaymentMode.Prepaid) {
            require(deposit > 0, "Prepaid requires deposit");
            IERC20(token).safeTransferFrom(msg.sender, address(this), deposit);
            lockedFunds[msg.sender][token] += deposit;
            emit FundsLocked(msg.sender, token, deposit);
        } else {
            require(deposit == 0, "Postpaid must have 0 deposit");
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
            maxDuration: maxDuration,
            openedAt: block.timestamp,
            expiresAt: block.timestamp + maxDuration,
            ratePerCall: ratePerCall,
            settledAmount: 0,
            status: ChannelStatus.Open
        });

        emit ChannelOpened(
            channelId, msg.sender, provider, token,
            mode, deposit, maxDuration, ratePerCall
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

    /**
     * @notice Close a channel with the last signed receipt from the provider.
     *         Either party can call this. The receipt's cumulativeCost determines
     *         the settlement amount.
     * @param channelId The channel to close
     * @param sequenceNumber Receipt sequence number
     * @param cumulativeCost Total accumulated cost from the receipt
     * @param timestamp Receipt timestamp
     * @param providerSignature Provider's signature over the receipt data
     */
    function closeChannel(
        bytes32 channelId,
        uint256 sequenceNumber,
        uint256 cumulativeCost,
        uint256 timestamp,
        bytes calldata providerSignature
    ) external nonReentrant onlyChannelParty(channelId) {
        Channel storage ch = channels[channelId];
        require(
            ch.status == ChannelStatus.Active || ch.status == ChannelStatus.Open,
            "Channel not closeable"
        );

        // Verify receipt signature from provider
        bytes32 receiptHash = getReceiptHash(
            channelId, sequenceNumber, cumulativeCost, timestamp
        );
        address signer = receiptHash.toEthSignedMessageHash().recover(providerSignature);
        require(signer == ch.provider, "Invalid provider signature");

        // Verify cumulative cost is consistent with rate
        // cumulativeCost should be sequenceNumber * ratePerCall
        // Allow a small tolerance for the last call (might be partial)
        require(
            cumulativeCost <= (sequenceNumber * ch.ratePerCall),
            "Cumulative cost exceeds expected total"
        );

        ch.status = ChannelStatus.Settling;
        _settle(channelId, cumulativeCost);
    }

    /**
     * @notice Close a channel with zero payment (no API calls were made).
     *         Only consumer can call this. Returns full deposit if prepaid.
     */
    function closeChannelEmpty(bytes32 channelId)
        external
        nonReentrant
    {
        Channel storage ch = channels[channelId];
        require(msg.sender == ch.consumer, "Only consumer");
        require(
            ch.status == ChannelStatus.Active || ch.status == ChannelStatus.Open,
            "Channel not closeable"
        );

        ch.status = ChannelStatus.Settling;
        _settle(channelId, 0);
    }

    /**
     * @notice Force-close an expired channel. Anyone can call this after
     *         expiry + grace period. If no receipt was submitted, consumer
     *         gets full refund (prepaid) or pays nothing (postpaid).
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

        ch.status = ChannelStatus.Settling;
        _settle(channelId, 0);
    }

    /**
     * @notice Force-close with a receipt when the channel has expired.
     *         Provider calls this to claim payment for work done.
     */
    function forceCloseWithReceipt(
        bytes32 channelId,
        uint256 sequenceNumber,
        uint256 cumulativeCost,
        uint256 timestamp,
        bytes calldata providerSignature
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        require(
            ch.status == ChannelStatus.Active || ch.status == ChannelStatus.Open,
            "Channel not closeable"
        );
        require(block.timestamp >= ch.expiresAt, "Not yet expired");
        require(msg.sender == ch.provider, "Only provider");

        bytes32 receiptHash = getReceiptHash(
            channelId, sequenceNumber, cumulativeCost, timestamp
        );
        address signer = receiptHash.toEthSignedMessageHash().recover(providerSignature);
        require(signer == ch.provider, "Invalid provider signature");

        require(
            cumulativeCost <= (sequenceNumber * ch.ratePerCall),
            "Cumulative cost exceeds expected total"
        );

        ch.status = ChannelStatus.Settling;
        _settle(channelId, cumulativeCost);
    }

    // -- Dispute --

    /**
     * @notice Raise a dispute on a channel that is being settled or is active.
     *         The other party has DISPUTE_TIMEOUT to respond with a valid receipt.
     */
    function disputeChannel(bytes32 channelId)
        external
        onlyChannelParty(channelId)
    {
        Channel storage ch = channels[channelId];
        require(
            ch.status == ChannelStatus.Active || ch.status == ChannelStatus.Settling,
            "Cannot dispute this channel"
        );

        ch.status = ChannelStatus.Disputed;
        disputeDeadline[channelId] = block.timestamp + DISPUTE_TIMEOUT;

        emit ChannelDisputed(channelId, msg.sender);
    }

    /**
     * @notice Resolve a dispute by submitting a valid signed receipt.
     *         The receipt with the highest sequence number wins.
     */
    function resolveDispute(
        bytes32 channelId,
        uint256 sequenceNumber,
        uint256 cumulativeCost,
        uint256 timestamp,
        bytes calldata providerSignature
    ) external nonReentrant onlyChannelParty(channelId)
        channelInStatus(channelId, ChannelStatus.Disputed)
    {
        require(
            block.timestamp <= disputeDeadline[channelId],
            "Dispute deadline passed"
        );

        Channel storage ch = channels[channelId];

        bytes32 receiptHash = getReceiptHash(
            channelId, sequenceNumber, cumulativeCost, timestamp
        );
        address signer = receiptHash.toEthSignedMessageHash().recover(providerSignature);
        require(signer == ch.provider, "Invalid provider signature");

        require(
            cumulativeCost <= (sequenceNumber * ch.ratePerCall),
            "Cumulative cost exceeds expected total"
        );

        _settle(channelId, cumulativeCost);
        emit DisputeResolved(channelId, cumulativeCost);
    }

    /**
     * @notice If dispute deadline passes with no resolution, either party
     *         can finalize. Consumer gets full refund (prepaid) or pays nothing (postpaid).
     */
    function finalizeExpiredDispute(bytes32 channelId)
        external
        nonReentrant
        onlyChannelParty(channelId)
        channelInStatus(channelId, ChannelStatus.Disputed)
    {
        require(
            block.timestamp > disputeDeadline[channelId],
            "Dispute still active"
        );
        _settle(channelId, 0);
    }

    // -- Internal --

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
            emit ChannelSettled(channelId, payment, refund);
        } else {
            // Postpaid: consumer must have approved this contract or funds
            // are pulled from consumer's wallet
            if (amount > 0) {
                IERC20(ch.token).safeTransferFrom(ch.consumer, ch.provider, amount);
            }
            ch.settledAmount = amount;
            emit ChannelSettled(channelId, amount, 0);
        }

        ch.status = ChannelStatus.Closed;
        emit ChannelClosed(channelId);
    }

    // -- View Functions --

    function getChannel(bytes32 channelId) external view returns (
        address consumer,
        address provider,
        address token,
        PaymentMode mode,
        uint256 deposit,
        uint256 maxDuration,
        uint256 openedAt,
        uint256 expiresAt,
        uint256 ratePerCall,
        uint256 settledAmount,
        ChannelStatus status
    ) {
        Channel storage ch = channels[channelId];
        return (
            ch.consumer, ch.provider, ch.token, ch.mode,
            ch.deposit, ch.maxDuration, ch.openedAt, ch.expiresAt,
            ch.ratePerCall, ch.settledAmount, ch.status
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
}
