import {
  AgentDeactivated as AgentDeactivatedEvent,
  AgentRegistered as AgentRegistryEvent,
} from "../generated/AgentRegistry/AgentRegistry";
import { Agent } from "../generated/schema";

export function handleAgentRegistered(event: AgentRegistryEvent): void {
  let id = event.params.agentId.toHex();

  let agent = new Agent(id);
  agent.agentId = event.params.agentId;
  agent.address = event.params.agentAddress;
  agent.wallet = event.params.walletContract;
  agent.owner = event.params.ownerAddress.toHex();
  agent.index = event.params.agentIndex;
  agent.metadata = event.params.metadata;

  agent.active = true;
  agent.createdAt = event.block.timestamp;
  agent.updatedAt = event.block.timestamp;

  agent.save();
}

export function handleAgentDeactivated(event: AgentDeactivatedEvent): void {
  let id = event.params.agentId.toHex();
  let agent = Agent.load(id);

  if (agent) {
    agent.active = false;
    agent.updatedAt = event.block.timestamp;
    agent.save();
  }
}

// export function handleRegistrySessionKeyAdded(
//   event: SessionRegisteredEvent,
// ): void {
//   let id = event.params.sessionKey.toHex();

//   let session = new Session(id);
//   session.sessionKey = event.params.sessionKey;
//   session.agent = event.params.agentId.toHex();

//   let agent = Agent.load(session.agent);
//   if (agent) {
//     session.user = agent.owner;
//   }

//   session.sessionIndex = event.params.sessionIndex;
//   session.validUntil = event.params.validUntil;

//   session.status = "ACTIVE";

//   session.createdAt = event.block.timestamp;
//   session.updatedAt = event.block.timestamp;

//   session.save();
// }

// export function handleRegistrySessionKeyRevoked(
//   event: SessionDeactivatedEvent,
// ): void {
//   let id = event.params.sessionKey.toHex();
//   let session = Session.load(id);

//   if (session) {
//     session.status = "REVOKED";
//     session.updatedAt = event.block.timestamp;
//     session.save();
//   }
// }
