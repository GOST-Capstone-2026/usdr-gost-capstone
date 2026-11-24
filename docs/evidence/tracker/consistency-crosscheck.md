# Dashboard and calendar cross-check (T-08 manual check)

Run on November 23, 2026 against the local app on commit `045dee96`, with the sample data from `yarn db:seed` loaded the same day (seed dates are relative to the seed day; "today" was November 23, 2026 in Eastern Time).

A browser script signed in as `grant-admin@usdigitalresponse.org`, read the deadline API, then read the summary cards, every list section (with **Show closed** open), and the calendar (with **Show unverified** and **Show closed** on) across October 2026 to January 2027. Each deadline is checked for the right list section and label, and for exactly one calendar entry on its due date with the same label. The undated deadline must not appear on the calendar.

Result: **every deadline and every summary card matched.**

| Deadline | API status | Due date | List (section / label) | Calendar day | Match |
| --- | --- | --- | --- | --- | --- |
| Submit close-out financial report | completedLate | 2026-11-04 | completed / Complete (Was Overdue) | 2026-11-04 | Yes |
| Submit annual audit certification | completed | 2026-11-09 | completed / Complete | 2026-11-09 | Yes |
| Submit quarterly financial status report | overdue | 2026-11-14 | overdue / Overdue | 2026-11-14 | Yes |
| Complete annual performance report | upcoming | 2026-12-15 | upcoming / Upcoming | 2026-12-15 | Yes |
| Submit updated subrecipient monitoring plan | dueSoonUnverified | 2026-11-26 | reviewNeeded / Due Soon Unverified | 2026-11-26 | Yes |
| Complete civil rights compliance self-assessment | upcomingUnverified | 2026-12-04 | reviewNeeded / Upcoming Unverified | 2026-12-04 | Yes |
| Maintain records supporting ongoing grant obligations | reviewNeeded | none | reviewNeeded / Review Needed | not shown (no date) | Yes |

| Summary card | Card count | List rows | Match |
| --- | --- | --- | --- |
| overdue | 1 | 1 | Yes |
| dueToday | 0 | 0 | Yes |
| dueSoon | 0 | 0 | Yes |
| upcoming | 1 | 1 | Yes |
| reviewNeeded | 3 | 3 | Yes |

Calendar months walked: October 2026, November 2026, December 2026, January 2027. Extra calendar entries not in the API: 0.

Mutation checks (marking a deadline complete, and the list, summary, and calendar updating together without a reload) are covered by the automated consistency test in `packages/client/src/views/ComplianceDeadlinesConsistency.spec.js`.
