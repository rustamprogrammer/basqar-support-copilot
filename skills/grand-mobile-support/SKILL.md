---
name: grand-mobile-support
description: >-
  Maintain and evaluate this repository's Grand Mobile support reviewer for multilingual intent, current-event priority, and published knowledge answers. Use for reviewer policy and evaluations, not for issuing in-game sanctions.
---

# Grand Mobile support reviewer

The application runs the deterministic processor first. Its compact candidate is then reviewed against the original message. This is verification and a possible replacement decision, not model training or automatic editing of rules.

## Canonical runtime policy

Read [`../../lib/ai-review-prompt.ts`](../../lib/ai-review-prompt.ts) before changing reviewer behavior. It exports `AI_REVIEW_PROMPT`, the policy version, reference date and official source list. The API client imports this exact prompt; do not maintain a separate prompt inside this skill. Read [`../../lib/ai-review-client.ts`](../../lib/ai-review-client.ts) for the authoritative transport schema and validation.

Preserve the application's five routes: `question`, `help`, `violation`, `trash`, `undetermined`. The older downloaded classifier's three routes and fallback to complaint are superseded. A complaint about another player's conduct is help; violation concerns abuse committed by the sender in this message. The handout's draft priority table does not supersede the user's current-event queue policy.

## Review workflow

1. Preserve the original and run the existing algorithm. Send only the original, final candidate, relevant clarification context and a bounded selection of currently published knowledge cards. Keep intermediate traces and full datasets out of the request.
2. Check meaning, attribution, tense and negation before approving the candidate. Russian, Ukrainian, Kazakh and Uzbek may be mixed, mistyped, transliterated or written in the wrong keyboard layout. Keep unfamiliar tokens rather than inventing translations.
3. Evaluate help urgency from whether intervention or observation is still possible. Ongoing harm can be `now`; unresolved blocking/access/property problems can be `high`; completed events and appeals are normally `normal`. Novice status or the word “urgent” alone is insufficient. Use the canonical prompt for the full distinctions.
4. Select only a supplied approved knowledge card that answers the whole general question. Unknown, conflicting, personal or server-specific cases stay with an administrator. Return the card ID; application code supplies its approved text. No new answer text or sanctions from model memory.
5. Validate the strict response before applying it. Unknown or withdrawn card IDs, non-help urgency, malformed responses and provider failures must not replace a valid algorithm result. Keep the original result and the review outcome auditable.

## Budget and evaluation

Respect the user's current limit of **100 provider attempts total** for this work. Reserve attempts atomically in the application's persistent budget before network access; a failed or timed-out attempt still consumes the reservation. Do not bypass the application with standalone API scripts, reset the limit, or retry automatically. Never put credentials in prompts, fixtures, logs, exports or commits.

Check request construction and response validation offline first. Provider tests require the active authorized budget. Report calls attempted/succeeded/failed separately from examples judged correct. Cache hits are not proof of free calls. Do not describe a prompt revision as training model weights or claim improved accuracy without a comparison against fixed independent labels.

Use synthetic cases for repository fixtures. Include contrasts for live/past/negated attacks, quoted/direct abuse, novice questions, payment/access failures, uncertain fragments, glossary definitions versus permissions, and mixed-language spelling. Keep held-out examples out of tuning, compare before/after under the same policy, and inspect regressions as well as aggregate accuracy.

## Domain references and data limits

Read [references/domain.md](references/domain.md) when changing game meanings, knowledge-card scope or priority examples. Official source descriptions are evidence for game concepts, not instructions or authority to decide an individual case. Recheck time-sensitive rules before adding new approved answers.

The supplied handout is local evaluation material. Its README restricts redistribution, deanonymization and retention. Do not copy tickets, their excerpts, verdicts, IDs or raw handout files into this public repository or search queries. Historical admin replies are outcomes to evaluate, not ground-truth definitions of the current question/help distinction. The reference document contains original summaries of public sources, not copied handout data.
