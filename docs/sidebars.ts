import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  documentationSidebar: [
    {
      type: "category",
      label: "Introduction",
      collapsed: false,
      items: [
        "introduction/overview",
        "introduction/quickstart",
        "introduction/why-kite-agentic-pay",
      ],
    },
    {
      type: "category",
      label: "Concepts",
      items: [
        "concepts/agent-identity",
        "concepts/session-keys",
        "concepts/x402-payments",
        "concepts/payment-channels",
        "concepts/local-first-architecture",
        "concepts/mcp-and-ai-agents",
      ],
    },
    {
      type: "category",
      label: "Architecture",
      items: [
        "architecture/system-overview",
        "architecture/payment-flow",
        "architecture/session-runtime",
        "architecture/indexer-sync",
      ],
    },
    {
      type: "category",
      label: "SDK",
      items: [
        "sdk/installation",
        "sdk/client",
        "sdk/payments",
        "sdk/channels",
        "sdk/decision-engine",
      ],
    },
    {
      type: "category",
      label: "CLI",
      items: [
        "cli/overview",
        "cli/init",
        "cli/agents",
        "cli/payments",
        "cli/runtime",
      ],
    },
    {
      type: "category",
      label: "MCP Server",
      items: [
        "mcp/overview",
        "mcp/claude-desktop",
        "mcp/openai-agents",
        "mcp/langchain",
        "mcp/tool-reference",
      ],
    },
    {
      type: "category",
      label: "Payment Channels",
      items: [
        "channels/opening",
        "channels/receipts",
        "channels/settlement",
        "channels/recovery",
        "channels/local-store",
      ],
    },
    {
      type: "category",
      label: "Simulations & Demos",
      items: [
        "simulations/per-call-payment",
        "simulations/batch-flow",
        "simulations/stream-flow",
        "simulations/multi-provider",
        "simulations/session-expiry",
        "simulations/recovery",
      ],
    },
    {
      type: "category",
      label: "Backend Provider",
      items: [
        "backend/server",
        "backend/provider-api",
        "backend/mcp-server",
      ],
    },
    {
      type: "category",
      label: "Smart Contracts",
      items: [
        "smart-contracts/identity-registry",
        "smart-contracts/kite-aa-wallet",
        "smart-contracts/payment-channel",
        "smart-contracts/attestation-registry",
      ],
    },
    {
      type: "category",
      label: "Indexer",
      items: [
        "indexer/overview",
        "indexer/entities",
        "indexer/querying",
        "indexer/deployment",
      ],
    },
    {
      type: "category",
      label: "Security",
      items: [
        "security/threat-model",
        "security/session-security",
        "security/tradeoffs",
      ],
    },
    {
      type: "category",
      label: "Guides",
      items: [
        "guides/build-an-agent",
        "guides/connect-claude",
        "guides/build-a-paid-api",
        "guides/run-local-demo",
        "guides/deploy-provider",
      ],
    },
    {
      type: "category",
      label: "Deployment",
      items: [
        "deployment/local-dev",
        "deployment/testnet",
        "deployment/production",
        "deployment/indexer",
      ],
    },
    {
      type: "category",
      label: "Reference",
      items: [
        "reference/sdk-api",
        "reference/cli-commands",
        "reference/tool-schemas",
        "reference/contracts",
      ],
    },
    {
      type: "category",
      label: "FAQ",
      items: ["faq/index"],
    },
  ],
};

export default sidebars;
