/**
 * Provider-side receipt signer for payment channels.
 *
 * The PaymentChannel contract verifies settlement receipts using:
 *
 *   bytes32 hash = keccak256(abi.encodePacked(
 *       channelId, sequenceNumber, cumulativeCost, timestamp
 *   ));
 *   bytes32 ethHash = ECDSA.toEthSignedMessageHash(hash);
 *   address signer  = ECDSA.recover(ethHash, signature);
 *   require(signer == channel.provider, "Bad signature");
 *
 * The client-side `validateChannelReceipt` in the CLI reproduces the same
 * digest via viem's `recoverMessageAddress({ message: { raw: hash } })`,
 * which also applies the standard Ethereum personal-sign prefix.
 *
 * We use `ethers.Wallet.signMessage(bytes)` which applies the same prefix,
 * so the two sides are compatible.
 */
import { ethers } from "ethers";
import { getSigner } from "./contract-service.js";
import type { ChannelCallReceipt } from "./channel-session.js";

/**
 * Sign a channel call receipt using the backend deployer key.
 *
 * The digest matches `keccak256(abi.encodePacked(channelId, seqNum, cost, ts))`
 * signed as an Ethereum personal message.
 */
export async function signChannelReceipt(
  channelId: string,
  sequenceNumber: number,
  cumulativeCost: bigint,
  timestamp: number,
): Promise<ChannelCallReceipt> {
  const signer = getSigner();

  // Replicate on-chain: keccak256(abi.encodePacked(bytes32, uint256, uint256, uint256))
  const hash = ethers.solidityPackedKeccak256(
    ["bytes32", "uint256", "uint256", "uint256"],
    [channelId, BigInt(sequenceNumber), cumulativeCost, BigInt(timestamp)],
  );

  // ethers.Wallet.signMessage applies the Ethereum personal-sign prefix (\x19...)
  const signature = await signer.signMessage(ethers.getBytes(hash));

  return {
    channelId: channelId as `0x${string}`,
    sequenceNumber,
    cumulativeCost: cumulativeCost.toString(),
    timestamp,
    providerSignature: signature as `0x${string}`,
  };
}

/**
 * Return the public address used as the provider identity.
 * The on-chain channel must have `provider == providerAddress()`.
 */
export function providerAddress(): string {
  return getSigner().address;
}
