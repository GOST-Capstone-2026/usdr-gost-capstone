# G32 First Demo Integration Readiness

Owner: Connor Delk. Checked October 8, 2026.

Status: local integration candidate verified; shared first-demo workflow NOT frozen.

## Work completed

- Combined develop with the current heads of PRs 13, 14, 16, 17, and 18 in a separate local candidate. No GitHub PR was merged or changed, and the original checkout remains on the C-06 branch.
- Resolved the profile/extraction-demo router conflict and the profile/dashboard navigation, deployment-flag, and flag-test conflicts while retaining all three routes and both feature-gate chains.
- Found and fixed a profile demo issue in the candidate: numeric organization ID 0 was incorrectly treated as an absent team. Added tests for loading/saving team 0, showing its navigation link, and rejecting genuinely missing selections.
- Added four route-integration tests for the combined candidate and three server contract-integration tests for C-04 profile validation with C-06 screening.
- Verified 48 server component tests, 75 targeted frontend tests across six files, targeted server/client lint, and a Vite production build. The component rehearsal again passed seven synthetic screening cases and three source-mapped chunks.

These checks used local Node 24.19.0, not the Docker image's Node 20.11.1. Repeat in Docker before the shared freeze. The production build completed with existing Vue compatibility, dependency annotation, and large-chunk warnings. This is not a claim that every project test passed.

## Candidate identity and scope

Workspace: C:\Users\Bonnor\Documents\Codex\2026-08-31\rea\g32-c07-integration

Candidate merge HEAD: 2cade2029c40142de71e1b4e0b64c33d8843a2ba, plus uncommitted seeded-team fix and new integration tests. This is a local candidate, not a frozen release.

| PR | Head checked | Observed review state on October 8 |
| --- | --- | --- |
| 13 deadline update API | da4f0dbf89453c574d19f2641a26244327d9cd64 | Open; no submitted review |
| 14 profile UI | 52a460d479e281800cf5fbec9527ff9e1f596778 | Open; approved by mgcapiendo |
| 16 extraction demo | ae3f04a1a0b189f6f641a4f6d61e5a01035c5333 | Open; approved by mgcapiendo; contract comment also present |
| 17 portfolio dashboard | 7edb685f4816a9b52e19377955c4f85ae704c2aa | Open; no submitted review |
| 18 eligibility screening | e3ea5dec61f472876d4b4f0c4c26a7945654f137 | Open; no submitted review |

All five were individually reported mergeable against current develop. That does not establish that merging them consecutively is conflict-free: the local combination found the shared frontend conflicts above.

## Required team actions

1. Apply and test the team-0 profile fix on C-05 before merging PR 14. The standalone fix is saved at C:\Users\Bonnor\Documents\Codex\2026-08-31\rea\outputs\G32_C05_Seeded_Team_Fix_2026-10-08.patch. Confirm the working tree is clean and use git apply --check before applying it; do not blindly apply it to the current C-06 branch, which lacks the C-05 files.
2. Request teammate review of PR 18 and add the three new profile/screening contract tests. Review PRs 13 and 17 and confirm whether the extraction-run contract comment on PR 16 needs a follow-up.
3. A suitable merge order is 13, 14, 16, 17, 18 after review. Keep the profile and extraction routes as separate route objects. When adding the dashboard, retain both profile and deadline flags, helper exports, navigation entries, imports, and route guards. Do not accept one whole side of the conflicts.
4. Record the resulting develop commit, update the original checkout, and start the full local stack using the real LocalStack token. Do not reseed or reset existing data. Apply pending migrations only after confirming the database target.
5. Perform live login, profile create/edit/reload and validation, real PDF upload/analysis, and seeded portfolio verification. Use a designated demo team; clearly label seeded dashboard data and synthetic screening controls. Do not overwrite an unrelated organization profile.
6. Run the component, frontend, and relevant API checks in Docker. API fixture tests must target a separate test database because their setup deletes and reseeds test data; do not point them at the development database.
7. Save browser screenshots or a recording, exact commit, input grant/PDF identity, environment settings without secrets, expected results, actual results, limitations, and fallback instructions. Only then mark C-07 completed and freeze the demo.

The candidate does not include Allison's unverified data/AI branch. Confirm its PR, mock mode, and input contract separately. C-06 remains a callable server screening service, not a public matching/ranking endpoint. The first demo must not present screening, extraction, and the seeded tracker as a generated end-to-end AI checklist workflow.

## Original-checkout C-06 follow-up command

With gost-app running against the original checkout:

```powershell
docker exec gost-app sh -lc 'cd /app/packages/server && yarn mocha __tests__/lib/eligibilityBlockers.test.js __tests__/lib/grantsEligibilityAdapter.test.js __tests__/lib/documentChunking.test.js __tests__/lib/eligibilityProfileIntegration.test.js'
```

Expected: 48 passing. This command does not load database fixtures or reseed data.

## Freeze checklist

- [ ] Team-0 profile fix reviewed and committed
- [ ] Required PRs reviewed and merged
- [ ] Shared develop commit recorded
- [ ] Docker component and relevant API checks passed
- [ ] Live profile create/edit/reload passed
- [ ] Real PDF upload and analysis passed
- [ ] Seeded portfolio and review-needed cases verified
- [ ] Demo evidence, known limitations, and local fallback saved

Leave C-07 In Progress until the live and shared-branch checks are complete. The October 7 internal target has passed; update Planner with the actual progress and agreed revised target rather than backdating completion.
