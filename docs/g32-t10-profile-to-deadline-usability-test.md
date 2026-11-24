# T-10: Profile-to-Deadline Usability Test

Owner: Manuel Capiendo (Portfolio and Deadline Tracker, 6.4). Prepared November 23, 2026.

This kit runs a moderated usability test of the full Grant Compliance Assistant workflow: an organization saves its profile, finds a matching grant, analyzes that grant's notice, confirms the resulting checklist items, and manages the deadlines that appear. It records where people succeed, slow down, or get stuck. Results feed the tracker documentation (DOC-05), the demo evidence (M-14), and next week's UI work.

## Scope

In scope: the path a staff member follows from **Organization Profile** to a completed deadline in **Compliance Deadlines**, using the screens on `develop` as of commit `1f8701cb` (M-11 merged).

Out of scope: account creation, grant search outside matching, ARPA reporting, and visual styling preferences (log them, but they are not task failures).

## Environment

| Item | Setting |
| --- | --- |
| App | The team server, https://gost.student.hpc.fau.edu/ (PDF upload and the AI provider work there; they do not work on a laptop without LocalStack and an AI key) |
| Account | One admin or staff account per participant, all on the same test team. Staff or admin is required to verify checklist items |
| Feature flags | Server: `ENABLE_GRANT_COMPLIANCE`, `ENABLE_ORGANIZATION_PROFILES`, `ENABLE_GRANT_MATCHING`, `ENABLE_GRANT_DOCUMENT_ANALYSIS`, `ENABLE_COMPLIANCE_CHECKLISTS`, `ENABLE_COMPLIANCE_DEADLINES` all `true`. Browser flags are already on in the server's `deploy-config.js` |
| Grant | One open demo grant that ranks in matching for the test profile. Avoid grants that have already closed |
| Notice PDF | The full announcement (NOFO) PDF for that grant, downloaded from Grants.gov before the session and placed on the participant's desktop as `grant-notice.pdf` |
| Device | Laptop browser at full width. Optional second pass at tablet width (about 800 px) |
| Recording | Screen and audio, only with written consent |

### Reset between sessions

Each participant must start from the same state.

1. Use a fresh test team, or clear the previous participant's profile fields so the profile page starts empty.
2. Remove the previous participant's uploaded document for the test grant. Document upload rejects a duplicate PDF for the same organization (see `docs/g32-c12-selected-grant-document-analysis.md`), so a leftover copy would block task 3.
3. Sign out, close the browser, and open a new window.
4. Confirm the notice PDF is on the desktop and the test grant still ranks in matching.

## Participants

Run **at least 3 sessions**: a teammate for the pilot does not count toward the 3. Include at least one person who has never worked with grant compliance. Describe participants in results only by role and experience (for example "P2: student, no grants experience"), never by name.

## Session plan (about 30 minutes)

| Part | Time | What happens |
| --- | --- | --- |
| Welcome and consent | 3 min | Read the intro, get consent for notes and any recording |
| Tasks 1 to 6 | 20 min | Participant thinks aloud; facilitator reads each task card |
| Questionnaire | 5 min | Ease and confidence ratings, open comments |
| Wrap-up | 2 min | Thank them, answer questions about the project |

### Intro script (read aloud)

> Thanks for helping. We are testing a tool, not you, so there are no wrong answers. Please think out loud as you go: say what you are looking for, what you expect to happen, and anything that surprises you. I will read each task, then mostly stay quiet. If you get completely stuck, tell me and we will move on. You can stop at any time.

Roles: one **facilitator** reads tasks and only helps when the participant is fully stuck; one **observer** fills in the observation sheet. Every hint is logged.

## Tasks

Task wording avoids naming buttons or labels, so the test shows whether people can find them. Facilitator notes say what success looks like on screen.

| # | Task card (read to participant) | Success looks like | Time budget | Failure signal |
| --- | --- | --- | --- | --- |
| 1 | "You manage grants for a small city. Set up your organization's information in the tool: you are a city of about 40,000 people in Florida, you focus on transportation and public safety, you have 2 grant staff, and you can put up matching funds." | **Organization Profile** saved with those values: **Save profile** finishes without an error and the values are still there after reloading the page | 4 min | Profile not saved, or a required field left wrong after 4 min |
| 2 | "Find grants your city could apply for, and pick the one that looks like the best fit." | **Find matches with saved profile** opens **Grant match results**; participant names a top-ranked grant and can say why (explanation or quote) | 4 min | Cannot run matching, or picks a blocked grant |
| 3 | "For the grant you picked, find out what the city would have to do. The grant's official notice is on your desktop." | From **Review documents for grant ...**, the participant uses **Upload PDF** then **Start Analysis**, and the compliance checklist appears | 5 min | Cannot find upload, or never starts analysis |
| 4 | "Look over the requirements the tool found. Confirm one that has a due date and that you agree with." | Participant opens an item's **Source citations**, reads the quote, and verifies the item | 3 min | Verifies without checking the source, or cannot verify |
| 5 | "See all of this grant's deadlines in one place. What is due soonest? Is anything overdue?" | **View deadlines for this document** opens the deadline list; participant names the soonest deadline and correctly says whether anything is overdue | 3 min | Wrong answer about overdue, or cannot reach the deadlines |
| 6 | "Pretend you just submitted the deadline you confirmed. Record that. Then check where it came from in the notice." | **Details**, then **Mark complete**; the item moves to the closed list. **Open document** returns to its checklist item | 3 min | Cannot complete it, or cannot find where it came from |

Optional task 7 if time remains: "The notice actually gives a different due date for one deadline. Fix it." Success: **Change due date**, then noticing that the deadline goes back to **Review Needed**.

## Observation sheet (one per participant)

| Task | Outcome (unaided / with hint / failed) | Time | Hints given | Quotes and confusion points |
| --- | --- | --- | --- | --- |
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |
| 6 | | | | |
| 7 (optional) | | | | |

## Questionnaire

Ask after the tasks. Ratings use 1 (very hard / not confident) to 5 (very easy / very confident).

1. Overall, how easy was it to go from your organization's profile to managing deadlines? (1 to 5)
2. How confident are you that you know which deadlines are overdue or due soon? (1 to 5)
3. How much do you trust the requirements the tool found from the notice? Why? (1 to 5)
4. Was anything confusing or surprising?
5. What one change would help most?

## Severity scale for findings

| Severity | Meaning | Action |
| --- | --- | --- |
| Blocker | Participant cannot finish the task without help | Fix now if the fix is small and safe; otherwise record as a known issue with a reason |
| Major | Participant finishes but with clear struggle or a wrong first attempt | Fix if small, otherwise schedule |
| Minor | Hesitation or a wording complaint | Log for the UI pass next week |
| Cosmetic | Visual preference only | Log for the UI pass next week |

Any fix that changes behavior must be followed by a re-run of the deadline consistency tests (`ComplianceDeadlinesConsistency.spec.js`) and the date tests (`deadlineStatus.test.js`).

## Results

Fill in after the sessions. Keep raw observation sheets out of the repository if they contain names.

### Participants

| ID | Role and experience | Date | Device |
| --- | --- | --- | --- |
| Pilot | | | |
| P1 | | | |
| P2 | | | |
| P3 | | | |

### Task outcomes

| Task | P1 | P2 | P3 | Unaided success rate | Median time |
| --- | --- | --- | --- | --- | --- |
| 1 Profile | | | | | |
| 2 Matching | | | | | |
| 3 Notice analysis | | | | | |
| 4 Verify an item | | | | | |
| 5 Find deadlines | | | | | |
| 6 Complete and trace | | | | | |

### Questionnaire summary

| Question | P1 | P2 | P3 | Average |
| --- | --- | --- | --- | --- |
| 1 Ease | | | | |
| 2 Confidence about overdue | | | | |
| 3 Trust in requirements | | | | |

### Findings

| # | Finding | Task | Seen by | Severity | Action (fixed in commit / deferred with reason / UI pass) |
| --- | --- | --- | --- | --- | --- |
| 1 | | | | | |

## Dry run (facilitator walkthrough)

Before recruiting, the facilitator walked the task path to confirm every step is reachable. Results on November 23, 2026:

| Step | Local build (`develop`, sample data) | Team server |
| --- | --- | --- |
| Profile page loads and saves | Requires `ENABLE_GRANT_COMPLIANCE` and `ENABLE_ORGANIZATION_PROFILES` in the local `.env` | To confirm in the pilot |
| Matching | Needs the pinned matching model downloaded; not set up locally | To confirm in the pilot |
| Upload and analyze a notice | Needs LocalStack and an AI key; not available locally | To confirm in the pilot |
| Checklist with sources, verify an item | Works with the sample notice (document 6); **Verify** needs extracted page text, which the sample notice does not have | To confirm in the pilot |
| Deadline list, summary, calendar, actions | Works; automated cross-check of list, summary, and calendar matched for all 7 sample deadlines | To confirm in the pilot |
| Open document jumps to the checklist item | Works (scrolls to the item, outlines it, opens its sources) | To confirm in the pilot |

The pilot session on the team server confirms the remaining steps before P1 starts.
