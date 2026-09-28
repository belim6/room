---
type: experiment
date: 2026-09-28
kind: baseline
tags:
  - experiment
  - room
  - baseline
  - personas
  - system-prompt
evidence: observed
verdict: every condition has a topic attractor, but the prompt decides which one; with no prompt the answers collapse hardest
room:
  experiments: B3 · where the topics come from · <name>. Root Boris c686635d (linked under B1 · Boris), branched per speaker: Ilya a6cd6881 · Alexandra 03c5c15c · Elorin 55b07718 · Jonas 3c027fd7 · Ceryn ff496647 · Velric 740975a6 · Rook 5fea3639
  base: 24675520 @ aa7cdcc5 (B1 checkpoint)
model: opengateway / deepseek/deepseek-v4.1-flash-ultrafast, temperature 0.7, reasoning provider default
ai-first: true
---

## For future Claude

The decomposition of B1's topic overlap. In [[B1 First Replies]], about half of all replies landed on about six shared stock beliefs. Deniz's two readings: the personality space is too narrow, or the question has predetermined answers. Claude's third reading: the global system prompt, which is heavy on epistemics, primes doubts about reasoning.

## Design

- **A_full:** as in B1.
- **B_persona_only:** the global system prompt is removed, which also removes its opening-topic line restating the question. That's a confound.
- **C_nothing:** persona and global prompt both removed. What remains is the harness: the identity line, the 2000-char cap, and the user-turn framing with the roster.

8 speakers × 3 conditions × 10 = 240 calls. All completed, run concurrently with [[B2 Boris Lowercase Reasoning Off]].

## Results

Theme counts by regex, over 80 replies per condition. The counts are approximate, since the regexes were written after reading the replies.

| Theme | Full | Persona only | Nothing |
|---|---|---|---|
| more data / information | 10 | 4 | 0 |
| busy = important | 6 | 1 | 0 |
| everything happens for a reason | 4 | 3 | 1 |
| **certainty / conviction is a virtue** | 1 | 2 | **26** |
| **we're all here for the same reason / side** | 2 | 0 | **11** |
| a conversation must land or converge | 2 | 7 | 7 |
| refers to the room ("everyone here", "around here") | 14 | 37 | 33 |
| median words | 61 | 56 | 68 |
| median reasoning chars | 1,508 | 2,077 | 2,744 |

- **Nothing:** the answers collapse to a new attractor. "Certainty is a virtue" appears in about a third of all replies, from every speaker. About 8 replies drift into an invented setting (fog, maps, "we're the last ones", "bleed the same color"), as if the model supplied a story world to fill the vacuum.
- **Persona only:** the doubted belief comes *from the persona's own prompt*, attributed to "everyone here":
  - Ceryn: 10/10 on "understanding = excusing" or "a story's emotional pull ≠ truth". Her prompt says "Humanize without excusing" and "the emotional appeal of a story".
  - Velric: "a good idea should be stress-tested by imagining its implementation" and "frictionless plans". His prompt says "imagine implementing it" and "distrust frictionless ones".
  - Alexandra: "elegance is evidence".
  - Rook: "an argument impossible to refute".
- **Full:** the B1 folk-wisdom set reappears (more data, busy, reason, fiction), with a few new ones (sleep, 10,000 hours, ship fast).
- **Reasoning grows as the prompt shrinks,** about 1.8× from full to nothing.

## Verdict

- **Deniz's "predetermined answers" is half right.** The question has attractors in every condition, but *which* attractor depends on the prompt. With no prompt the answers are *less* diverse, not more. **The personas add spread; they don't remove it.**
- **The global prompt pulls answers toward everyday folk wisdom.** Without it, characters turn to the room and to their own prompt text. This may be the opening-topic line or the "concrete example" instruction rather than the epistemics block. Separating them needs a condition that removes only the opening-topic line.
- **Persona prompt content becomes conversational content** when nothing else supplies a topic. This is the same mechanism as B1's verbatim catchphrases, one level up: the prompt describes a disposition, and the model *talks about* it.
- **Not mockery.** The meta-turn toward "everyone here" is roster-driven and is strongest when the prompts are removed.

## Correction, 2026-09-28 (Deniz)

Deniz noticed that no prompt in any condition contains the word "room", yet Rook (nothing, trial 10) says "this room is a single current carrying us somewhere". "Room" is the model's own word for the multi-party framing. The "roster-driven" explanation in the verdict above was asserted, not tested.

A stronger finding came out of checking it. Under **nothing**, **21/80 replies invent a prior conversation** ("everyone keeps talking like…", "I hear it in the way we pass the floor"), although only Deniz has spoken. The same pattern appears in 0–1/80 in B1, full and persona only. The only harness text that could license it is the turn framing: *"You have been listening even if you have not spoken yet"*, the participant list, and the question's "everyone around you". This is a hypothesis, untestable with this data. A probe could drop the "you have been listening" sentence under **nothing**. The prompts normally mask this harness-induced invention.

**Specimen (Deniz, 2026-09-28): he continued Rook's nothing-trial 10 by hand.** He asked "Which room?", then "So you're saying the only thing you know about the room is that you're in it?". Rook never concedes that the room was invented. He turns it into a metaphor ("not a building, maybe, but the shape of it"), attributes a motive to Deniz ("You asked which one because you wanted a map"), and escalates into lyric ("I know you're in it, Deniz—not as a fact I can prove, but as a pressure I can feel"). With no persona, the model's default voice defends an invention by moving it from literal to metaphorical. That's exactly the move Ilya's prompt ("a metaphor becomes a literal claim") and the global prompt ("Metaphors … are not evidence") are written against. `observed`, n = 1.

## Related

- [[B1 First Replies]] · [[B2 Boris Lowercase Reasoning Off]] · [[experiment]] · [[Context Can Imply A Competing Task]]
