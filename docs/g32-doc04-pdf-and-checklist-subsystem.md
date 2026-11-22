# DOC-04: PDF and checklist subsystem

Anthony Karoussos, November 21, 2026

What the Grant Analysis and Compliance Checklist subsystem (F1, section 6.3) does, where every piece lives, and how to run every test that covers it.

## Before you start

- Start the containers: `docker start gost-postgres gost-app gost-localstack_main`
- Every command below runs inside the app container:
  `docker exec gost-app sh -lc 'cd /app/packages/server && <command>'`
- Put `AI_PROVIDER=mock` in front of any test command, same reason as Allison's A-18 doc: if `.env` is set to a real provider, some tests will make real, paid AI calls instead of using the free mock.

## The pipeline, in order

A grant notice PDF is uploaded, read page by page, split into pieces small enough for the AI, and the AI turns those pieces into a one-screen grant brief and a compliance checklist. Every fact either one reports has to cite the exact page and quote it came from, and nothing counts as trustworthy until a person reviews, edits, and verifies it.

| Step | Task | What it does | Where |
| --- | --- | --- | --- |
| 1 | AN-03 | Validates a PDF upload belongs to an authorized user/org before accepting it | `src/routes/compliance.js` |
| 2 | AN-04 | Extracts text from the PDF, page by page | `src/lib/pdfTextExtraction.js`, `src/lib/pdf.js` |
| 3 | AN-05 | Keeps each page's source metadata attached to its text, so later citations can point back to a real page | `src/lib/pdfTextExtraction.js` |
| 4 | AN-06 | Flags scanned or degraded pages that extracted little or no real text, instead of silently treating them as empty | `src/lib/extractionQuality.js` |
| 5 | AN-07 | Splits the extracted pages into AI-sized chunks, keeping track of which pages each chunk came from | `src/lib/documentChunking.js` |
| 6 | AN-09/AN-10 | Defines the grant brief's shape and fills it in from the AI, one chunk at a time, merging across chunks | `src/lib/grantBriefSchema.js`, `src/lib/grantBriefSynthesis.js` |
| 7 | AN-11/AN-12 | Defines one checklist item's shape and saves it for real, scoped to the right organization and grant | `src/lib/checklistItemSchema.js`, `src/db/index.js` |
| 8 | AN-13 | Checks a cited page and quote against the document's real extracted text before anything can be marked verified | `src/lib/sourceCitationValidation.js` |
| 9 | AN-14 | Turns the AI's findings into individual checklist items, each still carrying its citation | `src/lib/checklistGeneration.js` |
| 10 | AN-15/AN-16 | Edit, annotate, change status, verify, reject, and export to CSV, with protection against two people editing the same item at once | `src/routes/compliance.js`, `packages/client/src/components/ChecklistItems.vue` |

AN-17 added test coverage (and one real fix) for long documents and malformed AI output across steps 6 and 9; see `docs/g32-an18-checklist-documentation-and-evidence.md` for the detail on that fix.

## Tests

| Command | What it tests | Expected |
| --- | --- | --- |
| `AI_PROVIDER=mock yarn test:lib` | every library test, ours and GOST's, including all steps above (takes about 9 minutes) | 592 passing (1 known failure, not in this subsystem, see below) |
| `AI_PROVIDER=mock yarn test:apis` | the compliance API routes: analysis runs, checklist items, deadlines, grant brief, profile (needs localstack) | included in the 260+ passing suite |
| `yarn test` (in `packages/client`) | the Vue component tests, including `ChecklistItems.spec.js` | all passing |

Individual test files for this subsystem, if you want to run just one:

- `__tests__/lib/documentChunking.test.js` (step 5)
- `__tests__/lib/grantBriefSchema.test.js`, `__tests__/lib/grantBriefSynthesis.test.js` (step 6)
- `__tests__/lib/checklistItemSchema.test.js` (step 7)
- `__tests__/lib/sourceCitationValidation.test.js` (step 8)
- `__tests__/lib/checklistGeneration.test.js` (step 9)
- `__tests__/api/complianceAnalysisRuns.test.js`, `complianceChecklistItems.test.js`, `complianceDeadlines.test.js`, `complianceGrantBrief.test.js`, `complianceProfile.test.js` (API layer for steps 7-10)
- `packages/client/src/components/ChecklistItems.spec.js` (step 10, including the edit/verify/reload behavior)

The one known failure in `yarn test:lib` is in Allison's `faithfulness-checks.test.js`, not this subsystem's own tests. It's a side effect of the AN-17 fix (a per-chunk AI failure is now skipped instead of thrown, so her evaluator's error count reads 0 instead of 1). Already flagged to her, see `docs/g32-an18-checklist-documentation-and-evidence.md`.

## T-05 and T-07 (cross-team testing tasks)

These two testing tasks are mine on the planner but aren't separate deliverables, the same way Allison's T-02/T-04/T-06/T-09 were satisfied by her own A-numbered work rather than their own docs.

- **T-05, test short and long grant summaries**: covered by `grantBriefSynthesis.test.js`'s long-document tests (added in AN-17, including "collects facts scattered across a long document of many chunks") and by the real OwlCloud run in the AN-18 doc, which generated a real grant brief from an uploaded notice.
- **T-07, test checklist edit, verify, export, and reload**: edit, verify, and export are covered by the same live OwlCloud run in the AN-18 doc. Reload is covered by `ChecklistItems.spec.js`'s "reloads the list after a version conflict, so the next attempt starts from the saved state."

## Still open

- The grant brief doesn't run the AN-13 citation check the way the checklist does (also flagged in the AN-18 doc and Allison's A-17 doc). Worth a follow-up to reuse `canVerifyFoundItem`/`validateSource` in the brief route.
- AN-19 (verify final checklist workflow for presentation) and AN-20 (audit final checklist documentation) are still open on the planner, due Dec. 5 and Dec. 15.
