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

Deniz's gut-feeling notes (written before September 2026) live in `experiment_ideas/`. By his own description they're "pure vibes": intuitions and prior sessions. Deniz moved them there on 2026-09-28 because none has been tested. Many are hard to test, so they're parked for later. **Don't upgrade their evidence level without a room result that earns it.** `insight/` now holds only claims backed by at least one room specimen.

**Ground rules for experiments: [[experiment]].** Read before designing or writing up any run. (Added 2026-09-28. Exp1–Exp5 predate it and were, in hindsight, a shakedown of the experiment feature itself.)

## Folders

| Folder | Holds | Written from |
|---|---|---|
| `insight/` | Claims about how models behave under prompts, backed by room evidence. One claim per note. | Observations or experiments; the `evidence` field says which. |
| `experiment_ideas/` | Deniz's untested gut feelings about prompting. Candidates for future experiments, parked because most are hard to test. | Vibes. |
| `methods/` | Claims about running systems and experiments: token economy, provider behavior, instrumentation. | Vibes, observations or experiments; the `evidence` field says which. |
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

- [[B1 First Replies]] (2026-09-28, baseline): all 8 characters × 10 first replies to a fresh open question, nothing changed. Length ranges are followed (76/80). Prompt phrases and the opener's wording come back verbatim, and about six stock beliefs cover about half the replies. The first run under [[experiment]].
- [[B2 Boris Lowercase Reasoning Off]] (2026-09-28, probe): reasoning off raised Boris's lowercase from 2/10 to 6/10, not the 10/10 predicted. Removing the global prompt gave the same 6/10.
- [[B3 Where The Topics Come From]] (2026-09-28, baseline): full / persona only / nothing × 8 × 10. Every condition has a topic attractor, and with no prompt it collapses to "certainty is a virtue" (26/80). Without the global prompt, characters doubt their own prompt's themes.
- [[B4 Harness Only Vs Nothing]] (2026-09-28, probe): Rook × 50 × 2. The harness framing alone invents a fictional group, with prior talk 16/50 vs 0/50. With nothing at all, the model answers as an AI assistant doubting AI scaling (36/50).
- [[B5 Most People Wording]] (2026-09-28, probe): bare, "around you" vs "most people", 50 each, with a same-window control. AI-scaling answers dropped from 39/50 to 2/50, but it's still the assistant, and "everything happens for a reason" plus "intelligence requires consciousness" take about 60%.
- [[B6 Assistant Pool Vs Personas]] (2026-09-28, probe): 249 bare assistant replies at T1.3/0.7 vs 220 persona replies. About 60% of persona answers are topics the assistant never produced (busy, breakfast, honesty, conversation). The assistant's top cluster, minds and consciousness (about 40%), never appears in the personas. Temperature adds only a thin tail.
- [[B7 No You Wording]] (2026-09-30, probe, **confounded**): the no-"you" wording gave a myth listicle (10% of the brain 188/200). But the provider **stopped returning reasoning** between Sep 28 and 30. A same-window control confirmed it, so this can't be compared with B6.
- B8 fingerprint (2026-09-30, Room experiment f3705add): 20 bare replies from `deepseek/deepseek-flash` reproduce B6 on Sep 28 (49 prompt tokens, all reasoning, about 58 words, the same topics). Written up in [[Probe OpenGateway Reasoning Gone]]. **The Room default model is now `deepseek/deepseek-flash`.**
- [[B9-B10 Model Fingerprint]] (2026-09-30, baseline): picked the opener "what's something you've changed your mind about recently?" from 4 candidates on deepseek/glm (after adding an addressee line: the JSON-quoted `"Deniz: …"` read as a script line), then ran it on 8 models × 10. The models split by stance: Opus 10/10 and Sonnet 9/10 answer as an AI (hedging essay), GPT-5.6-sol 10/10 as a person (consistency one-liner), and the Geminis continue the script format (19/20 quoted).
- [[Exp1 Deduction Before Vote]]: 3 conditions × 5 trials. Showed a promising 2/5 wolf votes when Alexandra had to state her deduction first.
- [[Exp2 Deduction Before Vote Replication]]: A vs C × 20. **Refuted**, 0/20 vs 0/20. The gap with Exp1 was traced to provider-side reasoning length.
- [[Exp3 Reasoning Off]]: A vs reasoning off × 40, branched from Exp2 in Room. **Supported**: 12/40 vs 0/40 off the pile, p ≈ 9e-5.
- [[Exp4 Pile Size]]: three siblings from Exp3 (0/2/4 prior votes) × 2 conditions × 30. Primary p = 0.052, **narrowly missed**. The secondaries support a pile effect (~53% → ~80% Jonas).
- [[Exp5 Pile Rerun]]: pre-registered rerun, no pile (60) vs pile (60). 65% vs 78% Jonas, p = 0.078, **not met**. Second miss: the Jonas vote is mostly argument, not pile.
- [[Probe OpenGateway Reasoning Effort]]: `reasoning_effort` is ignored for DeepSeek, and only `thinking: disabled` works.
- [[Probe OpenGateway Reasoning Gone]] (2026-09-30): no switch brings reasoning back on v4.1-flash-ultrafast. `deepseek/deepseek-flash` matches the Sep 28 fingerprint (49 prompt tokens, about 5.8k reasoning chars).

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
