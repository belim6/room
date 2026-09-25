---
type: concept
date: 2026-09-24
tags:
  - concept
  - model-behavior
  - reasoning
  - room
evidence: hypothesis
confidence: unplanned pattern in two concurrent runs; confounded; not pre-registered
ai-first: true
---

## For future Claude

An unplanned side result of [[Exp4 Pile Size]] and [[Exp5 Pile Rerun]]. It's recorded as a hypothesis so that it gets tested rather than cited.

## The pattern

Median completion tokens (mostly hidden reasoning) for Alexandra's vote with reasoning on, by how many votes were already cast. Each run's three fork points ran concurrently, so provider drift hit them alike:

| Run | No votes (P0) | Jonas 2, Rook 1 (P2) | Jonas 4, Rook 1 (P4) |
|---|---|---|---|
| Exp4 | 774 | 1,014 | 986 |
| Exp5 | 716 | 1,378 | 988 |

In both runs, **having no votes on the board produced the shortest reasoning.** Whether a *split* vote (P2) is special is less consistent: it's the longest in Exp5, and about tied in Exp4.

## Why it might be real

Seeing votes gives the model more to weigh: agreeing, dissenting, or explaining a disagreement between voters. It deliberates when the social evidence needs reconciling. This would also fit [[Short Reasoning Joins The Pile]], but in the opposite direction from naive herding: the pile makes her think *more*, not less.

## Why it might not be

- **Transcript length:** P0's transcript is 2–5 messages shorter.
- **Out-of-turn voting:** at P0 she votes before anyone listed ahead of her, which may simply read as "early and informal".
- **Not pre-registered:** looking at medians after the fact invites a pattern.

## Test

Pre-register "completion tokens at P0 < P2 and P4", run concurrently. Add a P0′ control whose transcript is padded with neutral messages to P4's length, which separates *transcript length* from *votes present*.

## Related

- [[Room Ledger]] (hub) · [[2026-09-24 Werewolf Experiment Series]] · [[Provider Behavior Drifts Under Identical Requests]]
