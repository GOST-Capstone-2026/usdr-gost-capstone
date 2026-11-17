# A-13: Organization isolation and authorization tests

Allison Cerna, October 30, 2026

## What this is

These tests make sure **one organization can't see or change another organization's data**. That covers profiles, uploaded grant documents, grant summaries (briefs), analysis runs, and deadlines.

Each feature already had a test or two for this. A-13 checks **every** compliance page against **every** kind of user, all in one place.

## How to run it

```sh
docker exec gost-app sh -lc 'cd /app/packages/server && yarn test:isolation'
```

It uses the test database, never the real dev data, and cleans up after itself. Result: **21 passing**.

## How it works

The test creates sample data for two organizations:

| | Organization | Users used |
| --- | --- | --- |
| Org A | USDR | a staff member and an admin |
| Org A's sister agency | TSDR (same tenant as USDR) | a staff member |
| Org B | Nevada (different tenant) | a staff member and an admin |

Then it tries to reach Org A's data in every way we could think of, and checks 3 things each time:

1. **The user is blocked.**
2. **The error message doesn't leak anything.** Org A's sample data has "secret" words planted in it, and the test makes sure they never show up.
3. **Nothing gets changed.** Org A's data is saved before the attempt and compared after.

It also checks that real members **can** get to their own data. Without that, a page that blocked everyone would pass by accident.

## What was tested

| Who | Tried to | Result |
| --- | --- | --- |
| Org A's own staff | see Org A's data | ✅ allowed, and only sees Org A's data |
| Not logged in, or a fake/forged login | use any of the 9 compliance pages | ✅ blocked |
| Staff or admin from Org B | use Org A's pages | ✅ blocked |
| Staff from the sister agency | use Org A's pages | ✅ blocked |
| Org B or sister-agency users | open Org A's records by guessing their ID numbers | ✅ "not found" |
| Org A's admin | use Org B's pages | ✅ blocked |
| Anyone | use a weird organization ID like `00` or `abc` | ✅ blocked or rejected |
| Audit log search (my A-10 code) | search one tenant's AI records | ⚠️ was broken for tenant #0, **now fixed** |

## What I found

1. **Fixed (my A-10 code):** searching the AI audit log for tenant #0 returned **every** tenant's records. JavaScript treats `0` as "no filter," so the filter was skipped. It's a one-line fix in `ai-audit.js`. Nothing was exposed, because no page uses that search yet.
2. **For Anthony:** grant brief AI calls are saved in the audit log without a tenant or user (`analysisRuns.js`, lines 74-78), so we can't tell which organization or user triggered them. The fix is to pass the organization and user into `runAnalysis` and on to the audit call.
3. **Good to know:** admins can open any agency in their own tenant, not just their own agency. That's how GOST was already built. The test makes sure it stays that way unless we decide to change it.
4. **Good to know:** if an admin uses a non-number organization ID (like `abc`), the app quietly shows their own organization. It never shows someone else's, so it's not a leak, just a little odd.

## Tip for running the full test suite

Our `.env` files may point at the real CoECS AI. The API tests read `.env`, so one of the grant brief tests will make **real (paid) AI calls** and then fail, because it expects the free mock. To keep it free, run:

```sh
docker exec gost-app sh -lc 'cd /app/packages/server && AI_PROVIDER=mock yarn test:apis'
```

With the mock, the full API suite gives 250 passing.

## What's not covered yet

- The original GOST pages (grants, users, agencies) have their own tests and aren't re-checked here.
- Connor's ranked-results page (C-11) isn't merged yet. Once it is, it should be added to this test.
