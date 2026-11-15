# A-16: Grant summary and checklist faithfulness evaluation

Allison Cerna, updated November 14, 2026

## What this is

The AI writes a grant summary (brief) and a compliance checklist. A-16 checks that **everything the AI says actually comes from the notice**, and that it doesn't make anything up.

## How it checks

**1. Automatic checks on every fact.** No AI call and no person needed:

| Check | What it catches |
| --- | --- |
| FOUND_HAS_SOURCE | a fact with no page or quote behind it |
| PAGE_EXISTS | a quote from a page the document doesn't have |
| EXCERPT_ON_PAGE | a quote that isn't really on that page (made up or reworded) |
| DATE_VALID / DATE_SUPPORTED | a date that isn't a real date, or doesn't match its quote |
| AMOUNT_VALID / AMOUNT_SUPPORTED | a bad dollar amount, or one that doesn't match its quote (like being off by 100x) |
| NOT_FOUND_IS_EMPTY / NOT_FOUND_LIST_MATCHES | "not found" fields that still have an answer in them |
| CATEGORY_VALID | a checklist item with a category outside our contract |
| MARKED_UNVERIFIED | AI output calling itself "verified" before a person checks it |

**2. An answer key.** There are 12 test notices:

- **11 built from our real Grants.gov demo listings.** Page 1 has the listing details the way Grants.gov shows them (dates, award amounts, cost share, who can apply). Page 2 has the description. The answers come from the same official fields, so they're exact.
- **1 real HUD PDF** (the first 2 pages of a 107-page notice). It's a trap: the table of contents lists "Cost Sharing" and "Eligible Applicants" as headings but never says what they are. A faithful summary has to say "not found" for those.

Each fact gets scored as correct, wrong, missed, or **invented** (the AI said something the notice doesn't say).

## How to run it

```sh
# free: shows what would be sent and how many tokens it would use
docker exec gost-app sh -lc 'cd /app/packages/server && yarn eval:faithfulness'

# free: a fake "perfect AI" answers from the answer key. should score 100%, proves the scoring works
docker exec gost-app sh -lc 'cd /app/packages/server && yarn eval:faithfulness --self-check'

# PAID: real CoECS calls. saves every reply so it never has to be paid for twice
docker exec gost-app sh -lc 'cd /app/packages/server && AI_PROVIDER=coecs yarn eval:faithfulness --live'

# free: rescores saved replies
docker exec gost-app sh -lc 'cd /app/packages/server && yarn eval:faithfulness --replay evaluation/faithfulness-runs/live-<date>.json'
```

A live run is **12 AI calls, about 11,000 input tokens** plus the replies.

Unit tests: `AI_PROVIDER=mock yarn test:eval` gives **62 passing** (30 of them are new for A-16). Every check has a "break it on purpose" test to prove it can actually fail.

## Results so far

| Run | Facts backed by a real quote | Recall | Invented facts |
| --- | --- | --- | --- |
| Self-check (fake perfect AI) | 54/54 | 100% | 0 |
| Live CoECS run (brief) | _to do, by Nov 22_ | | |
| Live CoECS run (checklist) | _to do, by Nov 22_ | | |

Targets for the live run: at least 90% of facts backed by a real quote, no invented facts, every reply readable, no AI errors.

## Checklist

Anthony's checklist code (AN-14) was merged on Nov 11. It already drops any item whose quote isn't really on the page (using his AN-13 citation check), so made-up quotes shouldn't reach the checklist at all. A-16 still checks the items that are kept, and also looks for things his check doesn't cover, like a wrong date or a missed requirement.

To run it: generate checklist items for the 12 test notices, save them as `{ "documents": [{ "id": "<test notice id>", "items": [...] }] }`, and add `--checklist <file>` to any run. This is **12 more AI calls**, so it gets done together with the live run.

## Limits

- The 11 listing notices are short (2 pages). Real notices are often 50–100+ pages, so a live run here doesn't test long documents. The trap PDF is the only real notice.
- The answer key only grades what the listings state exactly (purpose, who can apply, award range, cost share, close date). "Key requirements" only get the automatic checks.
- One reviewer (me).
