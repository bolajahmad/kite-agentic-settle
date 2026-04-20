# @kite-agent-pay/sdk

Programmable payments for AI agents — SDK and CLI for the Kite Agent Pay protocol.

## Install

```bash
# SDK only
npm install @kite-agent-pay/sdk

# CLI globally
npm install -g @kite-agent-pay/sdk
```

## Quick Start (SDK)

```typescript
import { KiteSettleClient } from "@kite-agent-pay/sdk";

// Create a client from a stored credential (~/.kite-agent-pay/vars.json)
const client = await KiteSettleClient.fromStoredCredential();

// Or create with an explicit seed phrase / private key
const client = await KiteSettleClient.create({
  credential: "your seed phrase or 0x private key",
});

// Fetch a paid API endpoint — payment is handled automatically
const res = await client.fetchWithPayment("https://api.example.com/data");
const data = await res.json();

// Check wallet balance
const balance = await client.getDepositedBalance();
console.log("Deposited balance:", KiteSettleClient.formatAmount(balance));

// Deposit USDT into the AA wallet
await client.deposit("10.0"); // 10 USDT

// Withdraw funds
await client.withdraw("5.0"); // 5 USDT
```

## CLI Usage

After installing globally, the `kite` binary is available:

```bash
# One-time setup
kite init

# Check identity
kite whoami

# Wallet
kite balance
kite fund --amount 10
kite withdraw --amount 5

# Make a paid API call
kite call --url https://api.example.com/data

# Channel-based payments
kite channels open --provider 0xProviderAddress
kite channels list
kite channels close --id 0xChannelId

# Session keys
kite sessions register --agent 0 --session 0
kite sessions list

# Persist config values
kite vars set PRIVATE_KEY 0xabcdef...
kite vars get PRIVATE_KEY
kite vars list
```

## KiteSettleClient API

### Factory

```typescript
// From explicit credential
KiteSettleClient.create(options: KiteSettleClientOptions): Promise<KiteSettleClient>

// From ~/.kite-agent-pay/vars.json PRIVATE_KEY
KiteSettleClient.fromStoredCredential(options?): Promise<KiteSettleClient>

// Generate a new BIP-39 seed phrase
KiteSettleClient.generateSeedPhrase(): string
```

### Options

```typescript
interface KiteSettleClientOptions {
  credential: string;         // seed phrase or 0x private key
  config?: KiteConfig;        // chain/contract overrides
  defaultPaymentMode?: "perCall" | "channel" | "batch" | "auto";
  agentIndex?: number;        // default 0
  sessionIndex?: number;      // default 0, used for perCall mode
}
```

### Addresses

```typescript
client.eoaAddress      // string — EOA wallet address
client.address         // string — active signer (session key / agent / EOA)
client.agentAddress    // string | undefined — derived agent key address
client.sessionKeyAddress // string | undefined — derived session key address
```

### Wallet

```typescript
client.getDepositedBalance(): Promise<bigint>
client.getWalletBalance(): Promise<bigint>
client.deposit(amount: string): Promise<`0x${string}`>    // amount in USDT (e.g. "10.0")
client.withdraw(amount: string): Promise<`0x${string}`>
```

### Identity & Registration

```typescript
client.isRegistered(): Promise<boolean>
client.onboard(agentName: string, agentDescription: string, sessionConfig?: ...): Promise<void>
client.registerAgent(agentName: string, agentDescription: string): Promise<void>
client.registerSessionKey(agentIndex?: number, sessionIndex?: number): Promise<void>
client.resolveAgent(address?: string): Promise<AgentRegistration | null>
client.getAgent(agentId: string): Promise<AgentRegistration | null>
client.deriveAgent(agentIndex: number): Promise<{ address: string; privateKey: string }>
client.deriveSession(agentIndex: number, sessionIndex: number): Promise<{ address: string; privateKey: string }>
```

### Payment

```typescript
// Fetch with automatic x402 payment
client.fetchWithPayment(
  url: string,
  init?: RequestInit,
  options?: { maxCost?: string; preferMode?: string }
): Promise<Response>
```

### Channel Lifecycle

```typescript
client.openChannel(providerAddress: string, depositAmount: string): Promise<string>
client.activateChannel(channelId: string): Promise<void>
client.initiateSettlement(channelId: string, merkleRoot?: string): Promise<void>
client.finalizeChannel(channelId: string): Promise<void>
client.forceCloseChannel(channelId: string): Promise<void>
client.getChannel(channelId: string): Promise<Channel | null>
client.getSettlementState(channelId: string): Promise<SettlementState | null>
client.setChannelForProvider(channelId: string): Promise<void>
```

### Receipts

```typescript
client.submitReceipt(channelId: string, receipt: ChannelCallReceipt): Promise<void>
client.signReceiptAsProvider(receipt: ChannelCallReceipt): Promise<string>
client.verifyAndStoreReceipt(channelId: string, receipt: ChannelCallReceipt): Promise<boolean>
client.getChannelReceipts(channelId: string): Promise<ChannelCallReceipt[]>
```

### Batch Sessions

```typescript
client.startBatchSession(providerAddress: string, maxCalls: number, budget: string): Promise<string>
client.endBatchSession(sessionId: string): Promise<void>
client.getBatchSession(sessionId: string): Promise<BatchSession | null>
client.getActiveBatchSessions(): Promise<BatchSession[]>
client.canAffordBatchCall(sessionId: string, cost: string): Promise<boolean>
```

### Decision Engine

```typescript
client.decidePayment(requirement: PaymentRequirement): Promise<PaymentDecision>
client.checkPaymentRules(url: string, cost: bigint): Promise<{ allowed: boolean; reason?: string }>
```

### Usage / Analytics

```typescript
client.getUsageLogs(agentAddress?: string): Promise<UsageLog[]>
client.getTotalSpent(agentAddress?: string): Promise<bigint>
```

### Indexer (subgraph queries)

```typescript
client.getAgentsByOwner(ownerAddress?: string): Promise<IndexedAgent[]>
client.getIndexedAgent(agentAddress: string): Promise<IndexedAgent | null>
client.getSessionsByAgent(agentAddress: string): Promise<IndexedSession[]>
client.getPaymentHistory(agentAddress?: string): Promise<PaymentEvent[]>
client.getRecentPayments(limit?: number): Promise<PaymentEvent[]>
client.getSessionKeyEvents(agentAddress: string): Promise<SessionKeyEvent[]>
```

### Static Vars Store

```typescript
KiteSettleClient.getVar(key: string): string | undefined
KiteSettleClient.setVar(key: string, value: string): void
KiteSettleClient.deleteVar(key: string): boolean
KiteSettleClient.listVars(): string[]
KiteSettleClient.hasVar(key: string): boolean
KiteSettleClient.getVarsPath(): string      // path to vars.json
KiteSettleClient.getKiteDir(): string       // path to ~/.kite-agent-pay/
KiteSettleClient.resolveVar(key: string): string | undefined  // env var → vars.json fallback
```

### Token Utilities

```typescript
KiteSettleClient.formatAmount(raw: bigint, decimals?: number): string  // "10.000000"
KiteSettleClient.parseAmount(human: string, decimals?: number): bigint // bigint
KiteSettleClient.getToken(symbol?: string): TokenConfig
```

### Escape Hatches

```typescript
client.getPaymentClient(): KitePaymentClient   // underlying payment client
client.getEoaClient(): KitePaymentClient       // EOA-level client
```

## Architecture

```
Your App / AI Agent
        │
        ▼
  KiteSettleClient          ← single entry point (@kite-agent-pay/sdk)
        │
        ├── KitePaymentClient (EOA)     ← wallet ops, registration
        └── KitePaymentClient (agent/session) ← payment signing
                │
                ├── ContractService    ← on-chain calls (viem)
                ├── ChannelManager     ← channel lifecycle
                ├── BatchManager       ← batch sessions
                ├── ReceiptStore       ← off-chain receipts
                └── DecisionEngine     ← payment routing logic
```

## Environment

Set via `kite vars set KEY value` or directly in `~/.kite-agent-pay/vars.json`:

| Key | Description |
|-----|-------------|
| `PRIVATE_KEY` | EOA private key or BIP-39 seed phrase |
| `KITE_RPC_URL` | Custom RPC endpoint (optional) |
| `KITE_REGISTRY_ADDRESS` | Custom registry contract (optional) |

## License

ISC
