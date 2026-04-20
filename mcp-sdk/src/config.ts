import { zeroAddress } from "viem";
import type { KiteConfig } from "./types.js";

// Contract addresses sourced from frontend/utils/contracts/index.ts (source of truth)
export const KITE_TESTNET: KiteConfig = {
  rpcUrl: "https://rpc-testnet.gokite.ai",
  chainId: 2368,
  contracts: {
    agentRegistry: "0xf4589146A5B6Acacac1CBCB19B46A0FDF05B8AF4",
    kiteAAWallet: "0x2Cea0acbab5D5788d241D7279b2ebE0C5d49512D",
    anchorMerkle: "0x6680F8Af6E3919C4F892ACB02b7f8171DADd4CE4",
    paymentChannel: "0x8CeC8318aff55A5473a737bC9e0a3475D54Bbfa5",
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
