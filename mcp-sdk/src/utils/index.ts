// ── Utils ──────────────────────────────────────────────────────────
import readline from "node:readline";
import { zeroAddress } from "viem";
import { KITE_TESTNET, TOKENS } from "../config.js";

export interface TokenMetadata {
  address: string;
  symbol: string;
  decimals: number;
}

// Module-level cache keyed by lowercase address.
export const _tokenMetadataCache = new Map<string, TokenMetadata>();

/**
 * Resolve full token metadata (address, symbol, decimals) from either a
 * token address or a symbol string.
 *
 * Resolution order:
 *  1. Static TOKENS config list (by address or symbol match) — synchronous.
 *  2. In-process cache (for previously resolved on-chain tokens).
 *  3. On-chain ERC-20 `symbol()` + `decimals()` calls (address input only).
 *
 * @param tokenAddressOrSymbol - Token contract address (0x…) or known symbol.
 * @param defaults - When true and nothing is found, returns a best-effort
 *   fallback with decimals=18 and a truncated address as symbol instead of null.
 */
export async function resolveTokenMetadata(
  tokenAddressOrSymbol: string,
  defaults = true,
): Promise<TokenMetadata | null> {
  const input = tokenAddressOrSymbol.toLowerCase();

  // Native KITE token — zero address or "kite" symbol, no on-chain lookup needed
  if (input === zeroAddress || input === "kite") {
    const meta: TokenMetadata = {
      address: zeroAddress,
      symbol: "KITE",
      decimals: 18,
    };
    _tokenMetadataCache.set(zeroAddress, meta);
    return meta;
  }

  // 1. Check static TOKENS list by address or symbol
  const known = TOKENS.find(
    (t) =>
      t.address.toLowerCase() === input || t.symbol.toLowerCase() === input,
  );
  if (known) {
    const meta: TokenMetadata = {
      address: known.address,
      symbol: known.symbol,
      decimals: known.decimals,
    };
    _tokenMetadataCache.set(known.address.toLowerCase(), meta);
    return meta;
  }

  // 2. In-process cache (for previously resolved on-chain tokens)
  if (_tokenMetadataCache.has(input)) return _tokenMetadataCache.get(input)!;

  // 3. On-chain fallback — only possible when input is a full hex address
  if (input.startsWith("0x") && input.length === 42) {
    try {
      const { createPublicClient, http } = await import("viem");
      const minAbi = [
        {
          name: "symbol",
          type: "function",
          stateMutability: "view",
          inputs: [],
          outputs: [{ type: "string" }],
        },
        {
          name: "decimals",
          type: "function",
          stateMutability: "view",
          inputs: [],
          outputs: [{ type: "uint8" }],
        },
      ] as const;
      const publicClient = createPublicClient({
        transport: http(KITE_TESTNET.rpcUrl),
      });
      const [symbol, decimals] = await Promise.all([
        publicClient.readContract({
          address: tokenAddressOrSymbol as `0x${string}`,
          abi: minAbi,
          functionName: "symbol",
        }),
        publicClient.readContract({
          address: tokenAddressOrSymbol as `0x${string}`,
          abi: minAbi,
          functionName: "decimals",
        }),
      ]);
      const meta: TokenMetadata = {
        address: tokenAddressOrSymbol,
        symbol: symbol,
        decimals: Number(decimals),
      };
      _tokenMetadataCache.set(input, meta);
      return meta;
    } catch {
      // fall through to defaults
    }
  }

  if (!defaults) return null;

  // Fallback: keep address, guess 18 decimals, shorten address as symbol
  const fallback: TokenMetadata = {
    address: tokenAddressOrSymbol,
    symbol: `${tokenAddressOrSymbol.slice(0, 6)}…`,
    decimals: 18,
  };
  _tokenMetadataCache.set(input, fallback);
  return fallback;
}

export async function prompt(
  question: string,
  hidden = false,
): Promise<string> {
  return new Promise((res) => {
    if (hidden && process.stdin.isTTY) {
      const stdin = process.stdin;

      process.stdout.write(question);

      const wasRaw = stdin.isRaw;

      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding("utf-8");

      let value = "";

      const onData = (chunk: string) => {
        const str = chunk.toString();

        // ENTER / RETURN
        if (str === "\n" || str === "\r" || str === "\u0004") {
          stdin.setRawMode(wasRaw ?? false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          return res(value);
        }

        // CTRL + C
        if (str === "\u0003") {
          process.exit(1);
        }

        // BACKSPACE (can come as multiple chars too)
        if (str === "\u007F" || str === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          return;
        }

        // Handle pasted input
        const clean = str.replace(/[\r\n]/g, "");

        if (!clean) return;

        // Append full chunk
        value += clean;

        process.stdout.write("\b".repeat(clean.length));

        // Replace with masked output
        process.stdout.write("*".repeat(clean.length));
      };

      stdin.on("data", onData);
    } else {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.question(question, (answer) => {
        rl.close();
        res(answer.trim());
      });
    }
  });
}
