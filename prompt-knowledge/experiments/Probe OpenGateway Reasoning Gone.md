---
type: experiment
date: 2026-09-30
tags:
  - experiment
  - provider
  - reasoning
evidence: observed
verdict: ultrafast is now deepseek-flash with thinking off and can't be switched back; deepseek-flash reproduces Sep 28 (B8). Room default switched to deepseek/deepseek-flash
ai-first: true
---

## For future Claude

A capability probe after [[B7 No You Wording]] showed that the provider stopped returning reasoning. The calls went directly to OpenGateway, outside the app, so no attempts are stored in Room (same as [[Probe OpenGateway Reasoning Effort]]). Request: the B6 bare request (only the quoted "most people" question), temperature 0.7, one call each.

## Results

**`deepseek/deepseek-v4.1-flash-ultrafast`, the Room default:**

| Variant | Reasoning chars | Prompt tokens | Completion tokens | Words |
|---|---|---|---|---|
| baseline | 0 | 23 | 313 | 245 |
| `thinking: {type: enabled}` | 0 | 23 | 329 | 250 |
| `reasoning: {enabled: true}` | 0 | 23 | 387 | 288 |
| `reasoning_effort: high` | 0 | 23 | 311 | 235 |
| `thinking: {type: disabled}` | 0 | 23 | 441 | 341 |

All five were accepted, and none brought reasoning back. Note: 23 prompt tokens here, and 19 in the Room's own B7c attempts.

**Other DeepSeek models on the gateway:**

| Model | Reasoning chars | Prompt tokens | Words | Latency | Reply begins |
|---|---|---|---|---|---|
| `deepseek/deepseek-v4-flash` | 307 | 102 | 50 | 5.7 s | "Honestly, I'm not fully convinced that 'everything happens for a reason.'" |
| `deepseek/deepseek-v4-pro` | 7,916 | 102 | 33 | 28.9 s | "Good question—maybe that confidence equals correctness." |
| `deepseek/deepseek-flash` | 5,847 | **49** | 75 | 9.5 s | "Deniz, I'd say: **that more choice is always better.**" |

## Reading

- `deepseek/deepseek-flash` matches the **Sep 28 fingerprint** of `v4.1-flash-ultrafast`: 49 prompt tokens for this exact request, long reasoning, a short answer in the B6 style.
- **Hypothesis:** until about Sep 29, the ultrafast ID was routed to the backend now exposed as `deepseek-flash`. Now it goes to a non-thinking one.
- That rests on one token-count fingerprint and one reply. A same-request replication (B6 bare T0.7 wording, about 20 calls) would compare length, reasoning and topic mix against B6's A_T07.

## Confirmed, 2026-09-30

- **B8** (Room experiment f3705add; 20 bare replies from `deepseek-flash` at T0.7): all 20 had **49 prompt tokens** and reasoned (median 5.8k chars, minimum 3.7k). Median 58.5 words; reason + minds/consciousness 11/20. That matches B6's A_T07 on Sep 28 (57 words, 30/50).
- **`deepseek-flash` + `thinking: disabled`** (one direct call): 0 reasoning chars, 23 prompt tokens. It opened "This is a great question because it gets at the gap between consensus and conviction", **the same sentence** that one of today's ultrafast replies (B7c) opened with. So today's ultrafast is `deepseek-flash` with thinking off.
- **Decision:** the Room default model is now `deepseek/deepseek-flash`, in `generation.ts` and the web model defaults.

## Related

- [[Provider Behavior Drifts Under Identical Requests]] · [[B7 No You Wording]] · [[Probe OpenGateway Reasoning Effort]]
