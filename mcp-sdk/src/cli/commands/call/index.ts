import { formatUnits, parseUnits } from "viem";
import {
  DecisionMode,
  SessionRules,
  decide as decideCall,
} from "../../../decide.js";
import { getSessionsByAgent } from "../../../indexer.js";
import { KiteSettleClient } from "../../../kite-settle-client.js";
import { PaymentRequest, PaymentResult } from "../../../types.js";
import { prompt, resolveTokenMetadata } from "../../../utils/index.js";
import { deriveSessionId } from "../../../utils/session-id.js";
import { getVar } from "../../../vars.js";
import { findFlag } from "../../index.js";
import { runBatchApiCallsFlow, runStreamCallsFlow } from "./channel-flow.js";
import { formatReceipt, promptForPayment } from "./shared.js";

function isHardRuleReject(reason: string): boolean {
  return /(exceeds per-call limit|would exceed session budget|is blocked)/i.test(
    reason,
  );
}

export async function callApi(args: string[]) {
  let decide = findFlag(args, "--decide") as DecisionMode | undefined;
  const tokenFlag = findFlag(args, "--token");
  const agentIdStr = findFlag(args, "--agent");
  const sessionKeyFlag =
    findFlag(args, "--session") ??
    findFlag(args, "--session-key") ??
    findFlag(args, "--key");

  const maxCalls = Number.parseInt(findFlag(args, "--max-calls") || "100", 10);
  const durationSecs = Number.parseInt(
    findFlag(args, "--duration") || "60",
    10,
  );
  const ratePerCallFlag = findFlag(args, "--rate-per-call");
  const depositFlag = findFlag(args, "--deposit");
  const channelIdFlag = findFlag(args, "--channel") as
    | `0x${string}`
    | undefined;
  const url = findFlag(args, "--url") || (await prompt("Enter API URL: "));
  const rawMode = findFlag(args, "--mode")?.trim() || "perCall";
  const mode = (rawMode === "x402" ? "perCall" : rawMode) as
    | "perCall"
    | "batch"
    | "stream"
    | "auto";

  const token = await resolveTokenMetadata(
    tokenFlag ||
      process.env.SETTLEMENT_TOKEN_ADDRESS ||
      process.env.TESTNET_TOKEN ||
      "0xd4A87dA836399f9ea548b5f8f8fF8fB80B8eD78F",
  );
  const tokenDecimals = token?.decimals ?? 18;

  const paymentMode =
    mode === "perCall" ? "perCall" : mode === "stream" ? "channel" : mode;

  const ratePerCallOverride = ratePerCallFlag
    ? parseUnits(ratePerCallFlag, tokenDecimals)
    : undefined;
  const depositOverride = depositFlag
    ? parseUnits(depositFlag, tokenDecimals)
    : undefined;

  const indexedSessions = agentIdStr
    ? await getSessionsByAgent(`0x${BigInt(agentIdStr).toString(16)}`).catch(
        () => [],
      )
    : [];

  const normalizeSession = (raw: string) =>
    raw.startsWith("0x") ? raw.toLowerCase() : `0x${raw.toLowerCase()}`;

  const explicitSessionKey = sessionKeyFlag
    ? normalizeSession(sessionKeyFlag)
    : undefined;
  const requiresSessionBoundChannel = mode === "batch" || mode === "stream";

  if (requiresSessionBoundChannel) {
    if (!agentIdStr) {
      throw new Error(
        "Channel mode requires --agent <id> so the channel is opened against an agent/session context.",
      );
    }
    if (!explicitSessionKey) {
      throw new Error(
        "Channel mode requires --session <sessionKey> (or --session-key/--key).",
      );
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const autoCandidates = indexedSessions
    .filter(
      (session) =>
        session.status.toUpperCase() === "ACTIVE" &&
        Number(session.validUntil) > now,
    )
    .map((session) => session.sessionKey.toLowerCase());

  const localCandidates = agentIdStr
    ? Array.from({ length: 64 })
        .map((_, i) => getVar(`SESSION_${agentIdStr}_${i}_ADDRESS`))
        .filter((v): v is string => Boolean(v))
        .map((v) => normalizeSession(v))
    : [];

  const mergedCandidates = Array.from(
    new Set([...autoCandidates, ...localCandidates]),
  );

  const sessionsToTry = requiresSessionBoundChannel
    ? [explicitSessionKey]
    : explicitSessionKey
      ? [explicitSessionKey]
      : mergedCandidates.length > 0
        ? mergedCandidates
        : [undefined];

  const runWithSettle = async (settle: KiteSettleClient): Promise<void> => {
    const sessionKeyAddress = settle.sessionKeyAddress;
    const client = settle.getPaymentClient();

    console.log(`  EOA:      ${settle.eoaAddress}`);
    if (agentIdStr) console.log(`  Agent ID: ${agentIdStr}`);
    if (sessionKeyAddress) console.log(`  Session:  ${sessionKeyAddress}`);
    console.log(`  Target:   ${url}`);
    console.log(`  Mode:     ${mode}`);
    console.log(`  Decide:   ${decide ?? "auto"}`);
    if (ratePerCallFlag)
      console.log(`  Rate/call override: ${ratePerCallFlag} ${token?.symbol}`);
    if (depositFlag)
      console.log(`  Deposit override:   ${depositFlag} ${token?.symbol}`);
    console.log("");

    const selectedSession = sessionKeyAddress
      ? indexedSessions.find(
          (session) =>
            session.sessionKey.toLowerCase() ===
            sessionKeyAddress.toLowerCase(),
        )
      : indexedSessions[0];

    let sessionRemainingSeconds: number | undefined;
    let sessionRemainingCapacity: bigint | undefined;

    if (requiresSessionBoundChannel) {
      if (!sessionKeyAddress) {
        throw new Error(
          "No session key is attached to this client. Use --agent and --session.",
        );
      }
      if (!selectedSession) {
        throw new Error(
          "Session not found in indexer. Cannot determine session budget.",
        );
      }

      const contract = settle.getPaymentClient().getContractService();

      // Compute sessionId from session data
      const agentIdBigint = BigInt(selectedSession.agent.agentId);
      const validUntilBigint = BigInt(selectedSession.validUntil);
      const sessionId = deriveSessionId(
        sessionKeyAddress as `0x${string}`,
        agentIdBigint,
        validUntilBigint,
      );

      // Resolve the ClientVault wallet contract for this session
      const walletContract =
        await contract.resolveWalletContractForSession(sessionKeyAddress);
      if (!walletContract) {
        throw new Error(
          `Unable to resolve ClientVault wallet contract for session ${sessionKeyAddress}`,
        );
      }

      // Fetch spending rules from ClientVault
      const spendingRules = await contract.getVaultSpendingRules(
        walletContract,
        sessionId,
      );
      if (!spendingRules || spendingRules.length === 0) {
        throw new Error(
          `No spending rules found for session ${sessionKeyAddress}`,
        );
      }

      const currentRules = spendingRules[0];
      const budget = currentRules.rule.budget;
      const spent = currentRules.usage.amountUsed;

      sessionRemainingCapacity = budget > spent ? budget - spent : 0n;

      const nowSec = Math.floor(Date.now() / 1000);
      sessionRemainingSeconds = Math.max(0, Number(validUntilBigint) - nowSec);
    }

    const defaultRule: SessionRules = selectedSession
      ? {
          maxPerCall: formatUnits(
            BigInt(selectedSession.valueLimit),
            token?.decimals ?? 18,
          ).toString(),
          maxPerSession: formatUnits(
            BigInt(selectedSession.maxLimit ?? selectedSession.valueLimit),
            token?.decimals ?? 18,
          ).toString(),
          blockedAgents: selectedSession.blockedAgents ?? [],
          requireApprovalAbove: formatUnits(
            BigInt(selectedSession.maxLimit ?? selectedSession.valueLimit),
            token?.decimals ?? 18,
          ).toString(),
        }
      : {
          maxPerCall: "10",
          maxPerSession: "100",
          blockedAgents: [],
          requireApprovalAbove: "50",
        };

    let lastPaymentResult: PaymentResult | undefined;
    const onPayment = (result: PaymentResult) => {
      lastPaymentResult = result;
    };

    if (mode === "batch") {
      await runBatchApiCallsFlow(
        {
          client,
          url,
          token,
          decide,
          defaultRules: defaultRule,
          onPayment,
          maxCalls,
          durationSecs,
          ratePerCallOverride,
          depositOverride,
          agentIndex: agentIdStr ? Number.parseInt(agentIdStr, 10) : undefined,
          eoaAddress: settle.eoaAddress,
          sessionKeyAddress: sessionKeyAddress as `0x${string}` | undefined,
          sessionRemainingSeconds,
          sessionRemainingCapacity,
        },
        channelIdFlag,
      );
      return;
    }

    if (mode === "stream") {
      await runStreamCallsFlow({
        client,
        url,
        token,
        decide,
        defaultRules: defaultRule,
        onPayment,
        maxCalls,
        durationSecs,
        ratePerCallOverride,
        depositOverride,
        agentIndex: agentIdStr ? Number.parseInt(agentIdStr, 10) : undefined,
        eoaAddress: settle.eoaAddress,
        sessionKeyAddress: sessionKeyAddress as `0x${string}` | undefined,
        sessionRemainingSeconds,
        sessionRemainingCapacity,
      });
      return;
    }

    console.log("  Per-call mode: making a single call with each request.");
    const fetchOpts: any = {
      paymentMode: "perCall" as const,
      onPayment,
      sessionKey: sessionKeyAddress,
    };

    if (decide === "cli") {
      fetchOpts.onPaymentRequired = promptForPayment;
    } else {
      fetchOpts.onPaymentRequired = async (
        req: PaymentRequest,
      ): Promise<boolean> => {
        const ctx = {
          request: req,
          rules: defaultRule,
          balance: Number.MAX_SAFE_INTEGER,
          totalSpentThisSession: Number(client.getTotalSpent()),
          callCount: client.getUsageLogs().length,
          openaiApiKey: process.env.OPENAI_API_KEY,
        };

        const result = await decideCall(ctx, decide);
        console.log(
          `  Decision: ${result.decision} [${result.tier}] — ${result.reason}`,
        );

        if (result.decision === "approve") {
          return true;
        }

        if (result.tier === "llm") {
          return false;
        }

        if (isHardRuleReject(result.reason)) {
          return false;
        }

        // Permissive fallback: if no explicit deny condition matched, allow.
        return true;
      };
    }

    console.log(`  Calling ${url}...`);
    console.log("");

    const t0 = Date.now();
    const response = await client.fetch(url, undefined, fetchOpts);
    const elapsed = Date.now() - t0;

    if (response.status === 402) {
      const errBody: any = await response.json().catch(() => null);
      console.log(`  Status: ${response.status} Payment Required`);
      console.log("  The agent was not charged.");
      const reason = errBody?.error || "payment was declined";
      console.log(`  Reason: ${reason}`);
      throw new Error(String(reason));
    }

    const body = await response.json();
    console.log(`  Status:  ${response.status} OK`);
    console.log(`  Data:    ${JSON.stringify(body, null, 2)}`);
    console.log(`  Time:    ${elapsed}ms`);

    if (lastPaymentResult) {
      console.log(formatReceipt(lastPaymentResult, url, body));
    }
  };

  let lastErr: unknown;
  for (const sessionKeyToTry of sessionsToTry) {
    try {
      const settle = agentIdStr
        ? await KiteSettleClient.create({
            agentId: BigInt(agentIdStr),
            sessionKey: sessionKeyToTry,
            defaultPaymentMode: paymentMode,
          })
        : await (async () => {
            const credential = getVar("PRIVATE_KEY");
            if (!credential) {
              throw new Error(
                "No credential found. Run: npx kite init\n" +
                  "  Or specify an agent: npx kite call --agent <agentId> --url <url>",
              );
            }
            return KiteSettleClient.create({
              credential,
              defaultPaymentMode: paymentMode,
            });
          })();

      await runWithSettle(settle);
      return;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);

      if (!agentIdStr || explicitSessionKey) throw err;

      if (
        msg.toLowerCase().includes("session key not active") ||
        msg.toLowerCase().includes("session private key not found") ||
        msg.toLowerCase().includes("unavailable for payments") ||
        msg.toLowerCase().includes(" is expired")
      ) {
        continue;
      }
      throw err;
    }
  }

  if (lastErr instanceof Error) throw lastErr;
  throw new Error("No usable session found for this call.");
}
