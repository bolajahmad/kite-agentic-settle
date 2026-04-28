import { zeroAddress } from "viem";
import type { KiteConfig } from "./types.js";

// Contract addresses sourced from frontend/utils/contracts/index.ts (source of truth)
export const KITE_TESTNET: KiteConfig = {
  rpcUrl: "https://rpc-testnet.gokite.ai",
  chainId: 2368,
  contracts: {
    attestationRegistry: "0x3A8ce8DC1E700Ea16a31b731A575A650149960A9",
    identityRegistry: "0x46A6cbc0Fd15936F4F67aABBc554f4CAf80281F9",
    kiteAAWallet: "0xBfdbA4E11De8B3b82F910Dd3AE8e517Ce60b0bB2",
    paymentChannel: "0x4791Ea0134eA66b40371A6Daf22d43e02bbB39f8",
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
