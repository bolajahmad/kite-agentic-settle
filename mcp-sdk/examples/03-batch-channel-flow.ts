/**
 * Demo 3: Batch Channel Flow
 *
 * CHANNEL-BASED BATCHING:
 * This demo shows how payment channels enable cost-efficient API workflows.
 * The consumer opens a channel on-chain once, makes multiple calls through it,
 * and settles the aggregate cost at the end. Provider signs receipts for each
 * call, enabling merkle-proof-based auditability.
 *
 * WHAT YOU'LL LEARN:
 * - How to open a payment channel on-chain with deposit
 * - How channel calls accumulate provider-signed receipts
 * - How merkle roots track cumulative call history
 * - How to handle 402 rejections and stop gracefully
 * - How settlement finalizes aggregate payment with gas savings
 *
 * PREREQUISITES:
 * - Run \`npx kite init\` to store your EOA seed phrase
 * - Run \`npx kite onboard\` to register an agent and create a session key
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
import { createDemoClient, formatUsdc, parseUsdc } from "./lib/setup.js";

// Demo configuration
const AGENT_ID = "8";
const SESSION_KEY = "0x6869Be52272d679eC4D4020796EdE9091546Cdc3";
const MAX_CALLS = 10;

export async function run() {
  const logger = createLogger();

  logger.header(
    "Demo 3: Batch Channel Flow",
    "Multiple API calls through a single on-chain payment channel",
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
      throw new Error("Session key required for channels");
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

    const discoveryUrl = "http://localhost:4000/api/stream/intelligence";
    const probeResponse = await fetch(discoveryUrl, {
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
      recommendedDeposit: challenge.channelOptions?.recommendedDeposit
        ? formatUsdc(BigInt(challenge.channelOptions.recommendedDeposit))
        : "N/A",
      maxDuration: challenge.channelOptions?.maxDuration || "3600s",
    });

    // ── Open payment channel on-chain ─────────────────────────────────
    logger.step("Open payment channel on-chain");

    const depositAmount = parseUsdc("5.0");
    const maxDuration = 3600;

    logger.info("Channel configuration:");
    logger.data("Configuration", {
      deposit: formatUsdc(depositAmount),
      maxSpend: formatUsdc(depositAmount),
      maxDuration: `${maxDuration}s`,
      maxPerCall: formatUsdc(maxPerCall),
      mode: "prepaid",
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

    logger.success(
      "Channel opened on-chain (via ClientAgentVault batch — gas sponsored)",
    );
    logger.data("Channel Info", {
      channelId: channelId,
      txHash: openTxHash,
      status: "Open (awaiting provider activation)",
    });

    client.setChannelForProvider(providerAddress, channelId);
    logger.info("Channel registered with payment interceptor");

    // ── Wait for provider activation ──────────────────────────────────
    logger.step("Wait for provider to activate channel");
    logger.info("Provider reads channel from chain and activates it...");

    const activated = await waitForChannelActive(client, channelId);
    if (activated) {
      logger.success("Channel is Active");
    } else {
      logger.warn(
        "Provider did not activate within 90s. Proceeding anyway (calls may fail).",
      );
    }

    // ── Define API endpoints ──────────────────────────────────────────
    const apiEndpoints = [
      {
        name: "Market Data (BTC)",
        url: "http://localhost:4000/api/stream/market/BTCUSDT",
      },
      {
        name: "Market Data (ETH)",
        url: "http://localhost:4000/api/stream/market/ETHUSDT",
      },
      {
        name: "Intelligence Report",
        url: "http://localhost:4000/api/stream/intelligence",
      },
      {
        name: "Protocol Analytics",
        url: "http://localhost:4000/api/stream/protocol-report",
      },
      {
        name: "Market Data (SOL)",
        url: "http://localhost:4000/api/stream/market/SOLUSDT",
      },
    ];

    // ── Make channel calls ────────────────────────────────────────────
    logger.step(`Make ${MAX_CALLS} API calls through channel`);
    logger.info(
      "Calls use channel mode: X-Payment-Mode: channel + X-Channel-Id header",
    );

    const receipts: ChannelCallReceipt[] = [];
    const leafHashes: `0x${string}`[] = [];
    let lastReceipt: ChannelCallReceipt | null = null;
    let callCount = 0;

    for (let i = 0; i < MAX_CALLS; i++) {
      const endpoint = apiEndpoints[i % apiEndpoints.length];
      const callNum = i + 1;

      logger.info(`\nCall ${callNum}/${MAX_CALLS}: ${endpoint.name}`);

      const startTime = Date.now();

      try {
        const headers = buildChannelHeaders(channelId, lastReceipt);

        const response = await fetch(endpoint.url, {
          method: "GET",
          headers,
        });

        const elapsed = Date.now() - startTime;

        // ── Handle 402 rejection (stop immediately) ───────────────────
        if (response.status === 402) {
          const errorBody = await response.json().catch(() => ({}));
          logger.error(
            `Call ${callNum} rejected with 402 Payment Required (${elapsed}ms)`,
          );
          logger.data("402 Error", errorBody);
          logger.info(
            "Channel rejected by provider. Stopping batch flow gracefully.",
          );
          logger.info("Common causes:");
          logger.info("  - Channel deposit exhausted");
          logger.info("  - Channel expired");
          logger.info("  - Provider detected issue with last receipt");
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
          continue;
        }

        if (receipt.channelId.toLowerCase() !== channelId.toLowerCase()) {
          logger.warn(
            `Call ${callNum} receipt channelId mismatch: ${receipt.channelId} != ${channelId}`,
          );
          continue;
        }

        if (
          lastReceipt &&
          receipt.sequenceNumber <= lastReceipt.sequenceNumber
        ) {
          logger.warn(
            `Call ${callNum} receipt sequence not increasing: ${receipt.sequenceNumber} <= ${lastReceipt.sequenceNumber}`,
          );
          continue;
        }

        const valid = await validateChannelReceipt(receipt, providerAddress);
        if (!valid) {
          logger.warn(
            `Call ${callNum} receipt signature invalid or not from provider`,
          );
          continue;
        }

        logger.success(`Call ${callNum} completed in ${elapsed}ms`);

        receipts.push(receipt);
        lastReceipt = receipt;
        callCount++;

        logger.data(`Receipt ${callNum}`, {
          sequence: receipt.sequenceNumber,
          cumulativeCost: formatUsdc(BigInt(receipt.cumulativeCost)),
          timestamp: new Date(receipt.timestamp * 1000).toISOString(),
          signature: receipt.providerSignature.slice(0, 20) + "...",
        });

        const leafHash = computeLeafHash({
          channelId: receipt.channelId,
          sequenceNumber: receipt.sequenceNumber,
          callCost: 0n,
          cumulativeCost: BigInt(receipt.cumulativeCost),
          timestamp: receipt.timestamp,
          url: endpoint.url,
          requestHash:
            "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
          responseHash:
            "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
          providerSignature: receipt.providerSignature,
        });
        leafHashes.push(leafHash);

        const merkleRoot = buildMerkleRoot(leafHashes);
        logger.data("Merkle State", {
          leafHash: leafHash.slice(0, 20) + "...",
          merkleRoot: merkleRoot.slice(0, 20) + "...",
          leafCount: leafHashes.length,
          cumulativeSequence: receipt.sequenceNumber,
        });

        logger.info(
          `Cumulative cost: ${formatUsdc(BigInt(receipt.cumulativeCost))}`,
        );
        logger.info(
          `Remaining deposit: ~${formatUsdc(depositAmount - BigInt(receipt.cumulativeCost))}`,
        );
      } catch (err: any) {
        logger.error(`Call ${callNum} error: ${err.message}`);
        logger.info("Stopping batch flow due to error");
        break;
      }
    }

    // ── Show final summary ────────────────────────────────────────────
    logger.step("Batch flow summary");

    if (callCount === 0) {
      logger.warn("No calls completed successfully");
    } else {
      logger.data("Summary", {
        totalCalls: callCount,
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
        purpose:
          "Submitted to PaymentChannel.initiateSettlement() for on-chain verification",
      });
    }

    // ── Check channel state ───────────────────────────────────────────
    logger.step("Check channel state on-chain");
    const channelState = await client.getChannel(channelId);
    logger.data("Channel State", {
      status: ChannelStatus[channelState.status],
      deposit: formatUsdc(channelState.deposit),
      settledAmount: formatUsdc(channelState.settledAmount),
      highestClaimedCost: formatUsdc(channelState.highestClaimedCost),
      highestSequence: channelState.highestSequenceNumber,
    });

    // ── Check balance after ───────────────────────────────────────────
    logger.step("Check ClientAgentVault balance after channel calls");
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
      logger.info("To settle this channel:");
      logger.info("  1. Initiate settlement with last receipt:");
      logger.info(`     npx kite finalize --channel ${channelId}`);
      logger.info("  2. Wait for challenge window (1 hour)");
      logger.info("  3. After window: finalize settlement");
      logger.info("");
      logger.info("Settlement will:");
      logger.info(
        `  - Verify provider signature on receipt seq ${lastReceipt.sequenceNumber}`,
      );
      logger.info(
        `  - Transfer ${formatUsdc(BigInt(lastReceipt.cumulativeCost))} to provider`,
      );
      logger.info(
        `  - Refund ${formatUsdc(depositAmount - BigInt(lastReceipt.cumulativeCost))} to consumer`,
      );
      logger.info("  - Close channel");
    } else {
      logger.info(
        "No calls completed - channel can be closed without settlement",
      );
    }

    // ── Cost comparison ───────────────────────────────────────────────
    if (callCount > 1) {
      logger.step("Cost comparison: Channel vs Per-Call");

      const perCallGas = 100000;
      const channelOpenGas = 150000;
      const channelSettleGas = 50000;
      const channelTotalGas = channelOpenGas + channelSettleGas;

      logger.data("Gas Efficiency", {
        perCallApproach: `${callCount} calls x ${perCallGas} gas = ${callCount * perCallGas} gas`,
        channelApproach: `Open (${channelOpenGas}) + Settle (${channelSettleGas}) = ${channelTotalGas} gas`,
        savings:
          callCount * perCallGas > channelTotalGas
            ? `${((1 - channelTotalGas / (callCount * perCallGas)) * 100).toFixed(1)}% gas reduction`
            : "Break-even point not reached",
        breakEvenCalls: Math.ceil(channelTotalGas / perCallGas),
      });
    }

    logger.complete(
      "Channel batch flow demonstrated. Multiple API calls made through single on-chain channel. " +
        "Provider signed receipts collected. Merkle proofs computed for auditability. " +
        "Ready for aggregate settlement with gas savings.",
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
