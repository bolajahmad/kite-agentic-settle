#!/usr/bin/env node
/**
 * Demo runner for Kite Agent Pay examples.
 * Run specific demos by number/name or run all in sequence.
 *
 * Usage:
 *   npm run demo              # List all demos
 *   npm run demo 1            # Run demo 1 (percall-payment)
 *   npm run demo percall      # Run by keyword
 *   npm run demo all          # Run all demos in sequence
 */

import { createLogger } from "./lib/logger.js";

interface Demo {
  number: number;
  name: string;
  title: string;
  description: string;
  file: string;
  keywords: string[];
}

const DEMOS: Demo[] = [
  {
    number: 0,
    name: "onboarding",
    title: "Full Agent Onboarding",
    description:
      "EOA → AA wallet deployment → agent NFT → session key → funded vault",
    file: "./00-onboarding.js",
    keywords: ["onboard", "setup", "init", "register", "agent", "wallet", "session", "fund"],
  },
  {
    number: 1,
    name: "percall-payment",
    title: "Per-Call Payment with x402",
    description:
      "Value proposition: programmable micropayments with EIP-712 receipts",
    file: "./01-percall-payment.js",
    keywords: ["percall", "x402", "receipt", "payment", "basic"],
  },
  {
    number: 2,
    name: "session-bound-channel",
    title: "Session-Bound Channel Architecture",
    description:
      "Architectural differentiator: channels constrained by session limits",
    file: "./02-session-bound-channel.js",
    keywords: ["session", "channel", "bound", "architecture", "constraint"],
  },
  {
    number: 3,
    name: "batch-channel-flow",
    title: "Batch Channel Flow",
    description: "Stateful reuse: off-chain batched calls with local state",
    file: "./03-batch-channel-flow.js",
    keywords: ["batch", "channel", "flow", "stateful", "reuse"],
  },
  {
    number: 4,
    name: "stream-channel-flow",
    title: "Stream Channel Flow",
    description: "Time-governed execution: scheduled calls within time window",
    file: "./04-stream-channel-flow.js",
    keywords: ["stream", "channel", "time", "scheduled", "window"],
  },
  {
    number: 5,
    name: "channel-settlement",
    title: "Channel Settlement and Finalization",
    description: "Closure semantics: cooperative and force-close scenarios",
    file: "./05-channel-settlement.js",
    keywords: ["settlement", "finalize", "close", "cooperative", "force"],
  },
  {
    number: 6,
    name: "multi-provider-agent",
    title: "Multi-Provider Agent Workflow",
    description: "Scalability: one agent identity across many providers",
    file: "./06-multi-provider-agent.js",
    keywords: ["multi", "provider", "agent", "scalability", "identity"],
  },
  {
    number: 7,
    name: "observability",
    title: "Observability and Transparency",
    description:
      "Transparency: indexer queries, local state inspection, usage tracking",
    file: "./07-observability.js",
    keywords: ["observability", "transparency", "indexer", "query", "usage"],
  },
  {
    number: 9,
    name: "aa-onboard-session",
    title: "AA Onboarding and Session Rule Flow",
    description:
      "EOA onboarding, session constraints, and sponsored AA user operation",
    file: "./bkp.js",
    keywords: ["aa", "bkp", "smoke", "sponsored", "gasless", "transfer"],
  },
];

function printHelp() {
  const logger = createLogger();
  logger.header(
    "🚀 Kite Agent Pay Demo Suite",
    "Progressive narrative demonstrating protocol capabilities"
  );

  console.log("Available demos:\n");
  for (const demo of DEMOS) {
    console.log(`  ${demo.number}. ${demo.title}`);
    console.log(`     ${demo.description}`);
    console.log(`     Keywords: ${demo.keywords.join(", ")}\n`);
  }

  console.log("\nUsage:");
  console.log("  npm run demo              # Show this help");
  console.log("  npm run demo 1            # Run demo by number");
  console.log("  npm run demo percall      # Run demo by keyword");
  console.log("  npm run demo all          # Run all demos in sequence\n");
}

async function runDemo(demo: Demo): Promise<boolean> {
  const logger = createLogger();
  logger.separator();
  console.log(`🎬 Running Demo ${demo.number}: ${demo.title}`);
  logger.separator();

  try {
    const module = await import(demo.file);
    if (typeof module.run === "function") {
      await module.run();
      return true;
    } else {
      logger.error(`Demo ${demo.file} does not export a 'run' function`);
      return false;
    }
  } catch (err: any) {
    logger.error(`Failed to run demo ${demo.number}: ${err.message}`);
    if (err.stack) {
      console.error(err.stack);
    }
    return false;
  }
}

async function runAll(): Promise<void> {
  const logger = createLogger();
  logger.header(
    "🎬 Running All Demos",
    "Progressive narrative from basic to advanced"
  );

  const results: Array<{ demo: Demo; success: boolean }> = [];

  for (const demo of DEMOS) {
    const success = await runDemo(demo);
    results.push({ demo, success });

    if (!success) {
      logger.warn(`Demo ${demo.number} failed, continuing to next demo...`);
    }

    // Brief pause between demos
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // Summary
  logger.separator();
  console.log("📊 Demo Suite Summary:\n");
  for (const { demo, success } of results) {
    const status = success ? "✅ PASS" : "❌ FAIL";
    console.log(`  ${status}  Demo ${demo.number}: ${demo.title}`);
  }
  logger.separator();

  const passed = results.filter((r) => r.success).length;
  const total = results.length;
  console.log(`\n${passed}/${total} demos passed\n`);

  if (passed < total) {
    process.exit(1);
  }
}

function findDemo(query: string): Demo | undefined {
  const normalized = query.toLowerCase().trim();

  // Try by number first
  const number = Number.parseInt(normalized, 10);
  if (!Number.isNaN(number)) {
    return DEMOS.find((d) => d.number === number);
  }

  // Try by exact name
  const byName = DEMOS.find((d) => d.name === normalized);
  if (byName) return byName;

  // Try by keyword match
  return DEMOS.find((d) =>
    d.keywords.some((k) => k.includes(normalized) || normalized.includes(k))
  );
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printHelp();
    return;
  }

  const query = args[0];

  if (query === "all") {
    await runAll();
    return;
  }

  const demo = findDemo(query);
  if (!demo) {
    console.error(`❌ Demo not found: "${query}"\n`);
    printHelp();
    process.exit(1);
  }

  const success = await runDemo(demo);
  process.exit(success ? 0 : 1);
}

try {
  await main();
} catch (err) {
  console.error("Fatal error:", err);
  process.exit(1);
}
