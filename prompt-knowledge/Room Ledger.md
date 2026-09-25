---
type: hub
date: 2026-09-24
tags:
  - hub
  - room
  - ledger
status: active
ai-first: true
---

## For future Claude

Hub for everything learned in **Room** (`~/dev/room`, the local conversation workshop). Deniz, 2026-09-24: this folder is "the ledger for experiments or any other data we acquire from the room … the taxonomy is just a template, you can change that too." Claude is expected to keep it current: every experiment, finding, and correction from the room lands here.

The notes under `insight/` written before September 2026 are Deniz's. By his own description they're "pure vibes": intuitions and prior sessions, several of which are good starting points for experiments. **Don't upgrade their evidence level without a room result that earns it.**

## Folders

| Folder | Holds | Written from |
|---|---|---|
| `insight/` | Claims about how models behave under prompts. One claim per note. | Vibes, observations, or experiments; the `evidence` field says which. |
| `methods/` | Claims about running systems and experiments: token economy, provider behavior, instrumentation. | Same. |
| `experiments/` | One note per experiment in Room, mirroring the app's record: question, pre-registered prediction, design, results, verdict, links. | Room experiment records only. |
| `reports/` | Syntheses across several experiments: what a series means, its limits, next steps. | Written after a series closes. |
| `werewolf/`, `DND/` | Project notes for games played in or before the room. | Session records. |
| `frontier/` | Product ideas. | Deniz. |
| `graph/`, `problems/` | Screenshots from earlier sessions. | — |

## Evidence levels

New notes carry an `evidence` field. Deniz's older notes keep `status: active` until one is re-examined.

- **vibe**: an intuition or remembered experience. No preserved specimen.
- **observed**: at least one preserved specimen in the room (branch, message, attempt). Not controlled.
- **hypothesis**: a proposed mechanism for an observation, not yet tested.
- **tested**: supported by a pre-registered Room experiment. Always scoped: *which* checkpoint, model and n.
- **refuted**: a pre-registered prediction failed. Keep the note, since refutations are findings.

**Rules:**
- **Cite the room.** Every claim above `vibe` cites the Room IDs that back it (experiment, branch, observation), so the evidence can be reopened in the app.
- **Scope results to model and date.** Results are per model *and per run window*. Exp1 and Exp2 showed the provider can drift with byte-identical requests ([[Provider Behavior Drifts Under Identical Requests]]).
- **Corrections go in, not over.** When a claim is corrected, the correction is added with its date and the original stays visible. The room follows the same rule for its own records.

## Reports

- [[2026-09-24 Werewolf Experiment Series]]: Exp1–Exp5 pulled together. Start here.

## Experiments

- [[Exp1 Deduction Before Vote]]: 3 conditions × 5 trials. Showed a promising 2/5 wolf votes when Alexandra had to state her deduction first.
- [[Exp2 Deduction Before Vote Replication]]: A vs C × 20. **Refuted**, 0/20 vs 0/20. The gap with Exp1 was traced to provider-side reasoning length.
- [[Exp3 Reasoning Off]]: A vs reasoning off × 40, branched from Exp2 in Room. **Supported**: 12/40 vs 0/40 off the pile, p ≈ 9e-5.
- [[Exp4 Pile Size]]: three siblings from Exp3 (0/2/4 prior votes) × 2 conditions × 30. Primary p = 0.052, **narrowly missed**. The secondaries support a pile effect (~53% → ~80% Jonas).
- [[Exp5 Pile Rerun]]: pre-registered rerun, no pile (60) vs pile (60). 65% vs 78% Jonas, p = 0.078, **not met**. Second miss: the Jonas vote is mostly argument, not pile.
- [[Probe OpenGateway Reasoning Effort]]: `reasoning_effort` is ignored for DeepSeek, and only `thinking: disabled` works.

## Findings from the room

- [[Vote Piles Pull Late Voters]]: *refuted* at this checkpoint. She joins the pile ~85% of the time, but already votes Jonas ~65% with no pile at all ([[Exp4 Pile Size]], [[Exp5 Pile Rerun]]).
- [[Short Reasoning Joins The Pile]]: *tested* in the off direction (Exp3). Without reasoning she joined the pile 40/40; with it, 28/40. Whether *length* is the dial is untested.
- [[Provider Behavior Drifts Under Identical Requests]]: *observed*. Reasoning length halved between two runs with identical requests.
- [[Characters Argue From Style Not Records]]: *observed*. The decisive clue (vote timing) appears in at least 5 of 435 replies, and ~6× more often in reasoning.
- [[Seeing Votes Lengthens Deliberation]]: *hypothesis*. No votes on the board gave the shortest reasoning in both concurrent runs.
- [[The Result That Prompts A Replication Overstates It]]: *observed*, 2 of 2 (methods).
- [[Cached Input Makes Replays Cheap]]: *observed*. 92% cache hits in Exp2; output (reasoning) is now 92% of the cost, about 0.1¢ per trial.
- [[Transcripts Grow Their Own Vocabulary]]: *observed*, 2 games. The favourite words depend on the model and on the transcript; within a game they spread to most characters.

Room evidence added to Deniz's older notes (dated "Observed in the room" sections):
- [[Context Can Imply A Competing Task]]: new specimen, with a credit for a seer's finding going to the previous speaker.
- [[Contrast Sentences Are The Tell]]: fake-negation count, 0 in 53 messages across two models.
- [[Examples Beat Descriptions]]: vocabulary contagion within a transcript.

## Experiment queue (from the insight notes)

Candidates where a Room experiment could move a vibe to tested. Each one varies one factor from a fixed checkpoint.

1. ~~**[[Vote Piles Pull Late Voters]] dose-response**~~: done, see [[Exp4 Pile Size]]. Follow-up done: [[Exp5 Pile Rerun]] missed too (p = 0.078).
2. ~~**[[Short Reasoning Joins The Pile]] on/off**~~: done, see [[Exp3 Reasoning Off]].
3. **[[Instructions To Disagree Become Dispositions]]**: rules with "push back hard when you disagree" vs trigger-shaped "when you can name the specific flaw, lead with it". Measure how often a character disagrees with a claim that is plainly correct.
4. **[[Frequency Adverbs Are Unimplementable]]**: give one character "occasionally mention a fun fact" vs a trait-shaped version. Over 20 trials each, the frequency version should cluster near always or never, and the trait version should be stable.
5. **[[Position Effects In Long Prompts]]**: move the voting rule from the middle to the end of the rules. Measure format compliance and vote choice.
6. **[[Context Can Imply A Competing Task]]**: a checkpoint where the previous speaker restated someone else's claim. Measure attribution errors in the next reply, with and without an explicit "credit the original source" rule.

## Related

- [[Prompt Engineering]] · [[Prompting For Systems]]: the two hubs these findings feed.
- Room itself: `~/dev/room/EXPERIMENTS_SPEC.md`, `WORKBENCH.md`.
