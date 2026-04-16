import { newMockEvent } from "matchstick-as"
import { ethereum, Address, Bytes, BigInt } from "@graphprotocol/graph-ts"
import {
  AgentLinked,
  AgentRegistryUpdated,
  FundsDeposited,
  FundsWithdrawn,
  OwnershipTransferred,
  PaymentExecuted,
  ProviderBlocked,
  ProviderUnblocked,
  SessionBlockedProvidersUpdated,
  SessionKeyAdded,
  SessionKeyRevoked,
  UserRegistered
} from "../generated/KiteAAWallet/KiteAAWallet"

export function createAgentLinkedEvent(
  user: Address,
  agentId: Bytes
): AgentLinked {
  let agentLinkedEvent = changetype<AgentLinked>(newMockEvent())

  agentLinkedEvent.parameters = new Array()

  agentLinkedEvent.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  )
  agentLinkedEvent.parameters.push(
    new ethereum.EventParam("agentId", ethereum.Value.fromFixedBytes(agentId))
  )

  return agentLinkedEvent
}

export function createAgentRegistryUpdatedEvent(
  registry: Address
): AgentRegistryUpdated {
  let agentRegistryUpdatedEvent =
    changetype<AgentRegistryUpdated>(newMockEvent())

  agentRegistryUpdatedEvent.parameters = new Array()

  agentRegistryUpdatedEvent.parameters.push(
    new ethereum.EventParam("registry", ethereum.Value.fromAddress(registry))
  )

  return agentRegistryUpdatedEvent
}

export function createFundsDepositedEvent(
  user: Address,
  token: Address,
  amount: BigInt
): FundsDeposited {
  let fundsDepositedEvent = changetype<FundsDeposited>(newMockEvent())

  fundsDepositedEvent.parameters = new Array()

  fundsDepositedEvent.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  )
  fundsDepositedEvent.parameters.push(
    new ethereum.EventParam("token", ethereum.Value.fromAddress(token))
  )
  fundsDepositedEvent.parameters.push(
    new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(amount))
  )

  return fundsDepositedEvent
}

export function createFundsWithdrawnEvent(
  user: Address,
  token: Address,
  amount: BigInt
): FundsWithdrawn {
  let fundsWithdrawnEvent = changetype<FundsWithdrawn>(newMockEvent())

  fundsWithdrawnEvent.parameters = new Array()

  fundsWithdrawnEvent.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  )
  fundsWithdrawnEvent.parameters.push(
    new ethereum.EventParam("token", ethereum.Value.fromAddress(token))
  )
  fundsWithdrawnEvent.parameters.push(
    new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(amount))
  )

  return fundsWithdrawnEvent
}

export function createOwnershipTransferredEvent(
  previousOwner: Address,
  newOwner: Address
): OwnershipTransferred {
  let ownershipTransferredEvent =
    changetype<OwnershipTransferred>(newMockEvent())

  ownershipTransferredEvent.parameters = new Array()

  ownershipTransferredEvent.parameters.push(
    new ethereum.EventParam(
      "previousOwner",
      ethereum.Value.fromAddress(previousOwner)
    )
  )
  ownershipTransferredEvent.parameters.push(
    new ethereum.EventParam("newOwner", ethereum.Value.fromAddress(newOwner))
  )

  return ownershipTransferredEvent
}

export function createPaymentExecutedEvent(
  sessionKey: Address,
  agentId: Bytes,
  recipient: Address,
  token: Address,
  amount: BigInt
): PaymentExecuted {
  let paymentExecutedEvent = changetype<PaymentExecuted>(newMockEvent())

  paymentExecutedEvent.parameters = new Array()

  paymentExecutedEvent.parameters.push(
    new ethereum.EventParam(
      "sessionKey",
      ethereum.Value.fromAddress(sessionKey)
    )
  )
  paymentExecutedEvent.parameters.push(
    new ethereum.EventParam("agentId", ethereum.Value.fromFixedBytes(agentId))
  )
  paymentExecutedEvent.parameters.push(
    new ethereum.EventParam("recipient", ethereum.Value.fromAddress(recipient))
  )
  paymentExecutedEvent.parameters.push(
    new ethereum.EventParam("token", ethereum.Value.fromAddress(token))
  )
  paymentExecutedEvent.parameters.push(
    new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(amount))
  )

  return paymentExecutedEvent
}

export function createProviderBlockedEvent(
  sessionKey: Address,
  provider: Address
): ProviderBlocked {
  let providerBlockedEvent = changetype<ProviderBlocked>(newMockEvent())

  providerBlockedEvent.parameters = new Array()

  providerBlockedEvent.parameters.push(
    new ethereum.EventParam(
      "sessionKey",
      ethereum.Value.fromAddress(sessionKey)
    )
  )
  providerBlockedEvent.parameters.push(
    new ethereum.EventParam("provider", ethereum.Value.fromAddress(provider))
  )

  return providerBlockedEvent
}

export function createProviderUnblockedEvent(
  sessionKey: Address,
  provider: Address
): ProviderUnblocked {
  let providerUnblockedEvent = changetype<ProviderUnblocked>(newMockEvent())

  providerUnblockedEvent.parameters = new Array()

  providerUnblockedEvent.parameters.push(
    new ethereum.EventParam(
      "sessionKey",
      ethereum.Value.fromAddress(sessionKey)
    )
  )
  providerUnblockedEvent.parameters.push(
    new ethereum.EventParam("provider", ethereum.Value.fromAddress(provider))
  )

  return providerUnblockedEvent
}

export function createSessionBlockedProvidersUpdatedEvent(
  sessionKey: Address,
  blockedProviders: Array<Address>
): SessionBlockedProvidersUpdated {
  let sessionBlockedProvidersUpdatedEvent =
    changetype<SessionBlockedProvidersUpdated>(newMockEvent())

  sessionBlockedProvidersUpdatedEvent.parameters = new Array()

  sessionBlockedProvidersUpdatedEvent.parameters.push(
    new ethereum.EventParam(
      "sessionKey",
      ethereum.Value.fromAddress(sessionKey)
    )
  )
  sessionBlockedProvidersUpdatedEvent.parameters.push(
    new ethereum.EventParam(
      "blockedProviders",
      ethereum.Value.fromAddressArray(blockedProviders)
    )
  )

  return sessionBlockedProvidersUpdatedEvent
}

export function createSessionKeyAddedEvent(
  sessionKey: Address,
  user: Address,
  agentId: Bytes,
  sessionIndex: BigInt,
  metadataHash: Bytes,
  valueLimit: BigInt,
  dailyLimit: BigInt,
  validUntil: BigInt,
  metadata: Bytes
): SessionKeyAdded {
  let sessionKeyAddedEvent = changetype<SessionKeyAdded>(newMockEvent())

  sessionKeyAddedEvent.parameters = new Array()

  sessionKeyAddedEvent.parameters.push(
    new ethereum.EventParam(
      "sessionKey",
      ethereum.Value.fromAddress(sessionKey)
    )
  )
  sessionKeyAddedEvent.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  )
  sessionKeyAddedEvent.parameters.push(
    new ethereum.EventParam("agentId", ethereum.Value.fromFixedBytes(agentId))
  )
  sessionKeyAddedEvent.parameters.push(
    new ethereum.EventParam(
      "sessionIndex",
      ethereum.Value.fromUnsignedBigInt(sessionIndex)
    )
  )
  sessionKeyAddedEvent.parameters.push(
    new ethereum.EventParam(
      "metadataHash",
      ethereum.Value.fromFixedBytes(metadataHash)
    )
  )
  sessionKeyAddedEvent.parameters.push(
    new ethereum.EventParam(
      "valueLimit",
      ethereum.Value.fromUnsignedBigInt(valueLimit)
    )
  )
  sessionKeyAddedEvent.parameters.push(
    new ethereum.EventParam(
      "dailyLimit",
      ethereum.Value.fromUnsignedBigInt(dailyLimit)
    )
  )
  sessionKeyAddedEvent.parameters.push(
    new ethereum.EventParam(
      "validUntil",
      ethereum.Value.fromUnsignedBigInt(validUntil)
    )
  )
  sessionKeyAddedEvent.parameters.push(
    new ethereum.EventParam("metadata", ethereum.Value.fromBytes(metadata))
  )

  return sessionKeyAddedEvent
}

export function createSessionKeyRevokedEvent(
  sessionKey: Address,
  agentId: Bytes
): SessionKeyRevoked {
  let sessionKeyRevokedEvent = changetype<SessionKeyRevoked>(newMockEvent())

  sessionKeyRevokedEvent.parameters = new Array()

  sessionKeyRevokedEvent.parameters.push(
    new ethereum.EventParam(
      "sessionKey",
      ethereum.Value.fromAddress(sessionKey)
    )
  )
  sessionKeyRevokedEvent.parameters.push(
    new ethereum.EventParam("agentId", ethereum.Value.fromFixedBytes(agentId))
  )

  return sessionKeyRevokedEvent
}

export function createUserRegisteredEvent(user: Address): UserRegistered {
  let userRegisteredEvent = changetype<UserRegistered>(newMockEvent())

  userRegisteredEvent.parameters = new Array()

  userRegisteredEvent.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  )

  return userRegisteredEvent
}
