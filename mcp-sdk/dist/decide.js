// 3-tier payment decision cascade: Rules -> Cost Model -> LLM
// Each tier returns "approve", "reject", or "unclear" (pass to next tier).
// Tier 1: Rule-based checks
export function checkRules(ctx) {
    const { request, rules, totalSpentThisSession } = ctx;
    // Check per-call limit
    const maxPerCall = BigInt(rules.maxPerCall);
    if (maxPerCall > 0n && request.price > maxPerCall) {
        return { decision: "reject", reason: `Price ${request.price} exceeds per-call limit ${maxPerCall}` };
    }
    // Check session budget
    const maxPerSession = BigInt(rules.maxPerSession);
    if (maxPerSession > 0n && totalSpentThisSession + request.price > maxPerSession) {
        return { decision: "reject", reason: `Would exceed session budget (${totalSpentThisSession + request.price} > ${maxPerSession})` };
    }
    // Check blocked providers
    if (rules.blockedProviders.length > 0) {
        const payToLower = request.payTo.toLowerCase();
        if (rules.blockedProviders.some((p) => p.toLowerCase() === payToLower)) {
            return { decision: "reject", reason: `Provider ${request.payTo} is blocked` };
        }
    }
    // Check allowed providers (if set, only these are allowed)
    if (rules.allowedProviders.length > 0) {
        const payToLower = request.payTo.toLowerCase();
        if (!rules.allowedProviders.some((p) => p.toLowerCase() === payToLower)) {
            return { decision: "reject", reason: `Provider ${request.payTo} not in allowlist` };
        }
    }
    // Auto-approve if under the approval threshold
    const approvalThreshold = BigInt(rules.requireApprovalAbove);
    if (approvalThreshold > 0n && request.price <= approvalThreshold) {
        return { decision: "approve", reason: "Within auto-approve threshold" };
    }
    return { decision: "unclear" };
}
// Tier 2: Cost model — balance check and historical analysis
export function checkCostModel(ctx) {
    const { request, balance, totalSpentThisSession, callCount } = ctx;
    // Hard reject: insufficient balance
    if (request.price > balance) {
        return { decision: "reject", reason: `Insufficient balance: need ${request.price}, have ${balance}` };
    }
    // If balance after payment would be < 10% of what we started with, flag it
    const sessionStart = balance + totalSpentThisSession;
    const afterPayment = balance - request.price;
    if (sessionStart > 0n && afterPayment * 10n < sessionStart) {
        return { decision: "unclear", reason: "Payment would leave < 10% of session starting balance" };
    }
    // If we've paid many times this session, approve (recurring pattern = trusted)
    if (callCount >= 3) {
        const avgCost = totalSpentThisSession / BigInt(callCount);
        // If this call costs roughly the same as average, approve
        if (request.price <= avgCost * 2n) {
            return { decision: "approve", reason: `Consistent with session avg cost (${callCount} prior calls)` };
        }
    }
    // Small relative to balance = approve
    if (balance > 0n && request.price * 100n <= balance) {
        return { decision: "approve", reason: "Cost < 1% of balance" };
    }
    return { decision: "unclear" };
}
// Tier 3: LLM fallback — asks an AI model for a binary decision
export async function askLLM(ctx) {
    if (!ctx.openaiApiKey) {
        return { decision: "unclear", reason: "No OpenAI API key configured" };
    }
    try {
        const { generateText } = await import("ai");
        const { openai } = await import("@ai-sdk/openai");
        const prompt = `You are a payment approval agent. Decide whether to approve or reject this payment.

Payment details:
- URL: ${ctx.request.url}
- Price: ${ctx.request.price.toString()} wei
- Pay to: ${ctx.request.payTo}
- Merchant: ${ctx.request.merchantName || "unknown"}
- Description: ${ctx.request.description || "none"}

Agent context:
- Current balance: ${ctx.balance.toString()} wei
- Total spent this session: ${ctx.totalSpentThisSession.toString()} wei
- Call count this session: ${ctx.callCount}

Respond with exactly one word: APPROVE or REJECT, followed by a brief reason on the next line.`;
        const result = await generateText({
            model: openai(ctx.model || "gpt-4o-mini"),
            prompt,
            maxOutputTokens: 100,
        });
        const text = result.text.trim();
        const firstLine = text.split("\n")[0].trim().toUpperCase();
        const reason = text.split("\n").slice(1).join(" ").trim() || "LLM decision";
        if (firstLine.startsWith("APPROVE")) {
            return { decision: "approve", reason };
        }
        else if (firstLine.startsWith("REJECT")) {
            return { decision: "reject", reason };
        }
        return { decision: "unclear", reason: `LLM returned ambiguous response: ${firstLine}` };
    }
    catch (err) {
        return { decision: "unclear", reason: `LLM error: ${err.message}` };
    }
}
// Run the full cascade. Returns a final approve/reject decision.
export async function decide(ctx, mode = "auto") {
    // CLI mode: always defer to interactive prompt (handled by caller)
    if (mode === "cli") {
        return { decision: "approve", reason: "CLI mode — deferred to interactive prompt", tier: "cli" };
    }
    // Tier 1: Rules
    const rulesResult = checkRules(ctx);
    if (rulesResult.decision !== "unclear") {
        return {
            decision: rulesResult.decision,
            reason: rulesResult.reason || "Rule-based decision",
            tier: "rules",
        };
    }
    if (mode === "rules") {
        // Rules-only mode: if rules are unclear, default to reject
        return { decision: "reject", reason: "Rules inconclusive, defaulting to reject", tier: "rules" };
    }
    // Tier 2: Cost model
    const costResult = checkCostModel(ctx);
    if (costResult.decision !== "unclear") {
        return {
            decision: costResult.decision,
            reason: costResult.reason || "Cost model decision",
            tier: "cost",
        };
    }
    // Tier 3: LLM (only in ai or auto mode)
    if (mode === "ai" || mode === "auto") {
        const llmResult = await askLLM(ctx);
        if (llmResult.decision !== "unclear") {
            return {
                decision: llmResult.decision,
                reason: llmResult.reason || "LLM decision",
                tier: "llm",
            };
        }
    }
    // All tiers inconclusive — default to reject (safe default)
    return { decision: "reject", reason: "All decision tiers inconclusive", tier: "rules" };
}
