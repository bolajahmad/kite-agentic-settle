import type { NextFunction, Request, Response } from "express";
import {
  decodeX402Header,
  processX402Payment,
} from "../services/facilitator.js";

// ─── Types ────────────────────────────────────────────────────────────

export interface X402RouteConfig {
  /**
   * Preferred multi-offer model. If provided, provider will expose all offers
   * in accepts[] and settlement will validate against the selected asset.
   */
  offers?: Array<{
    amount: bigint;
    token: string;
    description?: string;
  }>;
  /** Amount in token base units (e.g. 1_000_000n = 1 USDT with 6 decimals) */
  amount?: bigint;
  /** ERC20 token address that must be used for payment */
  token?: string;
  /** This backend's address that should receive the payment */
  recipient: string;
  /** Human-readable description shown in the 402 challenge */
  description?: string;
  /** Optional network name (default: "kite-testnet") */
  network?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function build402Challenge(
  config: X402RouteConfig,
  resourceUrl: string,
): object {
  const offers =
    config.offers && config.offers.length > 0
      ? config.offers
      : config.amount !== undefined && config.token
        ? [
            {
              amount: config.amount,
              token: config.token,
              description: config.description,
            },
          ]
        : [];

  if (offers.length === 0) {
    throw new Error("x402 route has no payment offers configured");
  }

  return {
    x402Version: 1,
    accepts: offers.map((offer) => ({
      scheme: "kite-programmable",
      network: config.network ?? process.env.KITE_NETWORK ?? "kite-testnet",
      maxAmountRequired: offer.amount.toString(),
      payTo: config.recipient,
      asset: offer.token,
      resource: resourceUrl,
      description:
        offer.description ??
        config.description ??
        "Payment required to access this resource",
    })),
  };
}

// ─── Middleware factory ───────────────────────────────────────────────

/**
 * Creates an Express middleware that:
 * 1. Returns 402 with a x402 challenge if no X-PAYMENT header is present.
 * 2. Decodes, validates, and settles the KiteAAWallet EIP-712 payment when
 *    X-PAYMENT is present (calling executePaymentBySig on-chain via the
 *    facilitator service).
 * 3. Attaches settlement details to `res.locals.payment` and calls next() on
 *    success so the route handler can return the protected data.
 */
export function requireX402Payment(config: X402RouteConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const xPayment = req.headers["x-payment"] as string | undefined;

    console.log(
      `[x402] ${req.method} ${req.originalUrl} — X-PAYMENT present: ${!!xPayment}`,
    );

    if (!xPayment) {
      const resourceUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
      console.log(`[x402] No X-PAYMENT header, returning 402 challenge`);
      res.status(402).json(build402Challenge(config, resourceUrl));
      return;
    }

    try {
      const decoded = decodeX402Header(xPayment);
      const selectedToken = decoded.auth.token.toLowerCase();
      const offers =
        config.offers && config.offers.length > 0
          ? config.offers
          : config.amount !== undefined && config.token
            ? [{ amount: config.amount, token: config.token }]
            : [];

      const matchedOffer = offers.find(
        (offer) => offer.token.toLowerCase() === selectedToken,
      );

      if (!matchedOffer) {
        throw new Error(
          `Token not accepted for this route: ${decoded.auth.token}`,
        );
      }

      console.log(
        `[x402] Processing payment, recipient=${config.recipient}, token=${matchedOffer.token}, amount=${matchedOffer.amount}`,
      );
      const settlement = await processX402Payment(
        xPayment,
        config.recipient,
        matchedOffer.token,
        matchedOffer.amount,
      );

      console.log(`[x402] Settlement OK: txHash=${settlement.txHash}`);
      // Expose settlement info to route handlers
      res.locals.payment = settlement;
      next();
    } catch (err: any) {
      console.error(`[x402] Settlement FAILED:`, err.message);
      // Payment validation or settlement failed — still deny access
      res.status(402).json({
        x402Version: 1,
        error: err.message ?? "Payment verification failed",
      });
    }
  };
}
