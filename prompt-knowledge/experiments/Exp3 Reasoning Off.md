---
type: experiment
date: 2026-09-24
tags:
  - experiment
  - room
  - werewolf
  - reasoning
evidence: tested
verdict: prediction supported (p ≈ 9e-5)
room:
  experiment: c1e425bc-ed80-4ecf-9f2e-e11244e724b1
  parent: Exp2 (f014d360), branched with Room's experiment branching
  base: be558803 (Werewolf · game 2) @ revision 1f7b27db
ai-first: true
---

## For future Claude

The first experiment that *manipulated* reasoning, rather than correlating with it. Branched from [[Exp2 Deduction Before Vote Replication]], and the first one run with Room's built-in experiment branching.

## Design

- **Same as Exp1 and Exp2:** fork point, speaker (Alexandra), model, temperature and rules.
- **Conditions:**
  - **A_control:** unchanged from Exp1/Exp2.
  - **R_off:** identical rules, plus `Alexandra.reasoning: off`, which sends `thinking: {type: "disabled"}`. This was verified in the dispatched request, with 0 reasoning characters returned.
- **Trials:** 40 per condition. n was raised from 20 because A already joins the pile about 85% of the time.

**Pre-registered prediction:** R_off votes someone other than Jonas less often than A (one-sided Fisher exact, p < 0.05).
- **If longer thinking finds the less obvious answer,** R_off should be near 40/40 Jonas.
- **If deviating produces a longer justification afterwards,** there should be no reliable difference.

## Results

| Condition | Votes | Off the pile | Wolf | Median completion tokens |
|---|---|---|---|---|
| A_control | Jonas 28, Rook 11, Ceryn 1 | 12/40 | 1/40 | 1,457 |
| R_off | Jonas 40 | **0/40** | 0/40 | 132 |

One-sided Fisher exact test: **p ≈ 9.3 × 10⁻⁵.** Cost: a few cents.

## Verdict

**Supported.** With reasoning off, Alexandra joined the pile every time. With reasoning on, she broke from it 30% of the time. This rules out the "justification afterwards" reading as the whole story. At this checkpoint, the ability to deviate depends on reasoning being on.

**Caveat:** disabling thinking may switch to a different generation mode rather than simply shortening the thinking. So this shows reasoning is *necessary* for deviating here. It doesn't show that reasoning *length* is the dial. That would need a provider where effort levels actually work ([[Probe OpenGateway Reasoning Effort]]).

**Drift check:** A's median of 1,457 tokens is back near Exp1's 1,411, and well above Exp2's 1,016. A's off-pile rate (30%) is double Exp2's A (15%). Both fit reasoning length following the provider's state from run to run ([[Provider Behavior Drifts Under Identical Requests]]).

**A result that complicates the earlier pattern:** within A, 2 of the 11 runs under 900 tokens broke from the pile. So the Exp1+Exp2 pattern (0/27 under 900) isn't absolute. Short runs deviate less often, but they can.

## Related

- [[Room Ledger]] (hub) · [[Short Reasoning Joins The Pile]] · [[Vote Piles Pull Late Voters]] · [[Cached Input Makes Replays Cheap]]
