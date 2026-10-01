---
type: experiment
date: 2026-09-30
kind: probe
tags:
  - experiment
  - room
  - wording
  - provider
evidence: observed
verdict: confounded. The provider stopped returning reasoning between Sep 28 and Sep 30 (the same-window control proves it), so B7 can't be compared with B6. Within B7, the no-"you" wording gave a myth-busting listicle
room:
  experiments: B7 · assistant pool · bare no-"you" wording · T1.3 a1eb8d4c (linked under B6 pool) · B7c · control · B6 wording 1fdfb3c1 · B7c · control · B7 wording 4bcf480e (both linked under B7)
  base: 'B7 · fresh scene · no-"you" wording' (new) and the B5 checkpoint
model: opengateway / deepseek/deepseek-v4.1-flash-ultrafast, T1.3. Served WITHOUT reasoning from 2026-09-30
ai-first: true
---

## For future Claude

A robustness check for [[B6 Assistant Pool Vs Personas]]. The question: did the assistant's self-talk ("you" → minds and consciousness) crowd the everyday topics out of the B6 pool? The wording drops "you": *"what's a common belief that might not be true?"* ("false" was avoided, since it invites myth listicles). Bare, T1.3, 200 replies.

## Protocol deviation (Claude)

**No same-window control was planned**, which breaks rule 4 of [[experiment]]. After all 200 replies came back with no reasoning, a control was run as B7c: 10 replies each of the B6 wording and the B7 wording, concurrently. **None of the 20 reasoned**, including the byte-identical B6 request, which reasoned in all of its 300 runs on Sep 28. So the provider changed. See [[Provider Behavior Drifts Under Identical Requests]].

## Results (as observed, no reasoning)

| Out of 200 | Count |
|---|---|
| "we only use 10% of our brains" | 188 |
| goldfish memory | 171 |
| 8 glasses of water | 155 |
| sugar → hyperactivity | 101 |
| opens with "Great question" | 92 |
| minds / consciousness | 1 |
| everything happens for a reason | 0 |
| breakfast | 0 |
| busy | 1 |
| honesty / feedback | 2 |

Other observations:
- Median 274 words.
- Framing like "Deniz's question from a Q&A format".
- One reply in Turkish, one in Chinese, and Chinese tokens leaking into English.
- A quote attributed to "Naval Ravikant" and another to Mehmet Akif Ersoy.

B7c, B6 wording today: about 250 words, "Great question", lists, answering about Deniz's question rather than as a speaker. Topics include "more choice" and "understanding means you can predict".

## Verdict

- **Not comparable to B6.** The difference is confounded with the provider's switch to a non-reasoning variant. To answer the original question, rerun B6 and B7 wordings together in one window, and check first whether reasoning is back or can be forced.
- **Within B7:** without "you", the bare model treats the question as a trivia request and gives the classic misconception list. B6's persona-only topics (busy, honesty, conversation) stay absent here too. That's weakly consistent with B6's verdict, under a different serving mode.
- **Bigger consequence:** Room characters on this model now run without reasoning, unless the provider reverts. Earlier results don't transfer automatically.

## Related

- [[B6 Assistant Pool Vs Personas]] · [[Provider Behavior Drifts Under Identical Requests]] · [[Exp3 Reasoning Off]] · [[experiment]]
