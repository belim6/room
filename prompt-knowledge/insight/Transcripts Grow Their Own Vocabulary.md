---
type: concept
date: 2026-09-24
tags:
  - concept
  - model-behavior
  - multi-agent
  - style
  - room
evidence: observed
confidence: 2 games, simple word counts; contagion mechanism inferred
ai-first: true
---

## For future Claude

Written after Claude claimed the Werewolf characters shared one fixed vocabulary ("shape, thin, wagon, pile, I'll wear that"). Counting showed it isn't fixed: the favourite words depend on the model *and* on the transcript.

## The observation

Word counts over the generated messages of two Werewolf games in Room. Each game had 7 speaking characters, with the same persona prompts in both games.

Game 1 switched models partway through: Night 1 to Night 2 on Kimi, then Day 2 on DeepSeek. So it's split into its two halves:

| Term | Game 1 · Kimi (14 msgs) | Game 1 · DeepSeek (13 msgs) | Game 2 · DeepSeek (26 msgs) |
|---|---|---|---|
| "thin" | **13** | 1 | 7 (4/7 characters) |
| "wagon" | 1 | **16** | 1 |
| "checkable / checks out" | 2 | 6 | 0 |
| "pile" | — | — | **16 (6/7)** |
| "shape" | — | — | **13 (6/7)** |
| "not just X, it's Y" (fake negation) | 0 (both halves) | | 0 |
| "isn't X, it's Y" (real negation) | 4 (whole game) | | 4 (4/7) |

(— = not split out; the whole of game 1 had 1 "pile" and 1 "shape".)

## Reading, two effects, both present

1. **The model sets the favourite word.** Within one game, with the same characters and transcript, the dominant term flipped from "thin" to "wagon" when Kimi was replaced by DeepSeek. Caveat: the switch coincided with a new game phase (Day 2), but Day 1 on Kimi also had a full vote round and used "thin", not "wagon".
2. **The transcript sets which word wins for a given model.** DeepSeek's word was "wagon" in game 1 and "pile"/"shape" in game 2. Once a term is in the transcript it spreads across most characters, which is the in-context version of [[Examples Beat Descriptions]]. Eight distinct persona descriptions don't hold it back.

**Correction (2026-09-24):** this note was first written as "per-game vocabulary, and game 1 used 'wagon' before the model switch". The split by model showed the opposite for "wagon". Kept visible per the [[Room Ledger]] rules.

A clean test of effect 2 holds the model fixed: fork one checkpoint, seed a new term in a single message, and count its spread against a control branch.

## Why it matters

It's the distinctiveness problem from `PRODUCT_SPEC.md` §4.8, in measurable form. A per-character vocabulary overlap score within a transcript would be a cheap, automatic distinctiveness metric for Room.

## Related

- [[Room Ledger]] (hub) · [[Werewolf]]
- [[Examples Beat Descriptions]] · [[Contrast Sentences Are The Tell]] (the licensed-contagion idea there targets exactly this)
