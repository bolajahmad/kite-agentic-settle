import { BigInt } from "@graphprotocol/graph-ts";
import {
  ChannelActivated as ChannelActivatedEvent,
  ChannelFinalized as ChannelFinalizedEvent,
  ChannelOpened as ChannelOpenedEvent,
  ReceiptSubmitted as ReceiptSubmittedEvent,
  SettlementInitiated as SettlementInitiatedEvent,
} from "../generated/PaymentChannel/PaymentChannel";
import { Channel, Payment, Receipt } from "../generated/schema";

export function handleChannelOpened(event: ChannelOpenedEvent): void {
  const id = event.params.channelId.toHex();
  let channel = new Channel(id);

  channel.channelId = event.params.channelId;

  channel.user = event.params.user.toHex();
  channel.agent = event.params.consumer.toHex();
  channel.provider = event.params.provider;

  channel.walletContract = event.params.walletContract;
  channel.token = event.params.token;

  channel.mode = event.params.mode == 0 ? "PREPAID" : "POSTPAID";

  channel.deposit = event.params.deposit;
  channel.maxSpend = event.params.maxSpend;
  channel.maxPerCall = event.params.maxPerCall;
  channel.refundAmount = BigInt.fromI32(0);

  channel.status = "OPEN";
  channel.openedAt = event.block.timestamp;
  channel.expiresAt = event.block.timestamp.plus(event.params.maxDuration);

  channel.createdAt = event.block.timestamp;
  channel.updatedAt = event.block.timestamp;

  channel.save();
}

export function handleChannelActivated(event: ChannelActivatedEvent): void {
  let channel = Channel.load(event.params.channelId.toHex());
  if (!channel) return;

  channel.status = "ACTIVE";
  channel.save();
}

export function handleSettlementInitiated(
  event: SettlementInitiatedEvent,
): void {
  let channel = Channel.load(event.params.channelId.toHex());
  if (!channel) return;

  channel.status = "SETTLEMENT_PENDING";
  channel.settlementDeadline = event.params.settlementDeadline;
  channel.highestClaimedCost = event.params.claimedAmount;

  channel.save();
}

export function handleReceiptSubmitted(event: ReceiptSubmittedEvent): void {
  let channel = Channel.load(event.params.channelId.toHex());
  if (!channel) return;

  // Update channel state
  channel.highestClaimedCost = event.params.cumulativeCost;
  channel.highestSequenceNumber = event.params.sequenceNumber;
  channel.save();

  // Create receipt entity
  let id = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  let receipt = new Receipt(id);

  receipt.channel = channel.id;
  receipt.sequenceNumber = event.params.sequenceNumber;
  receipt.cumulativeCost = event.params.cumulativeCost;
  receipt.submitter = event.params.submitter;
  receipt.timestamp = event.block.timestamp;

  receipt.save();
}

export function handleChannelFinalized(event: ChannelFinalizedEvent): void {
  let channel = Channel.load(event.params.channelId.toHex());
  if (!channel) return;

  channel.status = "CLOSED";
  channel.closedAt = event.block.timestamp;
  channel.usageMerkleRoot = event.params.usageMerkleRoot;

  let paymentAmount = event.params.payment;
  let refundAmount = event.params.refund;

  channel.refundAmount = refundAmount;
  channel.save();

  // 🔥 PAYMENT (to provider)
  if (paymentAmount.gt(BigInt.zero())) {
    let payment = new Payment(event.transaction.hash.toHex() + "-pay");

    payment.channel = channel.id;
    payment.user = channel.user;
    payment.agent = channel.agent;
    payment.recipient = channel.provider;
    payment.token = channel.token;
    payment.amount = paymentAmount;
    payment.timestamp = event.block.timestamp;
    payment.txHash = event.transaction.hash;
    payment.type = "CHANNEL_FINAL";

    payment.save();
  }

  // 🔥 REFUND (back to user)
  if (refundAmount.gt(BigInt.zero())) {
    let refund = new Payment(event.transaction.hash.toHex() + "-refund");

    refund.channel = channel.id;
    refund.user = channel.user;
    refund.agent = channel.agent;
    refund.recipient = channel.provider;
    refund.token = channel.token;
    refund.amount = refundAmount;
    refund.timestamp = event.block.timestamp;
    refund.txHash = event.transaction.hash;
    refund.type = "CHANNEL_REFUND";

    refund.save();
  }
}
