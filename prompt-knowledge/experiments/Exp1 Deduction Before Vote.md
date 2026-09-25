---
type: experiment
date: 2026-09-23
tags:
  - experiment
  - room
  - werewolf
evidence: tested
verdict: inconclusive, superseded by Exp2
room:
  experiment: 15736e0b-fb6c-44cb-9502-07ccdbff7b3a
  base: be558803 (Werewolf · game 2) @ revision 1f7b27db
  preregistration: observation 266cbbdb (2026-09-23T22:49:00Z)
ai-first: true
---

## For future Claude

The first controlled experiment run in Room. The result looked positive, then failed to replicate: [[Exp2 Deduction Before Vote Replication]]. Read both before citing either.

## Origin

In [[Werewolf]] game 2, Deniz noticed the characters' spoken arguments were mostly style reads ("shape", "thin", "pile") and rarely used checkable facts. Reading Alexandra's hidden reasoning before her decisive Day 2 vote showed real deduction that the spoken reply didn't carry through. She then joined a 4-vote pile on Jonas, a villager, and the village lost.

**Correction (2026-09-24):** the framing "her reasoning showed she shouldn't vote Jonas" was wrong. Her deduction, that at least one wolf is among Rook, Ceryn and Elorin, doesn't make Jonas less likely to be a wolf. With 2 wolves among {Elorin, Jonas, Ceryn, Rook} and at least one of them in that three, each of the four is 50% under a uniform prior. The informative evidence was *vote timing*: Ceryn, Elorin and Ilya voted Deniz *after* his seer claim. Room observation `6a6ad7f4`.

## Design

- **Fork point:** game 2, just before Alexandra's Day 2 vote. 4 votes were already on Jonas.
- **Speaker:** Alexandra. **Model:** `deepseek/deepseek-v4.1-flash-ultrafast`, temperature 0.7.
- **Conditions,** one line of the shared rules varied:
  - **A (control):** the original rules.
  - **B:** the rules without "Keep replies short, like speech around a table: a few sentences."
  - **C:** the voting rule becomes "first state the deduction behind it … using what is known (revealed roles, who voted for whom), then name exactly one living player."
- **Trials:** 5 per condition.

**Pre-registered prediction:** if the prompt suppresses reasoning, B and/or C vote Rook/Ceryn/Elorin more often than A.

## Results

| Condition | Votes | Wolf |
|---|---|---|
| A control | Jonas 5 | 0/5 |
| B no brevity | Jonas 4, Rook 1 | 0/5 |
| C deduction first | Jonas 2, Rook 1, Elorin 1, Ceryn 1 | 2/5 |

- **Wolf votes:** both of C's wolf votes cited vote timing, the one piece of genuinely informative evidence.
- **Significance:** Fisher exact A vs C ≈ 0.17, so this was underpowered by design.
- **Cost:** about $0.02 (estimated). OpenGateway billing for 23 Sep shows $1.49 for 102 requests, but Room recorded 37 of those as Kimi calls, which dominate the cost. At the DeepSeek rate measured on 24 Sep (~0.1¢ per call), Exp1's 15 calls cost ~2¢. The earlier figure of "$0.40" was a running total, not this experiment.

## Verdict

At the time: the direction matched the prediction, but the result wasn't significant. After [[Exp2 Deduction Before Vote Replication]]: **not replicated.** C's 2/5 was most likely an artifact of a provider-side run with long reasoning. See [[Short Reasoning Joins The Pile]] and [[Provider Behavior Drifts Under Identical Requests]].

## Related

- [[Room Ledger]] (hub) · [[Werewolf]]
- [[Vote Piles Pull Late Voters]]: the stable effect this experiment ran into
