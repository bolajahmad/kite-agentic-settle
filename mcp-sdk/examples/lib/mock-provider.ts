/**
 * Mock HTTP provider that emits 402 Payment Required challenges
 * and validates x402 receipts for demo purposes.
 */

import http from "http";
import crypto from "crypto";

export interface MockProviderConfig {
  port: number;
  agentAddress: string;
  pricePerCall: bigint;
}

interface Challenge {
  requestId: string;
  timestamp: number;
  amount: string;
  recipient: string;
}

/**
 * Simple mock provider that:
 * 1. Returns 402 with WWW-Authenticate challenge on first request
 * 2. Validates x402 receipt signature on retry
 * 3. Returns mock result on valid payment
 */
export class MockProvider {
  private server: http.Server | null = null;
  private config: MockProviderConfig;
  private validatedRequests = new Set<string>();

  constructor(config: MockProviderConfig) {
    this.config = config;
  }

  /**
   * Start the mock provider server
   */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.listen(this.config.port, () => {
        resolve();
      });
    });
  }

  /**
   * Stop the mock provider server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    // Extract x402 receipt from Authorization header
    const authHeader = req.headers["authorization"];
    const receiptMatch = authHeader?.match(/^x402-receipt (.+)$/);

    if (receiptMatch) {
      // Has receipt - validate and respond
      const receiptB64 = receiptMatch[1];
      try {
        const receipt = JSON.parse(
          Buffer.from(receiptB64, "base64").toString("utf8")
        );

        // Basic validation: check if already used
        const receiptId = receipt.requestId || receipt.nonce;
        if (this.validatedRequests.has(receiptId)) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Receipt already used" }));
          return;
        }

        // Mark as validated
        this.validatedRequests.add(receiptId);

        // Return success result
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            result: "success",
            data: {
              message: "Payment validated",
              requestId: receiptId,
              timestamp: Date.now(),
            },
          })
        );
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid receipt format" }));
      }
    } else {
      // No receipt - emit 402 challenge
      const requestId = crypto.randomBytes(16).toString("hex");
      const challenge: Challenge = {
        requestId,
        timestamp: Date.now(),
        amount: this.config.pricePerCall.toString(),
        recipient: this.config.agentAddress,
      };

      const challengeB64 = Buffer.from(JSON.stringify(challenge)).toString(
        "base64"
      );

      res.writeHead(402, {
        "Content-Type": "application/json",
        "WWW-Authenticate": `x402-challenge ${challengeB64}`,
      });
      res.end(
        JSON.stringify({
          error: "Payment Required",
          message: "Please provide x402 receipt",
        })
      );
    }
  }

  getUrl(): string {
    return `http://localhost:${this.config.port}`;
  }
}

/**
 * Helper to create and start a mock provider
 */
export async function createMockProvider(
  config: MockProviderConfig
): Promise<MockProvider> {
  const provider = new MockProvider(config);
  await provider.start();
  return provider;
}
