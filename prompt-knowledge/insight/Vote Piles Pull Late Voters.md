---
type: concept
date: 2026-09-24
tags:
  - concept
  - model-behavior
  - multi-agent
  - room
evidence: refuted
confidence: two pre-registered dose-response tests missed (p = 0.052, 0.078); pile effect at most modest (~13 points)
ai-first: true
---

## For future Claude

A regularity from the Werewolf experiments in Room. It wasn't the pre-registered question of any experiment, so it's recorded as *observed*, even though it comes from controlled trials.

## The observation

At the Day 2 vote checkpoint in game 2 (4 votes already on Jonas, Alexandra voting fifth), Alexandra joined the pile in **47 of 55 trials (85%)**. That held across three rule variants and two runs:

| Run | Joined the pile |
|---|---|
| Exp1 A | 5/5 |
| Exp1 B | 4/5 |
| Exp1 C | 2/5 |
| Exp2 A | 17/20 |
| Exp2 C | 19/20 |

The original, uncontrolled game run also voted Jonas. Changing the brevity rule or the voting instruction didn't move the rate outside noise ([[Exp2 Deduction Before Vote Replication]]).

## What it does *not* show yet

**Joining the pile isn't necessarily herding.** At this checkpoint Jonas is a 50% wolf under a uniform prior (see the correction in [[Exp1 Deduction Before Vote]]), so a Jonas vote can be defended on the merits. The reasons given are consistent across trials: "his one vote went to a man the seer cleared, and he never revised it". That could be a genuine argument that happens to coincide with the pile. To separate "follows the pile" from "reaches the same conclusion", the pile has to vary while the evidence stays fixed.

## The test

Fork the same vote at 0, 2 and 4 prior Jonas votes, with everything before the vote unchanged. If the Jonas rate climbs with the count, the pile is doing work. If it's flat, the argument is. This is item 1 in the [[Room Ledger]] experiment queue.

## Dose-response test (2026-09-24): [[Exp4 Pile Size]]

The same discussion, forked at 0, 2 and 4 prior Jonas votes, 30 trials each, reasoning on. Jonas rate: **16/30 → 26/30 → 23/30.**
- **Primary contrast** (4 vs 0): p = 0.052, which missed the pre-registered 0.05.
- **Secondary:** 2 vs 0 gives p = 0.005.
- **Reasoning off:** 24 → 27 → 30.

**Reading:** with no pile, Alexandra is split between Jonas and Rook. Any pile pushes her to roughly 80% Jonas. So the argument makes Jonas a candidate, and the pile makes him the choice. Not established by the pre-registered test. A larger rerun is queued.

## Rerun (2026-09-24): [[Exp5 Pile Rerun]], so the title overstates it

A pre-registered rerun: no pile gave 39/60 (65%) Jonas, and a pile gave 47/60 (78%). p = 0.078, **not met.** Two misses in a row. **Most of the Jonas vote is reached by argument:** she picks him 65% of the time with no votes cast at all. A pile adds a modest amount at most. The 85% "joins the pile" figure above was mostly the argument, not the pile. The title is kept so links still work. The claim it makes is refuted at this checkpoint.

## Connections

- [[Critic Personas Debug Personalities]]: same weights converge on the same salient thought. Here, the most salient thought is the one four earlier speakers already voiced.
- [[Examples Beat Descriptions]]: four prior votes are four live examples of what a vote here looks like.
- [[Short Reasoning Joins The Pile]]: the pile-joiners skew heavily toward short reasoning runs.

## Related

- [[Room Ledger]] (hub) · [[Werewolf]]
