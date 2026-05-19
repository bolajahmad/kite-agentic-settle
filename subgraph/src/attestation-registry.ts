import { BigInt } from "@graphprotocol/graph-ts";
import {
  FeedbackGiven as FeedbackGivenEvent,
  FeedbackRevoked as FeedbackRevokedEvent,
  ValidationRequested as ValidationRequestedEvent,
  ValidationResponded as ValidationRespondedEvent,
  MerkleRootAnchored as MerkleRootAnchoredEvent,
  ResponseAppended as ResponseAppendedEvent,
} from "../generated/AttestationRegistry/AttestationRegistry";
import { Attestation, Validation, MerkleRoot, Agent } from "../generated/schema";

/**
 * Handle feedback given to an agent.
 * Feedback is reputation data: a rating (value) with optional tags.
 */
export function handleFeedbackGiven(event: FeedbackGivenEvent): void {
  let agentId = event.params.agentId.toHex();
  let giverId = event.params.giver.toHex();
  let feedbackIndex = event.params.feedbackIndex;

  let id = agentId + "-" + giverId + "-" + feedbackIndex.toString();
  let attestation = new Attestation(id);

  attestation.agent = agentId;
  attestation.giver = event.params.giver;
  attestation.feedbackIndex = feedbackIndex;
  attestation.value = event.params.value;
  attestation.valueDecimals = event.params.valueDecimals;
  attestation.tag1 = event.params.tag1;
  attestation.tag2 = event.params.tag2;
  attestation.status = "ACTIVE";
  attestation.timestamp = event.block.timestamp;
  attestation.txHash = event.transaction.hash;

  attestation.save();

  // Update agent's feedback count and reputation score
  let agent = Agent.load(agentId);
  if (agent) {
    agent.feedbackCount = agent.feedbackCount.plus(BigInt.fromI32(1));
    // Reputation score calculation: sum of all feedback values (scaled by decimals)
    // This is approximate; a full implementation would aggregate all attestations
    let currentScore = agent.reputationScore;
    if (currentScore !== null) {
      agent.reputationScore = currentScore.plus(event.params.value);
    } else {
      agent.reputationScore = event.params.value;
    }
    agent.updatedAt = event.block.timestamp;
    agent.save();
  }
}

/**
 * Handle feedback revocation.
 */
export function handleFeedbackRevoked(event: FeedbackRevokedEvent): void {
  let agentId = event.params.agentId.toHex();
  let giverId = event.params.giver.toHex();
  let feedbackIndex = event.params.feedbackIndex;

  let id = agentId + "-" + giverId + "-" + feedbackIndex.toString();
  let attestation = Attestation.load(id);

  if (attestation) {
    attestation.status = "REVOKED";
    attestation.save();

    // Update agent's feedback count (decrement)
    let agent = Agent.load(agentId);
    if (agent) {
      agent.feedbackCount = agent.feedbackCount.minus(BigInt.fromI32(1));
      agent.updatedAt = event.block.timestamp;
      agent.save();
    }
  }
}

/**
 * Handle agent response to feedback.
 * Append a response hash to existing feedback.
 */
export function handleResponseAppended(event: ResponseAppendedEvent): void {
  let agentId = event.params.agentId.toHex();
  let giverId = event.params.giver.toHex();
  let feedbackIndex = event.params.feedbackIndex;

  let id = agentId + "-" + giverId + "-" + feedbackIndex.toString();
  let attestation = Attestation.load(id);

  if (attestation) {
    // Response hash could be stored here if emitted in the event
    // For now, just mark that a response exists
    attestation.save();
  }
}

/**
 * Handle validation request.
 * A validator is asked to validate agent reputation/performance.
 */
export function handleValidationRequested(event: ValidationRequestedEvent): void {
  let requestKey = event.params.requestKey.toHex();

  let validation = new Validation(requestKey);
  validation.requestKey = event.params.requestKey;
  validation.agent = event.params.agentId.toHex();
  validation.validator = event.params.validatorAddress;
  validation.requestHash = event.params.requestHash;
  validation.status = "PENDING";
  validation.requestedAt = event.block.timestamp;
  validation.txHash = event.transaction.hash;

  validation.save();
}

/**
 * Handle validation response.
 * Validator submits their validation result (yes/no/abstain).
 */
export function handleValidationResponded(event: ValidationRespondedEvent): void {
  let requestKey = event.params.requestKey.toHex();

  let validation = Validation.load(requestKey);
  if (validation) {
    validation.response = event.params.response;
    validation.responseTag = event.params.tag;
    validation.status = "RESPONDED";
    validation.respondedAt = event.block.timestamp;
    validation.save();
  }
}

/**
 * Handle merkle root anchoring.
 * Validator anchors a merkle root proving agent performance/usage.
 * Links off-chain data (via IPFS URI) to on-chain record.
 */
export function handleMerkleRootAnchored(event: MerkleRootAnchoredEvent): void {
  let agentId = event.params.agentId.toHex();
  let merkleRoot = event.params.merkleRoot.toHex();

  let id = agentId + "-" + merkleRoot;
  let merkleRootRecord = new MerkleRoot(id);

  merkleRootRecord.agent = agentId;
  merkleRootRecord.merkleRoot = event.params.merkleRoot;
  merkleRootRecord.logCount = event.params.logCount;
  merkleRootRecord.ipfsURI = event.params.ipfsURI;
  merkleRootRecord.validator = event.params.validator;
  merkleRootRecord.anchoredAt = event.block.timestamp;
  merkleRootRecord.txHash = event.transaction.hash;

  merkleRootRecord.save();
}
