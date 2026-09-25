---
type: report
date: 2026-09-24
tags:
  - report
  - room
  - werewolf
  - experiments
ai-first: true
---

# Werewolf experiment series: report (23–24 September 2026)

## For future Claude

A synthesis of the first five Room experiments. Everything comes from one fork point family: Alexandra's Day 2 vote in Werewolf · game 2, on `deepseek/deepseek-v4.1-flash-ultrafast` via OpenGateway. The per-experiment notes hold the details and Room IDs. This report holds what the series means as a whole, what it doesn't show, and what to do next. **Every inference below is scoped to that one checkpoint, one character and one model.** Generalising is the first open question, not a finding.

## Summary

We set out to test whether a character's spoken reasoning could be improved by instruction, and ended up finding out what actually drives a decision at a contested moment in a group conversation:

1. **Reasoning is what makes dissent possible.** With hidden reasoning switched off, Alexandra voted with the majority 40/40. With it on, she broke away 12/40 (p ≈ 9 × 10⁻⁵).
2. **The majority vote is mostly reached by argument, not by following the pile.** With no votes cast at all, she already picks the eventual majority target about 65% of the time. Two pre-registered tests of a pile effect missed (p = 0.052, 0.078).
3. **Instructions to reason aloud don't change the decision.** "State your deduction before voting" had no effect at n = 20.
4. **The provider's reasoning length drifts within a day, and behavior drifts with it**, while our requests stay byte-identical.
5. **The one decisive clue in the game, vote timing, is almost never used:** at least 5 of 435 replies.

Pre-registration caught two results that would otherwise have been believed. Cost was trivial: an estimated ~$0.50 for all five experiments (435 trials: 305 with reasoning at ~0.15¢, 130 without at ~0.02¢), because cached input made replays nearly free. Only 24 Sep up to Exp2 has been checked against billing ($0.07).

## The series

| # | Question | Design | Result | Verdict |
|---|---|---|---|---|
| [[Exp1 Deduction Before Vote]] | Does dropping brevity, or requiring a stated deduction, change the vote? | 3 conditions × 5 | Deduction condition: 2/5 wolf votes, others 0/5 | Promising, underpowered |
| [[Exp2 Deduction Before Vote Replication]] | Replicate Exp1 control vs deduction | 2 × 20 | 0/20 vs 0/20 wolf votes | **Refuted.** Exp1's 2/5 was noise, enabled by long-reasoning runs |
| [[Exp3 Reasoning Off]] | Does turning reasoning off remove dissent? | 2 × 40 | Broke from the pile 12/40 vs **0/40** | **Supported**, p ≈ 9 × 10⁻⁵ |
| [[Exp4 Pile Size]] | Does the number of prior votes drive the vote? | 3 fork points × 2 × 30 | Jonas 53% (no votes) → 87% / 77% | Primary **missed**, p = 0.052 |
| [[Exp5 Pile Rerun]] | Pre-registered rerun: no pile vs pile | 60 vs 60 | 65% vs 78% | Primary **missed**, p = 0.078 |

Plus [[Probe OpenGateway Reasoning Effort]]: effort parameters are ignored, and only `thinking: disabled` works.

## Inferences

Each one is linked to its own note, with its evidence level on the [[Room Ledger]] scale.

| Inference | Evidence | Note |
|---|---|---|
| With reasoning off, she never broke from the majority | tested | [[Short Reasoning Joins The Pile]] |
| The majority vote is mostly argument; a pile adds ≤ ~13 points | refuted (pile effect not established) | [[Vote Piles Pull Late Voters]] |
| Instructing a stated deduction doesn't change decisions | refuted (as a lever) | [[Exp2 Deduction Before Vote Replication]] |
| The provider's reasoning length drifts both ways within a day; behavior tracks it | observed (5 runs) | [[Provider Behavior Drifts Under Identical Requests]] |
| Characters argue from style and rarely from the record | observed (435 trials) | [[Characters Argue From Style Not Records]] |
| Seeing votes on the board may lengthen deliberation | hypothesis (unplanned) | [[Seeing Votes Lengthens Deliberation]] |
| The result that prompts a replication overstates the effect | observed (2 of 2) | [[The Result That Prompts A Replication Overstates It]] |
| Cached input makes replays nearly free; output is the cost | observed | [[Cached Input Makes Replays Cheap]] |
| Effort knobs silently ignored on this route | observed | [[Probe OpenGateway Reasoning Effort]] |
| Vocabulary spreads within a transcript; the model sets the favourite words | observed (2 games) | [[Transcripts Grow Their Own Vocabulary]] |
| Credit for a claim drifts to the nearest speaker, inside the reasoning | observed (n = 1) | [[Context Can Imply A Competing Task]] |

### How they fit together

The first three rows form one picture. At this checkpoint, the obvious answer is Jonas: the discussion made a salient case against him ("his one vote went to a man the seer cleared"). **Without reasoning, the model takes the obvious answer every time. With reasoning, it sometimes finds an alternative (Rook), and occasionally the right one (a wolf).** Other people's votes add a little pull on top, but much less than we assumed. Telling the model to show its deduction changes how the reply reads, not what it decides. The deciding factor is whether the hidden reasoning happens and how long it runs, and that is partly outside our control, set by the provider's state on the day.

For the product this means **a character's independence from the room is partly a compute budget**, and that budget drifts unless it's recorded and controlled. Any persona comparison that doesn't record reasoning length can be confounded by it.

## What went wrong, and was corrected

Recorded so the same mistakes aren't repeated. All corrections are kept visible in the notes.

- **A false inference about the deduction.** Claude claimed Alexandra's reasoning "showed she shouldn't vote Jonas". It didn't. Her deduction left Jonas at a 50% wolf probability. The informative clue was vote timing.
- **Vocabulary.** "All the characters share one vocabulary" was wrong: the favourite words depend on the model and on the transcript.
- **Costs.** Claude extrapolated $1 for Exp2 from a running total. The billed cost was $0.07 for the whole day.
- **Herding.** First labelled `tested`, then `observed`. After Exp4 and Exp5, the pile effect it claimed isn't supported.
- **Exp1 record.** The first backfill stored "Not pre-registered", although a pre-registration note existed. The script was fixed before it ran on real data.

## Limits

- **One checkpoint, one character, one game, one model.** Nothing here is shown to generalise.
- **Out-of-turn voting:** at the P0 and P2 fork points, Alexandra votes ahead of players the moderator listed first.
- **Reasoning off vs short reasoning:** turning reasoning off may be a different generation mode rather than "less reasoning". Exp3 shows reasoning is *necessary*, not that its *length* is the dial.
- **Undercounted clue:** the vote-timing count is a regex, a lower bound.
- **Drift:** results from different sessions differ in reasoning length, so only experiments run concurrently are directly comparable.

## Next

In rough order of value per cent spent:

1. **Generalise before building on it.** Repeat Exp3 (reasoning on/off) at 2–3 other decision points: another character's vote, game 1, a non-game conversation. If "no reasoning, no dissent" holds, it's a property of the setup. If not, it's a property of this checkpoint.
2. **Make the record usable.** Test whether a structured vote log in the moderator's announcement (who voted whom, before or after the seer claim) gets the timing clue used. This separates "can't reason from records" from "records aren't salient".
3. **Is length the dial?** Find a model or route where reasoning effort actually changes token counts, then run low/medium/high.
4. **The deliberation hypothesis ([[Seeing Votes Lengthens Deliberation]]):** pre-register it, with token count as the outcome, and a length-matched no-votes control.
5. **Product:**
   - Record reasoning length and cached tokens per trial, which Room now does.
   - Add a per-trial cost column.
   - Raise the 50-trial run cap, or support splitting runs, since Exp5's P0 needed a manual resume.

## Related

- [[Room Ledger]] (hub) · [[Werewolf]] · `~/dev/room/EXPERIMENTS_SPEC.md`
