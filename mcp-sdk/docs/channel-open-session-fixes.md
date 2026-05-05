# Channel Open Session-First Fix Plan

Date: 2026-05-05

## Problem Summary

The current CLI has two mismatches with the intended architecture:

1. Channel opening can still fall back to EOA-only flows in places where agent/session context should be mandatory.
2. Channels opened via `kite call --mode batch|stream` are not persisted in the local channel store, so later commands that depend on local channel memory (for example `kite channel call --channel <id>`) fail with `Channel ... not found in local store`.

## Required Behavior

1. Channel open operations must be session-driven.
2. For channel-opening paths, callers must provide an explicit `--agent` and `--session` pair.
3. EOA credential must not be required for channel open.
4. Channel duration must be capped by remaining session validity.
5. Channel deposit must be capped by remaining session spend capacity.
6. Every opened channel must be persisted to local per-channel storage immediately.

## Fixes To Implement

## 1) Enforce agent/session pair for channel-open paths in `call.ts`

File: `src/cli/commands/call.ts`

- Introduce a `requiresSessionBoundChannel` gate for `--mode batch` and `--mode stream`.
- If true, require both:
  - `--agent <id>`
  - `--session <sessionKey>` (or alias flags currently accepted)
- Remove EOA fallback for these channel-open paths. The client must be created in agent mode (`KiteSettleClient.create({ agentId, sessionKey, ... })`).

Rationale:

- Prevents opening channels without explicit session context.
- Matches requirement that even EOA invocations must specify the agent/session pair.

## 2) Compute and enforce session-derived constraints before open

File: `src/cli/commands/call.ts`

- Resolve selected session metadata (`validUntil`, `valueLimit`) from indexer by exact `sessionKey`.
- Read on-chain session spent via `settle.getPaymentClient().getContractService().getSessionSpent(sessionKey)`.
- Compute:
  - `remainingSeconds = max(0, validUntil - now)`
  - `remainingCapacity = max(0, valueLimit - spent)`
- Clamp channel opening params:
  - `effectiveMaxDuration = min(requestedMaxDuration, remainingSeconds)`
  - `effectiveDeposit = min(requestedDeposit, remainingCapacity)`
- Fail early with a clear message if either remaining window or remaining capacity is zero.

Rationale:

- Aligns channel bounds with session constraints.
- Avoids opening attempts that will revert due to exhausted session or expired validity.

## 3) Persist channels opened by `kite call` flows

File: `src/cli/commands/call.ts`

- Add local store integration (`createChannelRecord`) in both open paths:
  - `runBatchApiCallsFlow` when opening a new channel.
  - `runStreamCallsFlow` when opening a new channel.
- Persist immediately after open tx returns:
  - `channelId`, `provider`, `token`, `openUrl`, `agentAddress`, `agentIndex`, `maxPerCall`, `deposit`, `maxSpend`, `durationSecs`, `openedAt`, `openTxHash`, and `providerMaxRatePerCall` if available.

Rationale:

- Makes opened channels discoverable by local-memory-dependent commands.
- Keeps ongoing channel state available locally even if indexer lags.

## 4) Fix agent entity-id encoding bug in session lookup

File: `src/cli/commands/call.ts`

- Correct `getSessionsByAgent` argument from `0x${BigInt(agentIdStr)}` to hex encoding using `.toString(16)`.

Rationale:

- Current decimal interpolation can query wrong subgraph entity ids for agent ids >= 10.

## 5) Align `kite channel open` command with session-first policy

File: `src/cli/commands/channels.ts`

- Replace EOA-only `PRIVATE_KEY` requirement in `cmdChannelOpen`.
- Require `--agent` and `--session` for channel open.
- Build `KiteSettleClient` in agent mode with explicit session key.
- Apply the same session validity/capacity clamping logic before open.
- Persist local channel record with correct `agentIndex` (not hardcoded `0`).

Rationale:

- Keeps behavior consistent across `kite channel open` and `kite call --mode batch|stream`.

## 6) Non-deletion policy while ongoing

Current behavior already deletes local records only when closed/finalized in force-close paths. Maintain this behavior and ensure no active/open channel is deleted implicitly.

## Validation Plan

1. Open channel with explicit session:
   - `npx kite channel open --agent 2 --session <key> --url <endpoint>`
   - Confirm local file appears under `~/.kite-agent-pay/channels/<id>.json`.
2. Open via call flow:
   - `npx kite call --mode batch --agent 2 --session <key> --url <endpoint>`
   - Confirm local channel file created.
3. Verify local-memory retrieval:
   - `npx kite channel call --channel <id> --url <endpoint>` should no longer fail with missing local store.
4. Constraint checks:
   - Use a near-expiry session and confirm max duration is capped.
   - Use low remaining session capacity and confirm deposit is capped or rejected clearly.
5. Agent-id encoding:
   - Test with agent id >= 10 and verify session lookup works.
