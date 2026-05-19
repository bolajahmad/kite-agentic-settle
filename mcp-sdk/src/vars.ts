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

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const KITE_DIR = join(homedir(), ".kite-agent-pay");
const VARS_FILE = join(KITE_DIR, "vars.json");
// Dedicated config file for EOA credential (set by `kite init`).
// Kept separate from vars.json so the credential is never co-mingled with
// agent session keys and can be cleared independently.
const CONFIG_FILE = join(KITE_DIR, "config.json");

// ── Internal helpers ───────────────────────────────────────────────

function ensureDir(): void {
  if (!existsSync(KITE_DIR)) {
    mkdirSync(KITE_DIR, { recursive: true, mode: 0o700 });
  }
}

function load(): Record<string, string> {
  if (!existsSync(VARS_FILE)) return {};
  return JSON.parse(readFileSync(VARS_FILE, "utf-8"));
}

function save(vars: Record<string, string>): void {
  ensureDir();
  writeFileSync(VARS_FILE, JSON.stringify(vars, null, 2) + "\n", {
    mode: 0o600,
  });
}

// ── Public API ─────────────────────────────────────────────────────

/** Get a stored variable value, or undefined if not set. */
export function getVar(key: string): string | undefined {
  return load()[key];
}

/** Set (or overwrite) a variable in the store. */
export function setVar(key: string, value: string): void {
  const vars = load();
  vars[key] = value;
  save(vars);
}

/** Delete a variable. Returns true if it existed. */
export function deleteVar(key: string): boolean {
  const vars = load();
  if (!(key in vars)) return false;
  delete vars[key];
  save(vars);
  return true;
}

/** List all stored variable names (not values). */
export function listVars(): string[] {
  return Object.keys(load());
}

/** Check if a variable exists in the store. */
export function hasVar(key: string): boolean {
  return key in load();
}

/** Absolute path to the vars file. */
export function getVarsPath(): string {
  return VARS_FILE;
}

/** Absolute path to the kite config directory. */
export function getKiteDir(): string {
  return KITE_DIR;
}

/** Delete all stored variables. Returns the number of keys deleted. */
export function clearAllVars(): number {
  const vars = load();
  const count = Object.keys(vars).length;
  save({});
  return count;
}

/**
 * Delete all variables whose keys match a predicate.
 * Returns the list of deleted keys.
 */
export function clearVarsWhere(predicate: (key: string) => boolean): string[] {
  const vars = load();
  const deleted: string[] = [];
  for (const key of Object.keys(vars)) {
    if (predicate(key)) {
      deleted.push(key);
      delete vars[key];
    }
  }
  save(vars);
  return deleted;
}

/**
 * Resolve a value that may reference a stored variable.
 *
 * - Plain values (no `$` prefix) are returned as-is.
 * - `"$VAR_NAME"` is resolved from the vars store first,
 *   then falls back to `process.env.VAR_NAME`.
 * - Throws with an actionable message if neither source has the value.
 */
export function resolveVar(value: string): string {
  if (!value.startsWith("$")) return value;

  const key = value.slice(1);

  // 1. Vars store
  const stored = getVar(key);
  if (stored) return stored;

  // 2. Environment variable
  const envVal = process.env[key];
  if (envVal) return envVal;

  // 3. Actionable error
  throw new Error(
    `Variable "${key}" is not set.\n` +
      `  Run onboarding:  npx kite init  /  npx kite onboard\n` +
      `  Or set env var:  export ${key}="..."`
  );
}

// ── EOA credential helpers (kite init) ────────────────────────────
// The EOA private key / seed phrase stored by `kite init` is kept in a
// separate file so it is never co-mingled with session/agent vars.

function loadConfig(): Record<string, string> {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveConfig(cfg: Record<string, string>): void {
  ensureDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + "\n", {
    mode: 0o600,
  });
  chmodSync(CONFIG_FILE, 0o600);
}

/** Get the EOA credential stored by `kite init`. Falls back to PRIVATE_KEY env var. */
/** Get the EOA credential stored by `kite init`. Falls back to PRIVATE_KEY env var.
 *  Migration fallback: also reads from legacy vars.json if config.json is empty. */
export function getCredential(): string | undefined {
  // Primary: dedicated config.json
  const fromConfig = loadConfig()["PRIVATE_KEY"];
  if (fromConfig) return fromConfig;

  // Env var
  if (process.env.PRIVATE_KEY) return process.env.PRIVATE_KEY;

  // Migration fallback: old location in vars.json
  const fromVars = load()["PRIVATE_KEY"];
  if (fromVars) return fromVars;

  return undefined;
}

/** Store the EOA credential in the dedicated config file. */
export function setCredential(value: string): void {
  const cfg = loadConfig();
  cfg["PRIVATE_KEY"] = value;
  saveConfig(cfg);
}

/** Check whether an EOA credential is available (file or env). */
export function hasCredential(): boolean {
  return !!(loadConfig()["PRIVATE_KEY"] ?? process.env.PRIVATE_KEY);
}

/** Delete the stored EOA credential. Returns true if it existed. */
export function clearCredential(): boolean {
  const cfg = loadConfig();
  if (!("PRIVATE_KEY" in cfg)) return false;
  delete cfg["PRIVATE_KEY"];
  saveConfig(cfg);
  return true;
}

/** Absolute path to the dedicated credential config file. */
export function getConfigPath(): string {
  return CONFIG_FILE;
}
