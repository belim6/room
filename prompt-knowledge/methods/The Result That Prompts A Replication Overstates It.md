---
type: concept
date: 2026-09-24
tags:
  - concept
  - systems
  - experiments
  - statistics
evidence: observed
confidence: 2 of 2 replications in the Werewolf series; a well-known statistical effect elsewhere
ai-first: true
---

## For future Claude

A methods lesson from the first Room experiment series. It's why pre-registered replication is standard practice in the ledger, not an optional extra.

## What happened, twice

1. **[[Exp1 Deduction Before Vote]]:** the deduction condition got 2/5 wolf votes and looked like a finding. The pre-registered replication at n = 20 got **0/20** ([[Exp2 Deduction Before Vote Replication]]).
2. **[[Exp4 Pile Size]]:** with no votes cast, Alexandra voted Jonas 16/30 (53%), making the pile look like a big effect (53% → ~80%). The pre-registered rerun found **65%** with no votes, and the effect shrank to ~13 points and missed significance ([[Exp5 Pile Rerun]]).

## Why

When a noisy estimate is chosen for follow-up *because* it looked interesting, it's selected on its luck. Extreme cells get picked, and extreme cells regress toward the mean. This is known as the winner's curse or regression to the mean. It's stronger here because the provider's reasoning length drifts between runs ([[Provider Behavior Drifts Under Identical Requests]]), which adds run-level noise on top of sampling noise.

## Rules

1. **An exciting small-n result is a reason to replicate, not a finding.** Record it as `observed` at most.
2. **Size replications for a smaller effect than the one that prompted them.** Exp5 was sized for Exp4's apparent effect and was underpowered for the real one.
3. **Pre-register the replication's primary test before running it,** and don't reuse the prompting data. Pooling it in would carry the lucky draw into the "confirmation".
4. **A narrow miss is still a miss** (p = 0.052, 0.078). Moving the threshold afterwards defeats the point of pre-registering.
5. **Cheap trials make this affordable.** Replications here cost cents ([[Cached Input Makes Replays Cheap]]), so there's no excuse to skip them.

## Related

- [[Prompting For Systems]] · [[Room Ledger]] · [[2026-09-24 Werewolf Experiment Series]]
- [[Never Give The Model Full Agency]]: the same instinct, applied to our own results. The finding that pleases you most is the one to check hardest.
