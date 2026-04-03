import type { UsageLog } from "./types.js";

export class UsageTracker {
  private logs: UsageLog[] = [];

  log(entry: UsageLog): void {
    this.logs.push(entry);
  }

  getLogs(): UsageLog[] {
    return [...this.logs];
  }

  getLogsByChannel(channelId: string): UsageLog[] {
    return this.logs.filter((l) => l.channelId === channelId);
  }

  getTotalSpent(): bigint {
    return this.logs.reduce((sum, l) => sum + l.amount, 0n);
  }

  getCount(): number {
    return this.logs.length;
  }

  clear(): void {
    this.logs = [];
  }
}
