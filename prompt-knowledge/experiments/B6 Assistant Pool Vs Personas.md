---
type: experiment
date: 2026-09-28
kind: probe
tags:
  - experiment
  - room
  - personas
  - temperature
  - baseline
evidence: observed
verdict: Deniz's "the personas are just reweighting the assistant" refuted for this question. About 60% of persona answers are topics the bare assistant never produced in 249 tries at T1.3. The assistant's top cluster (minds and consciousness, about 40%) never appears in the personas
room:
  experiments: B6 · assistant pool · bare "most people" · T1.3 · B6 · Boris · "around you" wording · B6 · Boris · "most people" wording (all linked under B5 1db5f589)
  base: B5 checkpoint ("most people") and B1 checkpoint ("around you")
model: opengateway / deepseek/deepseek-v4.1-flash-ultrafast; pool at temperature 1.3 (4 × 50) and 0.7 (50); Boris at 0.7, full prompts
ai-first: true
---

## For future Claude

Deniz's question after [[B5 Most People Wording]]: the personas' stock answers ("everything happens for a reason", "more choice") also show up in the bare assistant. Can the no-prompt assistant regenerate *all* the persona answers if we sample enough at a higher temperature? Topic **support** is compared (does a topic appear at all), not frequency, since temperature flattens the distribution. Boris ran with both wordings, because the persona pool was asked "around you" and the assistant pool "most people".

## Design

- **Pool:** bare request (only the quoted "most people" question), speaker Rook (invisible). 4 replicates × 50 at T1.3, plus 50 at T0.7 in the same window. 249/250 completed; 1 failed with "Provider returned no text content".
- **Boris:** full prompts, T0.7, 30 per wording, concurrent.
- **Persona pool for comparison:** B1 (80) + B3 full (80) + B6 Boris (60) = 220 replies.
- **Labels:** a topic codebook written from the persona replies before the pool was read, applied by regex to the persona replies. It's roughly 80% accurate: "failure of communication" gets labeled as failure, for example. The assistant pool was also read in full. Counts are ± a few; the support claims (present vs never) were checked by reading.

## Results

**Assistant pool, T1.3 (n = 199):**

| Topic | Count |
|---|---|
| minds and AI (understanding requires consciousness, intelligence ⇔ consciousness, understanding vs pattern-matching, consciousness = brain) | 85 |
| everything happens for a reason | 35 |
| more information → better decisions | 18 |
| more choice = better | 12 |
| a stable self / free will | 12 |
| intelligence is one general thing | 11 |
| hard work pays off | 8 |
| certainty / confidence is a virtue | 7 |
| facts change minds | 3 |
| AI / tech progress | 3 |
| love what you do | 1 |
| other (what doesn't kill you, closure, one correct answer, disagreement is a knowledge problem) | 4 |

Twelve topics cover 98% of the pool.

**T0.7 (n = 50):** the same set without "more choice" and without the novel tail. Reason 16, minds/AI 14, then 4 or fewer each. Median words 57 vs 64–72 at 1.3. **So temperature is not ignored, but the effect is mild:** a few new tails, and the same core.

**Persona topics the assistant never produced (0/249):**

| Topic | Persona count (/220) |
|---|---|
| busy = important | 19 |
| folk health / habits (breakfast, sleep, news, water) | 14 |
| how conversations work (disagreement, consensus, steelmanning) | 14 |
| honesty / transparency / feedback | 14 |
| fiction and empathy | 9 |
| social niceties ("we should hang out", "doing their best", "trust the process") | several |
| incentives | several |
| understanding = excusing | several |
| unique ones ("reply speed measures caring", "values page", "everything's priced in") | about 34 |

About 40% of persona replies fall on topics that are also in the assistant pool (reason, more info, more choice, hard work, certainty, arguments change minds, passion, explain simply).

**Assistant topics the personas never produced (0/220):** minds and AI (about 40% of the pool), self / free will, intelligence as one thing.

**Boris by wording (30 each):**
- "around you": busy 8, "trust the data"/dashboards about 7, "do what you love" 2, incentives 3.
- "most people": busy 1, "people change their minds from evidence/arguments" 5–6 (0 before), more information 5, breakfast 2, honest feedback 2.
- "Everyone here" disappears, and so does the room-talk.
- No AI topics under either wording. Wording moves which topics he picks, but only within persona territory.

## Verdict

- **Refuted: the personas don't just reweight the assistant.** About 60% of persona answers are topics the bare assistant didn't produce in 249 tries at T1.3. They sit mostly in *everyday lived observation* (calendars, breakfast, meetings, friends), which the assistant, answering as an AI about "people", doesn't go near.
- **The shared core is real.** "Everything happens for a reason", "more information" and "more choice" come from the assistant's native pool and survive every layer. That is the overlap Deniz noticed across characters.
- **The personas suppress the assistant's biggest cluster completely.** Minds and consciousness is the assistant's answer about itself, and a "person" has no reason to give it.
- **Temperature 0.7 → 1.3** adds a thin tail, not a new distribution. A higher temperature is not a way to get variety from this model.
- Caveat: the persona pool was mostly asked "around you" and the assistant pool "most people". The Boris pair shows the wording shifts topics *within* each identity, but doesn't move a persona into assistant territory. That makes the support comparison fair to about this degree.

## Related

- [[B5 Most People Wording]] · [[B4 Harness Only Vs Nothing]] · [[B3 Where The Topics Come From]] · [[B1 First Replies]] · [[experiment]]
