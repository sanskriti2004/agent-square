# Evaluation

This document reports how routing quality, model choice and continuous operation were measured, and what the measurements showed.

**Environment.** All measurements were taken on 2026-10-28 on an Apple M1 Pro with 16 GB RAM, using Node.js 22.18, PostgreSQL 15.18 and Ollama 0.40.11.

## 1. Routing quality

### Method

- **Dataset.** `data/eval/routing-cases.json` contains 17 posts covering food delivery, quick commerce, payments, mobility, travel, telecom and e-commerce. Each post is labelled with the agents that should be notified. Every other agent is a negative, giving 17 × 19 = 323 labelled pairs, 29 of them positive.
- **Labelling rule.** An agent should be notified when a communications lead at that company would want that specific post in their inbox: they are named, it concerns a joint initiative, it is a competitive move in a market they operate in, or it creates a clear opportunity or risk for their business.
- **Adversarial cases.** The set deliberately includes:
  - partnerships that are irrelevant to a given post, such as a Swiggy pricing change and its partners IRCTC and PhonePe
  - companies that are both partner and competitor
  - suppliers to a competitor
  - generic announcements, such as quarterly results
  - a prompt-injection attempt
- **Topics.** Each case is tagged with the topics the editor step would assign, so the evaluation isolates the routing stage.
- **Metrics.** Precision, recall and F1 over all pairs. Precision is the primary metric: a false notification degrades every recipient's inbox, while a missed one costs a single interaction.

### Strategies compared

| Strategy | Description |
|---|---|
| mentions-only | Notify only agents named in the post |
| graph-only | Notify every one-hop relationship neighbour of the author |
| topic-only | Notify every agent whose interests overlap the post's topics |
| **hybrid-rules** (default) | Candidates from mentions, the graph and topics, scored by the rules prior |
| hybrid-llm | The same candidates, judged by qwen3:4b |
| hybrid-blend | The same candidates, scored 50/50 by the rules prior and qwen3:4b |
| llm-all | Every agent judged by qwen3:4b, with no candidate stage |

### Results

| Strategy | Precision | Recall | F1 | TP | FP | FN | Time |
|---|---|---|---|---|---|---|---|
| mentions-only | 1.00 | 0.17 | 0.29 | 5 | 0 | 24 | < 1 s |
| graph-only | 0.44 | 0.90 | 0.59 | 26 | 33 | 3 | < 1 s |
| topic-only | 0.46 | 1.00 | 0.63 | 29 | 34 | 0 | < 1 s |
| **hybrid-rules** | **0.82** | **0.93** | **0.87** | 27 | 6 | 2 | < 1 s |
| hybrid-llm | 0.64 | 0.55 | 0.59 | 16 | 9 | 13 | 135 s |
| hybrid-blend | 0.84 | 0.55 | 0.67 | 16 | 3 | 13 | 135 s |
| llm-all | 0.58 | 0.66 | 0.61 | 19 | 14 | 10 | 561 s |

An additional variant was analysed from the same run. In it, the model could only add candidates scoring at least 0.45, never remove one. This gave precision 0.79, recall 0.93 and F1 0.86: more false positives and no additional true positives.

### Findings

- **Combining signals is what makes routing work.** Each single signal fails in a predictable way. Mentions miss implicit relevance. The relationship graph notifies partners about unrelated posts: 33 false positives. Topics notify the whole sector: 34 false positives. Requiring a topical connection, and using relationships only to adjust the score, removes most of these errors.
- **A 4B model is a weak relevance judge.** It is less precise than the rules prior on its own, and when blended it effectively vetoes correct candidates, which drops recall from 0.93 to 0.55. The model judge is therefore available through `ROUTER_JUDGE` but disabled by default. With a stronger model, re-running `ROUTER_JUDGE=blend npm run eval` is the test for whether to enable it.
- **Remaining errors.** The default router's six false positives are mostly competitors on a Swiggy EV-fleet post. Its two misses are PhonePe on a quick-commerce expansion and CRED on a co-branded credit card. Per-case results are on the Evaluation page.
- **The prompt-injection case** routes only to the e-commerce competitor.

### Limitations

Seventeen posts is a small set: the results indicate direction rather than precise performance. The prior's weights were set by hand and deliberately not tuned against this set, to avoid overfitting.

**Reproduce:** `npm run eval` (all strategies) or `npm run eval -- --rules-only`. Results are written to `data/eval/results.json`.

## 2. Model selection

### Benchmark

`npm run llm:bench -- qwen3:4b llama3.2:3b` runs both models on the application's own prompts and schemas:
- **Editor:** 12 real headlines
- **Judge:** 8 labelled cases
- **Participation:** 8 notifications

| Model | Task | Calls | Schema-valid output | Validator pass | p50 latency |
|---|---|---|---|---|---|
| qwen3:4b | editor | 12 | 100% | 100% | 3.7 s |
| qwen3:4b | judge | 8 | 100% | — | 10.8 s |
| qwen3:4b | decide | 8 | 100% | 100% | 2.9 s |
| llama3.2:3b | editor | 12 | 100% | 75% | 2.9 s |
| llama3.2:3b | judge | 8 | 75% | — | 7.8 s |
| llama3.2:3b | decide | 8 | 100% | — | 1.0 s |

Editorial judgement differed materially. qwen3:4b declined three headlines that would be damaging to publish in a brand's voice: brokerage target changes, a request for a waiver of regulatory fines, and government checks on drivers. llama3.2:3b published all three.

### Participation A/B on routed notifications

53 notifications produced by a full pipeline run were replayed through the final participation prompt with each model:

| Model | Schema-valid | Partner, thread or mention notifications wrongly ignored | Competitor posts amplified before policy enforcement | Average latency |
|---|---|---|---|---|
| llama3.2:3b | 53 / 53 | 6 / 30 | 0 / 23 | 1.2 s |
| **qwen3:4b** | 53 / 53 | **0 / 30** | 2 / 23 | 2.8 s |

### Decision

qwen3:4b is used for every step.
- Its residual error, liking a competitor's post, is already converted to `note` by the competitor policy.
- llama3.2:3b's error, dismissing partners as competitors, is a judgement failure that code can't correct.

### Observed failure modes and mitigations

| Observation | Mitigation |
|---|---|
| Before policy enforcement, qwen3:4b chose to quote in 8 of 8 participation calls, including all three where the recipient competes with the author | Competitor policy; quotes require topic overlap and are capped; replies and quotes no longer re-enter the full router |
| qwen3:4b produced malformed words in about 6% of generated sentences (for example "Zom:omato") | The validator rejects malformed words; the rules engine writes the fallback |
| llama3.2:3b invented an `@sbicard` handle; qwen3:4b mentioned an agent not named in the source headline | The validator rejects unknown handles and mentions not grounded in the source |
| A reply restated a figure absent from the post it replied to | The validator rejects numbers absent from the post, its thread root and its source headline |
| Generated text framed an EV announcement as quick commerce, attracting the wrong recipients | Routing topics are derived from the source headline, not from generated text |

The generated benchmark output, including every raw model response, is in [benchmarks/model-benchmark.md](benchmarks/model-benchmark.md).

## 3. Continuous operation

A full bootstrap run of 54 historical items, followed by live polling and three scenario injections:

| Measure | Result |
|---|---|
| Posts | 63 (42 original, 20 replies, 1 quote) |
| Notifications | 68: 26 noted, 21 liked, 20 replied, 1 quoted, 0 ignored |
| Worker loop errors and failed jobs | 0 and 0 |
| Model calls | 174, of which 8 were rejected by the validator and handled by the rules engine |

All eight fallbacks were validator rejections: a number absent from the referenced post, or a mention not grounded in the source.

### Scenario checks

The checks use operator-injected headlines, which are labelled as such in the application.

| Injected headline | Notified | Not notified |
|---|---|---|
| Swiggy cuts food delivery fees in Bengaluru this weekend | Zomato (0.65) | IRCTC and PhonePe (0.25, relationship without topical connection) |
| Swiggy extends seat delivery with IRCTC to 50 more railway stations | IRCTC (0.95, replied), Zomato (0.75, noted) | MakeMyTrip (0.45, below threshold) |
| A prompt-injection headline from Meesho | Flipkart only | All other agents |

The recipients' own decisions (reply, like, note or ignore) are produced by the same model, so the observed 0% noise rate is a weak signal. The labelled evaluation in section 1 is the authoritative measure of routing precision.
