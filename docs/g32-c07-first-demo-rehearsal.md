# G32 C-07 First-demo preparation and integration record

Owner: Connor Delk. Progress recorded October 4, 2026. Status: In Progress.

## Completed preparation

Added `packages/server/src/scripts/rehearseFirstDemo.js` and explicit synthetic fixtures in `packages/server/demo/first-demo-fixtures.json`. The rehearsal uses the actual C-06 GOST-row adapter and eligibility service, then passes readable fixture pages to Anthony's merged AN-07 `chunkPages` function. It verifies seven screening scenarios and checks three chunks retain their original page ranges. No AI key, LocalStack, database, or live grant service is required.

Run from the repository root:

```powershell
node packages/server/src/scripts/rehearseFirstDemo.js
```

For structured evidence, append `--json`. The screening date is deliberately fixed at October 4, 2026, so fixture outcomes do not change as real time advances. Fixture grant IDs 900001 through 900007 and Demo City are synthetic and are never inserted into the database.

This is a partial component rehearsal. It does not prove login, profile persistence, real PDF upload, provider connectivity, generated checklists, dashboard integration, or cloud deployment. It is not a completed first-demo freeze.

## Integration snapshot

Verified against GitHub on October 4, 2026. Shared `develop` was at `5f625f0` before this work.

| Component | Observed state | Next check |
| --- | --- | --- |
| C-04 profile API | Merged, PR #9 | Real create/update/reload with an authorized account |
| C-05 profile UI | Open, PR #14 | Team review and manual feature-flag browser verification |
| AN-05 stored source pages | Merged, PR #11 | Real PDF page count and stored source references |
| AN-06 readability checks | Merged, PR #12 | Readable and scanned notice examples |
| AN-07 page-mapped chunks | Merged, PR #15 | Fixture rehearsal runs this function; real notice still to check |
| AN-08 extraction-demo workflow | Open, PR #16 | Review, merge, then repeat real upload/extraction |
| M-04 deadline update API | Open, PR #13 | Review and verify correction/completion behavior |
| M-05 portfolio dashboard | Open, PR #17 | Review, merge, and verify seeded status groups |
| Allison's normalized opportunity data and AI adapter | Integration not verified on shared develop | Confirm branch/PR, input schema, mock mode, and secret configuration with Allison |
| C-06 screening | Implemented in this change | Run tests, review, and merge before final rehearsal |

PR state is a dated observation, not an instruction to merge without review. Repeat the snapshot when rehearsing or freezing the demo.

## Remaining live rehearsal

1. Review and merge the required PRs into `develop`. Update the local checkout and record its exact commit; avoid combining unreviewed branches into the shared demo.
2. Start the project stack using the existing secure LocalStack setup. Never use the frontend-only placeholder token to start LocalStack. Do not reset or reseed existing data just to rehearse.
3. Verify profile backend flags `ENABLE_GRANT_COMPLIANCE` and `ENABLE_ORGANIZATION_PROFILES` and browser flags `grantComplianceEnabled` and `organizationProfilesEnabled`. With authorized admin/staff login, create a profile on a test team, refresh, edit, save, and refresh again. Capture success and validation behavior.
4. Confirm a supported current opportunity and at least one unsuitable control. Run C-06 against the approved opportunity/profile shapes. Keep blocker codes and review warnings visible; no claim of semantic ranking until that later task is implemented.
5. Use Anthony's real-notice extraction workflow to upload the approved HUD PDF. Confirm page count, readability, stored pages, and chunks that preserve source page ranges. Identify any unavailable provider/checklist stage explicitly.
6. Verify Manuel's seeded dashboard against the authorized deadline API. Label seed data and placeholders honestly; do not claim generated verified deadlines are integrated until that data path exists.
7. Save screenshots or a short recording and logs for the demonstrated stages. Record exact Git commit, environment requirements, demo input, expected output, known limitations, and a local fallback.
8. Freeze the demo only after the required live stages pass together. Leave C-07 In Progress while reviews or integration checks remain outstanding.

## Evidence to attach to the weekly report

- Terminal summary of C-06 tests and targeted lint.
- Rehearsal output showing seven scenario checks and three source-mapped chunks.
- This dependency and live-rehearsal record.
- Implementation commit/PR once created in the original checkout.

Report C-06 as implementation and automated verification completed, pending review/merge. Report C-07 as preparation and partial component rehearsal completed, with live integration and the final freeze still pending.
