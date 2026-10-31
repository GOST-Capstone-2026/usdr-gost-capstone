# G32 C-06 Deterministic eligibility screening

Owner: Connor Delk. Implemented October 4, 2026; evaluation fixes prepared October 25. Current method version: `eligibility-v2` (previously `eligibility-v1`).

## Purpose and integration boundary

This server service screens a stored organization profile against an opportunity before semantic ranking. It has no AI, network, database-write, or browser dependency. It returns the C-02 dispositions `eligible`, `blocked`, and `reviewRequired`, with visible blocker codes and field references. `eligible` means the implemented checks found no blocker; it does not certify full notice eligibility.

`screenEligibility(profile, opportunity, { asOfDate })` consumes a normalized internal opportunity. `screenGrantRow(profile, row, { asOfDate })` adapts the current GOST PostgreSQL row shape and calls the same service. A future authorized matching route must load the organization-owned profile and candidate rows on the server before calling it. This task does not add a public route, asynchronous match runs, ranking, or persisted match results.

Example from the repository root:

```javascript
const { screenGrantRow } = require('./packages/server/src/lib/grantsEligibilityAdapter');
const result = screenGrantRow(storedProfile, storedGrantRow, { asOfDate: '2026-10-04' });
```

The caller supplies the business calendar date explicitly. For the project demo, derive that date in `America/New_York`; do not silently use the host's timezone. Repeating the same inputs and date produces the same result. Store the date, method version, profile version, and source grant revision when later persisting match runs.

## Rules

| Rule | Outcome |
| --- | --- |
| Closed or archived opportunity | `OPPORTUNITY_CLOSED` hard blocker |
| Valid close date before the screening date | `DEADLINE_PASSED` hard blocker |
| Definitive applicant codes exclude the mapped jurisdiction | `APPLICANT_TYPE_UNSUPPORTED` hard blocker |
| Cost share explicitly required and profile reports funds unavailable | `MATCHING_FUNDS_UNAVAILABLE` hard blocker |
| Explicit monetary minimum exceeds known available cents | `MATCHING_FUNDS_INSUFFICIENT` hard blocker |
| Missing status, deadline, eligibility, or cost-share requirement | Review required, not an invented pass or exclusion |
| Forecasted opportunity, additional eligibility text, or deadline instructions | Review required |
| `25` Others, `99` Unrestricted, or unknown category | Review required for notice qualifications |
| Tribal or other jurisdiction without sufficient applicant classification | Review required |
| Recognizable geographic or program-restriction wording in listing/eligibility text | Explicit geographic review warning; never a guessed location exclusion |

Applicant mapping uses Grants.gov category `02` for city/town/village, `01` for county, and `04` for special district. A generic tribal profile does not establish federal recognition for code `07`. Category definitions are confirmed against the [Grants.gov API status and eligibility codes](https://www.grants.gov/api/status-codes) and the repository's seed reference table. The notice still controls program-specific conditions.

The October 25 tribal fix distinguishes a definite exclusion from missing recognition information. A definitive list containing no potentially applicable tribal/housing category (`07`, `08`, `11`), no `25`/`99`, no unknown code, and no additional eligibility text can block a tribal profile. In particular, a state-government-only (`00`) opportunity now returns `APPLICANT_TYPE_UNSUPPORTED`. Potential tribal/housing categories still require review; a generic tribal government is not automatically certified as federally recognized, a tribal organization, or an Indian housing authority. `other` remains ambiguous rather than being treated as a tribe.

A date-only deadline includes the closing day. A genuinely explicit closed status remains a blocker. Legacy GOST ingestion derives status from milestones and marks a grant closed on the closing day; if that derived status conflicts with an unelapsed deadline, this adapter requests review rather than prematurely excluding it. No ingestion code is changed.

The exact Grants.gov deadline-note placeholder `No Explanation` is treated as an empty note, ignoring capitalization and surrounding whitespace. Actual instructions still require review, including longer notes that contain those words. Missing deadlines and independent hard blockers keep their existing behavior.

The adapter distinguishes `opportunity_status` from GOST's unrelated collaboration `status` such as `inbox`. It preserves leading zeroes in applicant codes. It reads available source metadata to avoid treating the legacy `2100-01-01` missing-deadline placeholder as an actual deadline or treating an absent cost-share flag as false.

`minimumMatchingFundsCents` is an optional internal normalized field for an explicitly stated monetary minimum. The legacy row adapter leaves it null: it never invents an amount from an award floor, ceiling, or percentage. If matching funds are available but the actual requirement or available limit is unknown, the result requires review. No shared HTTP request or database schema changes are introduced.

All hard blockers remain in the result. A supplied semantic score cannot override them; this service returns `rank: null`, `score: null`, and `model: null`. Ranking must only consider nonblocked opportunities and retain review warnings.

## Geographic review safeguard and remaining gap

The adapter now passes an internal `noticeText` assembled from the listing title and description, preferring explicitly supplied raw source fields over legacy text. The screener checks that text and additional eligibility information for conservative review cues, including required project/applicant locations, basin/county/region references, eligible areas, and limited/restricted-to clauses. HTML tags and common nonbreaking spaces are normalized only for detection. These cues add a visible uncertainty even when applicant codes otherwise match and matching funds are not required; an independent hard blocker still takes precedence.

This is **not full geographic eligibility validation**. It can request extra review for a program restriction and can miss differently worded limits, abbreviations, maps, or restrictions present only in the full PDF. No place is extracted as an authoritative service boundary, and the organization's home state does not establish where a project will be performed. Do not interpret absence of a warning or `eligible` as geographic certification. Exact exclusion needs reviewed source restrictions and proposed-project/service-area data; do not add a guessed state-name blocker.

## October 25 evaluation regression coverage

`__tests__/lib/eligibilityEvaluationRegressions.test.js` adds tribal definite-exclusion/ambiguous-category cases and geographic-warning checks, including the Alaska-project and Lake Superior Basin wording identified by Allison. The geographic controls also remove unrelated warning conditions so they cannot pass only because of `25` Others or unknown cost share. Existing tests now expect `eligibility-v2`; the version change separates the corrected behavior from historical results.

An isolated rerun against Allison's unchanged reviewed `matching-eval-v1` labels at data commit `f9701e60cf56b6ca4fe8eb9062a4d4df2e73ce19` gave zero disposition/blocker mismatches across 77 cases, including all nine expected applicant-type blockers. The earlier missed tribal blocker is now present alongside the independent matching-funds blocker. This is evidence on that small evaluation set, not a claim of universal accuracy or complete geographic coverage. Allison's branch, labels, and existing results document were not edited.

The agent verification used Node 20.11.1 without database access: **82 pure checks passed**, plus lint and the existing seven-case/three-chunk rehearsal. Docker execution and live API behavior are not claimed from these pure checks. Include the new regression file explicitly when repeating the focused suite; do not invoke the fixture-reseeding global library setup.

## October 27 deadline-note regression coverage

`__tests__/lib/eligibilityDeadlineNotes.test.js` adds 15 checks for absent notes, the exact `No Explanation` placeholder with case/whitespace variations, actual instructions, missing dates, independent hard blockers, and legacy/raw-source grant rows. The placeholder no longer creates a deadline warning; it does not suppress other review requirements or blockers.

## Verification

From the repository root with project dependencies installed:

```powershell
node node_modules/mocha/bin/mocha packages/server/__tests__/lib/eligibilityDeadlineNotes.test.js packages/server/__tests__/lib/eligibilityBlockers.test.js packages/server/__tests__/lib/grantsEligibilityAdapter.test.js packages/server/__tests__/lib/eligibilityProfileIntegration.test.js packages/server/__tests__/lib/eligibilityEvaluationRegressions.test.js packages/server/__tests__/lib/documentChunking.test.js
node node_modules/eslint/bin/eslint.js packages/server/src/lib/eligibilityBlockers.js packages/server/src/lib/grantsEligibilityAdapter.js packages/server/src/scripts/rehearseFirstDemo.js packages/server/__tests__/lib/eligibilityDeadlineNotes.test.js packages/server/__tests__/lib/eligibilityBlockers.test.js packages/server/__tests__/lib/grantsEligibilityAdapter.test.js packages/server/__tests__/lib/eligibilityEvaluationRegressions.test.js
node packages/server/src/scripts/rehearseFirstDemo.js
```

With an existing running `gost-app` container mounted to this checkout, use:

```powershell
docker exec gost-app sh -lc 'cd /app/packages/server && yarn mocha __tests__/lib/eligibilityDeadlineNotes.test.js __tests__/lib/eligibilityBlockers.test.js __tests__/lib/grantsEligibilityAdapter.test.js __tests__/lib/eligibilityProfileIntegration.test.js __tests__/lib/eligibilityEvaluationRegressions.test.js __tests__/lib/documentChunking.test.js'
docker exec gost-app sh -lc 'cd /app/packages/server && yarn eslint src/lib/eligibilityBlockers.js src/lib/grantsEligibilityAdapter.js src/scripts/rehearseFirstDemo.js __tests__/lib/eligibilityDeadlineNotes.test.js __tests__/lib/eligibilityBlockers.test.js __tests__/lib/grantsEligibilityAdapter.test.js __tests__/lib/eligibilityEvaluationRegressions.test.js'
docker exec gost-app sh -lc 'cd /app && node packages/server/src/scripts/rehearseFirstDemo.js'
```

These pure checks do not run the database fixture setup and do not reseed or modify the local database. Save the actual command output as report evidence. The application itself still needs authenticated API/browser verification during C-07 before the first-demo workflow is frozen.
