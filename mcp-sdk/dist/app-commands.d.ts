/**
 * Operational commands for the Kite CLI.
 *
 * Extracted so `src/cli.ts` can delegate heavy commands here
 * without loading WDK/viem for lightweight commands like `vars`.
 */
export declare function runAppCommand(command: string, args: string[]): Promise<void>;
