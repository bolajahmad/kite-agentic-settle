import {
  AgentLinked as AgentLinkedEvent,
  AgentRegistryUpdated as AgentRegistryUpdatedEvent,
  FundsDeposited as FundsDepositedEvent,
  FundsWithdrawn as FundsWithdrawnEvent,
  OwnershipTransferred as OwnershipTransferredEvent,
  PaymentExecuted as PaymentExecutedEvent,
  ProviderBlocked as ProviderBlockedEvent,
  ProviderUnblocked as ProviderUnblockedEvent,
  SessionBlockedProvidersUpdated as SessionBlockedProvidersUpdatedEvent,
  SessionKeyAdded as SessionKeyAddedEvent,
  SessionKeyRevoked as SessionKeyRevokedEvent,
  UserRegistered as UserRegisteredEvent
} from "../generated/KiteAAWallet/KiteAAWallet"
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
} from "../generated/schema"
import { Bytes } from "@graphprotocol/graph-ts"

export function handleAgentLinked(event: AgentLinkedEvent): void {
  let entity = new AgentLinked(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.user = event.params.user
  entity.agentId = event.params.agentId

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleAgentRegistryUpdated(
  event: AgentRegistryUpdatedEvent
): void {
  let entity = new AgentRegistryUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.registry = event.params.registry

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleFundsDeposited(event: FundsDepositedEvent): void {
  let entity = new FundsDeposited(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.user = event.params.user
  entity.token = event.params.token
  entity.amount = event.params.amount

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleFundsWithdrawn(event: FundsWithdrawnEvent): void {
  let entity = new FundsWithdrawn(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.user = event.params.user
  entity.token = event.params.token
  entity.amount = event.params.amount

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleOwnershipTransferred(
  event: OwnershipTransferredEvent
): void {
  let entity = new OwnershipTransferred(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.previousOwner = event.params.previousOwner
  entity.newOwner = event.params.newOwner

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handlePaymentExecuted(event: PaymentExecutedEvent): void {
  let entity = new PaymentExecuted(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.sessionKey = event.params.sessionKey
  entity.agentId = event.params.agentId
  entity.recipient = event.params.recipient
  entity.token = event.params.token
  entity.amount = event.params.amount

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleProviderBlocked(event: ProviderBlockedEvent): void {
  let entity = new ProviderBlocked(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.sessionKey = event.params.sessionKey
  entity.provider = event.params.provider

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleProviderUnblocked(event: ProviderUnblockedEvent): void {
  let entity = new ProviderUnblocked(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.sessionKey = event.params.sessionKey
  entity.provider = event.params.provider

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleSessionBlockedProvidersUpdated(
  event: SessionBlockedProvidersUpdatedEvent
): void {
  let entity = new SessionBlockedProvidersUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.sessionKey = event.params.sessionKey
  entity.blockedProviders = changetype<Bytes[]>(event.params.blockedProviders)

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleSessionKeyAdded(event: SessionKeyAddedEvent): void {
  let entity = new SessionKeyAdded(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.sessionKey = event.params.sessionKey
  entity.user = event.params.user
  entity.agentId = event.params.agentId
  entity.sessionIndex = event.params.sessionIndex
  entity.metadataHash = event.params.metadataHash
  entity.valueLimit = event.params.valueLimit
  entity.dailyLimit = event.params.dailyLimit
  entity.validUntil = event.params.validUntil
  entity.metadata = event.params.metadata

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleSessionKeyRevoked(event: SessionKeyRevokedEvent): void {
  let entity = new SessionKeyRevoked(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.sessionKey = event.params.sessionKey
  entity.agentId = event.params.agentId

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleUserRegistered(event: UserRegisteredEvent): void {
  let entity = new UserRegistered(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.user = event.params.user

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}
