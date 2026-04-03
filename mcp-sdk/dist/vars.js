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
import { readFileSync, writeFileSync, mkdirSync, existsSync, } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const KITE_DIR = join(homedir(), ".kite-agent-pay");
const VARS_FILE = join(KITE_DIR, "vars.json");
// ── Internal helpers ───────────────────────────────────────────────
function ensureDir() {
    if (!existsSync(KITE_DIR)) {
        mkdirSync(KITE_DIR, { recursive: true, mode: 0o700 });
    }
}
function load() {
    if (!existsSync(VARS_FILE))
        return {};
    return JSON.parse(readFileSync(VARS_FILE, "utf-8"));
}
function save(vars) {
    ensureDir();
    writeFileSync(VARS_FILE, JSON.stringify(vars, null, 2) + "\n", {
        mode: 0o600,
    });
}
// ── Public API ─────────────────────────────────────────────────────
/** Get a stored variable value, or undefined if not set. */
export function getVar(key) {
    return load()[key];
}
/** Set (or overwrite) a variable in the store. */
export function setVar(key, value) {
    const vars = load();
    vars[key] = value;
    save(vars);
}
/** Delete a variable. Returns true if it existed. */
export function deleteVar(key) {
    const vars = load();
    if (!(key in vars))
        return false;
    delete vars[key];
    save(vars);
    return true;
}
/** List all stored variable names (not values). */
export function listVars() {
    return Object.keys(load());
}
/** Check if a variable exists in the store. */
export function hasVar(key) {
    return key in load();
}
/** Absolute path to the vars file. */
export function getVarsPath() {
    return VARS_FILE;
}
/** Absolute path to the kite config directory. */
export function getKiteDir() {
    return KITE_DIR;
}
/**
 * Resolve a value that may reference a stored variable.
 *
 * - Plain values (no `$` prefix) are returned as-is.
 * - `"$VAR_NAME"` is resolved from the vars store first,
 *   then falls back to `process.env.VAR_NAME`.
 * - Throws with an actionable message if neither source has the value.
 */
export function resolveVar(value) {
    if (!value.startsWith("$"))
        return value;
    const key = value.slice(1);
    // 1. Vars store
    const stored = getVar(key);
    if (stored)
        return stored;
    // 2. Environment variable
    const envVal = process.env[key];
    if (envVal)
        return envVal;
    // 3. Actionable error
    throw new Error(`Variable "${key}" is not set.\n` +
        `  Run:  npx kite vars set ${key}\n` +
        `  Or:   export ${key}="..."`);
}
