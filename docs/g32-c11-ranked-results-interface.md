# C-11: ranked-results interface and bounded saved match runs

Owner: Connor Delk. Prepared October 25, 2026. Planner bucket: **Grant Finder and AI Matcher**.

Status: **Implementation and normal-stack verification complete; C-11 commit, pull request and teammate review remain.**

## Delivered

- Authenticated `/compliance/matches` page and Grant Matches navigation, off by default.
- Reusable `RankedMatchResults.vue` display and strict C-10 result/evidence validation.
- Organization-scoped `POST /api/organizations/:organizationId/compliance/match-runs` and `GET .../match-runs/:runId`.
- PostgreSQL migration/repository for durable run IDs, input snapshots and versioned results.
- Server-side saved-profile/candidate loading, tenant/role authorization, version checks before inference and again before storage, and safe error envelopes.
- Explicit start, loading, empty, error, profile-missing, stale-version and saved-run reload flows. Late responses cannot replace results after selection/route changes.
- Focused client/server tests and explicitly opt-in isolated PostgreSQL tests. No test invokes the application's fixture/reseed setup.

Prerequisites #18, #25, #27 and #28 were merged into develop on October 27, 2026. This branch was advanced to develop `11c95077`, then the saved C-11 changes were restored without conflicts. The organization-profile and matching navigation entries both remain. A file backup and a retained Git safety stash preserve the pre-integration work.

## Bounded synchronous baseline

A start request finishes the calculation and saves it before returning HTTP **201** with `{ run, links: { self } }`. It does not invent a queued background job. Failed requests return controlled errors without creating successful records; previous runs are preserved. There is no worker, asynchronous resume, polling queue, or retry-parent lineage in this local baseline. Each successful start creates a new run.

The browser sends only profile ID/version, optional numeric candidate grant IDs, and an optional limit. Defaults: 25 candidates; maximum: 50. Omitted IDs select a bounded stored posted/forecasted pool in stored text-ID order, not an exhaustive search. Explicit IDs can include closed/matching-fund controls. The response retains all selected blocked/unranked results. Pool strategy, total, selected count, limit and truncation are visible in `result.candidateSelection` and on the page.

The API uses the real C-06/C-09/C-10 pipeline and cached checksummed model. It does not download model assets during a request, call a text-generation provider, or create synthetic production results. One active matcher per configured API process bounds model resource use; overlapping work returns `MATCHING_BUSY`. Cluster-wide admission and distributed workers remain future hardening.

Each run includes server-owned IDs, actor/time metadata, profile identity/version, status, method/model identity and the entire unchanged C-10 result under **`run.result`**. Nonempty output remains `reviewRequired` because explanations are unverified. Processing completion never certifies eligibility or human verification. Empty completed runs do not prove that no suitable grant exists. Human-verification mutations are not part of C-11.

`grant_match_runs` contains tenant/organization/profile ownership, profile version, actor/timestamps, an actual input snapshot, and the result JSON. Input snapshots are not exposed in the response. Source changes after matching do not overwrite history. Organization/profile deletion can cascade runs under the migration; this is not an independent archival system.

## Display guarantees

- Preserve producer ranks/order; do not recalculate or round into a confidence percentage.
- Display six decimal places, including zero; null means unranked.
- Keep every hard blocker and review warning visible outside collapsed explanations. Blocked C-10 results require null rank/score.
- Label a screen pass "No hard blocker found," not certified eligibility. Close scores do not become strong recommendations.
- Keep explanation verification visibly unverified. Extractive explanations are not LLM prose or model-weight attribution.
- Show local claim-to-evidence links, actual listing fields/excerpts/offsets, available revisions, limitations and provenance. Listing references are not invented PDF/page citations.
- Render source/claim/error content as text, never raw HTML. Unknown errors become controlled messages.
- Reject wrong organization/profile versions, contradictory ranks/blockers, unsupported explanations, bad counts and invalid evidence references rather than inventing success.
- Use labelled controls, native disclosures, visible keyboard focus and unique evidence anchors. Hide previous results while loading, on errors, or after selection changes.

The display guard is not server authorization or cryptographic source verification. Refresh/reload to detect profile edits made elsewhere. Saved snapshots are historical evidence, not live eligibility certification. Geographic screening remains conservative review, not complete location eligibility validation.

## Safe normal-stack setup (after reviewing prerequisite integration)

1. Preserve current data. Do not use `docker compose down`, volume deletion, factory reset, reseeding or rollback as setup steps. The current Postgres container does not have a persistent database volume.
2. Start existing containers as needed; do not recreate Postgres. Apply the new migration through the project's normal Knex migration ledger, not by manually creating the table. Review the pending migration list first. Do not run global API/library fixture setup against the populated project database.
3. Install the existing locked dependencies if the container's dependency volume predates C-09. Reuse the C-09 cached/checksummed model files; the HTTP route will not download them.
4. Set `ENABLE_GRANT_COMPLIANCE=true`, `ENABLE_ORGANIZATION_PROFILES=true`, and `ENABLE_GRANT_MATCHING=true` in the local server configuration. Restart the existing app container after configuration changes. Do not print or share its secrets.
5. Enable browser flags `grantComplianceEnabled`, `organizationProfilesEnabled` and `grantMatchingEnabled` with the existing local session override, then reload. Keep production/staging flags off until reviewed. Local deploy config explicitly defaults matching off; absent master/profile flags also remain off.
6. Sign in with an authorized staff/admin account, select the intended team, and save its profile with at least one focus area using C-05. That editor is available when current develop/prerequisites are integrated; C-11 does not duplicate it.
7. Use **Grant Matches**, start a bounded run, inspect warnings/blockers/evidence, and reload the resulting `?runId=...` URL. Confirm the same run is restored. Edit the profile, reload and confirm the old-version result is not presented as current. Test disabled flags and an inaccessible organization.
8. Save actual normal-stack screenshots/output and obtain teammate review before marking the integrated feature finished. No migration, seed, reset, or configuration change was applied to the user's project database during isolated agent verification.

## Repeatable checks

From `packages/client` with project dependencies installed:

```powershell
yarn vitest run src/helpers/rankedMatchResults.spec.js src/components/RankedMatchResults.spec.js src/helpers/matchRunApi.spec.js src/views/GrantMatchesView.spec.js src/views/GrantMatchesAccess.spec.js
```

From the repository root, run the new pure server checks without fixture setup:

```powershell
node node_modules/mocha/bin/mocha packages/server/__tests__/lib/matchRuns.test.js
```

The additional `packages/server/__tests__/integration/matchRuns.test.js` requires an explicitly created **empty, loopback PostgreSQL database** named `g32_c11_verify_...`, passed through `G32_MATCH_TEST_DATABASE_URL`. It refuses application database names and preserves existing tables by refusing a nonempty fixture schema. It creates only its own minimal fixture schema using the actual profile/match migrations. No application seeding hook runs. `G32_MATCH_TEST_MODEL_CACHE` enables the optional real cached-model HTTP case; without it that case is skipped. Never point this suite at `usdr_grants` or the populated project's usual test database.

Lint only the changed files and run the normal client build. The focused suites do not need LocalStack. Full application document/upload regression checks remain separate.

## October 25 isolated verification record

Windows Node 20.11.1 and PostgreSQL 13.3 through the existing database container's loopback port; Docker control access was unavailable to the agent. A separate database contained synthetic fixtures only. Production matching route, repository, runner, signed cookies and cached model were exercised through HTTP. The browser check used the actual page/router/store/navigation with a clearly labelled isolated session/profile fixture adapter, not the user's live login/profile endpoints or application data.

The integrated browser run saved and reopened the same run after a full reload: six candidates, three ranked, two blocked; real model scores remained 0.609293, 0.492199 and 0.145199. Review warnings, unverified state and blocked null ranks were retained. The computer-use skill provided browser layout and interaction verification, not account changes or cloud writes.

Final prepared integration at develop `87a4c2d`: **341 client tests passed, nine existing skips**; **300 focused server/API checks passed**, including the actual PostgreSQL migration/repository, signed-cookie authorization and cached-model case. C-11 contributes 110 client checks and 46 server/API checks across the display and integration work. Targeted lint and the normal client production build passed. Existing Vue compatibility/build warnings remain; no unrelated warning cleanup was performed. The complete legacy database-reseeding API suite and the user's configured Docker app/login flow were not run by the agent. The prepared combined code tree was `cef6ab9d5554914401eb3b62f57b36f74096ba67` before this final documentation-only update. No commit, push or merge was made.

## October 27 normal-stack verification

The original C-11 branch now includes the merged prerequisites at develop `11c95077`. Both previously missing analysis-run migration files are present. Knex validated all 80 existing migration entries, then applied the five pending migrations through its normal ledger, including `grant_match_runs`. All 85 migrations are now applied. The migration process preserved the existing 19 users, 32 grants, one profile and one document; no database reset, rollback, container recreation or reseed was performed.

The normal Docker app and frontend returned HTTP 200 from `/api/health`. Using the existing seeded admin's normal email-link login through local Mailpit, the actual `/compliance/matches` page loaded organization 0's saved profile 1, version 7. A normal matching request saved run 1: 25 candidates selected from 32 stored records, one ranked result, 24 blocked results, and visible pool-limit/review warnings. The ranked result's semantic score was 0.178814; it remained unverified and did not certify eligibility. Existing dated records were often expired, which explains the blocked results; the data was not edited to manufacture a successful match.

A full browser reload restored the same run 1 and did not create another record. The explanation disclosure displayed the actual claims, listing excerpts, evidence references and limitations. Both Grant Matches and Organization Profile navigation remained available with their local flags enabled. Screenshots and test logs are stored with the task's October 27 verification artifacts. The existing saved profile was not edited during this check.

Verification on the integrated code: **341 client tests passed, nine existing skips; 308 focused pure server tests passed; 14 isolated PostgreSQL/API tests passed**, including the real cached-model case. Targeted client/server lint and the client production build passed. The isolated test database was created for this run and removed after its connections closed; it was separate from `usdr_grants`. Production/staging flags remain disabled. The temporary browser configuration used for the live check was restored to its checked-in default-off values; the ignored local server configuration enables matching for development only.
