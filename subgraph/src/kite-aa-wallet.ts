import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  ChannelFundsRefunded as ChannelFundsRefundedEvent,
  ChannelFundsWithdrawn as ChannelFundsWithdrawnEvent,
  FundsDeposited as FundsDepositedEvent,
  FundsWithdrawn as FundsWithdrawnEvent,
  PaymentExecuted as PaymentExecutedEvent,
  UserRegistered as UserRegisteredEvent,
} from "../generated/KiteAAWallet/KiteAAWallet";
import { Agent, Payment, User } from "../generated/schema";

export function handlePaymentExecuted(event: PaymentExecutedEvent): void {
  let id = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  let payment = new Payment(id);
  payment.session = event.params.sessionKey.toHex();
  payment.agent = event.params.agentId.toHex();
  let agent = Agent.load(payment.agent);
  if (!agent) {
    agent = new Agent(payment.agent);
    agent.agentId = event.params.agentId;
    agent.active = true;
    agent.createdAt = event.block.timestamp;
    agent.updatedAt = event.block.timestamp;
    agent.save();
  }

  payment.user = agent.owner;
  payment.recipient = event.params.recipient;
  payment.token = event.params.token;
  payment.amount = event.params.amount;

  payment.timestamp = event.block.timestamp;
  payment.txHash = event.transaction.hash;
  payment.channel = null;
  payment.type = "PerCall";

  payment.save();
}

export function handleFundsDeposited(event: FundsDepositedEvent): void {
  let id = event.params.user.toHex();
  let user = User.load(id);

  if (!user) {
    user = new User(id);
    user.address = event.params.user;
    user.totalDeposited = BigInt.fromI32(0);
    user.totalWithdrawn = BigInt.fromI32(0);
    user.lockedInChannels = BigInt.fromI32(0);
    user.createdAt = event.block.timestamp;
    user.updatedAt = event.block.timestamp;
  }

  user.totalDeposited = user.totalDeposited.plus(event.params.amount);
  user.save();
}

export function handleFundsWithdrawn(event: FundsWithdrawnEvent): void {
  let id = event.params.user.toHex();
  let user = User.load(id);

  if (!user) {
    user = new User(id);
    user.address = event.params.user;
    user.totalDeposited = BigInt.fromI32(0);
    user.totalWithdrawn = BigInt.fromI32(0);
    user.createdAt = event.block.timestamp;
    user.updatedAt = event.block.timestamp;
  }

  user.totalWithdrawn = user.totalWithdrawn.plus(event.params.amount);
  user.save();
}

export function handleChannelsFundsWithdrawn(
  event: ChannelFundsWithdrawnEvent,
): void {
  let id = event.params.user.toHex();
  let user = User.load(id);

  if (!user) {
    user = new User(id);
    user.address = event.params.user;
    user.totalDeposited = BigInt.fromI32(0);
    user.totalWithdrawn = BigInt.fromI32(0);
    user.lockedInChannels = BigInt.fromI32(0);
    user.createdAt = event.block.timestamp;
    user.updatedAt = event.block.timestamp;
  }

  user.totalWithdrawn = user.totalWithdrawn.plus(event.params.amount);
  user.lockedInChannels = user.lockedInChannels.plus(event.params.amount);
  user.save();
}

export function handleChannelsFundsRefunded(
  event: ChannelFundsRefundedEvent,
): void {
  let id = event.params.user.toHex();
  let user = User.load(id);

  if (!user) {
    user = new User(id);
    user.address = event.params.user;
    user.totalDeposited = BigInt.fromI32(0);
    user.totalWithdrawn = BigInt.fromI32(0);
    user.lockedInChannels = BigInt.fromI32(0);
    user.createdAt = event.block.timestamp;
    user.updatedAt = event.block.timestamp;
  }

  user.totalWithdrawn = user.totalDeposited.plus(event.params.amount);
  user.lockedInChannels = user.lockedInChannels.minus(event.params.amount);
  user.save();
}

// export function handleBlockedProvidersUpdated(event: BlockedProvidersUpdatedEvent): void {
//   let id = event.params.sessionKey.toHex();
//   let session = Session.load(id);

//   if (session) {
//     let providers = session.blockedProviders;
//     if (!providers) {
//       providers = [];
//     }
//     let provider = event.params.provider as Bytes;
//     let exists = false;

//     for (let i = 0; i < providers.length; i++) {
//       if (providers[i].equals(provider)) {
//         exists = true;
//         break;
//       }
//     }

//     if (!exists) {
//       providers.push(provider);
//     }
//     session.blockedProviders = providers;
//     session.updatedAt = event.block.timestamp;
//     session.save();
//   }
// }

export function handleUserRegistered(event: UserRegisteredEvent): void {
  let id = event.params.user.toHex();
  let user = User.load(id);

  if (!user) {
    user = new User(id);
    user.address = event.params.user;
    user.totalDeposited = BigInt.fromI32(0);
    user.totalWithdrawn = BigInt.fromI32(0);
    user.lockedInChannels = BigInt.fromI32(0);
    user.createdAt = event.block.timestamp;
    user.updatedAt = event.block.timestamp;
    user.wallet = Bytes.fromHexString(
      "0x0DB3Ad9b0182BdBB8fa8B32C609946D0C05079d8",
    );
    user.save();
  }
}
