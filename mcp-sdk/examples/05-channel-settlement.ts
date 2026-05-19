/**
 * Demo 5: Channel Settlement and Finalization
 *
 * COOPERATIVE SETTLEMENT (EARLY CLOSE):
 * This demo shows the full channel lifecycle end-to-end:
 *   open → activate → calls → initiateSettlement → provider approveSettlement → Closed → refund
 *
 * Because the provider is running and active, it will call approveSettlement()
 * immediately after the consumer submits a settlement — skipping the challenge window
 * and closing the channel cooperatively in a single round-trip.
 *
 * WHAT YOU'LL LEARN:
 * - How to open a real channel and collect provider-signed receipts
 * - How initiateSettlement puts the channel into SettlementPending
 * - How the provider's approveSettlement closes the channel immediately
 * - How the unused deposit is refunded to the ClientAgentVault
 *
 * PREREQUISITES:
 * - Run `npx kite init` to store your EOA seed phrase
 * - Run `npx kite onboard` to register an agent and create a session key
 * - Fund your ClientAgentVault with test USDC: npx kite fund --amount <amount>
 * - Start backend server at http://localhost:4000
 */

import { ChannelStatus } from "../src/types.js";
import {
  buildChannelHeaders,
  extractChannelReceipt,
  validateChannelReceipt,
  waitForChannelActive,
  type ChannelCallReceipt,
} from "../src/utils/channel-helpers.js";
import { createLogger } from "./lib/logger.js";
import { createDemoClient, formatTimestamp, formatUsdc } from "./lib/setup.js";

// Demo configuration — replace with your agent and session
const AGENT_ID = "3";
const SESSION_KEY = "0x875255dCe60F03fa645E64792701A57D1B1c678A";
const API_URL = "http://localhost:4000/api/stream/intelligence";
const NUM_CALLS = 3;
const CHANNEL_ID = "0x";

// How long to wait for the provider to approve settlement
const PROVIDER_APPROVE_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 3_000;

export async function run() {
  const logger = createLogger();

  logger.header(
    "Demo 5: Channel Settlement and Finalization",
    "Full lifecycle: open → calls → settle → provider approves → refund",
  );

  try {
    // ── Setup ────────────────────────────────────────────────────────
    logger.step("Initialize Kite client in agent mode");
    logger.info(`Agent ID: ${AGENT_ID}`);
    logger.info(`Session key: ${SESSION_KEY}`);

    const client = await createDemoClient({
      logger,
      agentId: AGENT_ID,
      sessionKey: SESSION_KEY,
    });

    if (!client.sessionKeyAddress) {
      logger.error(
        "No session key found. Run 'npx kite onboard' to create one.",
      );
      throw new Error("Session key required for this demo");
    }

    logger.success("Client initialized in agent mode");
    logger.info(`Session key: ${client.sessionKeyAddress}`);

    // ── Vault balance before ──────────────────────────────────────────
    logger.step("Check ClientAgentVault balance before");

    const vaultAddress = await client.getOwnerAAWalletAddress();
    logger.info(`ClientAgentVault: ${vaultAddress}`);
    const balanceBefore = await client.getDepositedBalance(
      undefined,
      vaultAddress,
    );
    logger.data("Balance Before", {
      formatted: formatUsdc(balanceBefore),
      raw: balanceBefore.toString(),
    });

    if (balanceBefore === 0n) {
      logger.warn(
        "Vault balance is zero. Fund your vault: npx kite fund --amount <amount>",
      );
      logger.info("Demo will continue but channel opening may fail");
    }

    // ── Discover provider ─────────────────────────────────────────────
    logger.step("Discover provider from 402 challenge");

    const probeResponse = await fetch(API_URL, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (probeResponse.status !== 402) {
      throw new Error(
        `Expected 402 response, got ${probeResponse.status}. Is the backend running at ${API_URL}?`,
      );
    }

    const challenge = await probeResponse.json();
    const offer = challenge.accepts?.[0];
    if (!offer) {
      throw new Error("402 response missing accepts[] array");
    }

    const providerAddress = offer.payTo as `0x${string}`;
    const tokenAddress = offer.asset as `0x${string}`;
    const maxPerCall = offer.maxRatePerCall
      ? BigInt(offer.maxRatePerCall)
      : BigInt(offer.maxAmountRequired);

    logger.success(`Provider: ${providerAddress}`);
    logger.data("Offer", {
      maxPerCall: formatUsdc(maxPerCall),
      token: tokenAddress,
    });

    // ── Open channel via ClientAgentVault ─────────────────────────────
    logger.step(
      "Open payment channel (via ClientAgentVault batch — gas sponsored)",
    );

    // Deposit enough for NUM_CALLS + 2 buffer so there is a meaningful refund
    const depositAmount = maxPerCall * BigInt(NUM_CALLS + 2);
    const maxDuration = 3600;

    logger.data("Channel Configuration", {
      deposit: formatUsdc(depositAmount),
      maxPerCall: formatUsdc(maxPerCall),
      maxDuration: `${maxDuration}s`,
      numCalls: NUM_CALLS,
      expectedCost: formatUsdc(maxPerCall * BigInt(NUM_CALLS)),
      expectedRefund: formatUsdc(maxPerCall * 2n),
    });

    const { txHash: openTxHash, channelId: newChannelId } = await client
      .getContractService()
      .openChannelViaVaultBatch(
        client.sessionKeyAddress as `0x${string}`,
        vaultAddress as `0x${string}`,
        providerAddress,
        tokenAddress,
        0, // prepaid mode
        depositAmount,
        depositAmount, // maxSpend == deposit
        maxDuration,
        maxPerCall,
      );

    if (!newChannelId) {
      throw new Error(
        "openChannelViaVaultBatch did not return a channelId — check ChannelOpened event",
      );
    }
    const channelId = newChannelId;

    logger.success("Channel opened on-chain (gas sponsored via vault)");
    logger.data("Channel Info", {
      channelId,
      txHash: openTxHash,
    });

    client.setChannelForProvider(providerAddress, channelId);

    // ── Wait for provider activation ──────────────────────────────────
    logger.step("Wait for provider to activate channel");
    logger.info(
      "Provider reads the ChannelOpened event and calls activate()...",
    );

    const activated = await waitForChannelActive(client, channelId);
    if (activated) {
      logger.success("Channel is Active");
    } else {
      logger.warn(
        "Provider did not activate within 90s. Proceeding anyway (calls may fail).",
      );
    }

    // ── Make API calls to collect receipts ────────────────────────────
    logger.step(`Make ${NUM_CALLS} API calls through channel`);
    logger.info(
      "Each call returns a provider-signed receipt accumulating the cost.",
    );

    let lastReceipt: ChannelCallReceipt | null = null;
    let callCount = 0;

    for (let i = 0; i < NUM_CALLS; i++) {
      const callNum = i + 1;
      logger.info(`\nCall ${callNum}/${NUM_CALLS}...`);

      const headers = buildChannelHeaders(channelId, lastReceipt);
      const response = await fetch(API_URL, { method: "GET", headers });

      if (response.status === 402) {
        const errBody = await response.json().catch(() => ({}));
        logger.error(`Call ${callNum} rejected with 402`);
        logger.data("402 Error", errBody);
        logger.info("Stopping — will settle with receipts collected so far.");
        break;
      }

      if (!response.ok) {
        logger.error(`Call ${callNum} failed: ${response.status}`);
        break;
      }

      const body = await response.json();
      const receipt = extractChannelReceipt(body, response.headers);

      if (!receipt) {
        logger.warn(`Call ${callNum}: provider did not return a receipt`);
        continue;
      }

      if (lastReceipt && receipt.sequenceNumber <= lastReceipt.sequenceNumber) {
        logger.warn(
          `Call ${callNum}: receipt sequence not increasing — discarding`,
        );
        continue;
      }

      const valid = await validateChannelReceipt(receipt, providerAddress);
      if (!valid) {
        logger.warn(`Call ${callNum}: invalid provider signature — discarding`);
        continue;
      }

      lastReceipt = receipt;
      callCount++;

      logger.success(`Call ${callNum} completed`);
      logger.data(`Receipt ${callNum}`, {
        sequence: receipt.sequenceNumber,
        cumulativeCost: formatUsdc(BigInt(receipt.cumulativeCost)),
        timestamp: new Date(receipt.timestamp * 1000).toISOString(),
        signature: receipt.providerSignature.slice(0, 22) + "...",
      });
    }

    if (!lastReceipt) {
      throw new Error(
        "No provider-signed receipts collected — cannot initiate settlement.",
      );
    }

    logger.separator();
    logger.data("Calls Summary", {
      completed: callCount,
      totalCost: formatUsdc(BigInt(lastReceipt.cumulativeCost)),
      finalSequence: lastReceipt.sequenceNumber,
      refundDue: formatUsdc(depositAmount - BigInt(lastReceipt.cumulativeCost)),
    });

    // ── Initiate settlement ───────────────────────────────────────────
    logger.step("Initiate settlement (consumer submits last receipt)");
    logger.info(
      "Calling PaymentChannel.initiateSettlement() with the highest-sequence receipt.",
    );
    logger.info("Channel will enter SettlementPending state.");

    // Route through AA vault so session key does not need native gas
    const settleTxHash = await client
      .getContractService()
      .initiateSettlementViaVaultAA(
        client.sessionKeyAddress as `0x${string}`,
        vaultAddress as `0x${string}`,
        channelId,
        lastReceipt.sequenceNumber,
        BigInt(lastReceipt.cumulativeCost),
        lastReceipt.timestamp,
        lastReceipt.providerSignature as `0x${string}`,
      );

    logger.success(`Settlement initiated: ${settleTxHash}`);

    const settlementState = await client
      .getContractService()
      .getSettlementState(channelId);

    logger.data("Settlement State (on-chain)", {
      highestCost: formatUsdc(settlementState.highestCost),
      highestSeq: settlementState.highestSeq,
      challengeDeadline: formatTimestamp(settlementState.deadline),
      challengeOpen: settlementState.challengeOpen,
    });

    // ── Wait for provider to approve ──────────────────────────────────
    logger.step("Wait for provider to approve settlement (cooperative close)");
    logger.info(
      "Provider calls approveSettlement() — skipping the challenge window.",
    );
    logger.info(
      "This closes the channel immediately and releases the refund to the vault.",
    );

    const pollStart = Date.now();
    let channelClosed = false;

    while (Date.now() - pollStart < PROVIDER_APPROVE_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

      const channelState = await client.getChannel(channelId);
      const elapsed = ((Date.now() - pollStart) / 1000).toFixed(0);

      if (channelState.status === ChannelStatus.Closed) {
        channelClosed = true;
        break;
      }

      logger.info(
        `  [${elapsed}s] Status: ${ChannelStatus[channelState.status]} — awaiting provider approval...`,
      );
    }

    // ── Show result ───────────────────────────────────────────────────
    if (!channelClosed) {
      logger.warn(
        `Provider did not approve within ${PROVIDER_APPROVE_TIMEOUT_MS / 1000}s.`,
      );
      logger.info(
        "Channel is still in SettlementPending. Finalize after the challenge window closes:",
      );
      logger.info(`  npx kite finalize --channel ${channelId}`);
    } else {
      logger.success("Provider approved settlement — channel is CLOSED");

      const finalState = await client.getChannel(channelId);
      logger.data("Final Channel State", {
        status: ChannelStatus[finalState.status],
        settledAmount: formatUsdc(finalState.settledAmount),
        paidToProvider: formatUsdc(finalState.settledAmount),
        refundedToVault: formatUsdc(depositAmount - finalState.settledAmount),
      });

      // ── Vault balance after ───────────────────────────────────────
      logger.step("Check ClientAgentVault balance after settlement");
      const balanceAfter = await client.getDepositedBalance(
        undefined,
        vaultAddress,
      );
      logger.data("Balance After", {
        formatted: formatUsdc(balanceAfter),
        raw: balanceAfter.toString(),
      });

      // balanceBefore = vault before open (deposit not yet locked)
      // balanceAfter  = vault after close (refund received)
      // netSpent      = balanceBefore - balanceAfter = what the provider kept
      const netSpent = balanceBefore - balanceAfter;
      const refundReceived = depositAmount - netSpent;

      logger.data("Settlement Summary", {
        depositLocked: formatUsdc(depositAmount),
        paidToProvider: formatUsdc(netSpent),
        refundedToVault: formatUsdc(refundReceived),
        vaultBefore: formatUsdc(balanceBefore),
        vaultAfter: formatUsdc(balanceAfter),
      });

      if (netSpent > 0n) {
        logger.success(`Provider paid: ${formatUsdc(netSpent)}`);
        logger.success(`Vault refunded: ${formatUsdc(refundReceived)}`);
      }
    }

    logger.complete(
      "Channel settlement lifecycle complete. Cooperative close via provider " +
        "approveSettlement() skips the challenge window — funds released immediately.",
    );
  } catch (err: any) {
    logger.error(`Demo failed: ${err.message}`);
    if (err.stack) {
      console.error(err.stack);
    }
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await run();
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
}
