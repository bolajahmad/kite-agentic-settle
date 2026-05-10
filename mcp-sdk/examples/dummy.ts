import { defineChain, parseAbi, type Address } from "viem";

const kiteTestnet = defineChain({
  id: 2368,
  name: "KiteAI Testnet",
  nativeCurrency: { name: "KITE", symbol: "KITE", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc-testnet.gokite.ai"] } },
  blockExplorers: {
    default: { name: "KiteScan", url: "https://testnet.kitescan.ai" },
  },
});

const EOA_ADDRESS = "0x9281e0888a4B6e7360F739BE740c0e696c3Ced2c" as Address;
const AA_WALLET = "0x4d90DcC7e740E22E2613677e0106bfC50cd101F9" as Address;
const BUNDLER_URL = "https://bundler-service.staging.gokite.ai/rpc/";
const RPC_URL = "https://rpc-testnet.gokite.ai";
const REVERT_SEL = "0xf4d678b8";

const entryPointAbi = parseAbi([
  "function depositTo(address) payable",
  "function getNonce(address sender, uint192 key) view returns (uint256)",
  "function getDepositInfo(address) view returns (uint112 deposit, bool staked, uint112 stake, uint32 unstakeDelaySec, uint48 withdrawTime)",
]);

const sep = (t: string) =>
  console.log(`\n${"─".repeat(56)}\n  ${t}\n${"─".repeat(56)}`);
const ok = (m: string) => console.log(`  ✅  ${m}`);
const warn = (m: string) => console.log(`  ⚠️   ${m}`);
const fail = (m: string) => console.log(`  ❌  ${m}`);
const info = (m: string) => console.log(`  ℹ️   ${m}`);
const fix = (m: string) => console.log(`  🔧  ${m}`);

async function bundlerCall(method: string, params: unknown[]) {
  const res = await fetch(BUNDLER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  const json = await res.json();
  if (json.error)
    throw new Error(`Bundler error: ${JSON.stringify(json.error)}`);
  return json.result;
}

async function main() {
  const bundlerUrl = "https://bundler-service.staging.gokite.ai/rpc/";
  const userOpHash =
    "0x8c30ef0ae8b1a68297d959e14e9daeb72817c6d16e3a1c5d1ab82d1fa54f9c30";

  const res = await fetch(bundlerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_getUserOperationReceipt",
      params: [userOpHash],
      id: 1,
    }),
  });
  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));

  sep("Done — work through steps in priority order: 4 → 2 → 5");
}

main().catch(console.error);
