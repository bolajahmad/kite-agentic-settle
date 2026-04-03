export class UsageTracker {
    logs = [];
    log(entry) {
        this.logs.push(entry);
    }
    getLogs() {
        return [...this.logs];
    }
    getLogsByChannel(channelId) {
        return this.logs.filter((l) => l.channelId === channelId);
    }
    getTotalSpent() {
        return this.logs.reduce((sum, l) => sum + l.amount, 0n);
    }
    getCount() {
        return this.logs.length;
    }
    clear() {
        this.logs = [];
    }
}
