import { keccak256, encodeAbiParameters, parseAbiParameters } from "viem";

/**
 * Derive the deterministic sessionId used by ClientAgentVault and IdentityRegistry.
 *
 *   sessionId = keccak256(abi.encodePacked(sessionKey, agentId, validUntil))
 *
 * @param sessionKey   The ephemeral session key address (EOA)
 * @param agentId      The agent's NFT tokenId (uint256)
 * @param validUntil   Session expiry as a Unix timestamp (uint256)
 */
export function deriveSessionId(
  sessionKey: `0x${string}`,
  agentId: bigint,
  validUntil: bigint
): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("address, uint256, uint256"),
      [sessionKey, agentId, validUntil]
    )
  );
}

/**
 * Hash a provider address to the bytes32 format expected by ClientAgentVault's
 * spending rules (targetProviders array and checkSpendingRules serviceProvider).
 *
 *   hashedProvider = keccak256(abi.encodePacked(providerAddress))
 *
 * @param providerAddress  The raw provider EOA / contract address
 */
export function hashProvider(providerAddress: `0x${string}`): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("address"),
      [providerAddress]
    )
  );
}
