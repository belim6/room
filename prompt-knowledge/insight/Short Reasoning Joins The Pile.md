---
type: concept
date: 2026-09-24
tags:
  - concept
  - model-behavior
  - reasoning
  - room
evidence: tested
confidence: reasoning-off manipulation p ≈ 9e-5 at one checkpoint (Exp3); length-as-dial still untested
ai-first: true
---

## For future Claude

Found while explaining why [[Exp1 Deduction Before Vote]] and [[Exp2 Deduction Before Vote Replication]] disagreed, and Deniz asked the right question: "isn't everything the same? what explains this result". Started as a correlation; the off direction was then tested in [[Exp3 Reasoning Off]].

## The observation

Pooling Exp1 and Exp2 (55 trials of Alexandra's vote, same checkpoint and model) by the number of completion tokens the model generated, which is mostly hidden reasoning:

| Completion tokens | n | Broke from the pile | Voted a wolf |
|---|---|---|---|
| < 900 | 27 | **0** | 0 |
| 900–1,300 | 12 | 2 | 0 |
| 1,300–1,800 | 7 | 2 | 1 |
| > 1,800 | 9 | **4** | 1 |

Every short run voted with the pile. Both wolf votes came from long runs, one of them at about 12,000 tokens. Exp1 happened to run while the provider was producing roughly twice as much reasoning ([[Provider Behavior Drifts Under Identical Requests]]), which is enough to explain its better-looking result.

## Two readings

1. **Thinking longer finds the less obvious answer.** A short think stops at the most salient conclusion, and the pile *is* the most salient conclusion.
2. **Deciding to deviate produces a longer justification.** The decision comes first, and the length follows it.

Both fit the table. Reading 1 predicts that turning reasoning off drives the pile rate to ~100%. Reading 2 predicts only a weaker effect. Neither can be dialed up on the current provider ([[Probe OpenGateway Reasoning Effort]]).

## Tested (2026-09-24): [[Exp3 Reasoning Off]]

Reasoning turned **off** meant Alexandra joined the pile **40/40**. With it on, the pile rate was 28/40 (12 broke away). One-sided Fisher p ≈ 9.3 × 10⁻⁵. Reading 2 alone can't produce this, so reasoning is causally involved in deviating at this checkpoint.

What's still open:
- **Is length the dial?** Thinking-off may be a different mode, not just less thinking. Testing length needs a provider with working effort levels.
- **The earlier pattern was too clean.** Exp3's control had 2/11 short runs (< 900 tokens) break from the pile, so the Exp1+Exp2 table above overstated it.

## Why it matters beyond Werewolf

If reading 1 holds, a character's independence from the room is partly a *compute budget*, not only a personality. The same persona prompt would produce a conformist at low reasoning and an independent thinker at high reasoning. That would be a confound in every persona comparison that doesn't record reasoning length, which is why the Room spec now does (§9).

## Related

- [[Room Ledger]] (hub) · [[Vote Piles Pull Late Voters]]
- [[Critic Personas Debug Personalities]]: independence "has to be paid for". This note suggests one currency is reasoning tokens.
