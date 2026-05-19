/**
 * requireFlexPayment — Dual-mode payment middleware factory.
 *
 * Supports both x402 (per-call) and payment-channel modes on the same route.
 * The consumer decides which mode to use; the provider accepts either.
 *
 * Detection logic:
 *   X-Channel-Id or X-Payment-Mode: channel  → channel payment path
 *   X-Payment (EIP-712 receipt)               → x402 per-call path
 *   Neither                                   → 402 advertising BOTH modes
 *
 * The combined 402 body includes:
 *   • `accepts[]`      — x402 offers (kite-programmable scheme, per-call)
 *   • `channelOptions` — channel metadata (recommended deposit, rate, etc.)
 *   • `paymentModes`   — ["x402", "channel"] so clients know both are accepted
 */

import type { NextFunction, Request, Response } from "express";
import { requireChannelPayment, type ChannelRouteConfig } from "./channel-payment.js";
import { requireX402Payment, type X402RouteConfig } from "./x402.js";
import { providerAddress } from "../services/receipt-signer.js";

// ─── Combined 402 challenge builder ───────────────────────────────────

function buildFlexChallenge(
  x402Config: X402RouteConfig,
  channelConfig: ChannelRouteConfig,
  resourceUrl: string,
): object {
  const network =
    x402Config.network ??
    channelConfig.network ??
    process.env.KITE_NETWORK ??
    "kite-testnet";

  const tokenAddr =
    process.env.USDT_TOKEN_ADDRESS ?? process.env.TOKEN_ADDRESS ?? "";

  const provAddr = providerAddress();

  // x402 per-call offers (come from the x402Config)
  const offers =
    x402Config.offers && x402Config.offers.length > 0
      ? x402Config.offers
      : x402Config.amount !== undefined && x402Config.token
        ? [{ amount: x402Config.amount, token: x402Config.token }]
        : [];

  const accepts = offers.map((offer) => ({
    scheme: "kite-programmable",
    network,
    maxAmountRequired: offer.amount.toString(),
    payTo: x402Config.recipient,
    asset: offer.token,
    resource: resourceUrl,
    description: offer.description ?? x402Config.description ?? "Per-call payment",
  }));

  const recommendedDeposit = (
    channelConfig.recommendedDeposit ?? channelConfig.ratePerCall * 10n
  ).toString();

  return {
    x402Version: 1,
    paymentModes: ["x402", "channel"],
    accepts,
    channelOptions: {
      acceptsChannel: true,
      recommendedDeposit,
      maxDuration: channelConfig.maxDuration ?? 3600,
      ratePerCall: channelConfig.ratePerCall.toString(),
      maxPerCall: channelConfig.ratePerCall.toString(),
      token: tokenAddr,
      payTo: provAddr,
    },
  };
}

// ─── Middleware factory ────────────────────────────────────────────────

export function requireFlexPayment(
  x402Config: X402RouteConfig,
  channelConfig: ChannelRouteConfig,
) {
  const x402Middleware = requireX402Payment(x402Config);
  const channelMiddleware = requireChannelPayment(channelConfig);

  return (req: Request, res: Response, next: NextFunction) => {
    const hasChannelId = !!req.headers["x-channel-id"];
    const hasChannelMode = req.headers["x-payment-mode"] === "channel";
    const hasX402Payment = !!req.headers["x-payment"];

    console.log(
      `[flex] ${req.method} ${req.originalUrl} — ` +
        `channelId=${hasChannelId}, channelMode=${hasChannelMode}, x402=${hasX402Payment}`,
    );

    if (hasChannelId || hasChannelMode) {
      // Consumer chose channel payment
      return channelMiddleware(req, res, next);
    }

    if (hasX402Payment) {
      // Consumer chose x402 per-call payment
      return x402Middleware(req, res, next);
    }

    // No payment headers — emit combined 402 so the consumer can pick a mode
    const resourceUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    res.status(402).json(buildFlexChallenge(x402Config, channelConfig, resourceUrl));
  };
}
