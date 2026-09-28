---
type: experiment
date: 2026-09-28
kind: baseline
tags:
  - experiment
  - room
  - baseline
  - personas
evidence: observed
verdict: length directives are followed (76/80); prompt wording and the question's wording come back verbatim; the topic pool is small and shared across the cast
room:
  base: 24675520 (B1 · fresh scene · first replies) @ aa7cdcc5
  experiments: Boris e5b735c6 · Ilya b1eb89fd · Alexandra 97dc58eb · Elorin ab0fa5c5 · Jonas a36361c5 · Ceryn 282a0664 · Velric 0400bcdd · Rook 6fe2d4af
model: opengateway / deepseek/deepseek-v4.1-flash-ultrafast, temperature 0.7, reasoning provider default
ai-first: true
---

## For future Claude

The first run under [[experiment]]: a baseline with nothing changed. It's the reference point every later persona probe on a fresh scene should beat. There's one checkpoint, one model and one run window, with n = 10 per character. Treat every number here as `observed`, scoped to this prompt and date.

## Question

With the current cast and nothing changed, how does each character answer a fresh open question, and how much do their answers vary across identical replays? Measures: length against the persona's stated range, opening move, and repeated phrasing.

## Prediction and decision rule

Baseline, so no hypothesis was tested. The recorded expectation, per experiment: most replies fall within the persona's stated length range.

## Design

- **Scene:** a fresh room with all 8 characters, and the human is Deniz. One human message: *"what's something everyone around you seems to believe that you're not sure about?"*
- **Deviation from the defaults, decided before the run:** the global system prompt's opening-topic line ("Being an indie game developer in this day and age") was replaced by the same question. Otherwise it would have competed with the question ([[Context Can Imply A Competing Task]]). Everything else is as the app sets it by default.
- **Runs:** 8 experiments, one per speaker, each with a single control condition, 10 forced first replies each. All 8 were started together on 2026-09-28 at 12:46 UTC and finished within about a minute. 80/80 completed, 0 failed.

## Results

**Length follows the prompt.**

| | Stated | In range | Median (range) | Median reasoning chars |
|---|---|---|---|---|
| Boris | 5–35 words | 10/10 | 21.5 (16–32) | 1,140 |
| Ilya | 2–4 sentences | 9/10 | 3 sentences, 80 words | 918 |
| Alexandra | 30–90 words | 8/10 | 73.5 (43–113) | 1,127 |
| Elorin | 25–80 words | 10/10 | 57.5 (51–72) | 1,753 |
| Jonas | 10–60 words | 10/10 | 32.5 (24–47) | 876 |
| Ceryn | 35–90 words | 10/10 | 62.5 (52–76) | 1,612 |
| Velric | 30–90 words | 9/10 | 75.5 (65–91) | 1,071 |
| Rook | 25–80 words | 10/10 | 52 (36–76) | 1,774 |

76/80 fell within the stated range. Median reasoning length varies about 2× across characters.

**Style directives are weaker than length directives.** Boris is told to write in lowercase and started lowercase in 3/10 replies.

**Prompt wording comes back verbatim, as a tic.**
- Ceryn "what would count against": 8/10. Her prompt says "Ask what would count against an interpretation".
- Elorin "Imagined…": 10/10, and "the analogy stops/breaks": 5/10. Her prompt says "Mark imagined scenarios as imagined" and "where does the analogy stop working?"
- The instruction to *do* something becomes a phrase that *announces* it.

**The question's wording comes back too.** 31/80 replies open with "Everyone…", and 38/80 say "I'm not sure" or "I'm not". Rook did both in 9/10 and Elorin in 7–9/10. Ilya's own template is "The one I keep bumping into / circling", 7/10, and it spreads to Velric (5) and Ceryn (2), so it isn't only Ilya's.

**The topic pool is small and shared.** By reading, about half of all 80 replies land on one of about six stock beliefs:
- "more data / information settles things"
- "everything happens for a reason"
- "a good argument / clear explanation changes minds"
- "busy = important"
- "follow your passion"
- "fiction makes you empathetic"

Personas change the *treatment* a lot and the *choice* of topic only a little. Some replays are near-duplicates: Boris 7/8 ("I've seen the calendars"), Elorin 2/5 (a dropped ice cream cone, gravity), Alexandra 5/9 (fiction and empathy).

## Verdict

- **Length ranges in persona prompts work.** They're usable as a control dial on this model.
- **Distinctive prompt phrases turn into catchphrases.** This is a practical risk for persona writing. The candidate lesson is to describe the behavior without giving it a quotable name. It's a hypothesis, and a probe could test it: rephrase Ceryn's line so it isn't quotable and count the verbatim echoes.
- **The opener's phrasing is mirrored.** Any baseline is partly a baseline of the opener. The next fresh-scene baseline should use a differently worded opener before generalizing.
- **Diversity comes from treatment, not topic.** Anything that needs varied content across replays (games, brainstorming) will need something beyond the persona to supply it.

Not measured: contrast sentences. A quick regex was too loose to trust, so labelling them needs a written rule first.

## Related

- [[Room Ledger]] · [[experiment]] · [[Transcripts Grow Their Own Vocabulary]] · [[Examples Beat Descriptions]] · [[Context Can Imply A Competing Task]]
