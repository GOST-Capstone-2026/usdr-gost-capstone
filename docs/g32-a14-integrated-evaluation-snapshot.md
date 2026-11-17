# A-14: Integrated evaluation snapshot

Allison Cerna, October 30, 2026

## What this is

In A-12, I tested the eligibility checker and the grant ranker on Connor's branch. Now that his code is merged into `develop`, this snapshot runs the **whole matching process together** on the same 77 reviewed test cases:

1. load the Grants.gov listings the same way the app does
2. check eligibility (C-06)
3. rank the grants for each organization (C-09)
4. explain each match (C-10)
5. score everything against the reviewed answers (A-11 / A-12)

The results are saved to a dated file, so we can compare future versions against it:
`packages/server/evaluation/snapshots/a14-integrated-2026-10-31.json`

## How to run it

```sh
docker exec gost-app sh -lc 'cd /app/packages/server && yarn test:eval'       # 32 unit tests
docker exec gost-app sh -lc 'cd /app/packages/server && yarn eval:snapshot'   # the full snapshot
```

It doesn't need the database or internet, and it makes no paid AI calls. The ranking model has to be downloaded once first (`node src/scripts/rehearseSemanticRanking.js --download-model`).

## Results

All 8 pass/fail goals passed:

| Goal | Result |
| --- | --- |
| All test cases reviewed by a person | ✅ 77/77 |
| No ineligible grant let through | ✅ 0 |
| No eligible grant wrongly blocked | ✅ 0 |
| No unclear case marked as fully eligible | ✅ 0 of 19 |
| No blocked grant shows up in the rankings | ✅ 0 |
| Ranking does better than random | ✅ 1.00 vs 0.39 |
| Every match explanation passes every check | ✅ 55/55 |
| Running it twice gives the exact same results | ✅ |

**What changed since A-12:**
- Blocker accuracy went from 97.6% to **100%**, because Connor fixed the tribal-profile issue I reported.
- The 12 location-limited grants now get a "check the location" warning (before: 0).
- The evaluation now uses grant IDs exactly as the app stores them, since Connor fixed the ranker to accept them.
- The rankings themselves didn't change.

## How the match explanations are checked

Connor's explanations quote the grant listing and say why a grant ranked where it did. I added 11 checks to make sure each explanation is honest, for example:
- every quote really appears in the grant listing
- every score matches the real ranking
- every blocker and warning is explained
- no explanation says the organization "is eligible" or "qualifies"

Each check has its own test that breaks an explanation on purpose and makes sure the check catches it. So "0 problems found" means the checks really looked.

## Good to know

- The test set is small (11 grants, 5 sample organizations, one reviewer), so treat these numbers as a starting point, not a final grade.
- One ranking is very close: for the WA transportation district, the top grant wins by only 0.002.
- Grants that say "academic institutions only" in their text still don't get a specific warning. They're safe for now only because that grant is already flagged for review.
- The security tests (A-13, `yarn test:isolation`) ran on the same code: 21/21 passing. See `docs/g32-a13-organization-isolation.md`.
- Checking AI-written text is a separate task (A-16).
