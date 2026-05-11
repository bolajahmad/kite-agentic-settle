import { BigInt } from "@graphprotocol/graph-ts";
import {
  ChannelActivated as ChannelActivatedEvent,
  ChannelFinalized as ChannelFinalizedEvent,
  ChannelOpened as ChannelOpenedEvent,
  ReceiptSubmitted as ReceiptSubmittedEvent,
  SettlementInitiated as SettlementInitiatedEvent,
} from "../generated/PaymentChannel/PaymentChannel";
import {
  AAWallet,
  Channel,
  Payment,
  Receipt,
  Session,
  User,
} from "../generated/schema";

/**
 * Handle channel opening.
 * Channels are session-bound payment streams.
 * Link user/agent from session, and track AA wallet involvement.
 */
export function handleChannelOpened(event: ChannelOpenedEvent): void {
  const channelId = event.params.channelId.toHex();
  let channel = new Channel(channelId);

  // Load session to get agent/user relationship
  let sessionId = event.params.consumer.toHex();
  let session = Session.load(sessionId);

  if (session) {
    channel.user = session.user;
    channel.agent = session.agent;
    channel.session = sessionId;
  } else {
    // Edge case: session not yet indexed; this shouldn't happen in normal flow
    return;
  }

  // Ensure AA wallet exists
  let aaWalletId = event.params.walletContract.toHex();
  let aaWallet = AAWallet.load(aaWalletId);
  if (!aaWallet) {
    aaWallet = new AAWallet(aaWalletId);
    aaWallet.address = event.params.walletContract;
    // Try to get owner from session
    let sessionUser = User.load(session.user);
    aaWallet.owner = session.user;
    aaWallet.createdAt = event.block.timestamp;
    aaWallet.save();
  }

  channel.aaWallet = aaWalletId;
  channel.channelId = event.params.channelId;
  channel.provider = event.params.provider;

  channel.mode = event.params.mode == 0 ? "PREPAID" : "POSTPAID";
  channel.token = event.params.token;
  channel.deposit = event.params.deposit;
  channel.maxSpend = event.params.maxSpend;
  channel.maxPerCall = event.params.maxPerCall;
  channel.refundAmount = BigInt.zero();
  channel.settledAmount = BigInt.zero();

  channel.status = "OPEN";
  channel.openedAt = event.block.timestamp;
  channel.expiresAt = event.block.timestamp.plus(event.params.maxDuration);

  channel.createdAt = event.block.timestamp;
  channel.updatedAt = event.block.timestamp;

  channel.save();

  // Update user stats
  let user = User.load(channel.user);
  if (user) {
    user.totalChannelsOpened = user.totalChannelsOpened.plus(BigInt.fromI32(1));
    user.updatedAt = event.block.timestamp;
    user.save();
  }
}

/**
 * Handle channel activation.
 */
export function handleChannelActivated(event: ChannelActivatedEvent): void {
  let channel = Channel.load(event.params.channelId.toHex());
  if (!channel) return;

  channel.status = "ACTIVE";
  channel.updatedAt = event.block.timestamp;
  channel.save();
}

/**
 * Handle settlement initiation.
 */
export function handleSettlementInitiated(
  event: SettlementInitiatedEvent,
): void {
  let channel = Channel.load(event.params.channelId.toHex());
  if (!channel) return;

  channel.status = "SETTLEMENT_PENDING";
  channel.settlementDeadline = event.params.settlementDeadline;
  channel.highestClaimedCost = event.params.claimedAmount;
  channel.updatedAt = event.block.timestamp;

  channel.save();
}

/**
 * Handle receipt submission.
 * Receipts track cumulative cost and sequence during channel lifetime.
 */
export function handleReceiptSubmitted(event: ReceiptSubmittedEvent): void {
  let channel = Channel.load(event.params.channelId.toHex());
  if (!channel) return;

  // Update channel state with highest claimed cost
  channel.highestClaimedCost = event.params.cumulativeCost;
  channel.highestSequenceNumber = event.params.sequenceNumber;
  channel.updatedAt = event.block.timestamp;
  channel.save();

  // Create receipt entity
  let id = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  let receipt = new Receipt(id);

  receipt.channel = channel.id;
  receipt.sequenceNumber = event.params.sequenceNumber;
  receipt.cumulativeCost = event.params.cumulativeCost;
  receipt.submitter = event.params.submitter;
  receipt.timestamp = event.block.timestamp;
  receipt.txHash = event.transaction.hash;

  receipt.save();
}

/**
 * Handle channel finalization.
 * Final settlement of payments and refunds.
 */
export function handleChannelFinalized(event: ChannelFinalizedEvent): void {
  let channel = Channel.load(event.params.channelId.toHex());
  if (!channel) return;

  channel.status = "CLOSED";
  channel.closedAt = event.block.timestamp;
  channel.usageMerkleRoot = event.params.usageMerkleRoot;

  let paymentAmount = event.params.payment;
  let refundAmount = event.params.refund;

  channel.refundAmount = refundAmount;
  channel.settledAmount = paymentAmount;
  channel.updatedAt = event.block.timestamp;
  channel.save();

  // Create payment record if payment was made
  if (paymentAmount.gt(BigInt.zero())) {
    let payment = new Payment(event.transaction.hash.toHex() + "-settlement");

    payment.channel = channel.id;
    payment.user = channel.user;
    payment.agent = channel.agent;
    payment.session = channel.session;
    payment.recipient = channel.provider;
    payment.token = channel.token;
    payment.amount = paymentAmount;
    payment.change = refundAmount;
    payment.timestamp = event.block.timestamp;
    payment.txHash = event.transaction.hash;
    payment.type = "Channel";

    payment.save();

    // Update user stats
    let user = User.load(channel.user);
    if (user) {
      user.totalSpent = user.totalSpent.plus(paymentAmount);
      if (refundAmount.gt(BigInt.zero())) {
        user.totalRefunded = user.totalRefunded.plus(refundAmount);
      }
      user.updatedAt = event.block.timestamp;
      user.save();
    }
  }
}
