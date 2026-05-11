import { zeroAddress } from "viem";
import type { KiteConfig } from "./types.js";

// Contract addresses sourced from frontend/utils/contracts/index.ts (source of truth)
export const KITE_TESTNET: KiteConfig = {
  rpcUrl: "https://rpc-testnet.gokite.ai",
  chainId: 2368,
  networkName: "kite_testnet",
  bundlerUrl: "https://bundler-service.staging.gokite.ai/rpc/",
  contracts: {
    attestationRegistry: "0x5a9BE0D79F5ed3906f6Dcc0E5679D318AC85e61f",
    identityRegistry: "0x986A171fd6CE1Dc89d104E2b2a424Df9d4ef7524",
    paymentChannel: "0xa00dDA4C326e045aF948cc1dD45A464c09db3Af8",
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
