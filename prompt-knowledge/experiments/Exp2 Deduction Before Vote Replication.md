---
type: experiment
date: 2026-09-24
tags:
  - experiment
  - room
  - werewolf
  - replication
evidence: refuted
verdict: prediction not supported
room:
  experiment: f014d360-65c1-4eea-a941-5944e991a3ef
  base: be558803 (Werewolf · game 2) @ revision 1f7b27db
  observations: a9a5a183 (result), b2deeac5 (reasoning-length analysis)
ai-first: true
---

## For future Claude

A pre-registered replication of [[Exp1 Deduction Before Vote]], conditions A and C only, at n = 20. It failed, and the failure turned out more informative than Exp1's success: it exposed provider drift and a link between reasoning length and votes.

## Design

The same fork point, speaker, model, temperature and rules text as Exp1. 20 trials each for A (control) and C (deduction before vote). The requests were checked to be byte-identical to Exp1's.

**Pre-registered prediction:** C votes an actual wolf more often than A, one-sided Fisher exact p < 0.05. If not, Exp1's C result is treated as sampling noise.

## Results

| Condition | Votes | Wolf | Median completion tokens |
|---|---|---|---|
| A control | Jonas 17, Rook 3 | 0/20 | 1,016 (Exp1: 1,411) |
| C deduction first | Jonas 19, Rook 1 | 0/20 | 815 (Exp1: 1,413) |

- **Timing:** no reply cited vote timing, and 1 of the 40 reasoning traces mentioned it.
- **Cost and duration:** ≤ $0.07, about 2 minutes. OpenGateway billing for 24 Sep: 63 requests, $0.07. That matches exactly the 40 Exp2 trials plus 23 direct probe calls ([[Probe OpenGateway Reasoning Effort]]), so ~0.1¢ per DeepSeek call. Claude had first estimated ~$1 by extrapolating from a running total; that was wrong.

## Verdict

**Refuted.** The deduction instruction had no measurable effect at n = 20.

**But Exp1's C vs Exp2's C is itself unlikely** under a shared rate: 2/5 vs 0/20, Fisher p ≈ 0.03. With identical requests on our side, the difference was provider-side: reasoning length roughly halved between the runs. That led to:
- [[Provider Behavior Drifts Under Identical Requests]]
- [[Short Reasoning Joins The Pile]]
- the reasoning-length columns and the no-pooling rule in `EXPERIMENTS_SPEC.md` §8–9.

## Next

Branch this experiment, per spec §8, with C = `Alexandra.reasoning: off`. That turns the correlational finding into a manipulation, at least in the off direction. See [[Probe OpenGateway Reasoning Effort]] for why "longer" can't be set on this provider.

## Related

- [[Room Ledger]] (hub) · [[Exp1 Deduction Before Vote]] · [[Vote Piles Pull Late Voters]]
