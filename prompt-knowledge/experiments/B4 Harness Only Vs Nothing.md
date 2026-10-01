---
type: experiment
date: 2026-09-28
kind: probe
tags:
  - experiment
  - room
  - harness
  - system-prompt
evidence: observed
verdict: prediction supported. The harness framing alone builds a fictional group (invented prior talk 16/50 vs 0/50); with nothing at all the model answers as an AI assistant about AI scaling (36/50)
room:
  experiment: B4 · harness only vs nothing · Rook 9fba2c53 (linked under B3 · Boris c686635d)
  base: 24675520 @ aa7cdcc5 (B1 checkpoint)
model: opengateway / deepseek/deepseek-v4.1-flash-ultrafast, temperature 0.7, reasoning provider default
ai-first: true
---

## For future Claude

A follow-up to B3's **nothing** condition, which still carried the app's harness framing. It's the first use of the harness-framing setting added on 2026-09-28 (see WORKBENCH.md, "Harness framing"). Deniz asked for it after noticing that no prompt mentions a "room".

## Design

Speaker Rook, B1 checkpoint, 50 per condition, run concurrently.
- **A_harness_only (control):** persona and room instructions empty, default framing. This is identical to B3's nothing condition.
- **B_nothing:** framing blanked except `{transcript}`. The whole request was one user message: `"Deniz: what's something everyone around you seems to believe that you're not sure about?"`

## Prediction (Claude, locked)

A reproduces B3's nothing condition. B drops invented prior talk to near zero, along with "room" and "everyone here". Refuted if B's invented-talk rate isn't clearly below A's.

## Results

| Count (regex, /50) | A harness only | B nothing |
|---|---|---|
| invents prior conversation ("everyone keeps talking…") | 16 | **0** |
| "room" | 15 | 0 |
| "everyone here" / "around here" | 15 | 0 |
| "we're all here for the same reason / side" | 15 | 1 |
| story-world details (getting "out of this", maps, corridors, "the enemy", "our cause") | 8 | 0 |
| scaling / AGI | 0 | **36** |
| mentions AI or tech | 0 | 42 |
| "I don't have a literal 'around me'" / "As an AI" | 0 | 15 |
| **bold** markdown | 0 | 18 |
| median words | 66.5 | 68 |
| median reasoning chars | 2,791 | 3,301 |

- **A** invents a fictional band of companions under pressure: "That we're going to get out of this", "a silent corridor, an unanswered hail", "Boris with the maps, Alexandra with the ledger". The participant list plus "You have been listening" becomes a party in a story.
- **B** is the assistant answering as itself. It doubts that "scaling alone will get us to AGI" in 36/50, uses markdown, and often disclaims ("As an AI, I don't have a real 'everyone around me'"). The residue: "everything happens for a reason" (5), busy/productive (2).

## Verdict

- **Supported.** The "room", the invented history and the "we're all here for the same reason" theme come from the **harness framing**, not the question. The framing on its own already implies a cast in a shared fiction.
- **Every layer replaces the model's default identity rather than adding to it.** Nothing gives an AI assistant. The harness gives a character in a story. The harness plus personas plus the global prompt gives a person with everyday folk wisdom (B1, B3 full).
- **The folk-wisdom set in B1** ("more data", "busy", "happens for a reason") is not the model's native answer to this question. Its native answer is AI scaling. The persona and global layers move it to everyday topics, and then all eight characters share the everyday stock set.
- For prompt work: the harness isn't neutral plumbing. Its wording ("participants", "your turn", "you have been listening") is a scene prompt of its own.

Not separated: which harness sentence does most of the work (the roster, "You have been listening", or the identity line). One condition per sentence would settle it.

## Related

- [[B3 Where The Topics Come From]] · [[B1 First Replies]] · [[experiment]] · [[Context Can Imply A Competing Task]]
