import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  Registered as AgentRegisteredEvent,
  AgentWalletSet as AgentWalletSetEvent,
  SessionRegistered as SessionRegisteredEvent,
  SessionRevoked as SessionRevokedEvent,
  URIUpdated as URIUpdatedEvent,
} from "../generated/IdentityRegistry/IdentityRegistry";
import { Agent, AAWallet, Session, User } from "../generated/schema";

/**
 * Handle agent NFT registration.
 * Create Agent entity and associated User entity (owner).
 */
export function handleAgentRegistered(event: AgentRegisteredEvent): void {
  let agentId = event.params.agentId.toHex();
  let ownerId = event.params.owner.toHex();

  // Ensure User (EOA) exists
  let user = User.load(ownerId);
  if (!user) {
    user = new User(ownerId);
    user.address = event.params.owner;
    user.totalChannelsOpened = BigInt.zero();
    user.totalSpent = BigInt.zero();
    user.totalRefunded = BigInt.zero();
    user.createdAt = event.block.timestamp;
    user.updatedAt = event.block.timestamp;
    user.save();
  }

  // Create Agent entity
  let agent = new Agent(agentId);
  agent.agentId = event.params.agentId;
  agent.metadata = event.params.agentURI;
  agent.owner = ownerId;
  agent.active = true;
  agent.feedbackCount = BigInt.zero();
  agent.createdAt = event.block.timestamp;
  agent.updatedAt = event.block.timestamp;
  agent.save();
}

/**
 * Handle agent URI updates.
 */
export function handleURIUpdated(event: URIUpdatedEvent): void {
  let agentId = event.params.agentId.toHex();
  let agent = Agent.load(agentId);
  if (agent) {
    agent.metadata = event.params.newURI;
    agent.updatedAt = event.block.timestamp;
    agent.save();
  }
}

/**
 * Handle agent wallet assignment.
 * Link agent to an AA wallet contract and create/update AAWallet entity.
 *
 * This is critical for tracking which AA wallet holds funds for which agent.
 * The walletContract is the user's GokiteAccount (ERC-4337 account), derived from their EOA.
 */
export function handleAgentWalletSet(event: AgentWalletSetEvent): void {
  let agentId = event.params.agentId.toHex();
  let walletAddress = event.params.walletContract.toHex();

  // Create or update AAWallet
  let aaWalletId = walletAddress; // Use wallet address as ID
  let aaWallet = AAWallet.load(aaWalletId);

  if (!aaWallet) {
    aaWallet = new AAWallet(aaWalletId);
    aaWallet.address = event.params.walletContract;
    aaWallet.owner = event.params.user.toHex();
    aaWallet.createdAt = event.block.timestamp;
  }
  aaWallet.save();

  // Ensure User exists (the owner of the AA wallet)
  let userId = event.params.user.toHex();
  let user = User.load(userId);
  if (!user) {
    user = new User(userId);
    user.address = event.params.user;
    user.totalChannelsOpened = BigInt.zero();
    user.totalSpent = BigInt.zero();
    user.totalRefunded = BigInt.zero();
    user.createdAt = event.block.timestamp;
    user.updatedAt = event.block.timestamp;
    user.save();
  }

  // Link agent to AA wallet
  let agent = Agent.load(agentId);
  if (agent) {
    agent.aaWallet = aaWalletId;
    agent.updatedAt = event.block.timestamp;
    agent.save();
  }
}

/**
 * Handle session registration on IdentityRegistry.
 * Sessions are tied to agents and store spending rules for session keys.
 *
 * sessionId = keccak256(abi.encodePacked(sessionKey, agentId, validUntil))
 * This is created on the AA wallet's ClientAgentVault before being registered here.
 */
export function handleSessionRegistered(event: SessionRegisteredEvent): void {
  let sessionKeyHex = event.params.sessionKey.toHex();
  let agentId = event.params.agentId.toHex();
  let userId = event.params.user.toHex();

  // Ensure User exists
  let user = User.load(userId);
  if (!user) {
    user = new User(userId);
    user.address = event.params.user;
    user.totalChannelsOpened = BigInt.zero();
    user.totalSpent = BigInt.zero();
    user.totalRefunded = BigInt.zero();
    user.createdAt = event.block.timestamp;
    user.updatedAt = event.block.timestamp;
    user.save();
  }

  // Ensure AA wallet exists (where this session lives)
  let aaWalletId = event.params.walletContract.toHex();
  let aaWallet = AAWallet.load(aaWalletId);
  if (!aaWallet) {
    aaWallet = new AAWallet(aaWalletId);
    aaWallet.address = event.params.walletContract;
    aaWallet.owner = userId;
    aaWallet.createdAt = event.block.timestamp;
    aaWallet.save();
  }

  // Create or update Session
  let session = new Session(sessionKeyHex);
  session.sessionKey = event.params.sessionKey;
  session.user = userId;
  session.agent = agentId;
  session.aaWallet = aaWalletId;
  session.validUntil = event.params.validUntil;
  
  // Extract spending limits from event data or defaults
  // Note: Event doesn't directly include valueLimit/maxLimit or blockedAgents in the current signature,
  // so we default to zero/empty. These should be tracked separately from vault.createSession() events.
  session.valueLimit = BigInt.zero();
  session.maxLimit = BigInt.zero();
  session.status = "ACTIVE";
  session.createdAt = event.block.timestamp;
  session.updatedAt = event.block.timestamp;
  session.save();
}

/**
 * Handle session revocation.
 */
export function handleSessionRevoked(event: SessionRevokedEvent): void {
  let sessionKeyHex = event.params.sessionKey.toHex();
  let session = Session.load(sessionKeyHex);

  if (session) {
    session.status = "REVOKED";
    session.updatedAt = event.block.timestamp;
    session.save();
  } else {
    // Edge case: session not yet indexed (shouldn't happen with proper ordering)
    let newSession = new Session(sessionKeyHex);
    newSession.sessionKey = event.params.sessionKey;
    newSession.agent = event.params.agentId.toHex();
    newSession.user = ""; // unknown at revocation time
    newSession.aaWallet = ""; // unknown at revocation time
    newSession.validUntil = BigInt.zero();
    newSession.valueLimit = BigInt.zero();
    newSession.maxLimit = BigInt.zero();
    newSession.blockedAgents = [];
    newSession.status = "REVOKED";
    newSession.createdAt = event.block.timestamp;
    newSession.updatedAt = event.block.timestamp;
    newSession.save();
  }
}
