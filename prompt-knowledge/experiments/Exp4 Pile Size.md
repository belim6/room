---
type: experiment
date: 2026-09-24
tags:
  - experiment
  - room
  - werewolf
  - herding
evidence: tested
verdict: primary narrowly missed (p = 0.052); secondaries support a pile effect
room:
  experiments: P0 b4fea448 · P2 6929b385 · P4 f1c53370 (siblings, branched from Exp3 c1e425bc)
  base: be558803 (Werewolf · game 2) @ P0 505f5fb7 · P2 215e81ce · P4 1f7b27db
ai-first: true
---

## For future Claude

A dose-response test for [[Vote Piles Pull Late Voters]]: does the number of votes already on Jonas change how often Alexandra votes Jonas, with the discussion held fixed? It's three sibling experiments because a Room experiment has a single fork point. They ran concurrently, so provider drift hit all of them alike. They were the first experiments to run in their own workspaces, and added no branches to game 2.

## Design

- **Fork points** in game 2's Day 2 vote:
  - **P0:** the moderator has just opened voting. No votes yet.
  - **P2:** Jonas 2, Rook 1.
  - **P4:** Jonas 4, Rook 1. The same point as Exp1–3.
- **Conditions,** copied from Exp3: A_control, and R_off (reasoning off). 30 trials per condition per point, 180 in total.

**Pre-registered primary:** in A, Jonas at P4 > Jonas at P0 (one-sided Fisher exact, p < 0.05). If the rates were equal, the Jonas vote would come from the argument, not the pile.

**Recorded confound:** at P0 and P2, Alexandra votes before players the moderator listed ahead of her.

## Results (Jonas votes / 30)

| Point | A_control | R_off | A median tokens |
|---|---|---|---|
| P0 | 16 (Rook 14) | 24 (Rook 6) | 774 |
| P2 | 26 (Rook 3, Ceryn 1) | 27 (3 replies gave no vote) | 1,014 |
| P4 | 23 (Rook 7) | **30** | 986 |

- **Primary, A P4 > P0:** p = **0.052**. **Not met** at the pre-registered threshold.
- **Secondary tests** (not pre-registered as primary):
  - A P2 > P0: p = 0.005.
  - R_off P4 > P0: p = 0.012.
  - At P0, R_off votes Jonas more than A does: p = 0.027.
- **Not monotonic** in A: P2 is 87% and P4 is 77% (p = 0.25, compatible with noise).

## Verdict

**The pre-registered test narrowly failed.** It doesn't count as established, however close 0.052 is: moving the threshold after the fact is exactly what pre-registration exists to prevent.

The picture across all cells still points one way: with no votes cast, Alexandra splits almost evenly between Jonas and Rook. Once any votes exist, she votes Jonas in roughly 80% of trials. The evidence *for* a pile effect comes from secondary tests. A pre-registered rerun with more trials, or pooling P2 and P4 against P0 as a new primary, would settle it.

**What reasoning adds:** with reasoning off, she already leans toward Jonas at P0 (24/30), and reaches 30/30 once the pile is at 4. Without reasoning, the model takes the most salient argument ("his vote went to a man the seer cleared"), and the pile then makes it unanimous. With reasoning on, Rook stays a live alternative until votes accumulate.

**Drift again:** A's median tokens here (774–1,014) are well below Exp3's control a few hours earlier (1,457). That's why the family ran concurrently, and why its numbers shouldn't be compared directly with Exp3's.

**Format note:** 3 R_off replies at P2 never stated a vote. Reasoning off occasionally drops the answer format.

## Related

- [[Room Ledger]] (hub) · [[Vote Piles Pull Late Voters]] · [[Exp3 Reasoning Off]] · [[Short Reasoning Joins The Pile]] · [[Provider Behavior Drifts Under Identical Requests]]
