import { Request, Response } from "express";

const TOKEN_ADDRESS = process.env.TESTNET_TOKEN || "0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63";
const WALLET_ADDRESS = process.env.KITE_AA_WALLET_ADDRESS || "0x_NOT_CONFIGURED";
const DEFAULT_PRICE = process.env.SERVICE_PRICE || "1000000000000000000"; // 1 token

export const mockService = (req: Request, res: Response) => {
  const xPayment = req.headers["x-payment"];
  if (!xPayment) {
    return res.status(402).json({
      error: "Payment Required",
      accepts: [
        {
          scheme: "gokite-aa",
          network: "kite-testnet",
          maxAmountRequired: DEFAULT_PRICE,
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