/**
 * MCP tool definitions for Kite Agent Pay SDK
 *
 * These tools expose the SDK's capabilities so that AI agents
 * (via MCP) can discover and invoke them.
 */
import { KitePaymentClient } from "./index.js";
export interface McpToolDefinition {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}
export declare const TOOLS: McpToolDefinition[];
export declare function handleTool(client: KitePaymentClient, toolName: string, args: Record<string, unknown>): Promise<unknown>;
