# C-12: Connect selected grant to document analysis

Owner: Connor Delk. Implementation and verification: November 1, 2026.
Planner bucket: Integration, Evaluation, and Security.

## Scope

Adds an explicit handoff from each C-11 matching result to the existing grant-document upload and analysis workflow. The selected grant and organization replace the old hard-coded sample grant. This does not add checklist generation, a grant-brief viewer, geographic eligibility checks, or human-verification actions.

The local branch is `c12-selected-grant-document-analysis`, based on C-11 commit `a6505131`. C-11 PR #29 is still open. Keep C-12 separate and initially compare it against `c11-ranked-results-interface`; after C-11 merges, retarget to develop and check the comparison. No commit, push, approval or merge was made for C-12 during implementation.

## Navigation and identity

- Each validated result offers **Review documents for grant [ID]** when the master/document-analysis flags are true and the account can use matching. Blockers, ranks, scores, warnings and unverified explanations remain unchanged. Reading a blocked grant's notice does not make it eligible.
- Target: `/compliance/grants/:grantId/documents?organizationId=...&matchRunId=...`.
- The grant comes from the result's numeric ID, not title text, profile data, or a fixed demo default. Grant ID zero and organization ID zero are handled correctly.
- Both this route and the retained `/grant-document-demo` route require authentication and literal master/document-analysis flags. The retained demo URL now needs explicit `grantId` and `organizationId` query parameters; an old bare demo link never silently uploads to a sample grant.
- The page also requires a supported admin/staff role and an organization query matching the selected team. Server authorization remains the existing compliance API's responsibility; route/query checks are not an authorization substitute.
- A return link reopens the saved matching run. Navigation does not automatically start analysis, and document processing never marks matching explanations verified.

## Upload, reopen and analysis

Uses existing endpoints only:

1. `POST /api/organizations/:organizationId/compliance/documents`, multipart `file` and the selected `grantId`.
2. `GET .../documents/:documentId` for reopening and refreshing metadata.
3. `POST .../documents/:documentId/analysis-runs` only after **Start Analysis**.
4. `GET .../analysis-runs/:runId` for sequential polling.

A successful upload adds `documentId` to the same URL. Opening that URL or entering a known existing document ID reloads the document without uploading it again. The response must match the selected organization, grant and expected document before it is displayed or analyzed. An analysis response must match the selected document and expected run.

Selection/role changes and unmount invalidate outstanding work, clear old results and stop polling. Poll requests never overlap; transport failures stop polling and offer a GET-only status refresh rather than replaying the start POST. Raw server/provider errors are not displayed. Filenames and returned data render as text.

The existing duplicate constraint applies to the PDF hash across the organization, not per grant. A PDF already attached to another grant cannot be uploaded again or opened under the wrong grant. Preserve the association and use its correct grant. This work does not add a document listing endpoint, change that constraint, or automatically reassign documents. Existing document IDs or saved document URLs are needed to reopen prior uploads.

## Automated verification

New coverage tests route/context validation, correct multipart grant/team identity, reopening without another upload, explicit analysis start, run/document response identity, sequential polling, transport recovery, inert filenames, team/grant/role changes during outstanding requests, cleanup on unmount, route guards and per-result entry points.

Targeted command from `packages/client`:

```powershell
yarn vitest run src/helpers/grantDocumentHandoff.spec.js src/views/GrantDocumentDemoView.spec.js src/views/GrantMatchesView.spec.js src/views/GrantMatchesAccess.spec.js src/components/RankedMatchResults.spec.js
```

The five focused files have 75 passing tests, including 39 added C-12 checks. These browser-component tests use mocked HTTP responses; live verification is recorded separately. Targeted client lint and Vite production build pass. The full client suite also passed: 380 tests, with nine existing skips. Existing Vue compatibility and bundle-size warnings remain.

## Local walkthrough

Preserve the existing containers and populated database. Do not reseed, reset, recreate Postgres, or run database-fixture test hooks.

1. Enable the existing local browser master/profile/matching/document-analysis flags. No new feature flag or server endpoint is added.
2. Sign in normally and open Grant Matches with a saved profile/run.
3. Follow a result's document link. Confirm selected grant/team and the saved-run return link.
4. Upload the actual notice for that grant, or enter an existing document ID that belongs to it. Start Analysis explicitly.
5. Confirm completion, document metadata, and unchanged match warnings. Reload the document URL: the same document reopens, without another upload or automatic analysis.
6. Return to the saved matching run. Try a document attached to a different grant: the page must refuse it.
7. Restore temporary browser deploy configuration to its checked-in default-off values after verification.

The November 1 normal-stack check used seeded admin login through local Mailpit. Existing saved run 1 offered links for its actual results. Uploading the repository sample under Test Grant 0 returned the existing duplicate-document error. Read-only database inspection confirmed that sample was already document 1 under Test Grant 666999 / Team 0; it was not reassigned. With explicit user approval, a bounded matching run for grant 666999 was created and the sample reopened through its own result link, preserving the return run. Live completion and regression details are recorded in the task verification artifacts.


The approved existing sample analysis completed as analysis run 2: two readable pages and one chunk. The new matching run was also run 2, a separate record type, containing only grant 666999. The grant remained blocked and its explanations unverified. No duplicate document was created and no document was reassigned. Reload and cross-grant checks use read-only document endpoints; no new API, migration or reseed is needed.
