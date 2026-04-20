import type { Request, Response, NextFunction } from "express";
import { processX402Payment } from "../services/facilitator.js";

// ─── Types ────────────────────────────────────────────────────────────

export interface X402RouteConfig {
  /** Amount in token base units (e.g. 1_000_000n = 1 USDT with 6 decimals) */
  amount: bigint;
  /** ERC20 token address that must be used for payment */
  token: string;
  /** This backend's address that should receive the payment */
  recipient: string;
  /** Human-readable description shown in the 402 challenge */
  description?: string;
  /** Optional network name (default: "kite-testnet") */
  network?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function build402Challenge(config: X402RouteConfig, resourceUrl: string): object {
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: "kite-programmable",
        network: config.network ?? process.env.KITE_NETWORK ?? "kite-testnet",
        maxAmountRequired: config.amount.toString(),
        payTo: config.recipient,
        asset: config.token,
        resource: resourceUrl,
        description: config.description ?? "Payment required to access this resource",
        settlementContract: process.env.KITE_AA_WALLET_ADDRESS ?? "",
      },
    ],
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

    console.log(`[x402] ${req.method} ${req.originalUrl} — X-PAYMENT present: ${!!xPayment}`);

    if (!xPayment) {
      const resourceUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
      console.log(`[x402] No X-PAYMENT header, returning 402 challenge`);
      res.status(402).json(build402Challenge(config, resourceUrl));
      return;
    }

    try {
      console.log(`[x402] Processing payment, recipient=${config.recipient}, token=${config.token}, amount=${config.amount}`);
      const settlement = await processX402Payment(
        xPayment,
        config.recipient,
        config.token,
        config.amount
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
