// ── Utils ──────────────────────────────────────────────────────────

import { zeroAddress } from "viem";
import { TOKENS } from "../config.js";

// Parses a token's address/symbol to an object
// This is based on the TOKENS config
// @param t - token address or symbol
// @param defaults - optional default values to fill in if not found in TOKENS
export const parseToken = (t: string, defaults = true) => {
  const tkn = TOKENS.find(
    ({ address, symbol }) =>
      address.toLowerCase() == t.toLowerCase() ||
      symbol.toLowerCase() == t.toLowerCase(),
  );

  return (
    tkn ||
    (defaults ? { address: zeroAddress, symbol: "KITE", decimals: 18 } : null)
  );
};
