# Contest triage and reviewable drafts

## Verified implementation update 31 October 2026

The attached Decentrathon brief weights classification 25%, blind administrator draft review 30%, citation existence and relevance 20%, native Kazakh/Uzbek draft quality 15%, and cost/latency 10%. Its target is at most $0.002 per ticket and p95 at most 5 seconds. These are evaluation requirements, not a claim that this repository has achieved a jury score of 100.

The optional contest RAG path uses GPT-6 Luna with a strict structured response, selected rule passages, validated citation IDs, bounded request cost, a four-second provider deadline and a local fallback. Generated text always needs an administrator before sending. The model is prompted and grounded at inference time; its weights have not been fine-tuned. GPT-6 Luna does not support fine-tuning according to the official model documentation: https://developers.openai.com/api/docs/models/gpt-6-luna .

A separate local TF-IDF/logistic-regression candidate can be trained with `scripts/ml/train-contest-candidate.mjs`. The first candidate trained on 54 synthetic training and 18 validation records passed Python/TypeScript parity but failed the acceptance gate on 24 further records; it was not activated. A raw classifier accuracy gain is not evidence of better production behaviour when its confidence gate accepts no decisions.

The authored datasets in `evaluation/contest-*.jsonl` have fixed manifests and provisional labels. They contain no provided private tickets and have not been approved by native speakers. Once their errors are inspected for development they must not be presented as a fresh independent holdout again. Never train on hidden tests or use historical administrator outcomes as input features.

`scripts/evaluate-contest-api.mjs` performs an explicitly paid evaluation using a separate local spend ledger. It reserves the conservative maximum before every request, never retries automatically, and includes timeout uncertainty. Pass `--in`, `--out`, `--ledger`, `--budget-usd` (maximum 2) and either the `OPENAI_API_KEY` environment variable or an explicit `--key-file`. The ledger is for the evaluation run; the application's persistent 100-attempt counter remains separate. Reports and private source excerpts must stay outside Git.

Standard GPT-6 Luna rates used by the cost calculation on 2026-10-31 are $0.10/M ordinary input, $0.01/M cached reads, $0.125/M 30-minute cache writes and $0.50/M output tokens. The request selects `service_tier: "default"` and `prompt_cache_options: {mode: "implicit", ttl: "30m"}`. Ordinary input is `input_tokens - cached_tokens - cache_write_tokens`; write tokens replace the ordinary input charge, rather than adding a surcharge. The preflight bound assumes all input tokens incur the higher $0.125/M write rate. Verify rates against [OpenAI pricing](https://developers.openai.com/api/docs/pricing) and the accounting formula in [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) before changing models, cache TTL or service tiers. An unknown provider charge is recorded as null, not zero.

The support workspace retains its question/help/violation/trash routes and current-event urgency. The contest contract adds a separate category and p0–p3 priority. An accepted AI p0 raises queue urgency to `now`, and p1 to at least `high`, without inventing an ongoing event or a need for live observation. Existing higher urgency is preserved. The supplied taxonomy is marked draft and needs organizer confirmation before submission.

The [100-case adversarial verification](adversarial-verification-2026-10-31.md) records a zero-API algorithm baseline, raw independent AI decisions (no local fallback counted as AI success), and actual hybrid predictions after general policy corrections. Its separate frozen 20-case check exposes remaining errors. `scripts/evaluate-adversarial.mjs` validates the entire dataset/manifest before inference, locks the shared spend ledger and checkpoints each paid attempt. It does not automatically retry failures. Direct Node evaluation bypasses application D1 caching, request caps and rate limits; the report distinguishes this from local HTTP integration checks.

## Prepare and run

Node 22.13+ is required. Node 24 is recommended for direct TypeScript execution.

1. Install dependencies with `npm run install:ci`.
2. Prepare the private rule corpus: `npm run triage:prepare -- --rules /private/rules.json`. Alternatively pass `--archive /private/grand-support-copilot-handout-2026-10-27.tgz` (requires tar).
3. Run `npm run build`. It fails clearly if the corpus is missing, rather than silently claiming RAG works.
4. Apply the existing migrations, `drizzle/0007_triage_history.sql` and `drizzle/0008_ai_rate_limits.sql` to the intended local database. Back up an existing database first; do not replay old migrations blindly.
5. Start the normal application. `POST /triage` is available alongside the support UI.

The generated `lib/triage/corpus.local.json` is excluded from Git. It must be prepared on every build machine. It contains only the supplied rules, never ticket texts or admin outcomes. Do not publish the handout, generated corpus, local predictions or real ticket excerpts. The HTML client does not import the complete corpus. Selected supporting passages are sent with a triage result for review.

If Windows folder protection blocks Node from writing into Documents, use a development directory permitted by your Windows configuration. Do not disable antivirus protections just to build the app.

## HTTP contract

```json
{"kind":"complaint","images_count":1,"reported_nick":"Sample_Test","messages":[{"role":"player","text":"Этот игрок оскорбил меня"}]}
```

The response contains `lang`, `category`, `priority`, `is_spam_or_duplicate`, `extracted`, `draft_reply`, `needs_human`, `confidence`, `reasons` and diagnostic `meta`. Category codes follow the 14 handout categories. `meta.live_urgency` is separate from `priority`. `confidence` is explicitly heuristic, not calibrated accuracy.

Only player messages establish the request. Admin messages, verdict, punishment and violation fields are excluded from inference; historical final answers are not model inputs. Reported-player messages are accepted by the input contract but are not used by the initial local classifier. This limitation needs evaluation for disputed cases.

Nickname and rule references are extracted as player-supplied claims. `has_evidence` means a positive attachment count, not that an image was inspected. Mentioning “screenshots exist” alone does not prove an attachment exists. Selected source passages do not establish guilt.

Payments, access/property issues and appeals require human review. Drafts never promise punishment, an unban or a refund. A sender's abuse is retained in `meta.moderation_flag` without hiding the underlying payment/access issue. A validated substantive model decision can restore a locally rejected case to the administrator queue; the original route remains in the algorithm snapshot. A failed/limited model check also queues substantive rejected text for manual review without inventing a model decision.

## Rules and answer generation

All 11 sections are imported, including the RP terminology section with an empty points array. Rule keys are internal `section-id:ref` pairs. `draft_reply.cited` retains the original rule ref; `meta.citations` disambiguates the section and contains the supporting passage. Unnumbered definitions are identified by their actual section and term name, never assigned a fictitious numbered rule.

Retrieval is local, bounded and section-aware. Topic and rule-content guards exclude unrelated event rules before lexical ranking. Unknown topics abstain. This is a conservative retrieval baseline, not proof of perfect relevance.

Local drafts use authored templates in ru/kk/uz/en/es/pt plus published Russian FAQ cards. When enabled, the managed contest model can generate a draft using bounded source passages and exact source IDs; the server validates IDs before applying the result. Every generated draft requires administrator review. Kazakh and Uzbek templates and model drafts still need native-speaker evaluation. Unknown language falls back to a Russian local draft with `lang=und` for the input and human review. Only a matching published Russian FAQ can avoid human review.

## Integration with the teammate's AI

`lib/triage/managed-model.ts` uses the existing encrypted key and shared persistent 100-attempt reservation ledger. It has a separate `contest:` content-addressed cache namespace, validates stored model results, and does not automatically retry interrupted or failed paid requests. The currently priced contest model is `gpt-6-luna`; another selected model falls back locally. No separate credentials or provider SDK are introduced. Paid API tests are not part of the local test suite.

Both `/triage` and `/api/messages` use a local baseline followed by at most one managed contest-model call. The shared `chooseContestReview` gate uses observable input and local evidence, never evaluation labels or heuristic confidence as an accuracy estimate. In `uncertain` mode only a short whole-input verified Russian FAQ without extra conditions, or an anchored standalone greeting, skips AI. `all` reviews every eligible input including FAQ. Difficult adversarial traffic can therefore call AI almost every time; this gate does not promise a large cost saving.

The model receives an independent source selection and a neutral language hint, never a predicted local category, draft or language. A wrong local route must not anchor the model. Generated drafts are never saved as an automatic knowledge reply. Inputs exceeding the model's 8000-character limit use local processing without truncation. Attachment presence uses both ticket-level and player-message counts without double-counting an explicit total.

Before a new paid reservation, a transactional limiter allows six attempts per minute per visitor-cookie hash and twenty per minute across the installation. IP request headers are not used as trusted identity. The global bucket limits cookie rotation. Matching cached requests do not consume quota or another attempt. Migration `0008` is required, and `/api/health` checks it alongside the duplicate-history schema.

`/api/messages` stores the triage alongside the existing processing trace, so the admin can see the original, draft, sources and final sent reply. “Edit and send” fills the existing reply form; the administrator must submit it. Escalation stores a reason and history entry, not an external message or automatic permission change.

## Batch and evaluation

```sh
make predict IN=tickets.jsonl OUT=pred.jsonl
# Windows without make:
npm run triage:predict -- --in tickets.jsonl --out pred.jsonl
node --test lib/triage/*.test.ts
node scripts/evaluate-triage.mjs --in evaluation/triage-regression.jsonl --out report.local.json
```

Batch prediction is intentionally local and spends no API budget. HTTP can include AI review if enabled in settings: do not compare the two as the same model configuration. Output is written atomically. Bad input fails with the record number; it never silently skips a ticket. Keep predictions outside Git.

The regression fixture is authored, synthetic and includes all category codes; it is not a hidden or independent quality estimate. The evaluator also accepts private JSONL rows shaped as `{ticket, expected: {category, priority}}`, reports category accuracy, priority macro-F1 across four classes, language breakdown, human-review rate, citation existence and processor p95. Human ratings of relevance, fluency and usefulness remain necessary. It never substitutes admin outcome labels for category labels.

HTTP timing includes parsing/reviewer/retrieval in `meta.elapsed_ms`. Local processing without a provider call reports zero provider cost; infrastructure cost is not included. Paid review preserves `provider_usage` and calculates `api_cost_usd` from validated token usage and the configured standard rates above. A saved result reused without a new call reports zero incremental cost. Unknown charges, including timeouts without usage, remain null; missing price is not zero cost. Measure cold and warm end-to-end p95 independently, including failures.

Deduplication preserves the original case, priority and human flag. HTTP stores hashed identities and conservative text signatures for matching requests from one reporter in an hour. It retains only a day of processing history. Batch uses up to 10,000 preceding entries with supplied timestamps. This is normalized exact matching, not semantic deduplication; paraphrases are not guaranteed to merge. No cross-player deduplication is performed.

## Release gates still requiring evidence

- Confirm final organizer taxonomy and interpretation of unnumbered source citations.
- Independently label fresh real tickets for category and priority; do not tune on this evaluation set.
- Blindly rate 100 drafts, including Kazakh and Uzbek reviewed by native speakers.
- Verify correct citations, not merely existing refs, and review conservative abstentions.
- Measure the enabled AI mode's total cost and HTTP p95 under representative load.
- Test final deployment with its migrations, runtime configuration and actual build commit.

Passing unit tests or providing all JSON fields is not a claim of a 100/100 jury score.
