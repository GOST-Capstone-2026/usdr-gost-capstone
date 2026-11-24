# Tracker test results

Run on November 23, 2026 against commit `045dee96` (branch `m12-m14-tracker-tests-and-docs`, on top of `develop` after M-11). Generated from the test runners' own output.

## Summary

| Suite | Result |
| --- | --- |
| Server date rules, `__tests__/lib/deadlineStatus.test.js` | 32 passing (48ms) |
| server date tests, TZ=UTC | 32 passing (41ms) |
| server date tests, TZ=Asia/Tokyo | 32 passing (38ms) |
| Server deadline API, `__tests__/api/complianceDeadlines.test.js` | 68 passing (2s) |
| client suite, TZ=America/New_York | Tests 516 passed, 9 skipped (525) |
| client suite, TZ=Pacific/Auckland | Tests 516 passed, 9 skipped (525) |
| client suite, TZ=America/Los_Angeles | Tests 516 passed, 9 skipped (525) |

## T-08 / M-12 consistency tests (client)

- T-08 / M-12 deadline list, summary and calendar consistency > gives every summary card the same count as its list section
- T-08 / M-12 deadline list, summary and calendar consistency > lists every deadline exactly once, in the section its server status belongs to
- T-08 / M-12 deadline list, summary and calendar consistency > keeps unverified and undated deadlines out of every portfolio count
- T-08 / M-12 deadline list, summary and calendar consistency > shows by default exactly the open verified deadlines on the calendar, each on its due date
- T-08 / M-12 deadline list, summary and calendar consistency > places every dated deadline on its due date once unverified and closed items are shown, and never an undated one
- T-08 / M-12 deadline list, summary and calendar consistency > shows the same status label for a deadline in the list and on the calendar
- T-08 / M-12 consistency after a change > updates the summary, list and calendar together when a deadline is marked complete, without a reload

## M-13 date and time zone cases (server)

*getToday*

- uses the Eastern Time date when UTC has already moved to the next day
- moves to the next day once midnight passes in Eastern Time

*computeStatus for incomplete items*

- returns overdue for a due date before today
- returns dueToday for a due date of today
- returns dueSoon on the last day of the default window
- returns upcoming on the first day after the default window
- applies a custom due-soon window
- treats inProgress the same as notStarted

*computeStatus for closed items*

- returns completed when finished on the due date
- returns completed when finished late in the evening Eastern Time on the due date
- returns completedLate when finished after the due date in Eastern Time
- returns completed when no completion time is recorded
- returns notApplicable for a past-due item marked not applicable

*computeStatus for items needing review*

- returns reviewNeeded for an undated item even when verified
- adds the Unverified suffix for an unverified dated item
- adds the Unverified suffix to closed statuses

*calendar boundaries*

- keeps a seven-day due-soon window across the spring daylight saving change
- changes days at Eastern midnight on the spring daylight saving day
- changes days at Eastern midnight on the fall daylight saving day
- treats a deadline on the fall daylight saving day as due that whole day
- crosses the year boundary
- counts February 29 as a day in a leap year
- marks a completion at 12:01 AM Eastern on the next day as late
- lets completed and not applicable override an overdue date

*when the server runs in another time zone*

- computes the same Eastern Time statuses when the default zone is UTC
- computes the same Eastern Time statuses when the default zone is America/Los_Angeles
- computes the same Eastern Time statuses when the default zone is Asia/Tokyo
- computes the same Eastern Time statuses when the default zone is Pacific/Auckland

*isPortfolioItem*

- accepts a verified dated item
- rejects an unverified item
- rejects an undated item

*ALLOWED_STATUSES*

- lists every status computeStatus can return

**32 passing (48ms)**

## Deadline API tests (server)

*'/app/packages/server/__tests__/api'*

*Dropping database usdr_grants_test*

*Re-creating database usdr_grants_test*

*Seeding database usdr_grants_test*

*when the deadline feature is turned off*

- refuses every deadline route while ENABLE_GRANT_COMPLIANCE is off (83ms)
- refuses every deadline route while ENABLE_GRANT_DOCUMENT_ANALYSIS is off
- refuses every deadline route while ENABLE_COMPLIANCE_CHECKLISTS is off
- refuses every deadline route while ENABLE_COMPLIANCE_DEADLINES is off

*GET /compliance/deadlines*

- filters by document before calculating both groups and their pagination
- rejects malformed and unavailable document filters
- turns a deadline from due today to overdue when midnight passes in Eastern Time
- returns every deadline exactly once, in the group and status the dashboard and calendar both read (T-08) (90ms)
- splits items into a verified, dated portfolio group and a reviewNeeded group
- computes overdue for a past-due, incomplete item
- computes upcoming for a far-future, incomplete item
- marks a completed item finished before its due date as completed
- marks a completed item finished after its due date as completedLate
- returns an unverified item due soon in reviewNeeded as dueSoonUnverified
- returns an unverified item beyond the warning window in reviewNeeded as upcomingUnverified
- returns an undated item in reviewNeeded with status reviewNeeded
- returns the source page and excerpt for an item with a cited source
- returns a null source when no source was located
- keeps the source on an undated item so the date can be resolved later
- fills grantId and documentId from the checklist item's grant document
- keeps undated items when a date range is requested
- rejects a request for an organization outside the user's tenant
- rejects an invalid status filter
- rejects malformed from and through filters instead of failing in the database
- filters results by status when requested
- filters the reviewNeeded group by a review status
- rejects an unauthenticated request

*with several sources on one checklist item*

- returns the first source

*with additional status cases*

- computes dueToday for a verified item due today in Eastern Time
- computes dueTodayUnverified for an unverified item due today
- computes overdueUnverified for an unverified past-due item
- computes completedLateUnverified for an unverified item completed after its due date
- excludes rejected items from both groups
- computes notApplicable, not overdue or completed, for a past-due verified item marked not applicable
- computes notApplicableUnverified for an unverified item marked not applicable
- accepts notApplicable as a status filter
- keeps an undated item marked not applicable in reviewNeeded with status reviewNeeded

*PATCH /compliance/deadlines/:checklistItemId/verification*

- moves the cited deadline to the portfolio and stamps the reviewer (42ms)
- rejects an obsolete version before changing the item
- rejects an item if any cited excerpt is unsupported
- denies another team access to the item

*PATCH /compliance/deadlines/:checklistItemId*

- corrects a verified item's due date and resets it to unverified
- attaches a due date to an item that previously had none
- marks an item complete and stamps completedAt
- clears completedAt when an item moves away from completed
- rejects a null due date
- rejects a malformed due date
- rejects a due date in year 0000, which the database cannot store
- rejects an invalid completion status
- rejects an unknown field
- rejects an empty body
- returns 404 for a checklist item that does not exist in the organization
- rejects a request for an organization outside the user's tenant
- rejects an unauthenticated request
- updates dueDate and completionStatus together in one request
- rejects a non-numeric checklistItemId
- rejects a non-integer checklistItemId
- rejects a checklistItemId too large for the database
- completing a verified item leaves it verified, matching a subsequent GET
- correcting a due date moves the item from portfolio to reviewNeeded until re-verified
- bumps the checklist item version on every update so checklist edits detect the change
- keeps the original completedAt when an already-completed item is marked complete again
- marks the item user-edited only when its due date changes
- marks an item not applicable without stamping completedAt

*cross-organization access to a real checklist item*

- does not return another organization's items
- returns 404 and leaves the item unchanged when patched through a different organization's route

*a rejected checklist item*

- returns 404 and keeps the item rejected when its due date is corrected
- returns 404 and leaves the item unchanged when its completion status is updated

**68 passing (2s)**
