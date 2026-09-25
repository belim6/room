---
type: experiment
date: 2026-09-24
tags:
  - experiment
  - room
  - werewolf
  - herding
  - replication
evidence: refuted
verdict: primary not met (p = 0.078); second consecutive miss
room:
  experiments: P0 3a1ac41f · P2 5e28d7f7 · P4 e54771f0 (branched from the Exp4 siblings)
  base: be558803 (Werewolf · game 2) @ P0 505f5fb7 · P2 215e81ce · P4 1f7b27db
ai-first: true
---

## For future Claude

A pre-registered rerun to settle [[Exp4 Pile Size]], whose primary test narrowly missed (p = 0.052). Reasoning on only. It ran concurrently in its own workspaces.

## Design

- **No pile:** P0, 60 trials.
- **Pile:** P2 and P4, 30 each, pooled as decided in advance. Pooling is allowed here because they ran in one concurrent window.
- **Primary:** Jonas rate with a pile > with no pile (one-sided Fisher exact, p < 0.05).
- **Protocol deviation, logged before any P0 result:** the app caps runs at 50 per condition, so P0 ran as 50 plus a resumed 10. The resumed 10 went 6/10 Jonas, consistent with the first 50 (33/50).

## Results

| Point | Jonas | Others | Median completion tokens |
|---|---|---|---|
| P0 (no votes) | **39/60** (65%) | Rook 20, Elorin 1 (wolf) | 716 |
| P2 | 22/30 | Rook 7, Ceryn 1 (wolf) | 1,378 |
| P4 | 25/30 | Rook 5 | 988 |
| Pile, pooled | **47/60** (78%) | | |

- **Primary:** p = **0.078**, **not met.**
- **Secondary:** P4 vs P2, p = 0.27.

## Verdict

**Two pre-registered misses in a row.** The direction is consistent (no pile 65% → pile 78%), but the effect is about 13 points, much smaller than Exp4's secondary tests suggested. Exp4's no-pile cell (53%) was probably on the low side. That's the usual pattern: the result that prompts a replication tends to overstate the effect.

**What stands:** at this point in the game, **most of the Jonas vote is reached by argument.** With no votes cast at all, Alexandra already votes Jonas about 65% of the time. A pile adds, at most, a modest amount. The label "herding" in [[Vote Piles Pull Late Voters]] overstated it.

**Worth following up:** median reasoning length differed by fork point, at 716 / 1,378 / 988 tokens. The same model, run concurrently, thought for about twice as long at P2 as at P0. Seeing a split vote (Jonas 2, Rook 1) may prompt more deliberation than seeing no votes. That's unplanned and untested.

## Related

- [[Room Ledger]] (hub) · [[Exp4 Pile Size]] · [[Vote Piles Pull Late Voters]]
