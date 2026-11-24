# DOC-05: Portfolio and deadline tracker

Manuel Capiendo, November 23, 2026

What the Portfolio and Deadline Tracker (F5, section 6.4) does, where every piece lives, the rules it follows, and how to run every test that covers it. Accurate to `develop` after M-11 (PR #51). Evidence for these claims is in `docs/g32-m14-tracker-documentation-and-evidence.md`.

## Before you start

- Start the containers: `docker start gost-postgres gost-app gost-frontend gost-mailpit`
- Server commands run inside the app container: `docker exec gost-app sh -lc 'cd /app/packages/server && <command>'`
- Client commands run inside the frontend container: `docker exec gost-frontend sh -lc 'cd /app/packages/client && <command>'`
- The deadline routes need these server settings in `packages/server/.env`, all `true`: `ENABLE_GRANT_COMPLIANCE`, `ENABLE_GRANT_DOCUMENT_ANALYSIS`, `ENABLE_COMPLIANCE_CHECKLISTS`, `ENABLE_COMPLIANCE_DEADLINES`. Recreate the app container after changing them. The browser needs the matching client flags (`grantComplianceEnabled`, `grantDocumentAnalysisEnabled`, `complianceChecklistsEnabled`, `complianceDeadlinesEnabled`).
- Sample data: `yarn db:seed` loads a sample grant notice (document 6, grant `335255`) with seven checklist items whose dates are relative to the day you seed.

## What the tracker is

The tracker is a read-and-update view over the checklist items that notice analysis produces (DOC-04). **There is no separate deadline table.** A checklist item becomes a deadline the moment it has a due date, and it joins the trusted portfolio only after a person verifies it.

```
grant notice PDF
  -> analysis run: extracted pages, AI checklist with cited sources   (DOC-04, checklist_items)
  -> a person reviews items: edit, verify, reject                      (AN-15, checklist page)
  -> tracker reads non-rejected items for the organization             (GET /compliance/deadlines)
       portfolio:    verified and dated  -> summary cards, status sections, calendar
       reviewNeeded: unverified or undated -> Review Needed section
  -> staff act on deadlines: complete, not applicable, reopen, change date, verify against source
```

## Key concepts

| Term | Meaning (source of truth) |
| --- | --- |
| Portfolio item | Verified and has a due date (`isPortfolioItem`, `packages/server/src/lib/deadlineStatus.js`). Only these count as confirmed deadlines |
| Review Needed | Unverified, or no due date. Listed separately so AI output never looks like a confirmed deadline |
| Rejected | Excluded from the tracker entirely, and cannot be changed through deadline routes |
| Today | The start of the current day in **Eastern Time** (`America/New_York`), computed on the server for every request |
| Due soon window | 7 days, inclusive: a due date from tomorrow through today + 7 is `dueSoon` |
| Times shown on screen | Verified and completed times are shown in Eastern Time, with times marked `ET`, so they agree with the status rules for every viewer. Due dates are calendar dates and never shift |

## Status rules

The server computes one status per item at request time (`computeStatus`). The browser only displays it, so the list, summary cards, and calendar cannot disagree.

Checked in this order:

1. No due date: `reviewNeeded`.
2. Completion status `notApplicable`: `notApplicable`.
3. Completion status `completed`: `completedLate` if it was completed on a later Eastern day than the due date, otherwise `completed`.
4. Due date before today: `overdue`.
5. Due date is today: `dueToday`.
6. Due date within the next 7 days: `dueSoon`.
7. Otherwise: `upcoming`.

An unverified dated item gets the same status with `Unverified` added (for example `overdueUnverified`) and is placed in Review Needed. `inProgress` is treated like `notStarted`.

A deadline turns overdue at **midnight Eastern Time** after its due date, for every viewer. The page does not refresh itself at midnight; the new status appears on the next load or after any change.

## API

All routes are under `/api/organizations/:organizationId/compliance`, require a signed-in user, and act only on the organization in the session. Each returns `404 FEATURE_DISABLED` unless the four server settings above are `true`.

| Route | What it does |
| --- | --- |
| `GET /deadlines` | Returns `{ data: { portfolio, reviewNeeded }, pagination }`. Optional query: `from`, `through` (YYYY-MM-DD bounds on due date; undated items always included), `status`, `currentPage`, `perPage`, `documentId` (only that document's deadlines; the response then also includes `document`) |
| `PATCH /deadlines/:checklistItemId` | Accepts `dueDate` and/or `completionStatus` (`notStarted`, `inProgress`, `completed`, `notApplicable`). Changing the due date sets the item back to unverified and clears who verified it. Completing stamps `completedAt` once; completing again keeps the original time. Every update bumps the checklist item's `version` so checklist edits detect it |
| `PATCH /deadlines/:checklistItemId/verification` | Admin or staff only. Body `{ expectedVersion }`. Verifies the item only if every cited quote is found in the document's extracted text (`422 SOURCE_NOT_VERIFIABLE` otherwise; `409 VERSION_CONFLICT` if the item changed) |

Each deadline includes `checklistItemId`, `grantId`, `documentId`, `title`, `dueDate`, `status`, `completionStatus`, `completedAt`, `verificationStatus`, `verifiedBy`, `verifiedByName`, `verifiedAt`, `version`, `source`, and `sources`. Malformed dates, filters, or IDs return `400 VALIDATION_ERROR`. The full contract is in `docs/g32-shared-api-contracts.md`.

## Screens

Route `/compliance/deadlines` (`ComplianceDeadlinesView.vue`).

| Part | Behavior |
| --- | --- |
| Summary cards | Counts for Overdue, Due Today, Due Soon, Upcoming, and Review Needed. Each equals the rows in its section |
| List view | One section per status, Review Needed with its own status and verification columns, and a Closed section (completed and not applicable) hidden behind **Show closed** |
| Calendar view | Month grid in Eastern Time. Shows open verified deadlines by default; **Show unverified** and **Show closed** add the rest. Undated items are counted in a note instead |
| Details panel | Source page and quote, **Open document**, "Verified by [name] on [date]", and the actions **Mark complete**, **Not applicable**, **Reopen** (completed items come back as In progress), **Change due date**, and **Verify against source** (admin or staff, unverified items with sources) |
| Open document | Opens the notice's analysis page, scrolls to that checklist item, outlines it, and opens its source citations |
| One document's deadlines | The analysis page's **View deadlines for this document** opens the list filtered to that document, with **Return to document analysis** |
| Narrow screens | Up to 991 px, the date, status, verification, and completed values move under each obligation's name instead of separate columns |

## Organization isolation

Every query joins through `grant_documents.agency_id`, so one organization can never read or change another's deadlines, including by guessing an ID. This is covered by the deadline API tests and by Allison's A-13 isolation tests.

## Tests

| What | Where | Command |
| --- | --- | --- |
| Status rules, calendar boundaries (daylight saving, year end, leap day), other server time zones | `packages/server/__tests__/lib/deadlineStatus.test.js` | `NODE_ENV=test npx mocha __tests__/lib/deadlineStatus.test.js` |
| Deadline API: groups, filters, updates, verification, validation, feature flags, midnight transition, consistency | `packages/server/__tests__/api/complianceDeadlines.test.js` | `NODE_ENV=test SUPPRESS_EMAIL=true npx mocha --exit --require __tests__/api/fixtures.js __tests__/api/complianceDeadlines.test.js` |
| List, summary, and calendar agree (T-08) | `packages/client/src/views/ComplianceDeadlinesConsistency.spec.js` | `npx vitest run src/views/ComplianceDeadlinesConsistency.spec.js` |
| List page, calendar, details panel, store | `ComplianceDeadlinesView.spec.js`, `ComplianceDeadlinesCalendar.spec.js`, `DeadlineDetails.spec.js`, `store/modules/deadlines.spec.js` | `npx vitest run src/views src/components src/store` |
| Dates shown the same in every browser time zone | `packages/client/src/helpers/dates.spec.js`, `helpers/deadlineStatus.spec.js` | Run the client suite with a non-Eastern zone, for example `docker exec -e TZ=Pacific/Auckland gost-frontend ...` |
| Usability of the full workflow (T-10) | `docs/g32-t10-profile-to-deadline-usability-test.md` | Moderated sessions on the team server |

## Where everything lives

| Piece | File |
| --- | --- |
| Status rules | `packages/server/src/lib/deadlineStatus.js` |
| Routes | `packages/server/src/routes/complianceDeadlines.js` |
| Queries | `getDeadlineChecklistItems`, `getDeadlineChecklistItem`, `updateDeadlineChecklistItem` in `packages/server/src/db/index.js` |
| Feature flags | `deadlinesEnabled` in `packages/server/src/lib/complianceConfig.js`; client getters in `packages/client/src/helpers/featureFlags/index.js` |
| Sample data | `packages/server/seeds/dev/02_checklist_items.js` |
| List page | `packages/client/src/views/ComplianceDeadlinesView.vue` |
| Calendar | `packages/client/src/components/ComplianceDeadlinesCalendar.vue` |
| Details panel | `packages/client/src/components/DeadlineDetails.vue` |
| Store | `packages/client/src/store/modules/deadlines.js` |
| Labels and Eastern Time formatting | `packages/client/src/helpers/deadlineStatus.js` |

## Still open

- The due soon window is fixed at 7 days; the contract allows an organization setting, but the profile has no field for it.
- The time zone is fixed to Eastern Time for every organization.
- Changing a date in the tracker does not check whether someone edited the same item a moment earlier; the last save wins.
- Changing the due date of a verified item on the checklist page (AN-15) keeps it verified, while the tracker sets it back to unverified. Raised with the checklist owner.
- The calendar's details panel does not show **Verify against source**; it is only offered from the list view.
- **Verify against source** needs extracted page text, so it does not work on the seeded sample notice, only on uploaded and analyzed notices.
- Filtering and pagination run in memory after loading the organization's items, which is fine at capstone scale.
