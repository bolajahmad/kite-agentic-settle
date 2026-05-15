/**
 * Demo 4: Stream Channel Flow
 *
 * TIME-GOVERNED EXECUTION:
 * This demo shows how stream channels enable scheduled, time-bounded API
 * execution. Unlike batch channels (count/value limited), stream channels
 * are primarily time-limited — perfect for recurring tasks, monitoring,
 * and scheduled data collection within a time window.
 *
 * WHAT YOU'LL LEARN:
 * - How to open a stream channel with time bounds
 * - How stream calls execute within a scheduled window
 * - How time expiry automatically closes the channel
 * - How stream channels differ from batch channels
 *
 * PREREQUISITES:
 * - Run `npx kite init` to store your EOA seed phrase
 * - Run `npx kite onboard` to register an agent and create a session key
 * - Fund your ClientAgentVault with test USDC: npx kite fund --amount <amount>
 * - Start backend server at http://localhost:4000
 */

import { buildMerkleRoot, computeLeafHash } from "../src/merkle.js";
import { ChannelStatus } from "../src/types.js";
import {
  buildChannelHeaders,
  extractChannelReceipt,
  validateChannelReceipt,
  waitForChannelActive,
  type ChannelCallReceipt,
} from "../src/utils/channel-helpers.js";
import { createLogger } from "./lib/logger.js";
import { createDemoClient, formatUsdc } from "./lib/setup.js";

// Demo configuration
const AGENT_ID = "3";
const SESSION_KEY = "0x875255dCe60F03fa645E64792701A57D1B1c678A";
const STREAM_DURATION_SECONDS = 30; // 30 second window for demo
const CALL_INTERVAL_MS = 3000; // Call every 3 seconds

export async function run() {
  const logger = createLogger();

  logger.header(
    "Demo 4: Stream Channel Flow",
    "Time-bounded scheduled API execution",
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
      allowUnavailableSession: true,
    });

    if (!client.sessionKeyAddress) {
      logger.error(
        "No session key found. Run 'npx kite onboard' to create one.",
      );
      throw new Error("Session key required for stream channels");
    }

    logger.success("Client initialized in agent mode");
    logger.info(`Active address: ${client.address}`);
    logger.info(`Session key: ${client.sessionKeyAddress}`);

    // ── Check balance before ──────────────────────────────────────────
    logger.step("Check ClientAgentVault balance before opening channel");
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

    // ── Discover provider and channel options ─────────────────────────
    logger.step("Discover provider from 402 challenge");

    const apiUrl = "http://localhost:4000/api/stream/market/BTCUSDT";
    const probeResponse = await fetch(apiUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (probeResponse.status !== 402) {
      throw new Error(
        `Expected 402 response, got ${probeResponse.status}. Make sure backend is running.`,
      );
    }

    const challenge = await probeResponse.json();
    const offer = challenge.accepts?.[0];
    if (!offer) {
      throw new Error("402 response missing accepts[] array");
    }

    const providerAddress = offer.payTo;
    const tokenAddress = offer.asset;
    const ratePerCall = BigInt(offer.maxAmountRequired);
    const maxPerCall = offer.maxRatePerCall
      ? BigInt(offer.maxRatePerCall)
      : ratePerCall;

    logger.success(`Provider discovered: ${providerAddress}`);
    logger.data("Channel Options", {
      ratePerCall: formatUsdc(ratePerCall),
      maxPerCall: formatUsdc(maxPerCall),
    });

    // ── Open stream channel with time bounds ──────────────────────────
    logger.step("Open stream channel with time bounds");

    // Estimate max calls based on duration and interval
    const estimatedMaxCalls = Math.ceil(
      (STREAM_DURATION_SECONDS * 1000) / CALL_INTERVAL_MS,
    );
    const depositAmount = maxPerCall * BigInt(estimatedMaxCalls + 2); // +2 buffer

    logger.data("Stream Configuration", {
      duration: `${STREAM_DURATION_SECONDS}s`,
      callInterval: `${CALL_INTERVAL_MS / 1000}s`,
      estimatedCalls: estimatedMaxCalls,
      deposit: formatUsdc(depositAmount),
      maxPerCall: formatUsdc(maxPerCall),
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
        STREAM_DURATION_SECONDS,
        maxPerCall,
      );

    if (!newChannelId) {
      throw new Error(
        "openChannelViaVaultBatch did not return a channelId — check ChannelOpened event",
      );
    }
    const channelId = newChannelId;

    logger.success(
      "Stream channel opened on-chain (via ClientAgentVault batch — gas sponsored)",
    );
    logger.data("Channel Info", {
      channelId: channelId,
      txHash: openTxHash,
      status: "Open (awaiting provider activation)",
      expiresIn: `${STREAM_DURATION_SECONDS}s`,
    });

    client.setChannelForProvider(providerAddress, channelId);

    // ── Wait for provider activation ──────────────────────────────────
    logger.step("Wait for provider to activate channel");
    const activated = await waitForChannelActive(client, channelId);
    if (activated) {
      logger.success("Channel is Active");
    } else {
      logger.warn(
        "Provider did not activate within 90s. Proceeding anyway (calls may fail).",
      );
    }

    // ── Execute scheduled stream calls ────────────────────────────────
    logger.step("Execute scheduled stream calls within time window");

    const streamStartTime = Date.now();
    const streamDeadline = streamStartTime + STREAM_DURATION_SECONDS * 1000;

    logger.info(`Stream window: ${STREAM_DURATION_SECONDS}s`);
    logger.info(`Calls scheduled every ${CALL_INTERVAL_MS / 1000}s`);
    logger.info(
      `Stream will auto-terminate at ${new Date(streamDeadline).toLocaleTimeString()}\n`,
    );

    const receipts: ChannelCallReceipt[] = [];
    const leafHashes: `0x${string}`[] = [];
    let lastReceipt: ChannelCallReceipt | null = null;
    let callCount = 0;

    // Define rotating endpoints for variety
    const endpoints = [
      "http://localhost:4000/api/stream/market/BTCUSDT",
      "http://localhost:4000/api/stream/market/ETHUSDT",
      "http://localhost:4000/api/stream/market/SOLUSDT",
    ];

    while (Date.now() < streamDeadline) {
      const timeRemaining = Math.ceil((streamDeadline - Date.now()) / 1000);
      const callNum = callCount + 1;
      const endpoint = endpoints[callCount % endpoints.length];
      const symbol = endpoint.split("/").pop() || "UNKNOWN";

      logger.info(
        `\nCall ${callNum} (${timeRemaining}s remaining): Market data for ${symbol}`,
      );

      const startTime = Date.now();

      try {
        const headers = buildChannelHeaders(channelId, lastReceipt);

        const response = await fetch(endpoint, {
          method: "GET",
          headers,
        });

        const elapsed = Date.now() - startTime;

        // ── Handle 402 rejection (channel may be expired) ─────────────
        if (response.status === 402) {
          const errorBody = await response.json().catch(() => ({}));
          logger.error(
            `Call ${callNum} rejected with 402 Payment Required (${elapsed}ms)`,
          );
          logger.data("402 Error", errorBody);
          logger.info(
            "Channel rejected by provider (likely expired or exhausted).",
          );
          break;
        }

        if (!response.ok) {
          const errorText = await response.text();
          logger.error(
            `Call ${callNum} failed with status ${response.status} (${elapsed}ms)`,
          );
          logger.data("Error Response", errorText);
          break;
        }

        const body = await response.json();

        const receipt = extractChannelReceipt(body, response.headers);
        if (!receipt) {
          logger.warn(
            `Call ${callNum} succeeded but provider did not return receipt`,
          );
        } else if (
          receipt.channelId.toLowerCase() !== channelId.toLowerCase()
        ) {
          logger.warn(`Call ${callNum} receipt channelId mismatch`);
        } else if (
          lastReceipt &&
          receipt.sequenceNumber <= lastReceipt.sequenceNumber
        ) {
          logger.warn(`Call ${callNum} receipt sequence not increasing`);
        } else {
          const valid = await validateChannelReceipt(receipt, providerAddress);
          if (!valid) {
            logger.warn(`Call ${callNum} receipt signature invalid`);
          } else {
            receipts.push(receipt);
            lastReceipt = receipt;
            callCount++;

            logger.success(`Call ${callNum} completed in ${elapsed}ms`);
            logger.data(`Receipt ${callNum}`, {
              sequence: receipt.sequenceNumber,
              cumulativeCost: formatUsdc(BigInt(receipt.cumulativeCost)),
              timestamp: new Date(receipt.timestamp * 1000).toISOString(),
            });

            const leafHash = computeLeafHash({
              channelId: receipt.channelId,
              sequenceNumber: receipt.sequenceNumber,
              callCost: 0n,
              cumulativeCost: BigInt(receipt.cumulativeCost),
              timestamp: receipt.timestamp,
              url: endpoint,
              requestHash:
                "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
              responseHash:
                "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
              providerSignature: receipt.providerSignature,
            });
            leafHashes.push(leafHash);

            const merkleRoot = buildMerkleRoot(leafHashes);
            logger.info(
              `Merkle root: ${merkleRoot.slice(0, 20)}... (${leafHashes.length} leaves)`,
            );
            logger.info(
              `Cumulative cost: ${formatUsdc(BigInt(receipt.cumulativeCost))}`,
            );
          }
        }
      } catch (err: any) {
        logger.error(`Call ${callNum} error: ${err.message}`);
      }

      // ── Wait for next interval (if time remaining) ────────────────
      const nextCallTime = startTime + CALL_INTERVAL_MS;
      const waitTime = nextCallTime - Date.now();

      if (waitTime > 0 && Date.now() + waitTime < streamDeadline) {
        logger.info(
          `Waiting ${(waitTime / 1000).toFixed(1)}s until next call...`,
        );
        await new Promise((r) => setTimeout(r, waitTime));
      } else if (Date.now() >= streamDeadline) {
        logger.info("\nStream window expired - no more calls will be made");
        break;
      }
    }

    // ── Show stream summary ───────────────────────────────────────────
    logger.step("Stream flow summary");

    const actualDuration = (Date.now() - streamStartTime) / 1000;

    if (callCount === 0) {
      logger.warn("No calls completed successfully");
    } else {
      logger.data("Summary", {
        totalCalls: callCount,
        streamDuration: `${actualDuration.toFixed(1)}s`,
        avgCallInterval: `${(actualDuration / callCount).toFixed(1)}s`,
        totalCost: lastReceipt
          ? formatUsdc(BigInt(lastReceipt.cumulativeCost))
          : "0",
        avgCostPerCall: lastReceipt
          ? formatUsdc(BigInt(lastReceipt.cumulativeCost) / BigInt(callCount))
          : "0",
        receiptsCollected: receipts.length,
        finalSequence: lastReceipt?.sequenceNumber || 0,
      });

      const finalMerkleRoot = buildMerkleRoot(leafHashes);
      logger.data("Final Merkle Root", {
        root: finalMerkleRoot,
        leafCount: leafHashes.length,
      });
    }

    // ── Check channel state ───────────────────────────────────────────
    logger.step("Check channel state on-chain");
    const channelState = await client.getChannel(channelId);
    const isExpired = Date.now() / 1000 > channelState.expiresAt;

    logger.data("Channel State", {
      status: ChannelStatus[channelState.status],
      deposit: formatUsdc(channelState.deposit),
      settledAmount: formatUsdc(channelState.settledAmount),
      highestClaimedCost: formatUsdc(channelState.highestClaimedCost),
      expired: isExpired ? "Yes (time window closed)" : "No (still active)",
      expiresAt: new Date(channelState.expiresAt * 1000).toISOString(),
    });

    // ── Check balance after ───────────────────────────────────────────
    logger.step("Check ClientAgentVault balance after stream");
    const balanceAfter = await client.getDepositedBalance(
      undefined,
      vaultAddress,
    );
    logger.data("Balance After", {
      formatted: formatUsdc(balanceAfter),
      raw: balanceAfter.toString(),
    });

    const spent = balanceBefore - balanceAfter;
    if (spent > 0n) {
      logger.success(`Total spent: ${formatUsdc(spent)}`);
    } else {
      logger.info(
        "No balance change yet (channel deposit locked, settlement pending)",
      );
    }

    // ── Settlement instructions ───────────────────────────────────────
    logger.step("Settlement process");

    if (callCount > 0 && lastReceipt) {
      logger.info("Stream channel settlement:");
      logger.info("  1. Channel expired after time window");
      logger.info(
        `  2. Total cost accumulated: ${formatUsdc(BigInt(lastReceipt.cumulativeCost))}`,
      );
      logger.info("  3. Initiate settlement:");
      logger.info(`     npx kite finalize --channel ${channelId}`);
      logger.info("  4. Wait for challenge window (1 hour)");
      logger.info("  5. Finalize to close channel and recover unused deposit");
    } else {
      logger.info(
        "No calls completed - channel can be closed without settlement",
      );
    }

    // ── Compare stream vs batch ───────────────────────────────────────
    logger.step("Stream vs Batch channels");

    logger.data("Stream Channels", {
      boundedBy: "Time duration",
      useCases:
        "Monitoring, scheduled tasks, periodic data collection, time-boxed workflows",
      advantage: "Automatic expiry, predictable window, recurring execution",
      termination: "Time-based (channel expires at maxDuration)",
    });

    logger.data("Batch Channels", {
      boundedBy: "Call count or deposit amount",
      useCases:
        "Bulk processing, multi-step workflows, variable-cost operations",
      advantage: "Flexible timing, resume after interruption, cost-controlled",
      termination: "Manual (consumer decides when to settle)",
    });

    logger.complete(
      `Stream channel flow demonstrated. ${callCount} API calls executed within ${actualDuration.toFixed(1)}s time window. ` +
        "Time-bounded execution enables scheduled workflows with automatic expiry handling. " +
        "Ideal for monitoring, recurring tasks, and time-sensitive operations.",
    );
  } catch (err: any) {
    logger.error(`Demo failed: ${err.message}`);
    if (err.stack) {
      console.error(err.stack);
    }
    throw err;
  }
}

// Allow running standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  await run();
}
