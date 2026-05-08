/**
 * Shared channel utilities for demos and CLI
 *
 * These functions handle common channel operations:
 * - Receipt extraction and validation
 * - Channel activation polling
 * - Header construction for channel calls
 */
import { keccak256, encodePacked, recoverMessageAddress } from "viem";
import { ChannelStatus } from "../../src/types.js";
/**
 * Extract a `ChannelCallReceipt` from an HTTP response.
 * Providers should embed it in `body.channelReceipt`; headers are checked
 * as a fallback so existing middleware can also convey the receipt.
 */
export function extractChannelReceipt(body, headers) {
    // Hopefully, structured object in response body
    if (body?.channelReceipt) {
        return body.channelReceipt;
    }
    // Fallback: individual HTTP headers
    const sig = headers.get("x-channel-receipt-sig");
    const seq = headers.get("x-channel-receipt-seq");
    const cost = headers.get("x-channel-cumulative-cost");
    const ts = headers.get("x-channel-receipt-timestamp");
    const channelId = headers.get("x-channel-id");
    if (sig && seq && cost && ts && channelId) {
        return {
            channelId: channelId,
            sequenceNumber: Number(seq),
            cumulativeCost: cost,
            timestamp: Number(ts),
            providerSignature: sig,
        };
    }
    return null;
}
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
export async function validateChannelReceipt(receipt, providerAddress) {
    const hash = keccak256(encodePacked(["bytes32", "uint256", "uint256", "uint256"], [
        receipt.channelId,
        BigInt(receipt.sequenceNumber),
        BigInt(receipt.cumulativeCost),
        BigInt(receipt.timestamp),
    ]));
    try {
        const recovered = await recoverMessageAddress({
            message: { raw: hash },
            signature: receipt.providerSignature,
        });
        return recovered.toLowerCase() === providerAddress.toLowerCase();
    }
    catch {
        return false;
    }
}
/**
 * Poll the on-chain channel status until it reaches `Active`, or until
 * `timeoutMs` elapses. Returns `true` if activation was detected.
 */
export async function waitForChannelActive(client, channelId, timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const ch = await client.getChannel(channelId);
        if (ch.status === ChannelStatus.Active)
            return true;
        // Wait 3 s between polls without blocking the event loop entirely.
        await new Promise((r) => setTimeout(r, 3_000));
    }
    return false;
}
/**
 * Build request headers for a channel call, including the last receipt if available.
 */
export function buildChannelHeaders(channelId, lastReceipt) {
    const headers = {
        "X-Payment-Mode": "channel",
        "X-Channel-Id": channelId,
    };
    if (lastReceipt) {
        headers["X-Last-Receipt-Seq"] = String(lastReceipt.sequenceNumber);
        headers["X-Last-Receipt-Cost"] = lastReceipt.cumulativeCost;
        headers["X-Last-Receipt-Timestamp"] = String(lastReceipt.timestamp);
        headers["X-Last-Receipt-Sig"] = lastReceipt.providerSignature;
    }
    return headers;
}
