import { Request, Response } from "express";
import { encodePacked, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const TOKEN_ADDRESS =
  process.env.TESTNET_TOKEN || "0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63";
const WALLET_ADDRESS =
  process.env.KITE_AA_WALLET_ADDRESS || "0x_NOT_CONFIGURED";
const DEFAULT_PRICE = process.env.SERVICE_PRICE || "1000000000000000000"; // 1 token

// In-memory cumulative cost tracker per channel (resets on server restart).
const channelCumulativeCost: Record<string, bigint> = {};
const channelSequenceNumber: Record<string, number> = {};

export const mockService = async (req: Request, res: Response) => {
  const xPayment = req.headers["x-payment"];
  const channelId = req.headers["x-channel-id"] as string | undefined;

  // ── Channel-stream / batch mode ──────────────────────────────────────────
  if (channelId) {
    const providerKey = process.env.DEPLOYER_PRIVATE_KEY as
      | `0x${string}`
      | undefined;
    if (!providerKey) {
      return res.status(503).json({
        error: "DEPLOYER_PRIVATE_KEY not set — cannot sign channel receipts",
      });
    }

    const callCost = BigInt(DEFAULT_PRICE);
    const prevCumulative = channelCumulativeCost[channelId] ?? 0n;
    const newCumulative = prevCumulative + callCost;
    const seq = (channelSequenceNumber[channelId] ?? 0) + 1;
    const timestamp = Math.floor(Date.now() / 1000);

    // Build the same digest as PaymentChannel.sol:
    // keccak256(abi.encodePacked(channelId, sequenceNumber, cumulativeCost, timestamp))
    const digest = keccak256(
      encodePacked(
        ["bytes32", "uint256", "uint256", "uint256"],
        [
          channelId as `0x${string}`,
          BigInt(seq),
          newCumulative,
          BigInt(timestamp),
        ],
      ),
    );

    const account = privateKeyToAccount(providerKey);
    const signature = await account.signMessage({ message: { raw: digest } });

    channelCumulativeCost[channelId] = newCumulative;
    channelSequenceNumber[channelId] = seq;

    return res.json({
      result: "Channel call served successfully",
      serviceId: req.params.id,
      channelReceipt: {
        channelId: channelId as `0x${string}`,
        sequenceNumber: seq,
        cumulativeCost: newCumulative.toString(),
        timestamp,
        providerSignature: signature,
      },
    });
  }

  // ── x402 single-call mode ────────────────────────────────────────────────
  if (!xPayment) {
    return res.status(402).json({
      error: "Payment Required",
      accepts: [
        {
          scheme: "gokite-aa",
          network: "kite-testnet",
          maxAmountRequired: DEFAULT_PRICE,
          maxRatePerCall: DEFAULT_PRICE,
          resource: `${req.protocol}://${req.get("host")}/api/service/mock/${req.params.id}`,
          description: "Mock Service API",
          mimeType: "application/json",
          payTo: WALLET_ADDRESS,
          asset: TOKEN_ADDRESS,
          maxTimeoutSeconds: 300,
          merchantName: "Mock Service",
        },
      ],
      x402Version: 1,
    });
  }

  // Payment header present — agent already paid
  res.json({
    result: "Service response returned successfully",
    serviceId: req.params.id,
    paymentTx: xPayment,
    paidAmount: DEFAULT_PRICE,
  });
};
