# AN-18: Finalize checklist documentation and evidence

Anthony Karoussos, November 21, 2026

## What this is

A summary of the whole Grant Analysis and Compliance Checklist subsystem (F1, section 6.3) as it stands now: what each piece does, how to verify it, and real evidence that it works end to end, not just in automated tests.

This covers AN-09 through AN-17. The pipeline, in plain terms: a grant notice PDF gets uploaded, read page by page, split into pieces small enough for the AI, and the AI turns those pieces into two things, a one-screen **grant brief** (purpose, eligibility, funding, cost share, key dates, key requirements) and a **compliance checklist** (one actionable item per obligation). Every fact either one reports has to cite the exact page and quote it came from, and nothing counts as trustworthy until a person reviews, edits, and verifies it.

## The pieces and where they live

| Task | What it does | Where |
| --- | --- | --- |
| AN-09/AN-10 | Defines the grant brief's shape and fills it in from the AI, one chunk at a time, merging across chunks | `src/lib/grantBriefSchema.js`, `src/lib/grantBriefSynthesis.js` |
| AN-11/AN-12 | Defines one checklist item's shape and saves it for real, scoped to the right organization and grant | `src/lib/checklistItemSchema.js`, `src/db/index.js` |
| AN-13 | Checks a cited page and quote against the document's real extracted text before anything can be marked verified | `src/lib/sourceCitationValidation.js` |
| AN-14 | Turns the AI's findings into individual checklist items, each still carrying its citation | `src/lib/checklistGeneration.js` |
| AN-15 | The screen a grants manager uses: edit, annotate, change status, verify, or reject, with protection against two people editing the same item at once | `src/routes/compliance.js`, `packages/client/src/components/ChecklistItems.vue` |
| AN-16 | One-click CSV export of the full checklist | `src/routes/compliance.js` (`checklist-export`) |
| AN-17 | Tests for long documents and malformed AI output, plus a real fix (see "Fixed since first coded" below) | `src/lib/documentChunking.js`, `src/lib/grantBriefSynthesis.js`, `src/lib/checklistGeneration.js` |

## How to verify it

```sh
docker exec gost-app sh -lc 'cd /app/packages/server && yarn test:lib'
```

Result: **593 passing**, covering schema, storage, citation validation, checklist/brief generation (including long documents and malformed AI output), and the edit/verify/export API.

## Fixed since first coded

When the brief and checklist were first coded, if one part of a long notice failed (like an AI timeout), the results from the parts that worked were lost too. AN-17 (merged Nov 21, pull request #53) fixes this: a failed AI call on one chunk is now logged and skipped, the same way an unparseable response already was, instead of losing the whole document.

Two tests in `failureHandling.test.js` recorded the old behavior. Both are updated to check that the document now completes and keeps the good chunks instead of throwing.

One side effect: `evaluateFaithfulness.js` counts an "AI error" by catching a thrown error from `synthesizeGrantBrief`. Since a per-chunk failure no longer throws, that count is now always 0 even on a real failure (`faithfulness-checks.test.js`'s "counts unreadable replies and ai errors instead of crashing" failed, expected 1, got 0). Fixed: the evaluator now records the error when its own AI call fails, so the count is right again and the library didn't need to change.

## Real end-to-end evidence (not just automated tests)

Run live on OwlCloud (our actual deployment, real AI key, real FAU login), not a local/mocked test:

1. Logged in with a real FAU account, ran the real AI grant-matching against a saved organization profile.
2. Uploaded a realistic sample grant notice to the top-matched grant and ran real analysis.
3. The grant brief populated for real: purpose, eligibility, funding range, cost share, key dates, and key requirements, each with a working source-citation dropdown pointing at the exact page and quote.
4. The checklist generated from that brief, one item per obligation, correctly categorized (eligibility, cost share, deadline, submission, reporting).
5. Edited an item (only the changed field was sent), verified every item (each one re-checked its citation before allowing it), and exported the full checklist to CSV, confirmed the downloaded file had correct categories, citations, verifier name, and readable timestamps.
6. Found and fixed one real bug live: a checklist item's error message rendered in plain black instead of red, missing the `text-danger` class `DeadlineDetails.vue` already used for the same purpose. Fixed, re-tested, merged.

Screenshots of this run are saved locally in `OwlCloud Demo Screenshots` on the desktop.

## Still open

- The grant brief doesn't run the AN-13 citation check the way the checklist does (Allison's A-17 doc also flags this). A made-up quote in the brief isn't caught until Allison's A-16 evaluation checks it afterward. Worth a small follow-up: reuse `canVerifyFoundItem`/`validateSource` in the brief route too.
- `DOC-04` (document the PDF and checklist subsystem) is a separate, later deliverable (due Nov 29), this doc is task-specific evidence, not the full subsystem README.
