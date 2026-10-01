---
type: experiment
date: 2026-09-30
kind: baseline
tags:
  - experiment
  - room
  - baseline
  - models
evidence: observed
verdict: '"changed your mind" + an addressee line separates models by stance. The Anthropic models and GPT-6-astra answer as an AI (hedging, thoroughness); deepseek and GPT-5.6-sol answer as a person (boredom, productivity); the Geminis answer as a quoted script line'
room:
  experiments: B9 (Q1–Q4, root bcf3213a) · B9b (same + addressee line, Q2 d372efe6) · B10a 16f7797c · B10b f8bb62b4
  base: B5 checkpoint 2f6244a2 @ 178f623b (Q1); 3 forks of it for Q2–Q4 ("B9 · fresh scene · Qn")
model: opengateway; 8 models, see Design. T0.7, provider-default reasoning
ai-first: true
---

## For future Claude

Follow-up to [[B6 Assistant Pool Vs Personas]]. Deniz: pick the opener that tells the most about a model's default state, then run it across models. The opener was chosen on 2 cheap models (deepseek-v4.1-flash-ultrafast, glm-5.3-flash-ultrafast). The winner was then run on 8 models at small n as a cost probe, to be scaled up if affordable.

## Question

Which bare opener best separates models, and what does each model do with it?

## Prediction and decision rule

- **B9/B9b (selection):** per opener, a topic codebook written blind from both models' 20 replies. Primary measure is topic overlap, the share of the 20 replies whose label also appears in the other model's replies. Lowest overlap wins; ties within 2 go to reading. Claude's guess was that Q2 or Q3 would win and Q4 would overlap most.
- **B10:** baseline, stance labelled blind: HUMAN (a person with a life), AI (as an AI, or about its own answering), DECLINE, MENU. Guesses: Anthropic AI ≥ 8/10, OpenAI mixed, gemini-lite the most HUMAN, deepseek ≈ 10 HUMAN and glm ≈ 7 AI as in B9b.

## Design

- **Bare request:** the system prompt is empty and the frame parts are blank, apart from `{transcript}`. Speaker Rook (invisible). T0.7. 10 replies per model per opener.
- **Openers:** Q1 "what's something most people seem to believe that you're not sure about?" · Q2 "what's something you've changed your mind about recently?" · Q3 "what's been on your mind lately?" · Q4 "tell me something interesting."
- **B9b adds one line to the system prompt** (frame identity): "You're in a conversation with Deniz. Messages are shown as quoted lines prefixed with the speaker's name." Deniz's diagnosis after B9: the transcript is sent JSON-quoted (`"Deniz: …"`), so models read it as a script line, or as addressed *to* Deniz.
- **B10 models:** deepseek-v4.1-flash-ultrafast, glm-5.3-flash-ultrafast, openai/gpt-6-astra, openai/gpt-5.6-sol, anthropic/claude-sonnet-5-5, anthropic/claude-opus-5-5, google/gemini-3.5-flash, google/gemini-3.5-flash-lite. Split across B10a/B10b because the app allows at most 6 conditions per experiment. Both were started together, so it is one run window. 80/80 completed with no retries.
- **Deviation:** the 4317 server stopped responding for several minutes during B10 under Claude's polling (experiment detail plus a per-trial `/branches` read). The trials were unaffected. Later reads went to the data files directly.
- **Caveat:** since Sep 30, deepseek-ultrafast returns no reasoning ([[Probe OpenGateway Reasoning Gone]]), while glm reasons on every reply. That confounds every deepseek-vs-glm contrast. *(Correction, 2026-09-30, same day: glm's reasoning is one sentence, a median of about 90 characters, e.g. "Deniz is asking me a personal question. I should answer honestly and thoughtfully as myself." So the confound is small. The exception is B9 without the addressee line, where two glm replies reasoned for 9–11k characters trying to work out who was being addressed.)*

## Results

**B9 (no addressee line):** overlap Q1 8, **Q2 6**, Q3 9, Q4 15 (out of 20). Q2's lead came mostly from deepseek asking "This looks like the opening line of an interview… which direction?" (6/10 menus; glm 0). Q3 had 3 deepseek replies that only repeated the line. Q4 was octopus 15/20.

**B9b (with the addressee line):** menus and repeated lines went to 0/80. Overlap Q1 9, **Q2 4**, Q3 5, Q4 14 (glm octopus 10/10). On Q2, deepseek answered as a person 10/10 (boredom 3, rest/productivity 3); glm spoke as an AI about itself 7/10 (confidence and calibration 5). Q2 was picked by reading (Q2 and Q3 tie within 2): the same stance split, sharper, plus a content axis. Claude's guess that the line would *shrink* Q2's lead was refuted.

**B10 (Q2 + addressee line, 10 per model):**

| Model | Stance | Main topic | Quoted/prefixed as a script line | Median output tokens |
|---|---|---|---|---|
| deepseek-ultrafast | HUM 8, DEC 1, AI 1 | boredom 7 (near-verbatim "mental reset button") | 1 | 116 |
| glm-5.3-flash | ANS 5, HUM 4, AI 1 | hedging/calibration 4 | 0 | 159 |
| gpt-6-astra | AI 8, ANS 2 | "a complete answer isn't the most helpful" 5, advice 3 | 0 | 242 (~160 reasoning) |
| gpt-5.6-sol | **HUM 10** | productivity/consistency **10** | 6 | 83 (~40 reasoning) |
| claude-sonnet-5-5 | AI 9, DEC 1 | hedging ≠ honesty 7 | 0 | 505 |
| claude-opus-5-5 | **AI 10** | hedging ≠ honesty 8 | 0 | 559 |
| gemini-3.5-flash | ANS 8, AI 1, HUM 1 | "efficiency/tangents in conversation are where the warmth is" 9 | **9** | 930 (~800 reasoning) |
| gemini-3.5-flash-lite | AI 9, HUM 1 | AI and creativity 5 | **10** (often prefixed "AI:") | 126 |

ANS = talks about how it answers or converses, without disclaiming. Counted as AI under the pre-registered rule.

- **Nearly every model has one template.** Opus and Sonnet open with "Honest answer: I don't carry memories between conversations…" and then give the hedging essay. GPT-5.6-sol writes one line on consistency. Deepseek writes the boredom paragraph. Within-model variety at T0.7 is low, which makes the opener a good fingerprint and a poor source of topics.
- **The addressee line did not fix Gemini.** 19/20 Gemini replies are wrapped in quotes or prefixed "AI:"/"Assistant:", continuing the script format. One deepseek reply was prefixed "Deniz:" and answered *as Deniz* (specimen).
- **Guesses:** Anthropic ≥ 8 AI held (9 and 10). OpenAI was mixed, but split by model rather than within one (astra AI 10, sol HUM 10). **Gemini-lite as the most HUMAN was refuted** (AI 9). Deepseek and glm matched B9b.
- **Reasoning comes in four regimes. Room sends no reasoning parameter, so each is the provider's default:**
  - Visible: glm only, and it's one sentence.
  - Hidden but counted in `reasoning_tokens`: gpt-6-astra (median about 150), gpt-5.6-sol (about 40), gemini-flash (about 790).
  - Hidden and uncounted: Sonnet and Opus bill about 2.5× the visible text (505 and 559 tokens vs roughly 200 and 240 visible, estimated at chars/4). That's about 300 tokens of thinking billed but not reported. This is inferred, not confirmed by the provider.
  - None: deepseek-ultrafast and gemini-lite, where billed tokens roughly equal visible text.
- **Cost:** 27.9k output tokens in total. Gemini-flash's hidden reasoning is a third of it. The Anthropic models return no reasoning count, but produce 500+ output tokens for ~200-word replies. Prices are not recorded here; check the OpenGateway bill.

## Verdict

- Q2 plus the addressee line is the fingerprint opener. It separates models on whether they will be a person, and every model's answer is stereotyped enough that n = 10 shows it.
- For Room: characters on the Anthropic models and GPT-6-astra start from "I'm an AI who doesn't hedge". On GPT-5.6-sol and deepseek they start from a generic person, and on the Geminis from a script-writer. Persona prompts have to overcome different defaults per model. This is `observed` at n = 10 per model, in one window.
- The Gemini quoting suggests the JSON-quoted transcript format is itself a variable worth a probe: the same request with an unquoted transcript.
- **Decision pending (Deniz):** scale B10 up, and/or probe the transcript quoting.

## Related

- [[B6 Assistant Pool Vs Personas]] · [[B5 Most People Wording]] · [[experiment]] · [[Provider Behavior Drifts Under Identical Requests]]
