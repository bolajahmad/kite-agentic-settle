/**
 * Shared channel utilities for demos and CLI
 *
 * These functions handle common channel operations:
 * - Receipt extraction and validation
 * - Channel activation polling
 * - Header construction for channel calls
 */
import type { KitePaymentClient } from "../../src/client.js";
/**
 * Provider-signed receipt returned per call in channel mode.
 * The signature covers `keccak256(abi.encodePacked(channelId, sequenceNumber,
 * cumulativeCost, timestamp))` — the same digest the PaymentChannel contract
 * uses for on-chain settlement verification.
 */
export interface ChannelCallReceipt {
    channelId: `0x${string}`;
    sequenceNumber: number;
    cumulativeCost: string;
    timestamp: number;
    providerSignature: `0x${string}`;
}
/**
 * Extract a `ChannelCallReceipt` from an HTTP response.
 * Providers should embed it in `body.channelReceipt`; headers are checked
 * as a fallback so existing middleware can also convey the receipt.
 */
export declare function extractChannelReceipt(body: any, headers: Headers): ChannelCallReceipt | null;
/**
 * Verify that a provider-signed channel receipt is authentic.
 *
 * The PaymentChannel contract uses:
 *   hash = keccak256(abi.encodePacked(channelId, sequenceNumber, cumulativeCost, timestamp))
 *   signer = toEthSignedMessageHash(hash).recover(signature)
 *   require(signer == ch.provider)
 *
 * We replicate the same digest here so we catch forged receipts before
 * they reach the settlement step.
 */
export declare function validateChannelReceipt(receipt: ChannelCallReceipt, providerAddress: string): Promise<boolean>;
/**
 * Poll the on-chain channel status until it reaches `Active`, or until
 * `timeoutMs` elapses. Returns `true` if activation was detected.
 */
export declare function waitForChannelActive(client: KitePaymentClient, channelId: `0x${string}`, timeoutMs?: number): Promise<boolean>;
/**
 * Build request headers for a channel call, including the last receipt if available.
 */
export declare function buildChannelHeaders(channelId: `0x${string}`, lastReceipt: ChannelCallReceipt | null): Record<string, string>;
