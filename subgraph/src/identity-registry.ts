import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  Registered as AgentRegisteredEvent,
  AgentWalletSet as AgentWalletSetEvent,
  SessionRegistered as SessionRegisteredEvent,
  SessionRevoked as SessionRevokedEvent,
  URIUpdated as URIUpdatedEvent,
} from "../generated/IdentityRegistry/IdentityRegistry";
import { Agent, Session, User } from "../generated/schema";

export function handleAgentRegistered(event: AgentRegisteredEvent): void {
  let id = event.params.agentId.toHex();

  let agent = new Agent(id);
  agent.owner = event.params.owner.toHex();
  agent.metadata = event.params.agentURI;
  agent.agentId = event.params.agentId;

  agent.active = true;
  agent.createdAt = event.block.timestamp;
  agent.updatedAt = event.block.timestamp;

  agent.save();
}

export function handleURIUpdated(event: URIUpdatedEvent): void {
  let agent = Agent.load(event.params.agentId.toHex());
  if (agent) {
    agent.metadata = event.params.newURI;
    agent.updatedAt = event.block.timestamp;
    agent.save();
  }
}

export function handleAgentWalletSet(event: AgentWalletSetEvent): void {
  let agent = Agent.load(event.params.agentId.toHex());
  if (agent) {
    agent.wallet = event.params.walletContract;
    agent.updatedAt = event.block.timestamp;
    agent.save();
  }
}

export function handleSessionRegistered(event: SessionRegisteredEvent): void {
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

  session.validUntil = event.params.validUntil;
  session.maxLimit = event.params.maxValueAllowed;
  session.valueLimit = event.params.valueLimit;
  session.metadataHash = null;

  session.status = "ACTIVE";

  session.createdAt = event.block.timestamp;
  session.updatedAt = event.block.timestamp;

  session.save();
}

export function handleSessionRevoked(event: SessionRevokedEvent): void {
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

    newSession.valueLimit = BigInt.fromI32(0);
    newSession.maxLimit = BigInt.fromI32(0);
    newSession.validUntil = BigInt.fromI32(0);
    newSession.metadataHash = Bytes.empty();

    newSession.status = "REVOKED";
    newSession.blockedAgents = [];

    newSession.createdAt = event.block.timestamp;
    newSession.updatedAt = event.block.timestamp;

    newSession.save();
  }
}
