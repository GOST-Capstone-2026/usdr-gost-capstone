# A-17: External-service and malformed-output failure tests

Allison Cerna, updated November 21, 2026

## What this is

Tests for what happens when something outside our code breaks: the AI service goes down, file storage fails, the AI sends back junk (in the brief or the checklist), or the Grants.gov feed sends a bad message. The goal is that **nothing crashes, nothing gets stuck, and bad AI output never shows up looking like a real answer.**

Every outside service is faked in the test, so it's free, fast, and gives the same result every time.

## How to run it

```sh
docker exec gost-app sh -lc 'cd /app/packages/server && AI_PROVIDER=mock yarn test:failures'
```

Result: **45 passing** (was 35 before the checklist and cloud storage changes were merged).

## What was tested

| Area | Failures tested | Result |
| --- | --- | --- |
| AI service (CoECS) | server errors, outages, hanging calls, network down, bad key, an HTML error page instead of a reply, a reply cut off at the token limit | ✅ retries what's worth retrying, stops on the rest, never shows the API key |
| Bad AI replies in the grant brief | plain text, cut-off JSON, a list, `null`, an empty reply, wrong field types, a huge reply | ✅ ignored, every field shows "not found" |
| AI replies that *look* fine but aren't | a fact with no quote, a fake page number, a made-up quote, "mid-November" as a date, "80 million" as an amount, an amount off by 100x | ⚠️ the brief code saves them, but the A-16 checks catch every one |
| Long documents | one part gets a junk reply | ✅ the good parts are kept |
| | one part's AI call fails | ✅ that part is skipped, the rest is kept (fixed in AN-17) |
| Bad AI replies in the checklist (AN-14) | a made-up quote, a fake page number, no quote, a category outside the contract | ✅ the item is dropped |
| | "mid-November" as a due date | ✅ saved with no date instead |
| | one part gets a junk reply | ✅ the good parts are kept |
| | one part's AI call fails | ✅ that part is skipped, the rest is kept (fixed in AN-17) |
| File storage (S3) and PDF reading | missing file, storage down, not a real PDF | ✅ the run is marked failed, not stuck on "processing" |
| AI step during an analysis run | budget used up, no API key set | ✅ the run still finishes, just without a brief or checklist |
| | only the checklist step fails | ✅ the brief is still saved |
| Unreadable scans | a scan with no text | ✅ skips both AI steps, so no money is spent |
| Grants.gov feed | bad JSON, listings missing fields | ✅ skipped and left on the queue for a retry |
| | a message missing its `detail` | ⚠️ crashes the importer (see "Not ours") |

Connor's tests already cover the local ranking model (missing, tampered with, or bad output), so I didn't repeat them here.

## What I found

**Already fixed**

- **Bad checklist items get dropped.** Anthony's checklist code (AN-14) checks every quote against the real page (his AN-13 check) and drops anything that doesn't match. The tests confirm it catches made-up quotes, fake pages, missing quotes, and bad dates.
- **Users don't see raw errors on the page.** Connor's C-15 page shows "Analysis failed. Choose Start Analysis to retry…" instead of the internal error.
- **One failed part no longer loses the whole result.** Anthony's AN-17 (PR #53) catches an AI error for each part of a long notice and skips just that part, for both the brief and the checklist. He updated my two tests for this to check the good parts are kept.

**Still open (small)**

- **Brief quotes aren't checked yet.** The brief doesn't run the same quote check the checklist does, so a made-up quote can still get saved there. The A-16 checks catch it afterward. Easy fix: reuse the AN-13 check in the brief code. Anthony lists this as a possible follow-up in his AN-18 doc too.
- **The API still sends the raw error text** as `errorMessage`. The page hides it, but it's still in the API response. Low priority.

**Not ours, low risk:** in the original GOST code, a Grants.gov feed message with no `detail` field crashes the importer. Real messages always have it, so this is just good to know.

The tests for the open items record how things work today. If someone fixes one, that test will fail on purpose and should be updated to match the new behavior.
