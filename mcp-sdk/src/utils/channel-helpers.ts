/**
 * Shared channel utilities for demos and CLI
 *
 * These functions handle common channel operations:
 * - Receipt extraction and validation
 * - Channel activation polling
 * - Header construction for channel calls
 */

import { keccak256, encodePacked, recoverMessageAddress } from "viem";
import type { KitePaymentClient } from "../client.js";
import { ChannelStatus } from "../types.js";

/**
 * Provider-signed receipt returned per call in channel mode.
 * The signature covers `keccak256(abi.encodePacked(channelId, sequenceNumber,
 * cumulativeCost, timestamp))` — the same digest the PaymentChannel contract
 * uses for on-chain settlement verification.
 */
export interface ChannelCallReceipt {
  channelId: `0x${string}`;
  sequenceNumber: number;
  cumulativeCost: string; // bigint serialised as decimal string
  timestamp: number;
  providerSignature: `0x${string}`;
}

/**
 * Extract a `ChannelCallReceipt` from an HTTP response.
 * Providers should embed it in `body.channelReceipt`; headers are checked
 * as a fallback so existing middleware can also convey the receipt.
 */
export function extractChannelReceipt(
  body: any,
  headers: Headers,
): ChannelCallReceipt | null {
  // Hopefully, structured object in response body
  if (body?.channelReceipt) {
    return body.channelReceipt as ChannelCallReceipt;
  }
  // Fallback: individual HTTP headers
  const sig = headers.get("x-channel-receipt-sig");
  const seq = headers.get("x-channel-receipt-seq");
  const cost = headers.get("x-channel-cumulative-cost");
  const ts = headers.get("x-channel-receipt-timestamp");
  const channelId = headers.get("x-channel-id");
  if (sig && seq && cost && ts && channelId) {
    return {
      channelId: channelId as `0x${string}`,
      sequenceNumber: Number(seq),
      cumulativeCost: cost,
      timestamp: Number(ts),
      providerSignature: sig as `0x${string}`,
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
export async function validateChannelReceipt(
  receipt: ChannelCallReceipt,
  providerAddress: string,
): Promise<boolean> {
  const hash = keccak256(
    encodePacked(
      ["bytes32", "uint256", "uint256", "uint256"],
      [
        receipt.channelId,
        BigInt(receipt.sequenceNumber),
        BigInt(receipt.cumulativeCost),
        BigInt(receipt.timestamp),
      ],
    ),
  );
  try {
    const recovered = await recoverMessageAddress({
      message: { raw: hash },
      signature: receipt.providerSignature,
    });
    return recovered.toLowerCase() === providerAddress.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Poll the on-chain channel status until it reaches `Active`, or until
 * `timeoutMs` elapses. Returns `true` if activation was detected.
 */
export async function waitForChannelActive(
  client: { getChannel: (channelId: `0x${string}`) => Promise<{ status: number }> },
  channelId: `0x${string}`,
  timeoutMs = 90_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ch = await client.getChannel(channelId);
    if (ch.status === ChannelStatus.Active) return true;
    // Wait 3 s between polls without blocking the event loop entirely.
    await new Promise((r) => setTimeout(r, 3_000));
  }
  return false;
}

/**
 * Build request headers for a channel call, including the last receipt if available.
 */
export function buildChannelHeaders(
  channelId: `0x${string}`,
  lastReceipt: ChannelCallReceipt | null,
): Record<string, string> {
  const headers: Record<string, string> = {
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

// ── 402 Offer utilities ───────────────────────────────────────────────────

/** First offer extracted from a 402 response's `accepts[]` array. */
export interface PayOffer {
  payTo: `0x${string}`;
  asset: `0x${string}`;
  maxAmountRequired: string;
  /** Provider's declared per-call ceiling. */
  maxRatePerCall?: string;
  scheme: string;
  description?: string;
  merchantName?: string;
  resource?: string;
}

function selectOffer(
  offers: PayOffer[],
  preferredAsset?: string,
): PayOffer {
  const normalizedPreferredAsset = preferredAsset?.toLowerCase();
  const scopedOffers = normalizedPreferredAsset
    ? offers.filter(
        (offer) => offer.asset.toLowerCase() === normalizedPreferredAsset,
      )
    : offers;
  return (
    [...scopedOffers].sort((a, b) => {
      const aAmount = BigInt(a.maxAmountRequired);
      const bAmount = BigInt(b.maxAmountRequired);
      if (aAmount < bAmount) return -1;
      if (aAmount > bAmount) return 1;
      return 0;
    })[0] ?? offers[0]
  );
}

/**
 * Probe an endpoint for a 402 Payment Required offer.
 * Returns `null` when no payment is required (non-402 response).
 */
export async function probeApi402Offer(
  url: string,
  preferredAsset?: string,
): Promise<null | { offer: PayOffer; raw: any }> {
  const probe = await globalThis.fetch(url);
  if (probe.status !== 402) return null;

  const text = await probe.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Cannot parse 402 response body: ${text}`);
  }

  const offers = parsed.accepts as PayOffer[] | undefined;
  if (!offers || offers.length === 0) {
    throw new Error("402 response is missing accepts[]");
  }

  const offer = selectOffer(
    offers,
    preferredAsset ?? process.env.SETTLEMENT_TOKEN_ADDRESS,
  );
  return { offer, raw: parsed };
}
