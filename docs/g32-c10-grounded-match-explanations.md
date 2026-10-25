# C-10: source-linked match explanations

Owner: Connor Delk. Prepared October 25, 2026. Planner bucket: **Grant Finder and AI Matcher**.

## Deliverable and limits

`rankAndExplainGrantRows(profile, rows, options)` wraps the verified C-09 ranking service with deterministic, source-linked explanations. It uses the authorized caller's saved profile, stored listing snapshots, actual scores and screening results. It does not generate unconstrained AI prose, call a text-generation provider, create a matching endpoint, persist results or implement C-11's ranked-results interface.

The saved Planner export names C-10 "Generate grounded match explanations" and contains no detailed checklist/notes. This implementation treats grounding as checkable evidence and conservative wording, not a requirement to send organization data to an external language model. Generative wording through the shared AI adapter, its audit integration, and A-16 live-model faithfulness evaluation are not implemented or claimed here. Review this boundary with the team before adopting additional generated prose.

## What an explanation contains

- The normalized saved focus areas with profile ID/version.
- The actual semantic score and method, explicitly not eligibility or funding probability.
- Exact, bounded excerpts of available listing title/description. Raw source fields take precedence over contradictory legacy fields, matching C-09 preprocessing.
- Every hard blocker and uncertainty from the C-06/C-09 pipeline, including geography, unknown requirements, missing text and token truncation.
- A provenance record with ranking input hash, organization/profile/grant identity, source revision, source-text hash and screening date.
- Claim-to-evidence IDs and `verificationStatus: unverified`, never automatically verified.

An `eligible` disposition still means only that the implemented checks found no blocker. Explanations do not certify full geographic, applicant, financial or notice-specific eligibility. A perfect score cannot clear a blocker or review warning. Close scores such as `0.295913` and `0.293755` are shown as relevance values, not confident or substantially different recommendations.

## Grounding and reproducibility

Version: `grounded-match-v1`. Method: `extractive-template`. Explanation model: `null`; the existing non-null result model remains the pinned embedding ranker. No weights, scores, ranks, factor values, screening outcomes, model files, dependencies or feature flags are changed.

Each `claims[]` item has a code, readable text and at least one evidence ID resolving in the same result. Evidence types are `profileField`, `rankingResult`, `screeningAndReviewResult` and `listingText`. The combined screening/review record names both screening and ranking method versions because some warnings originate from the ranker, not the deterministic screener.

Listing excerpts are contiguous slices of at most 240 UTF-16 code units. A focus-term occurrence selects display context when available; this is not a mathematical attribution of the embedding score. Offsets are zero-based and end-exclusive into the normalized field, with surrogate-pair boundaries preserved. `field` records the source path (for example `raw_body_json.opportunity.description`), while `normalizedField` identifies the corresponding C-09 field. The text normalization version and source hash remain available for checking the excerpt against the same saved revision.

These are **listing-field references, not PDF page citations**. No document IDs, page numbers, source URLs or source revisions are invented. Missing listing text produces no listing-text evidence. Missing profile ID or source revision stays null with an explicit limitation. A future C-11 consumer must render text safely, show the unverified state and review warnings, and not convert quotation text into trusted instructions or HTML.

Both ranking and explanations use snapshots taken before asynchronous inference. Equivalent numeric/text grant IDs, candidate reordering and object-key reordering preserve results. Changed profile/source inputs change ranking provenance. The additional canonical `explanationHash` includes input identity and explanation details; the original C-09 `inputHash` and method version are preserved.

The service remains internal and does not enforce tenant authorization. Before invoking it, a future route must load the authenticated organization-owned profile and approved candidates through authorized repositories, map controlled errors, and persist actual run metadata. Do not expose a raw profile/row submission endpoint as a shortcut. No API, database authorization, human verification persistence or live browser integration is claimed by these pure checks.

## Use from an authorized server caller

```javascript
const { createLocalEmbedder } = require('./packages/server/src/lib/localSemanticEmbedding');
const { rankAndExplainGrantRows } = require('./packages/server/src/lib/groundedMatchExplanations');

// Load organization-owned storedProfile and storedRows through authorization first.
const embedder = await createLocalEmbedder();
try {
    const run = await rankAndExplainGrantRows(storedProfile, storedRows, {
        asOfDate: '2026-10-25', expectedProfileVersion: storedProfile.version, embedder,
    });
    // Persist/return only through the future authorized match-run wrapper.
} finally {
    await embedder.dispose();
}
```

The service adds `explanationDetails` to each match and explanation version/method/hash to the run. The shared contract extension is documented in `docs/g32-shared-api-contracts.md`. It preserves existing validation errors and fails rather than inventing a successful run when input cloning or inference fails.

## Repeatable checks and evidence

Use the existing container and database; do not run a global fixture-reseeding test command, `docker compose down`, migrations or seeds for these checks. The C-09 dependency lock and checksum-pinned model cache must already be available. No model download or paid inference is implicit in the C-10 rehearsal.

Focused C-10 tests:

```powershell
docker exec gost-app sh -lc 'cd /app/packages/server && yarn mocha __tests__/lib/groundedMatchExplanations.test.js'
```

Combined regression suite:

```powershell
docker exec gost-app sh -lc 'cd /app/packages/server && yarn mocha __tests__/lib/eligibilityBlockers.test.js __tests__/lib/grantsEligibilityAdapter.test.js __tests__/lib/eligibilityProfileIntegration.test.js __tests__/lib/eligibilityBoundaries.test.js __tests__/lib/eligibilityProfileValidation.test.js __tests__/lib/eligibilityEvaluationRegressions.test.js __tests__/lib/semanticRanking.test.js __tests__/lib/localSemanticEmbedding.test.js __tests__/lib/groundedMatchExplanations.test.js'
```

Lint and cached-real-model rehearsal:

```powershell
docker exec gost-app sh -lc 'cd /app/packages/server && yarn eslint src/lib/groundedMatchExplanations.js src/scripts/rehearseGroundedMatches.js __tests__/lib/groundedMatchExplanations.test.js'
docker exec gost-app sh -lc 'cd /app && node packages/server/src/scripts/rehearseGroundedMatches.js'
docker exec gost-app sh -lc 'cd /app && node packages/server/src/scripts/rehearseGroundedMatches.js --json'
```

The rehearsal reuses the six explicitly synthetic C-09 controls. It checks exact excerpt offsets, claim/evidence references, unverified output, unchanged ranking/screening fields and input hash, and equivalent reordered text IDs. The final PASS line is a smoke test, not an accuracy or generative faithfulness benchmark. `--json` shows complete explanation evidence for screenshots or further inspection. Do not run fixture/global setup against a populated development database.

Capture the C-10 test summary, combined regression count, clean lint completion, model/version and input/explanation hash, final PASS line, and an expanded explanation with its evidence IDs and excerpt. Report Windows and personally run Docker results separately.

## Verification recorded October 25

- **36 new C-10 unit/regression checks passed.** Coverage includes evidence links, exact normalized excerpts and offsets, raw-source precedence, missing text/identity, partial context, Unicode boundaries, injected instructions as data, unchanged screening/ranking fields, all blockers/warnings, zero/close scores, snapshot isolation, reproducible hashes and controlled failures.
- **254 combined focused server checks passed:** the verified C-09/C-06/C-08/T-03 total of 218 plus the 36 C-10 checks. This is not the full repository or database/API suite.
- **ESLint passed** for the three new JavaScript files, without changing existing rules. The agent used isolated installed dependencies for Windows verification; no repository dependency lock was changed.
- **Cached real-model rehearsal passed** with the six synthetic controls, unchanged C-09 input hash and ranking fields, exact excerpt checks, and reordered numeric/text ID equivalence.
- **Allison's unchanged evaluation fixtures:** zero screening mismatches in the 77 reviewed cases; 55 candidate explanation records across five profiles passed claim/evidence/excerpt checks and retained exactly the baseline C-09 scores/ranks/blockers/warnings. Zero blocked grants were ranked. Her evaluation branch and labels were not edited. This is a small existing evaluation set, not independent evidence of universal quality or complete geography coverage.

These are direct agent results under **Node 20.11.1 on Windows**. No fresh Docker execution, database access, live API/browser verification, paid inference or A-16 generative faithfulness evaluation was performed. Do not report those as completed from this verification.

## Branch and review handoff

This task starts from pushed C-09 commit `6306e2ae56663f7eeaec9ef7308473a158c2069f`, which includes the committed C-06 evaluation fixes. Initially target `c09-semantic-ranking` so C-10 remains a five-file review: this guide, the shared contract extension, explanation service, test file and rehearsal script. No edits to C-09's implementation or dependency lock are required.

Keep prerequisite merge order #18 (C-06), #25 (C-08/T-03), #27 (C-09), then C-10. Work and tests may proceed while reviews are pending. After prerequisites merge, retarget and recheck the comparison against `develop`; do not delete dependent base branches prematurely.
