import { formatUnits } from "viem";
import { KitePaymentClient } from "../../../client.js";
import { DecisionMode, SessionRules } from "../../../decide.js";
import { PaymentRequest, PaymentResult } from "../../../types.js";
import {
  prompt,
  type TokenMetadata,
} from "../../../utils/index.js";

/** First offer extracted from a 402 response's `accepts[]` array. */
export interface PayOffer {
  payTo: `0x${string}`;
  asset: `0x${string}`;
  maxAmountRequired: string;
  /** Provider's declared ceiling across all their endpoints. */
  maxRatePerCall?: string;
  scheme: string;
  description?: string;
  merchantName?: string;
  resource?: string;
}

/** Shared options threaded through batch/stream flows. */
export interface ChannelFlowOpts {
  client: KitePaymentClient;
  url: string;
  token: TokenMetadata | null;
  decide: DecisionMode | undefined;
  defaultRules: SessionRules;
  onPayment: (r: PaymentResult) => void;
  maxCalls: number;
  durationSecs: number;
  ratePerCallOverride?: bigint;
  depositOverride?: bigint;
  agentIndex?: number;
  eoaAddress?: string;
  sessionKeyAddress?: `0x${string}`;
  sessionRemainingSeconds?: number;
  sessionRemainingCapacity?: bigint;
}

export function clampChannelOpenToSession(
  requestedDurationSecs: number,
  requestedDeposit: bigint,
  opts: ChannelFlowOpts,
): { durationSecs: number; deposit: bigint } {
  const remainingSeconds = opts.sessionRemainingSeconds;
  const remainingCapacity = opts.sessionRemainingCapacity;

  if (remainingSeconds === undefined || remainingCapacity === undefined) {
    return {
      durationSecs: requestedDurationSecs,
      deposit: requestedDeposit,
    };
  }

  if (remainingSeconds <= 0) {
    throw new Error(
      "Selected session is expired or has no remaining validity window.",
    );
  }

  if (remainingCapacity <= 0n) {
    throw new Error(
      "Selected session has no remaining spend capacity for opening a channel.",
    );
  }

  const durationSecs = Math.min(requestedDurationSecs, remainingSeconds);
  const deposit =
    requestedDeposit > remainingCapacity ? remainingCapacity : requestedDeposit;

  if (durationSecs < requestedDurationSecs) {
    console.log(
      `  Session window cap: requested ${requestedDurationSecs}s, using ${durationSecs}s.`,
    );
  }
  if (deposit < requestedDeposit) {
    console.log(
      `  Session capacity cap: requested ${requestedDeposit.toString()} base units, using ${deposit.toString()}.`,
    );
  }

  if (deposit <= 0n) {
    throw new Error(
      "Effective deposit is zero after applying session capacity limits.",
    );
  }

  return { durationSecs, deposit };
}

export async function promptForPayment(req: PaymentRequest): Promise<boolean> {
  console.log("");
  console.log("── Payment Required ──────────────────────────────────────");
  console.log(`  Service:     ${req.url}`);
  console.log(`  Amount:      ${req.price.toString()} USDT`);
  console.log(`  Pay To:      ${req.payTo}`);
  console.log(`  Asset:       ${req.asset}`);
  console.log(`  Scheme:      ${req.scheme}`);
  if (req.description) console.log(`  Description: ${req.description}`);
  if (req.merchantName) console.log(`  Merchant:    ${req.merchantName}`);
  console.log("──────────────────────────────────────────────────────────");
  console.log("");

  const answer = await prompt("  Approve payment? (yes/no): ");
  return answer === "yes" || answer === "y";
}

export function formatReceipt(
  result: PaymentResult,
  url: string,
  responseBody?: any,
): string {
  let lines = [
    "",
    "── Payment Receipt ───────────────────────────────────────",
    `  Status:      ${result.success ? "SUCCESS" : "FAILED"}`,
    `  Method:      ${result.method}`,
    `  Amount:      ${formatUnits(result.amount, 18)} USDT`,
    `  Service:     ${url}`,
  ];
  if (result.txHash) {
    lines.push(
      `  Tx Hash:     ${result.txHash}`,
      `  Explorer:    https://testnet.kitescan.ai/tx/${result.txHash}`,
    );
  }
  if (result.receipt?.sessionId) {
    lines.push(
      `  Session:     ${result.receipt.sessionId}`,
      `  Nonce:       ${result.receipt.nonce}`,
      `  Provider:    ${result.receipt.provider}`,
      `  Consumer:    ${result.receipt.consumer}`,
    );
  }
  lines.push(`  Timestamp:   ${new Date().toISOString()}`);
  if (responseBody?.providerSignature) {
    lines.push(
      "",
      "  Provider Receipt (EIP-712 signed):",
      `  Signer:      ${responseBody.receipt?.provider || "unknown"}`,
      `  Signature:   ${responseBody.providerSignature}`,
    );
    if (responseBody.receipt) {
      lines.push(
        `  Service:     ${responseBody.receipt.service}`,
        `  Nonce:       ${responseBody.receipt.nonce}`,
        `  Timestamp:   ${responseBody.receipt.timestamp}`,
      );
    }
  }
  lines.push("──────────────────────────────────────────────────────────", "");
  return lines.join("\n");
}

function selectOffer(
  offers: PayOffer[],
  preferredAsset?: string,
): PayOffer {
  const normalizedPreferredAsset = preferredAsset?.toLowerCase();

  const scopedOffers = normalizedPreferredAsset
    ? offers.filter(
        (offer) => offer.asset.toLowerCase() === normalizedPreferredAsset,
      )
    : offers;

  return [...scopedOffers].sort((a, b) => {
    const aAmount = BigInt(a.maxAmountRequired);
    const bAmount = BigInt(b.maxAmountRequired);
    if (aAmount < bAmount) return -1;
    if (aAmount > bAmount) return 1;
    return 0;
  })[0] ?? offers[0];
}

export async function probeApi402Offer(
  url: string,
  preferredAsset?: string,
): Promise<null | { offer: PayOffer; raw: any }> {
  const probe = await globalThis.fetch(url);
  if (probe.status !== 402) return null;

  const text = await probe.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Cannot parse 402 response body: ${text}`);
  }

  const offers = parsed.accepts as PayOffer[] | undefined;
  if (!offers || offers.length === 0) {
    throw new Error("402 response is missing accepts[]");
  }

  const offer = selectOffer(
    offers,
    preferredAsset ?? process.env.SETTLEMENT_TOKEN_ADDRESS,
  );

  return { offer, raw: parsed };
}
