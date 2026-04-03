import type { UsageLog } from "./types.js";
export declare class UsageTracker {
    private logs;
    log(entry: UsageLog): void;
    getLogs(): UsageLog[];
    getLogsByChannel(channelId: string): UsageLog[];
    getTotalSpent(): bigint;
    getCount(): number;
    clear(): void;
}
