/**
 * Kite Agent Pay — Secure variable store
 *
 * Stores secrets (seed phrases, private keys, API keys) in
 * ~/.kite-agent-pay/vars.json — never committed to version control.
 *
 * Modeled after Hardhat's `npx hardhat vars set/get/list/delete`.
 *
 * Resolution order for "$VAR_NAME" references:
 *   1. Vars store (~/.kite-agent-pay/vars.json)
 *   2. Environment variables (process.env)
 *   3. Error with actionable message
 */
/** Get a stored variable value, or undefined if not set. */
export declare function getVar(key: string): string | undefined;
/** Set (or overwrite) a variable in the store. */
export declare function setVar(key: string, value: string): void;
/** Delete a variable. Returns true if it existed. */
export declare function deleteVar(key: string): boolean;
/** List all stored variable names (not values). */
export declare function listVars(): string[];
/** Check if a variable exists in the store. */
export declare function hasVar(key: string): boolean;
/** Absolute path to the vars file. */
export declare function getVarsPath(): string;
/** Absolute path to the kite config directory. */
export declare function getKiteDir(): string;
/**
 * Resolve a value that may reference a stored variable.
 *
 * - Plain values (no `$` prefix) are returned as-is.
 * - `"$VAR_NAME"` is resolved from the vars store first,
 *   then falls back to `process.env.VAR_NAME`.
 * - Throws with an actionable message if neither source has the value.
 */
export declare function resolveVar(value: string): string;
