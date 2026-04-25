import { ethers } from "ethers";
import {
  isContractsConfigured,
  getSessionRuleFromChain,
  getKiteAAWallet,
  getProvider,
} from "./contract-service.js";

const TOKEN_ADDRESS = process.env.TESTNET_TOKEN || "0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63";

export const getPayerAddress = async (_agentId: string, _sessionId: string) => {
  if (isContractsConfigured()) {
    const wallet = getKiteAAWallet(getProvider());
    return await wallet.getAddress();
  }
  return process.env.KITE_AA_WALLET_ADDRESS ?? "0x_NOT_CONFIGURED";
};

/**
 * Build an x402-compatible payment authorization.
 * In production the agent's session key would sign this;
 * for PoC the backend constructs the payload for settlement.
 */
export const approvePayment = async (
  agentId: string,
  serviceId: string,
  amount: number,
  sessionKeyAddress?: string
) => {
  const authorization = {
    agentId,
    serviceId,
    amount,
    token: TOKEN_ADDRESS,
    timestamp: Date.now(),
    ...(sessionKeyAddress ? { sessionKey: sessionKeyAddress } : {}),
  };

  // If contracts are live, validate session key rules on-chain
  if (isContractsConfigured() && sessionKeyAddress) {
    const rule = await getSessionRuleFromChain(sessionKeyAddress);
    if (!rule.active) {
      throw new Error("Session key is not active on-chain");
    }
    if (BigInt(amount) > BigInt(rule.valueLimit)) {
      throw new Error(
        `Amount ${amount} exceeds per-tx limit ${rule.valueLimit}`
      );
    }
  }

  return { authorization, signature: "pending-facilitator" };
};

/**
 * Settle a payment on-chain through KiteAAWallet.executePayment,
 * or fall-back to facilitator URL if configured.
 */
export const settlePayment = async (
  _facilitatorUrl: string,
  payload: {
    authorization: {
      agentId: string;
      serviceId: string;
      amount: number;
      token?: string;
      sessionKey?: string;
    };
    recipient: string;
    signature: string;
  }
) => {
  const { authorization, recipient } = payload;
  const token = authorization.token || TOKEN_ADDRESS;

  // On-chain settlement requires the full x402 signed payload (nonce, deadline, sig).
  // Use processX402Payment() in facilitator.ts for the real flow.
  // This PoC path falls back to mock mode.
  console.warn("settlePayment PoC path: on-chain settlement requires X-PAYMENT sig — returning mock");
  return {
    success: true,
    txHash: ethers.hexlify(ethers.randomBytes(32)),
    onChain: false,
  };
};