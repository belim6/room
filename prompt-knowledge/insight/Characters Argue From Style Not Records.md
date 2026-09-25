---
type: concept
date: 2026-09-24
tags:
  - concept
  - model-behavior
  - reasoning
  - room
evidence: observed
confidence: 435 trials at one checkpoint; regex counts are lower bounds
ai-first: true
---

## For future Claude

Deniz's reaction to Werewolf game 2 was "it was all pretend-reasoning". This note records what the experiments found about that.

## The observation

At the Day 2 vote in game 2, one piece of evidence separates the wolves from the villagers: **who voted to eliminate Deniz *after* he claimed seer** (Ceryn, Elorin and Ilya did; Ilya was a villager). Everyone else's arguments were style reads: "distance-then-pile", "a vote that never got a second look", "shapes".

Across all 435 experiment trials of Alexandra's vote ([[Room Ledger]], Exp1–Exp5):

- **Replies citing vote timing:** at least 5.
- **Reasoning traces mentioning it:** at least 29.
- **Wolf votes: 6 in total.** Both of Exp1's wolf votes cited timing.

The reasoning *notices* the record about 6 times as often as the reply *uses* it. When a reply does use it, the vote is disproportionately correct.

## What didn't fix it

Instructing her to "state the deduction behind it … using what is known (revealed roles, who voted for whom)" didn't raise the rate of timing-based votes at n = 20 ([[Exp2 Deduction Before Vote Replication]]). Asking for reasoning out loud changed the form of the reply, not its source of evidence.

## Two readings (untested)

1. **Salience.** The vote record is scattered across a long transcript as prose, while the style arguments are fresh, repeated and quotable. Characters reason from what the transcript makes salient ([[Examples Beat Descriptions]], [[Transcripts Grow Their Own Vocabulary]]).
2. **Capability.** Reconstructing "who did what before or after what" from a transcript is hard for this model at this reasoning length.

**Test:** give the moderator's vote-call announcement a structured vote log (who voted whom, and whether before or after the seer claim). If the rate of timing-based votes jumps, the answer is salience, and it's fixable with presentation. If it doesn't, it's capability. Item 2 in the report's next steps.

## Related

- [[Room Ledger]] (hub) · [[2026-09-24 Werewolf Experiment Series]]
- [[Verifiable Instructions Beat Easy Instructions]]: a structured record is the "verifiable" form of the evidence.
- [[Context Can Imply A Competing Task]]: the transcript demonstrates *arguing about style* as the activity.
