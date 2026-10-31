# Synthetic contest training and evaluation data

`contest-training.jsonl` has 72 original scenarios (12 each in Russian, Kazakh, Uzbek, English, Spanish and Portuguese). `contest-holdout.jsonl` has 24 separate scenarios (four per language). Both contain all 14 category codes and all four priorities. The records are authored synthetic examples, not private ticket excerpts, translated copies of the existing regression set or historical administrator answers.

Each row is `{id, scenario_id, ticket, expected}`. `scenario_id` is the family identifier; the file determines the split. `expected` contains `lang`, `category`, `priority` and `needs_human: true`. All labels were set before any model run on these records. The manifest freezes the original files with SHA-256 of UTF-8 content using LF line endings. A label correction must carry an explicit reviewed dataset revision; do not change labels just to agree with a model.

These labels were written by an AI assistant using the intended taxonomy. They have **not** been reviewed by a human or native speakers. The two small splits are useful smoke tests. Neither their size nor the name “holdout” makes the result an independent estimate of performance on real players. Once holdout errors have informed a change, later runs are regression checks rather than fresh evaluation.

## Provisional label policy

- Input channel is preserved: formal complaints use `complaint.*`; player reports use `report.*`.
- Complaint topics distinguish insults, cheating, unprovoked violence/NonRP, scams, real-money trading/advertising, administrator conduct and other concrete misconduct. An absent incident description is `complaint.invalid`; lack of evidence alone does not erase a concrete allegation.
- Reports distinguish factual gameplay questions, help with a specific problem, allegations about other players, account/property issues, payment problems and off-topic conversation.
- `p0`: lost account access, a payment incident, a credible real-life threat, or a clearly widespread technical failure. A how-to payment question is not a payment incident.
- `p1`: cheating or RMT/advertising allegations, a substantive formal complaint with attached evidence, or an explicitly major property scam. Attachments are submitted claims, not proof of guilt.
- `p2`: ordinary concrete support/property issues, reports about another player, and questions about rules.
- `p3`: general how-to questions, off-topic/invalid input and ordinary formal complaints without attached evidence. Critical conditions take precedence.
- Every row requires a human. Labels do not authorize sanctions, refunds, account recovery, or automatically sending a generated response.

The policy is a provisional development interpretation and still requires organizer confirmation. Jury weights 25/30/20/15/10 are scoring weights, not class quotas, and are not encoded as training labels.

## Validation and use

Run `node scripts/validate-contest-data.mjs`. It checks the frozen checksums, contracts, category/channel agreement, counts, unique IDs, separate scenario families and exact text overlap. It imports neither the classifier nor any model client and performs no inference or network access.

Use training rows for development. Reserve holdout for a declared final evaluation, without choosing prompts, thresholds or models from its errors. Keep model outputs separate from these label files. A report should include category accuracy, priority macro-F1 and language accuracy separately, plus human-review handling. Six-language fluency and citation correctness require additional reviewed target data.

The planned model decision is `{lang, category, priority, draft, citation_ids, needs_human, reason}`. These files deliberately do not invent draft targets or rule citations. A supervised fine-tuning export requires separately reviewed draft text, reasons and citation IDs checked against the exact supplied source passages. Do not turn the current classifier's predictions into ground truth, or fill missing targets with fabricated references. Provider training availability, model support, price and explicit authorization must be checked before any upload or job creation.

## Separately frozen final check

`contest-final.jsonl` adds 24 newly authored incidents, four per supported language, after the earlier holdout was studied. Its separate manifest freezes the LF-normalized SHA-256 before any model call. All 14 categories and p0–p3 appear; every row requires human review. The examples include explicit negative context such as a rules question about account sharing with intact access, a menu question without a failed purchase, and a server-wide game-currency bug explicitly distinguished from a card payment.

The final file is excluded from training and from the earlier two-split validator. A separate pre-inference check confirmed `parseTicket` validity, category/channel agreement, all expected labels, 24 unique IDs and families, and no exact normalized player-text overlap with training/holdout. The author used no classifier or model to create or adjust labels. No native-language or independent human review has occurred.

Run the final model evaluation once with fixed implementation and settings, then report the observed result, including failures. Do not improve the same score by tuning to these errors. “Final” describes the protocol, not a guarantee of independence, adequate sample size or real-world quality: the author knew the development context, and four cases per language cannot establish language performance.
