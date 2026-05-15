/**
 * Operational commands for the Kite CLI.
 *
 * Extracted so `src/cli.ts` can delegate heavy commands here
 * without loading WDK/viem for lightweight commands like `vars`.
 */

import { formatUnits, parseUnits, zeroAddress } from "viem";
import { TOKENS } from "../../config.js";
import { KiteSettleClient } from "../../index.js";
import {
  _tokenMetadataCache,
  resolveTokenMetadata,
} from "../../utils/index.js";
import { getCredential } from "../../vars.js";
import { findFlag } from "../index.js";
import { callApi } from "./call.js";

// ── Formatting ─────────────────────────────────────────────────────
function fmt(wei: bigint): string {
  return formatUnits(wei, 18);
}

async function showBalance(args: string[]) {
  const agentFlag = findFlag(args, "--agent");
  const addressFlag = findFlag(args, "--address");
  const tokenFlag = findFlag(args, "--token");

  let client: KiteSettleClient;
  let queryAddress: string | undefined;
  let displayLabel: string;

  if (agentFlag !== undefined) {
    // Resolve owner address from subgraph (agent may not be locally registered)
    const { getAgentById } = await import("../../indexer.js");
    const agent = await getAgentById(`0x${BigInt(agentFlag).toString(16)}`);
    if (!agent) throw new Error(`Agent ${agentFlag} not found on-chain.`);
    queryAddress = agent.owner.id || agent.owner.address;
    displayLabel = `Agent ${agentFlag} (owner: ${queryAddress})`;
    client = KiteSettleClient.createReadOnly();
  } else if (addressFlag) {
    queryAddress = addressFlag;
    displayLabel = addressFlag;
    client = KiteSettleClient.createReadOnly();
  } else {
    const credential = getCredential();
    if (!credential) {
      throw new Error(
        "No address to check. Pass --address <addr>, --agent <id>, or run: npx kite init",
      );
    }
    client = await KiteSettleClient.create({ credential });
    displayLabel = client.eoaAddress;
  }

  const extraTokens: string[] =
    tokenFlag === undefined
      ? []
      : tokenFlag.includes(",")
        ? tokenFlag.split(",").map((t) => t.trim())
        : [tokenFlag.trim()];

  const result = await client.balance({
    address: queryAddress,
    tokens: extraTokens,
  });

  console.log(`  Address:  ${displayLabel}`);
  console.log(`  AA Wallet: ${result.aaWalletAddress}`);
  console.log("");

  for (const tkn of result.tokens) {
    console.log(`  Token:    ${tkn.symbol}`);
    console.log(
      `  Deposited Balance:  ${tkn.depositedBalanceFormatted} ${tkn.symbol} (deposited)`,
    );
    if (tkn.token.toLowerCase() !== zeroAddress.toLowerCase()) {
      console.log(
        `     Balance:       ${tkn.walletBalanceFormatted} ${tkn.symbol} (wallet)`,
      );
    }
    console.log("");
  }
}

async function getIndexedPayments(
  agent: number,
  session?: string,
  limit = 20,
  offset = 0,
) {
  const {
    getPaymentsByAgentFull,
    getPaymentsBySession,
    getPaymentsByOwnerFull,
  } = await import("../../indexer.js");

  type Payment = Awaited<ReturnType<typeof getPaymentsByAgentFull>>[number];
  let payments: Payment[];
  let label: string;

  if (session) {
    // Session entity ID in the subgraph = sessionKey.toHex() (the session key address)
    const sessionId = session.startsWith("0x")
      ? session.toLowerCase()
      : `0x${session.toLowerCase()}`;
    payments = await getPaymentsBySession(sessionId, limit, offset);
    label = `Session ${sessionId}`;
  } else if (agent) {
    // Agent entity ID = agentId uint256 .toHex() e.g. "0x1" for agentId 1
    const agentEntityId = `0x${BigInt(agent).toString(16)}`;
    payments = await getPaymentsByAgentFull(agentEntityId, limit, offset);
    label = `Agent #${agent}`;
  } else {
    // Fallback: derive EOA address from stored credential
    const credential = getCredential();
    if (!credential) {
      throw new Error(
        "No address to query. Pass --agent <id>, --session <key>, or run: npx kite init",
      );
    }
    const client = await KiteSettleClient.create({ credential });
    payments = await getPaymentsByOwnerFull(
      client.eoaAddress.toLowerCase(),
      limit,
      offset,
    );
    label = `Owner ${client.eoaAddress}`;
    return { label, payments, eoaAddress: client.eoaAddress };
  }

  return { label, payments, eoaAddress: undefined };
}

// ── Local channel filter + display ─────────────────────────────────

interface ChannelFilter {
  /** Session key address (0x…). Looks up the owning agent via subgraph. */
  sessionKey?: string;
  /** Agent NFT tokenId. Matches channels by agentIndex. */
  agentId?: number;
  /** Owner EOA address. Matches channels by agentAddress. */
  eoaAddress?: string;
}

/**
 * Filters the given local channels to only those matching the supplied
 * criteria, then prints them.  If none of the three discriminators are
 * provided every channel is shown (shouldn't happen in practice).
 */
async function showLocalChannels(
  channels: Awaited<
    ReturnType<typeof import("../../channel-store.js").listChannels>
  >,
  filter: ChannelFilter,
): Promise<void> {
  let filtered = channels;

  if (filter.sessionKey) {
    // Resolve the session key → agent index via subgraph, then filter by agentIndex.
    const { getSessionKeyAdded } = await import("../../indexer.js");
    const session = await getSessionKeyAdded(filter.sessionKey);
    if (session?.agentId !== undefined) {
      const agentIdx = Number(BigInt(session.agentId));
      filtered = channels.filter((ch) => ch.agentIndex === agentIdx);
    }
    // If the subgraph lookup fails, fall through and show all channels.
  } else if (filter.agentId !== undefined) {
    filtered = channels.filter((ch) => ch.agentIndex === filter.agentId);
  } else if (filter.eoaAddress) {
    const eoa = filter.eoaAddress.toLowerCase();
    filtered = channels.filter((ch) => ch.agentAddress.toLowerCase() === eoa);
  }

  if (filtered.length === 0) return;

  console.log("");
  console.log(
    "  ── Local Channels (disk-persisted; unsettled spend not yet on-chain) ──",
  );

  for (const ch of filtered) {
    const cumCost = BigInt(ch.cumulativeCost);
    const deposit = BigInt(ch.deposit);
    const chMeta = await resolveTokenMetadata(ch.token);
    const chSym = chMeta?.symbol ?? `${ch.token.slice(0, 6)}…`;
    const chDec = chMeta?.decimals ?? 18;
    const openedDate = new Date(ch.openedAt)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    console.log(`    ${ch.channelId}`);
    console.log(`      Provider:   ${ch.provider}`);
    console.log(`      Token:      ${chSym}`);
    console.log(`      Calls:      ${ch.callCount}`);
    console.log(
      `      Cumulative: ${formatUnits(cumCost, chDec)} ${chSym}  (of ${formatUnits(deposit, chDec)} ${chSym} deposited)`,
    );
    console.log(`      Opened:     ${openedDate}`);
    if (ch.openUrl) console.log(`      URL:        ${ch.openUrl}`);
    console.log("");
  }
}

async function showUsage(args: string[]) {
  const sessionFlag = findFlag(args, "--session");
  const agentFlag = findFlag(args, "--agent");

  // Session takes priority over agent; notify the user if both were passed
  if (sessionFlag && agentFlag) {
    console.log("  Note: --agent ignored; filtering by --session instead.");
  }

  // Pagination flags
  const limitFlag = findFlag(args, "--limit");
  const offsetFlag = findFlag(args, "--offset");
  const limit = limitFlag ? Math.max(1, Number.parseInt(limitFlag, 10)) : 20;
  const offset = offsetFlag ? Math.max(0, Number.parseInt(offsetFlag, 10)) : 0;

  const { payments, label, eoaAddress } = await getIndexedPayments(
    Number(agentFlag),
    sessionFlag,
    limit,
    offset,
  );

  // Local channels persisted to disk — always shown (covers unsettled channel spend)
  const { listChannels } = await import("../../channel-store.js");
  const localChannels = listChannels();

  console.log(`  Usage for: ${label}`);
  const pageInfo =
    payments.length < limit
      ? `${offset + 1}-${offset + payments.length} (all results)`
      : `${offset + 1}-${offset + payments.length}  (pass --offset ${offset + limit} for next page)`;
  if (payments.length > 0) console.log(`  Showing:   ${pageInfo}`);
  console.log("");

  if (payments.length === 0) {
    console.log("  No on-chain payments found in the subgraph.");
  } else {
    // Pre-warm cache for all unique tokens in this page
    const tokenAddresses = [
      ...new Set(payments.map((p) => p.token.toLowerCase())),
    ];
    await Promise.all(tokenAddresses.map((a) => resolveTokenMetadata(a)));

    // Synchronous helpers — safe after the pre-warm above
    function metaFor(tokenAddr: string) {
      return _tokenMetadataCache.get(tokenAddr.toLowerCase());
    }
    function symFor(tokenAddr: string): string {
      return metaFor(tokenAddr)?.symbol ?? `${tokenAddr.slice(0, 6)}…`;
    }
    function decFor(tokenAddr: string): number {
      return metaFor(tokenAddr)?.decimals ?? 18;
    }

    const totalSpent = payments.reduce((sum, p) => sum + BigInt(p.amount), 0n);
    const primaryToken = payments[0].token;
    const allSameToken = payments.every(
      (p) => p.token.toLowerCase() === primaryToken.toLowerCase(),
    );
    const totalLabel = allSameToken
      ? `${formatUnits(totalSpent, decFor(primaryToken))} ${symFor(primaryToken)}`
      : `mixed tokens`;

    // Group by payment type
    const byType = new Map<string, typeof payments>();
    for (const p of payments) {
      const list = byType.get(p.type) ?? [];
      list.push(p);
      byType.set(p.type, list);
    }

    for (const [type, ps] of byType) {
      // Summarise per-type totals, grouping by token in case of mixed
      const typeTotals = new Map<string, bigint>();
      for (const p of ps)
        typeTotals.set(
          p.token,
          (typeTotals.get(p.token) ?? 0n) + BigInt(p.amount),
        );
      const typeSummary = [...typeTotals.entries()]
        .map(([tok, amt]) => `${formatUnits(amt, decFor(tok))} ${symFor(tok)}`)
        .join(" + ");
      console.log(
        `  ── ${type} — ${ps.length} call${ps.length > 1 ? "s" : ""}, ${typeSummary} ──────`,
      );
      for (const p of ps) {
        const date = new Date(Number(p.timestamp) * 1000)
          .toISOString()
          .replace("T", " ")
          .slice(0, 19);
        const agentPart = p.agent?.agentId
          ? `  Agent #${BigInt(p.agent.agentId)}`
          : "";
        const chanPart = p.channel?.channelId
          ? `  Chan ${p.channel.channelId.slice(0, 10)}…`
          : "";
        const tx = p.txHash ? `${p.txHash.slice(0, 12)}…` : "pending";
        console.log(
          `    ${date}  ${formatUnits(BigInt(p.amount), decFor(p.token)).padStart(12)} ${symFor(p.token)}  → ${p.recipient.slice(0, 10)}…  ${tx}${agentPart}${chanPart}`,
        );
      }
      console.log("");
    }

    console.log(
      `  Total on-chain: ${payments.length} payment${payments.length > 1 ? "s" : ""}, ${totalLabel} spent`,
    );
  }

  // ── Local channels (persisted to disk; may include unsettled spend) ──────
  await showLocalChannels(localChannels, {
    sessionKey: sessionFlag,
    agentId: agentFlag ? Number(agentFlag) : undefined,
    eoaAddress,
  });
}

async function fundWallet(args: string[]) {
  const credential = getCredential();
  if (!credential) throw new Error("No credential found. Run: npx kite init");

  const tokenFlag = findFlag(args, "--token");
  const amountFlag = findFlag(args, "--amount");
  if (!amountFlag) {
    throw new Error(
      "Amount is required. Usage: npx kite fund --amount <amount> --token <token>",
    );
  }

  let token = await resolveTokenMetadata(tokenFlag || zeroAddress);

  const amount = parseUnits(amountFlag || "0", token?.decimals ?? 18);
  const client = await KiteSettleClient.create({ credential });
  const contractService = client.getContractService();
  const vaultWallet = await contractService.resolveOwnerVaultWalletAddress();

  console.log(`  From:     ${client.eoaAddress}`);
  console.log(`  To:       ClientVault (${vaultWallet})`);
  console.log(`  Amount:   ${amountFlag.trim()} ${token?.symbol || "KITE"}`);

  if (token?.address !== zeroAddress) {
    const supported = await contractService.isVaultTokenSupported(
      vaultWallet,
      token!.address as `0x${string}`,
    );
    if (!supported) {
      console.log(
        `  Token:    enabling ${token?.symbol || token?.address} on ClientVault`,
      );
    }
  }

  const balance =
    token?.address === zeroAddress
      ? await client.getNativeBalance(client.eoaAddress)
      : await client.getWalletBalance(token?.address);

  if (balance < amount) {
    throw new Error(
      `Owner EOA has insufficient funds (${fmt(balance)} ${token?.symbol ?? "KITE"})`,
    );
  }

  const data = await client.deposit(amount, token?.address);

  console.log(`  Tx:       ${data}`);
}

async function withdrawFunds(args: string[]) {
  const credential = getCredential();
  if (!credential) throw new Error("No credential found. Run: npx kite init");

  const tokenFlag = findFlag(args, "--token");
  const amountFlag = findFlag(args, "--amount");
  if (!amountFlag) {
    throw new Error(
      "Amount is required. Usage: npx kite withdraw --amount <amount> --token <token>",
    );
  }

  let token = await resolveTokenMetadata(tokenFlag || zeroAddress);
  if (!token) {
    token = TOKENS.find(({ address }) => address === zeroAddress) || null;
    console.warn(
      `Token "${tokenFlag}" not found. Defaulting to ${token?.symbol || "KITE"}.`,
    );
  }

  const amount = parseUnits(amountFlag || "0", token?.decimals ?? 18);
  const client = await KiteSettleClient.create({ credential });
  const contractService = client.getContractService();
  const vaultWallet = await contractService.resolveOwnerVaultWalletAddress();

  const availableToWithdraw =
    token?.address === zeroAddress
      ? await contractService.getDeposit(vaultWallet)
      : await contractService.getAvailableBalance(
          vaultWallet,
          token!.address as `0x${string}`,
        );

  if (availableToWithdraw < amount) {
    throw new Error(
      `ClientVault has insufficient funds (${fmt(availableToWithdraw)} ${token?.symbol ?? "KITE"})`,
    );
  }

  console.log(`  From:     ClientVault (${vaultWallet})`);
  console.log(`  To:       ${client.eoaAddress}`);
  console.log(`  Amount:   ${amountFlag.trim()} ${token?.symbol || "KITE"}`);

  const data = await client.withdraw(amount, token?.address);

  console.log(`  Tx:       ${data}`);
}

// ── Entry point (called from cli.ts) ───────────────────────────────

export async function runAppCommand(command: string, args: string[]) {
  console.log("  ──────────────────────────────────────────────────────");

  switch (command) {
    case "call":
      await callApi(args);
      break;
    case "balance":
      await showBalance(args);
      break;
    case "usage":
      await showUsage(args);
      break;
    case "fund":
      await fundWallet(args);
      break;
    case "withdraw":
      await withdrawFunds(args);
      break;
  }
}
