# Contest triage and reviewable drafts

The support workspace retains its question/help/violation/trash routes and current-event urgency. The contest contract adds a separate category and p0–p3 priority; these must not be conflated with the existing queue policy. The supplied taxonomy is marked draft and needs organizer confirmation before submission.

## Prepare and run

Node 22.13+ is required. Node 24 is recommended for direct TypeScript execution.

1. Install dependencies with `npm run install:ci`.
2. Prepare the private rule corpus: `npm run triage:prepare -- --rules /private/rules.json`. Alternatively pass `--archive /private/grand-support-copilot-handout-2026-10-27.tgz` (requires tar).
3. Run `npm run build`. It fails clearly if the corpus is missing, rather than silently claiming RAG works.
4. Apply the existing migrations and `drizzle/0007_triage_history.sql` to the intended local database. Back up an existing database first; do not replay old migrations blindly.
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

Payments, access/property issues and appeals require human review. Drafts never promise punishment, an unban or a refund. A sender's abuse is retained in `meta.moderation_flag` without hiding the underlying payment/access issue. In the existing UI the moderation box is preserved; an administrator can restore the case before replying.

## Rules and answer generation

All 11 sections are imported, including the RP terminology section with an empty points array. Rule keys are internal `section-id:ref` pairs. `draft_reply.cited` retains the original rule ref; `meta.citations` disambiguates the section and contains the supporting passage. Unnumbered definitions are identified by their actual section and term name, never assigned a fictitious numbered rule.

Retrieval is local, bounded and section-aware. Topic and rule-content guards exclude unrelated event rules before lexical ranking. Unknown topics abstain. This is a conservative retrieval baseline, not proof of perfect relevance.

Drafts currently use authored templates in ru/kk/uz/en/es/pt plus published Russian FAQ cards. Kazakh and Uzbek templates need native-speaker approval; they are not sent automatically. Unknown language falls back to a Russian draft with `lang=und` for the input and human review. Only a matching published Russian FAQ can avoid human review. General custom LLM answer generation is not enabled by this module.

## Integration with the teammate's AI

`lib/triage/server.ts` calls the existing `processServerMessageWithReview`. Its encrypted key, selected model, uncertain/all setting, persistent 100-attempt cap and no-retry policy are preserved. No separate provider SDK or credentials are introduced. Paid API tests are not part of the local test suite.

The reviewed text may help the contest adapter understand a multilingual request. The AI's current five-box decision is not silently treated as a prediction of the 14 contest categories. Long inputs above the reviewer's 2000-character limit use the local processor without truncation and receive an explicit reason.

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

HTTP timing includes parsing/reviewer/retrieval in `meta.elapsed_ms`. Local mode reports zero provider cost; infrastructure cost is not included. For paid review `provider_usage` is preserved and `api_cost_usd` is null unless a cached result incurred no new charge. Configure verified prices for the actual model before asserting the $0.002 requirement; missing price is not zero cost. Measure cold and warm end-to-end p95 independently, including failures.

Deduplication preserves the original case, priority and human flag. HTTP stores hashed identities and conservative text signatures for matching requests from one reporter in an hour. It retains only a day of processing history. Batch uses up to 10,000 preceding entries with supplied timestamps. This is normalized exact matching, not semantic deduplication; paraphrases are not guaranteed to merge. No cross-player deduplication is performed.

## Release gates still requiring evidence

- Confirm final organizer taxonomy and interpretation of unnumbered source citations.
- Independently label fresh real tickets for category and priority; do not tune on this evaluation set.
- Blindly rate 100 drafts, including Kazakh and Uzbek reviewed by native speakers.
- Verify correct citations, not merely existing refs, and review conservative abstentions.
- Measure the enabled AI mode's total cost and HTTP p95 under representative load.
- Test final deployment with its migrations, runtime configuration and actual build commit.

Passing unit tests or providing all JSON fields is not a claim of a 100/100 jury score.
