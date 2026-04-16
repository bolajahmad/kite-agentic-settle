import { zeroAddress } from "viem";
import type { KiteConfig } from "./types.js";

// Contract addresses sourced from frontend/utils/contracts/index.ts (source of truth)
export const KITE_TESTNET: KiteConfig = {
  rpcUrl: "https://rpc-testnet.gokite.ai",
  chainId: 2368,
  contracts: {
    agentRegistry: "0x2A904dF5979Fbc3B65F0F298C0a3B4e06FF0881d",
    kiteAAWallet: "0xDbe183022eCCA66cc074e66f571Eee5FFa728BeD",
    anchorMerkle: "0x9df3c50EFfE57A15347e5667a994b0fA1e155b37",
    paymentChannel: "0x210a99B86D0a95C77Dcf995dAC3821af718399C6",
  },
  token: "0xd4a87d5531A586C247BD13F3Bb0Dd68C6253B489",
};

export const TOKENS = [
  {
    symbol: "DmUSDT",
    name: "Kite Demo USDT",
    address: "0xd4a87d5531A586C247BD13F3Bb0Dd68C6253B489",
    decimals: 18,
  },
  {
    symbol: "X.USDT",
    name: "Kite x402 USD",
    address: "0x1b7425d288ea676FCBc65c29711fccF0B6D5c293",
    decimals: 18,
  },
  {
    symbol: "USDC.e",
    name: "USDC Bridge",
    address: "0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e",
    decimals: 6,
  },
  {
    symbol: "USDT",
    name: "USDT Bridged",
    address: "0x3Fdd283C4c43A60398bf93CA01a8a8BD773a755b",
    decimals: 6,
  },
  {
    symbol: "KITE",
    name: "Kite Token",
    address: zeroAddress,
    decimals: 18,
  },
];
