import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  AgentLinked as AgentLinkedEvent,
  FundsDeposited as FundsDepositedEvent,
  FundsWithdrawn as FundsWithdrawnEvent,
  PaymentExecuted as PaymentExecutedEvent,
  PaymentExecutedBySig as PaymentExecutedBySigEvent,
  ProviderBlocked as ProviderBlockedEvent,
  ProviderUnblocked as ProviderUnblockedEvent,
  SessionBlockedProvidersUpdated as SessionBlockedProvidersUpdatedEvent,
  SessionKeyAdded as SessionKeyAddedEvent,
  SessionKeyRevoked as SessionKeyRevokedEvent,
  UserRegistered as UserRegisteredEvent,
} from "../generated/KiteAAWallet/KiteAAWallet";
import { Agent, Payment, Session, User } from "../generated/schema";

export function handleSessionBlockedProvidersUpdated(
  event: SessionBlockedProvidersUpdatedEvent,
): void {
  let id = event.params.sessionKey.toHex();
  let session = Session.load(id);

  if (session) {
    let providers: Bytes[] = [];
    for (let i = 0; i < event.params.blockedProviders.length; i++) {
      providers.push(event.params.blockedProviders[i] as Bytes);
    }
    session.blockedProviders = providers;
    session.updatedAt = event.block.timestamp;
    session.save();
  }
}

export function handlePaymentExecuted(event: PaymentExecutedEvent): void {
  let id = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  let payment = new Payment(id);
  payment.session = event.params.sessionKey.toHex();
  payment.agent = event.params.agentId.toHex();

  payment.recipient = event.params.recipient;
  payment.token = event.params.token;
  payment.amount = event.params.amount;

  payment.timestamp = event.block.timestamp;
  payment.txHash = event.transaction.hash;
  payment.type = "PerCall"; // TODO: determine type based on session rules

  payment.save();
}

export function handlePaymentExecutedBySig(event: PaymentExecutedBySigEvent): void {
  let id = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  let payment = new Payment(id);
  payment.session = event.params.sessionKey.toHex();
  payment.agent = event.params.agentId.toHex();

  payment.recipient = event.params.recipient;
  payment.token = event.params.token;
  payment.amount = event.params.amount;

  payment.timestamp = event.block.timestamp;
  payment.txHash = event.transaction.hash;
  payment.nonce = event.params.nonce;
  payment.type = "PerCall"; // TODO: determine type based on session rules

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
    user.createdAt = event.block.timestamp;
    user.updatedAt = event.block.timestamp;
  }

  user.totalDeposited = user.totalDeposited.plus(event.params.amount);
  user.save();
}

export function handleAgentLinked(event: AgentLinkedEvent): void {
  let userId = event.params.user.toHex();
  let agentId = event.params.agentId.toHex();

  // Check User exists
  let user = User.load(userId);
  if (!user) {
    user = new User(userId);
    user.address = event.params.user;
    user.totalDeposited = BigInt.fromI32(0);
    user.totalWithdrawn = BigInt.fromI32(0);
    user.createdAt = event.block.timestamp;
  }
  user.save();

  // Ensure agent exists
  let agent = Agent.load(agentId);
  if (!agent) {
    agent = new Agent(agentId);
    agent.agentId = event.params.agentId;
    agent.wallet = event.params.user;
    agent.active = true;
    agent.createdAt = event.block.timestamp;
    agent.updatedAt = event.block.timestamp;
  }
  agent.owner = userId;
  agent.save();
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

export function handleProviderBlocked(event: ProviderBlockedEvent): void {
  let id = event.params.sessionKey.toHex();
  let session = Session.load(id);

  if (session) {
    let providers = session.blockedProviders;
    if (!providers) {
      providers = [];
    }
    let provider = event.params.provider as Bytes;
    let exists = false;

    for (let i = 0; i < providers.length; i++) {
      if (providers[i].equals(provider)) {
        exists = true;
        break;
      }
    }

    if (!exists) {
      providers.push(provider);
    }
    session.blockedProviders = providers;
    session.updatedAt = event.block.timestamp;
    session.save();
  }
}

export function handleProviderUnblocked(event: ProviderUnblockedEvent): void {
  let id = event.params.sessionKey.toHex();
  let session = Session.load(id);

  if (session) {
    let providers = session.blockedProviders;
    if (!providers) {
      providers = [];
    }
    let provider = event.params.provider as Bytes;
    let updated: Bytes[] = [];
    for (let i = 0; i < providers.length; i++) {
      if (!providers[i].equals(provider)) {
        updated.push(providers[i]);
      }
    }

    session.blockedProviders = updated;
    session.updatedAt = event.block.timestamp;
    session.save();
  }
}

export function handleSessionKeyAdded(event: SessionKeyAddedEvent): void {
  let id = event.params.sessionKey.toHex();
  let userId = event.params.user.toHex();

  // Ensure user exists
  let user = User.load(userId);
  if (!user) {
    user = new User(userId);
    user.address = event.params.user;
    user.totalDeposited = BigInt.fromI32(0);
    user.totalWithdrawn = BigInt.fromI32(0);
    user.createdAt = event.block.timestamp;
    user.save();
  }

  let session = new Session(id);
  session.sessionKey = event.params.sessionKey;
  session.agent = event.params.agentId.toHex();

  let agent = Agent.load(session.agent);
  if (agent) {
    session.user = agent.owner;
  }

  session.sessionIndex = event.params.sessionIndex;
  session.validUntil = event.params.validUntil;
  session.dailyLimit = event.params.dailyLimit;
  session.valueLimit = event.params.valueLimit;
  session.metadataHash = event.params.metadataHash;

  session.status = "ACTIVE";

  session.createdAt = event.block.timestamp;
  session.updatedAt = event.block.timestamp;

  session.save();
}

export function handleSessionKeyRevoked(event: SessionKeyRevokedEvent): void {
  let sessionId = event.params.sessionKey.toHex();

  let session = Session.load(sessionId);

  if (session) {
    // ── Normal case ─────────────────────────────
    session.status = "REVOKED";
    session.updatedAt = event.block.timestamp;

    session.save();
  } else {
    // ── Edge case: session not indexed yet ─────
    // This can happen due to event ordering or indexing lag

    let newSession = new Session(sessionId);
    newSession.sessionKey = event.params.sessionKey;
    newSession.agent = event.params.agentId.toHex();
    newSession.user = ""; // unknown at this point

    newSession.sessionIndex = BigInt.fromU32(0);
    newSession.valueLimit = BigInt.fromI32(0);
    newSession.dailyLimit = BigInt.fromI32(0);
    newSession.validUntil = BigInt.fromI32(0);
    newSession.metadataHash = Bytes.empty();

    newSession.status = "REVOKED";
    newSession.blockedProviders = [];

    newSession.createdAt = event.block.timestamp;
    newSession.updatedAt = event.block.timestamp;

    newSession.save();
  }
}

export function handleUserRegistered(event: UserRegisteredEvent): void {
  let id = event.params.user.toHex();
  let user = User.load(id);

  if (!user) {
    user = new User(id);
    user.address = event.params.user;
    user.totalDeposited = BigInt.fromI32(0);
    user.totalWithdrawn = BigInt.fromI32(0);
    user.createdAt = event.block.timestamp;
    user.updatedAt = event.block.timestamp;
    user.save();
  }
}
