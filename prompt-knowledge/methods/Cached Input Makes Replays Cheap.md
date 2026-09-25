---
type: concept
date: 2026-09-24
tags:
  - concept
  - systems
  - experiments
  - cost
evidence: observed
confidence: measured on one experiment (Exp2); billing matched the estimate
ai-first: true
---

## For future Claude

Deniz, 2026-09-24: "running experiments is cheap because cached input is cheap. we should make use of this." Checked against Exp2's usage records: true for input, and output then dominates.

## Prices (OpenGateway, `deepseek-v4.1-flash-ultrafast`, 24 Sep 2026)

$0.30 / 1M input · $0.006 / 1M cached input (50× cheaper) · $1.20 / 1M output.

## Measured on [[Exp2 Deduction Before Vote Replication]]

- **Prompt size:** 40 calls, about 4,200 prompt tokens each (persona + rules + 35-message transcript).
- **Cache hits:** **92% of prompt tokens were cached.** Every trial after the first in a condition reused a 4,096-token prefix. Only the first call per condition missed.
- **Cost:** estimated $0.065, and billed $0.07 for the day, including 23 tiny probe calls. Without the cache it would have been ~$0.11.
- **Output is 92% of the remaining cost.** Hidden reasoning is the bill.

## Consequences

1. **Replaying long checkpoints is nearly free** on the input side. Never truncate context to save money.
2. **More trials per condition make each trial cheaper.** Only the first call pays full input price.
3. **The cost lever is output.** Reasoning off (Room spec §7) would cut roughly 90%. It's also a behavioral variable ([[Short Reasoning Joins The Pile]]), so a cost optimization and an experimental condition are the same switch here.
4. **Don't reorder prompts to improve cross-condition caching.** Position is itself a variable ([[Position Effects In Long Prompts]]), and at ≥ 20 trials per condition one miss per condition is negligible.
5. **Cached-token counts are in each response's usage** (`prompt_tokens_details.cached_tokens`), so per-trial cost can be computed.

## Related

- [[Prompting For Systems]] · [[Room Ledger]] · [[Preloaded Context Taxes Every Turn]]: the same token economy seen from the budget side. Caching changes the *price* of a preloaded prefix, not its effect on [[Position Effects In Long Prompts|attention]].
