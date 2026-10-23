# C-08 and T-03: eligibility and profile verification

Owner: Connor Delk. Verification date: October 23, 2026.

## Scope and reporting boundary

- **C-08 — Add eligibility boundary and conflict tests:** 38 new cases in `packages/server/__tests__/lib/eligibilityBoundaries.test.js`.
- **T-03 — Test profile and blocker rules:** 29 new profile-validation and profile-to-screening contract cases in `packages/server/__tests__/lib/eligibilityProfileValidation.test.js`, plus rerunning the existing relevant regression suites.
- Both Planner tasks belong in **Integration, Evaluation, and Security**.

These are additions to the already reported C-06/C-07 work, not a new implementation of the eligibility service. No application behavior, dependency, database schema, API contract, or feature flag was changed. C-09 ranking and C-10 grounded match explanations remain separate tasks.

## Coverage matrix

| Area | New verification |
| --- | --- |
| Calendar boundaries | Valid leap day, invalid non-leap day, month/year rollover, inclusive closing day, next-day exclusion, malformed business date |
| Matching funds | Zero, one-cent difference, equality, maximum safe integer; negative, fractional, string, null, nonfinite, and unsafe amounts require review |
| Conflicts | Independent hard blocker survives missing evidence, unrestricted categories, and date-derived status uncertainty; supplied score cannot override it |
| Source precedence | Missing source requirements are not replaced with optimistic legacy deadline, applicant, or cost-share defaults |
| Profile validation | Population/staffing bounds, exact integer cents, text/list length limits, invalid concurrency version, client ownership metadata rejection |
| Profile-to-rule contract | City-to-county change affects applicant screening; a funds update preserves an unknown minimum; versions propagate and inputs remain unchanged |

The profile-to-rule tests construct valid versioned objects in memory; they do not simulate a successful database save or prove authorization. A passing screen is not an agency eligibility certification.

## Results recorded October 23

| Check | Result | Qualification |
| --- | --- | --- |
| Existing screening, stored-row adapter, and profile contract suites | 42 passing | Existing regression coverage, not 42 new cases |
| New C-08 boundary/conflict suite | 38 passing | New work |
| New T-03 validation/contract suite | 29 passing | New work |
| Combined server command below | **109 passing, 0 failing** | Pure tests; no database or API fixture setup |
| ESLint on the two new test files | **0 errors, 0 warnings** | Existing project rules; external dependencies resolved from the workspace installation |
| Existing profile form and Vue view tests | **13 passing in 2 files** | Mocked API tests, not a live browser/API run |
| Four targeted in-memory fault probes | **4 detected** | Closing-day exclusion, equal-funds rejection, uncertainty hiding a blocker, and maximum-population rejection; no source edits |

Server tests ran against the original checkout using the workspace dependency installation. The three production modules used by these tests matched the workspace copies byte for byte. Frontend tests ran in `g32-c07-integration`; the profile view, form helper, their tests, feature-flag helper, fetch helper, Vite configuration, and test setup were compared with the original checkout and matched after line-ending normalization.

The automated agent runs did not exercise live authorization/persistence, the isolated-database API suite, the entire repository regression suite, or ranking-quality evaluation. Connor subsequently reported that the requested local checks passed; the manual profile verification is recorded separately below. No new live authorization or full-regression result is claimed.

## Reproduce and capture evidence

Run from the repository root with project dependencies installed. These explicit file lists intentionally avoid `yarn test:lib`, whose global fixture setup reseeds a database.

```powershell
node node_modules/mocha/bin/mocha packages/server/__tests__/lib/eligibilityBlockers.test.js packages/server/__tests__/lib/grantsEligibilityAdapter.test.js packages/server/__tests__/lib/eligibilityProfileIntegration.test.js packages/server/__tests__/lib/eligibilityBoundaries.test.js packages/server/__tests__/lib/eligibilityProfileValidation.test.js
node node_modules/eslint/bin/eslint.js packages/server/__tests__/lib/eligibilityBoundaries.test.js packages/server/__tests__/lib/eligibilityProfileValidation.test.js
```

Or, with the existing `gost-app` container running and mounted to this original checkout:

```powershell
docker exec gost-app sh -lc 'cd /app/packages/server && yarn mocha __tests__/lib/eligibilityBlockers.test.js __tests__/lib/grantsEligibilityAdapter.test.js __tests__/lib/eligibilityProfileIntegration.test.js __tests__/lib/eligibilityBoundaries.test.js __tests__/lib/eligibilityProfileValidation.test.js'
docker exec gost-app sh -lc 'cd /app/packages/server && yarn eslint __tests__/lib/eligibilityBoundaries.test.js __tests__/lib/eligibilityProfileValidation.test.js'
```

With the C-05 UI present and the existing frontend container running:

```powershell
docker exec gost-frontend sh -lc 'cd /app/packages/client && yarn vitest run src/helpers/complianceProfileForm.spec.js src/views/OrganizationProfileView.spec.js'
```

Save the server output showing `109 passing`, the frontend summary showing `13 passed`, and the lint command completing successfully. For C-08, capture the new calendar, funds, and conflict test names; for T-03, capture the new profile-validation/contract test names and the separate frontend summary. The combined 109-test run is shared evidence, not 109 new tests for each task.

## Manual verification and remaining API coverage

On October 23, Connor reported that the requested checks passed after enabling the two local browser feature flags. This is user-reported verification, not a browser run performed by the automated agent. Retain the new screenshots rather than reusing the last demo's evidence.

1. **Reported passed:** existing profile loads; a temporary name edit saves and survives refresh; restore the original name afterward. Capture the saved state without displaying tokens or login links.
2. **Reported passed:** an invalid required profile value is rejected without changing the saved profile. Capture the validation message.
3. **Not newly verified live:** a feature-disabled response is not shown as an absent profile, and a stale-version edit cannot overwrite a newer save. These cases have existing mocked/API tests; the 13 passing frontend tests cover the mocked interface behavior, not a fresh live API run.
4. **Not run in this verification:** isolated-database authorization/API regression tests. The existing API and global library fixtures delete/reseed data; do not run them against the populated development database. Cross-organization authorization coverage belongs to T-02 as well and must not be claimed from pure input validation.

Do not run `docker compose down`, delete volumes, or reseed a populated database to reproduce these pure tests. Preserve the existing containers and database.

## Commit and pull-request boundary

Stage only the two new test files and this document. Do not commit the previously reported C-06/C-07 application work again.

The initial testing branch was created from the integrated demo branch. That branch contains other PRs and is not a clean three-file comparison with `develop`. GitHub PR #18 (C-06) remained open when checked on October 23. Before publishing, carry only these three new files onto a new branch based on `origin/c06-eligibility-blockers`, and target `c06-eligibility-blockers` for the dependent test PR. Merge the C-06 dependency into `develop` first, then retarget the test PR to `develop` and recheck its files. Do not open a large mixed demo-to-`develop` PR and label it as only C-08/T-03. Preserve the demo branch and any uncommitted work during that preparation.

Suggested eventual PR title: `test: expand eligibility boundaries and profile rule verification`.

Suggested report distinction: C-08 developed 38 additional boundary/conflict regression cases; T-03 added 29 profile contract cases and verified the combined 109 server checks plus 13 mocked frontend checks. Connor also reported successful live profile save/refresh and invalid-input checks. Fresh live authorization, feature-disabled API behavior, stale-version API behavior, and the full repository regression suite were not newly verified by this work.
