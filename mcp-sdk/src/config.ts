import { zeroAddress } from "viem";
import type { KiteConfig } from "./types.js";

// Contract addresses sourced from frontend/utils/contracts/index.ts (source of truth)
export const KITE_TESTNET: KiteConfig = {
  rpcUrl: "https://rpc-testnet.gokite.ai",
  chainId: 2368,
  networkName: "kite_testnet",
  bundlerUrl: "https://bundler-service.staging.gokite.ai/rpc/",
  contracts: {
    attestationRegistry: "0x2F72b719679FD0b92712D03a1E16909F18d55660",
    identityRegistry: "0xE4C30627C02791bF12241021f2fC320b43991cb1",
    paymentChannel: "0x8EC6B059178485a37FF3f3AE6351994A6597d4Fb",
  },
  // token: "0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63",
  token: "0xd4a87d5531A586C247BD13F3Bb0Dd68C6253B489",
};

export const TOKENS = [
  {
    symbol: "USDT",
    name: "USDT (Testnet)",
    address: "0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63",
    decimals: 18,
  },
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
    symbol: "KITE",
    name: "Kite Token",
    address: zeroAddress,
    decimals: 18,
  },
];
