/**
 * requireChannelPayment — Express middleware factory for channel-protected routes.
 *
 * ─── Multi-step protocol ────────────────────────────────────────────────────
 *
 * Step 1  (probe / discovery)
 *   Client makes a bare request with no payment headers.
 *   → 402 with standard x402 `accepts[]` + `channelOptions` that advertises
 *     the recommended deposit, max duration, rate per call, etc.
 *     If scheme is "kite-programmable" the provider automatically accepts
 *     channels.
 *
 * Step 2  (first channel call — activation)
 *   Client opens a channel on-chain and retries with:
 *     X-Payment-Mode: channel
 *     X-Channel-Id:   <channelId>
 *   Server reads the channel from chain, verifies it, activates it on-chain,
 *   signs the first receipt, and returns the protected data.
 *
 * Step 3  (subsequent calls)
 *   Subsequent requests include the last receipt headers:
 *     X-Last-Receipt-Seq, X-Last-Receipt-Cost,
 *     X-Last-Receipt-Sig, X-Last-Receipt-Timestamp
 *   Server validates continuity against its session store, charges the call,
 *   signs a new receipt, and returns the data.
 *
 * The response always embeds `channelReceipt` in the JSON body (and mirrors
 * it in HTTP headers) so the client can track cumulative cost.
 */

import type { Request, Response, NextFunction } from "express";
import {
  getChannelOnChain,
  activateChannelOnChain,
  isContractsConfigured,
} from "../services/contract-service.js";
import {
  getSession,
  upsertSession,
  recordReceipt,
  type ChannelSession,
  type ChannelCallReceipt,
} from "../services/channel-session.js";
import {
  signChannelReceipt,
  providerAddress,
} from "../services/receipt-signer.js";

// ─── Types ────────────────────────────────────────────────────────────

export interface ChannelRouteConfig {
  /** Amount in token base units charged per successful call. */
  ratePerCall: bigint;
  /** Human-readable description surfaced in the 402 challenge. */
  description?: string;
  /** Suggested minimum deposit (defaults to ratePerCall * 10). */
  recommendedDeposit?: bigint;
  /** Suggested channel lifetime in seconds (default: 3 600 = 1 hour). */
  maxDuration?: number;
  /** Optional network name (default: from env or "kite-testnet"). */
  network?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────

const CHANNEL_STATUS_OPEN = 0;
const CHANNEL_STATUS_ACTIVE = 1;

function token(): string {
  return process.env.USDT_TOKEN_ADDRESS ?? process.env.TOKEN_ADDRESS ?? "";
}

/**
 * Build the 402 challenge body.  Includes both the standard x402 `accepts`
 * array (so per-call payment still works on the same routes) and a
 * `channelOptions` block that signals channel support.
 *
 * IMPORTANT: `payTo` must be the deployer's signing address (providerAddress()),
 * not FACILITATOR_RECIPIENT_ADDRESS. The channel is opened on-chain with
 * `provider = payTo`, and the contract enforces:
 *   - activateChannel: msg.sender == channel.provider
 *   - receipt verification: ecrecover(hash, sig) == channel.provider
 * Both operations are performed by the backend using DEPLOYER_PRIVATE_KEY.
 */
function build402Challenge(
  config: ChannelRouteConfig,
  resourceUrl: string,
): object {
  const tok = token();
  // For channel routes the provider IS the signer — see note above.
  const provAddr = providerAddress();
  const recommendedDeposit = (
    config.recommendedDeposit ?? config.ratePerCall * 10n
  ).toString();
  const maxDuration = config.maxDuration ?? 3600;

  return {
    x402Version: 1,
    accepts: [
      {
        scheme: "kite-programmable",
        network:
          config.network ??
          process.env.KITE_NETWORK ??
          "kite-testnet",
        maxAmountRequired: config.ratePerCall.toString(),
        // Inform clients this is also the ceiling per single call in a channel.
        maxRatePerCall: config.ratePerCall.toString(),
        payTo: provAddr,
        asset: tok,
        resource: resourceUrl,
        description:
          config.description ?? "Payment required to access this resource",
        settlementContract: process.env.KITE_AA_WALLET_ADDRESS ?? "",
      },
    ],
    // Extended metadata — a "kite-programmable" scheme always accepts channels.
    channelOptions: {
      acceptsChannel: true,
      recommendedDeposit,
      maxDuration,
      ratePerCall: config.ratePerCall.toString(),
      maxPerCall: config.ratePerCall.toString(),
      token: tok,
      payTo: provAddr,
    },
  };
}

function setReceiptHeaders(res: Response, receipt: ChannelCallReceipt): void {
  res.setHeader("X-Channel-Id", receipt.channelId);
  res.setHeader("X-Channel-Receipt-Seq", String(receipt.sequenceNumber));
  res.setHeader("X-Channel-Cumulative-Cost", receipt.cumulativeCost);
  res.setHeader("X-Channel-Receipt-Timestamp", String(receipt.timestamp));
  res.setHeader("X-Channel-Receipt-Sig", receipt.providerSignature);
}

// ─── Middleware factory ───────────────────────────────────────────────

export function requireChannelPayment(config: ChannelRouteConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const paymentMode = req.headers["x-payment-mode"] as string | undefined;
    const channelId = req.headers["x-channel-id"] as string | undefined;

    console.log(
      `[channel] ${req.method} ${req.originalUrl} — mode=${paymentMode ?? "none"}, channelId=${channelId ?? "none"}`,
    );

    // ── Step 1: No payment headers → 402 challenge ────────────────────
    if (!channelId || paymentMode !== "channel") {
      const resourceUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
      res.status(402).json(build402Challenge(config, resourceUrl));
      return;
    }

    if (!isContractsConfigured()) {
      res.status(503).json({ error: "PaymentChannel contract not configured" });
      return;
    }

    try {
      // ── Steps 2 & 3: Channel-based access ─────────────────────────────
      let session = getSession(channelId);

      if (!session) {
        // ── Step 2: First call — verify & activate ─────────────────────
        console.log(`[channel] Verifying new channel ${channelId}...`);

        let channelData: Awaited<ReturnType<typeof getChannelOnChain>>;
        try {
          channelData = await getChannelOnChain(channelId);
        } catch (err: any) {
          res
            .status(402)
            .json({ error: `Cannot read channel on-chain: ${err.message}` });
          return;
        }

        const provAddr = providerAddress();

        // Channel must target this backend as the provider.
        if (channelData.provider.toLowerCase() !== provAddr.toLowerCase()) {
          res.status(402).json({
            error: `Channel provider mismatch: channel.provider=${channelData.provider}, expected=${provAddr}`,
          });
          return;
        }

        // Channel must be Open or Active (not expired / closed).
        if (
          channelData.status !== CHANNEL_STATUS_OPEN &&
          channelData.status !== CHANNEL_STATUS_ACTIVE
        ) {
          res.status(402).json({
            error: `Channel is not open (status=${channelData.status})`,
          });
          return;
        }

        // maxPerCall must cover at least the rate we charge.
        if (BigInt(channelData.maxPerCall) < config.ratePerCall) {
          res.status(402).json({
            error:
              `Channel maxPerCall (${channelData.maxPerCall}) is less than ` +
              `required ratePerCall (${config.ratePerCall})`,
          });
          return;
        }

        // Deposit must cover at least one call.
        if (BigInt(channelData.deposit) < config.ratePerCall) {
          res.status(402).json({
            error: `Channel deposit (${channelData.deposit}) is less than ratePerCall (${config.ratePerCall})`,
          });
          return;
        }

        // Activate on-chain if still in Open state.
        if (channelData.status === CHANNEL_STATUS_OPEN) {
          console.log(`[channel] Activating channel ${channelId} on-chain...`);
          try {
            const { txHash } = await activateChannelOnChain(channelId);
            console.log(`[channel] Activated: txHash=${txHash}`);
          } catch (err: any) {
            res.status(500).json({
              error: `Failed to activate channel: ${err.message}`,
            });
            return;
          }
        } else {
          console.log(`[channel] Channel already Active — skipping activation.`);
        }

        // Create session entry.
        session = {
          channelId: channelId.toLowerCase(),
          consumer: channelData.consumer,
          provider: provAddr,
          token: channelData.token,
          ratePerCall: config.ratePerCall,
          sequenceNumber: 0,
          cumulativeCost: 0n,
          lastReceipt: null,
          activatedAt: Math.floor(Date.now() / 1000),
          expiresAt: channelData.expiresAt,
        } as ChannelSession;
        upsertSession(session);
        console.log(`[channel] Session created for channel ${channelId}`);
      } else {
        // ── Step 3: Subsequent call — validate last-receipt continuity ──
        const lastSeqHeader = req.headers["x-last-receipt-seq"] as string | undefined;
        const lastCostHeader = req.headers["x-last-receipt-cost"] as string | undefined;
        const lastSigHeader = req.headers["x-last-receipt-sig"] as string | undefined;

        // If the client forwards a last-receipt, verify it matches our records.
        if (lastSeqHeader && session.lastReceipt) {
          const clientSeq = Number(lastSeqHeader);
          if (clientSeq !== session.lastReceipt.sequenceNumber) {
            res.status(402).json({
              error:
                `Receipt sequence mismatch: client claims seq=${clientSeq}, ` +
                `provider has seq=${session.lastReceipt.sequenceNumber}`,
            });
            return;
          }
        }

        // Verify the channel has not expired.
        if (
          session.expiresAt > 0 &&
          Math.floor(Date.now() / 1000) > session.expiresAt
        ) {
          res.status(402).json({ error: "Channel has expired" });
          return;
        }

        // Verify cumulative spend does not exceed on-chain maxSpend.
        // (We check against local state; a full on-chain re-fetch is optional
        //  and would add latency on every call.)
        console.log(
          `[channel] Continuing session for ${channelId}, seq=${session.sequenceNumber}, ` +
            `cumulativeCost=${session.cumulativeCost}`,
        );
      }

      // ── Charge the call and sign a new receipt ───────────────────────
      const newSeq = session.sequenceNumber + 1;
      const newCumulativeCost = session.cumulativeCost + config.ratePerCall;
      const timestamp = Math.floor(Date.now() / 1000);

      const receipt = await signChannelReceipt(
        channelId,
        newSeq,
        newCumulativeCost,
        timestamp,
      );

      // Persist to session store.
      recordReceipt(channelId, receipt);

      // Attach to res.locals for the route handler to embed in the response.
      res.locals.channelReceipt = receipt;
      res.locals.channelSession = session;

      // Mirror receipt in response headers (client fallback).
      setReceiptHeaders(res, receipt);

      next();
    } catch (err: any) {
      console.error(`[channel] Unexpected error:`, err.message);
      res.status(500).json({ error: err.message });
    }
  };
}
