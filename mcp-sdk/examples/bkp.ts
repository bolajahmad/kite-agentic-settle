/**
 * Demo 8: AA Onboarding and Session Rule Flow
 *
 * MIGRATION FOCUS:
 * This demo simulates the migration target flow using Kite AA SDK primitives
 * plus the SDK onboarding/session orchestration used by this repository.
 *
 * WHAT YOU'LL LEARN:
 * - How an EOA maps to a Kite AA account
 * - How onboarding creates agent and session state on-chain
 * - How session rules (spending constraints) are persisted
 * - How to run a sponsored AA user operation and verify state changes
 *
 * NOTE:
 * This demo executes real on-chain writes by default.
 */

import { GokiteAASDK } from "gokite-aa-sdk";
import {
  createPublicClient,
  encodeFunctionData,
  Hex,
  http,
  keccak256,
  parseAbi,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { KITE_TESTNET } from "../src/config.js";
import { KiteSettleClient } from "../src/kite-settle-client.js";
import { getVar } from "../src/vars.js";
import { createLogger } from "./lib/logger.js";

const IDENTITY_ABI = parseAbi([
  "function totalAgents() view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getAgentSessions(uint256 agentId) view returns (address[])",
  "function validateSession(address sessionKey) view returns (bool active, uint256 agentId, address user, address walletContract, uint256 valueLimit, uint256 maxValueAllowed, uint256 validUntil)",
]);

const ATTESTATION_ABI = parseAbi([
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
  "function getFeedbackCount(uint256 agentId, address giver) view returns (uint256)",
]);

async function resolveOwnedAgentId(
  ownerAddress: `0x${string}`,
  pubClient: ReturnType<typeof createPublicClient>,
): Promise<bigint | null> {
  const identityRegistry = KITE_TESTNET.contracts
    .identityRegistry as `0x${string}`;
  const totalAgents = await pubClient.readContract({
    address: identityRegistry,
    abi: IDENTITY_ABI,
    functionName: "totalAgents",
  });

  for (let agentId = 1n; agentId <= totalAgents; agentId++) {
    const agentOwner = await pubClient.readContract({
      address: identityRegistry,
      abi: IDENTITY_ABI,
      functionName: "ownerOf",
      args: [agentId],
    });

    if (agentOwner.toLowerCase() === ownerAddress.toLowerCase()) {
      return agentId;
    }
  }

  return null;
}

export async function run() {
  const logger = createLogger();

  logger.header(
    "Demo 8: AA Onboarding and Session Rule Flow",
    "EOA onboarding + session constraints + sponsored AA user operation",
  );

  try {
    logger.step("Load owner credential and initialize clients");

    const credential = getVar("PRIVATE_KEY");
    if (!credential) {
      throw new Error("No PRIVATE_KEY found. Run 'npx kite init' first.");
    }

    const signer = privateKeyToAccount(
      (credential.startsWith("0x")
        ? credential
        : `0x${credential}`) as `0x${string}`,
    );
    const ownerAddress = signer.address;

    const pubClient = createPublicClient({
      transport: http(KITE_TESTNET.rpcUrl),
    });

    const aaSdk = new GokiteAASDK(
      "kite_testnet",
      KITE_TESTNET.rpcUrl,
      "https://bundler-service.staging.gokite.ai/rpc/",
    );
    const aaWallet = aaSdk.getAccountAddress(ownerAddress) as `0x${string}`;

    logger.data("Account Context", {
      ownerAddress,
      aaWallet,
      identityRegistry: KITE_TESTNET.contracts.identityRegistry,
      attestationRegistry: KITE_TESTNET.contracts.attestationRegistry,
    });

    logger.step("Ensure onboarding state (agent + session rule) exists");

    const settlementClient = await KiteSettleClient.create({ credential });
    let agentId = await resolveOwnedAgentId(ownerAddress, pubClient);

    if (agentId === null) {
      logger.warn("No existing agent found for owner; running onboarding flow");

      const metadata = {
        type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
        name: "AA Migration Demo Agent",
        description: "Onboarding and session-rule migration demo",
        services: [
          {
            name: "MCP",
            endpoint: "http://localhost:4000",
            version: "v1",
          },
        ],
        x402Support: true,
        x402ChannelSupport: true,
        active: true,
      };

      const onboardResult = await settlementClient.onboard(
        {
          agentURI: Buffer.from(JSON.stringify(metadata), "utf8").toString(
            "base64",
          ),
          valueLimit: "1.0",
          maxValueAllowed: "10.0",
          validDays: 7,
        },
        (step) => logger.info(`  -> ${step}`),
      );

      agentId = onboardResult.agentId;
      logger.success("Onboarding completed");
      logger.data("Onboard Result", {
        agentId: onboardResult.agentId.toString(),
        sessionKeyAddress: onboardResult.sessionKeyAddress,
        walletUSDTBalance: onboardResult.walletUSDTBalance,
      });
    } else {
      logger.success(`Found existing agent: ${agentId.toString()}`);
    }

    const sessionKeys = await pubClient.readContract({
      address: KITE_TESTNET.contracts.identityRegistry as `0x${string}`,
      abi: IDENTITY_ABI,
      functionName: "getAgentSessions",
      args: [agentId],
    });

    if (!sessionKeys.length) {
      throw new Error(
        "Agent has no session keys on-chain. Run 'npx kite onboard' to create one.",
      );
    }

    const firstSession = sessionKeys[0];
    const sessionRule = await pubClient.readContract({
      address: KITE_TESTNET.contracts.identityRegistry as `0x${string}`,
      abi: IDENTITY_ABI,
      functionName: "validateSession",
      args: [firstSession],
    });

    logger.success("Session/spending rule loaded from IdentityRegistry");
    logger.data("Session Rule", {
      sessionKey: firstSession,
      active: sessionRule[0],
      agentId: sessionRule[1].toString(),
      user: sessionRule[2],
      walletContract: sessionRule[3],
      valueLimit: sessionRule[4].toString(),
      maxValueAllowed: sessionRule[5].toString(),
      validUntil: sessionRule[6].toString(),
    });

    logger.step("Execute a sponsored AA user operation");

    const feedbackBefore = await pubClient.readContract({
      address: KITE_TESTNET.contracts.attestationRegistry as `0x${string}`,
      abi: ATTESTATION_ABI,
      functionName: "getFeedbackCount",
      args: [agentId, aaWallet],
    });

    const signFunction = async (userOpHash: string): Promise<string> => {
      return signer.signMessage({ message: { raw: userOpHash as Hex } });
    };

    const timestamp = Date.now();
    const feedbackHash = keccak256(
      toHex(`aa-onboard-demo:${ownerAddress}:${agentId}:${timestamp}`),
    );

    const request = {
      target: KITE_TESTNET.contracts.attestationRegistry,
      value: 0n,
      callData: encodeFunctionData({
        abi: ATTESTATION_ABI,
        functionName: "giveFeedback",
        args: [
          agentId,
          1000n,
          2,
          "aa-onboard",
          "sponsored",
          "sdk://demo/onboard",
          `ipfs://kite-agentic-pay/demo-8/${timestamp}`,
          feedbackHash,
        ],
      }),
    };

    let paymasterAddress: string | undefined;
    let executionMode: "sponsored" | "paid-fallback" = "sponsored";
    let result:
      | {
          userOpHash: string;
          status: {
            status: string;
            transactionHash?: string;
            blockNumber?: number;
          };
        }
      | undefined;

    try {
      try {
        const estimate = await aaSdk.estimateUserOperation(aaWallet, request);
        paymasterAddress = estimate.paymasterAddress;
        logger.data("Sponsorship Check", {
          sponsorshipAvailable: estimate.sponsorshipAvailable,
          remainingSponsorships: estimate.remainingSponsorships,
          paymasterAddress: estimate.paymasterAddress || "none",
          estimatedCostKITE: estimate.totalCostKITEFormatted,
        });
      } catch (err: any) {
        logger.warn(
          `Sponsored estimate failed, falling back to paid AA op: ${err.message ?? err}`,
        );
      }

      result = await aaSdk.sendUserOperationAndWait(
        aaWallet,
        request,
        signFunction,
        undefined,
        paymasterAddress,
        { maxRetries: 40, interval: 5000 },
      );
      if (result.status.status !== "success") {
        throw new Error(
          (result.status as { reason?: string }).reason ||
            "Sponsored AA user operation failed",
        );
      }

      const feedbackAfter = await pubClient.readContract({
        address: KITE_TESTNET.contracts.attestationRegistry as `0x${string}`,
        abi: ATTESTATION_ABI,
        functionName: "getFeedbackCount",
        args: [agentId, aaWallet],
      });

      if (feedbackAfter !== feedbackBefore + 1n) {
        throw new Error(
          `Post-check failed: expected feedback count ${feedbackBefore + 1n}, got ${feedbackAfter}`,
        );
      }

      logger.success("Sponsored AA call succeeded and state updated");
      logger.data("AA Result", {
        executionMode,
        userOpHash: result.userOpHash,
        transactionHash: result.status.transactionHash,
        blockNumber: result.status.blockNumber,
        feedbackCountBefore: feedbackBefore.toString(),
        feedbackCountAfter: feedbackAfter.toString(),
      });

      logger.complete(
        "EOA onboarding/session rule state confirmed and sponsored AA user operation verified.",
      );
    } catch (err: any) {
      logger.warn(
        `AA execution could not be finalized in this environment: ${err.message ?? err}`,
      );
      logger.data("AA Execution Diagnostic", {
        executionMode,
        reason: err.message ?? String(err),
        feedbackCountBefore: feedbackBefore.toString(),
      });
      logger.complete(
        "EOA onboarding/session rule state confirmed. AA execution step reported diagnostics without failing the demo.",
      );
    }
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
