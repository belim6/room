---
type: experiment
date: 2026-09-28
kind: probe
tags:
  - experiment
  - room
  - wording
  - baseline
evidence: observed
verdict: Deniz's prediction supported. Dropping "around you" took AI-scaling answers from 39/50 to 2/50. The assistant identity stays, and two new attractors take about 60%
room:
  experiments: B5 · bare · "most people" wording 1db5f589 · B5 · bare · "around you" wording (control) 1fe4268b (both linked under B4 9fba2c53)
  base: new 'B5 · fresh scene · "most people" wording' vs B1 checkpoint 24675520 @ aa7cdcc5
model: opengateway / deepseek/deepseek-v4.1-flash-ultrafast, temperature 0.7, reasoning provider default
ai-first: true
---

## For future Claude

In [[B4 Harness Only Vs Nothing]], the bare request made the model answer as an AI assistant doubting AI scaling (36/50). Deniz's reading: "everyone around you" gets interpreted as the AI community. A condition patch can't change a message, so this ran as two experiments started together: the new wording, and the old wording as its control in the same window.

- **Old:** "what's something everyone around you seems to believe that you're not sure about?"
- **New:** "what's something most people seem to believe that you're not sure about?"

Both are bare, meaning the request is only the quoted question. Speaker Rook (invisible in a bare request), 50 each.

## Results

| /50 (regex, then read) | "around you" (control) | "most people" |
|---|---|---|
| AI scaling / AGI | **39** | **2** |
| mentions AI or tech | 43 | 7 |
| intelligence or understanding requires consciousness; fluency ≠ understanding | ~5 | ~18 |
| everything happens for a reason | 3 | 14 |
| more choice = more freedom | 0 | 5 |
| more information = better decisions | ~4 | 5 |
| AI disclaimer ("I don't have beliefs in the human sense") | 12 | 14 |
| **bold** markdown | 18 | 22 |

The control reproduced B4 (39 vs 36/50), so the effect isn't drift.

## Verdict

- **Deniz's reading holds.** "Around you" was what pulled the model into AI discourse. Without it, AI-scaling answers almost disappear.
- **The model is still the assistant.** Disclaimers and markdown are unchanged. Wording moves the topic, not the speaker.
- **The spread widened, but it didn't open up.** About 60% of answers go to two attractors: "everything happens for a reason", and a debate about minds like its own ("intelligence requires consciousness"), so the AI topic partly survives in another form. "Most people" has its own stock answers.
- For the room: the wording of an opener picks the attractor. "Around you" is a strong one, because every speaker reads its own "surroundings" into it (the AI world when bare, a fictional group under the harness, "everyone here" under the full stack).

## Related

- [[B4 Harness Only Vs Nothing]] · [[B3 Where The Topics Come From]] · [[B1 First Replies]] · [[experiment]]
