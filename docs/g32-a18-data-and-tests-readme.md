# A-18: Data and test README

Allison Cerna, November 4, 2026

What data our project adds, where it came from, and how to run every test and evaluation.

## Before you start

- Start the containers: `docker start gost-postgres gost-app gost-localstack_main`
- Every command below runs inside the app container:
  `docker exec gost-app sh -lc 'cd /app/packages/server && <command>'`
- **Always put `AI_PROVIDER=mock` in front of test commands.** If your `.env` says `AI_PROVIDER=coecs`, some tests will make real, paid AI calls (and then fail, because they expect the free mock).

## The data

All of it is in `packages/server/`.

| File | What it is | Where it came from |
| --- | --- | --- |
| `seeds/demo/opportunities.json` | 11 real grant listings used in the demo (A-09) | Grants.gov public API, fetched Oct 10, 2026 |
| `evaluation/matching-fixtures.json` | 77 hand-reviewed eligibility cases and 5 sample organizations (A-11) | built from the demo listings, each case reviewed by Allison |
| `evaluation/faithfulness-fixtures.json` | 12 test notices with an answer key for AI summaries (A-16) | 11 built from the demo listings, plus 2 pages of a real HUD notice (`__tests__/fixtures/an08-sample.pdf`) |
| `evaluation/snapshots/a14-integrated-*.json` | full eligibility, ranking and explanation results (A-14) | `yarn eval:snapshot` |
| `evaluation/snapshots/a16-faithfulness-*.json` | AI summary faithfulness results (A-16) | `yarn eval:faithfulness` |
| `evaluation/headline-numbers.json` | the numbers for the poster, demo and video (A-15) | `yarn verify:prototype` |

None of it has personal information. The listings are public, and the sample organizations are made up.

**Rebuilding the data:**

- Load the demo grants into the dev database: `yarn demo:load` (safe to rerun).
- Rebuild the A-16 test notices after changing the demo data: `node src/scripts/buildFaithfulnessFixtures.js`.
- If the demo listings change, the A-11 cases have to be reviewed again by a person.

## Tests

| Command | What it tests | Expected |
| --- | --- | --- |
| `AI_PROVIDER=mock yarn test:eval` | evaluation metrics, A-11 cases, explanation checks (A-14), faithfulness checks (A-16) | 62 passing |
| `AI_PROVIDER=mock yarn test:failures` | outside services failing and bad AI output (A-17) | 35 passing |
| `AI_PROVIDER=mock yarn test:isolation` | one organization can't see another's data (A-13) | 21 passing |
| `AI_PROVIDER=mock yarn test:ai` | the AI adapter and audit log (A-10) | all passing |
| `AI_PROVIDER=mock yarn test:apis` | every API test, ours and GOST's (needs localstack) | 260 passing, 1 skipped |
| `AI_PROVIDER=mock yarn test:lib` | every library test, ours and GOST's (takes about 9 minutes) | 498 passing |

If the first run after starting Docker times out, run it again. The database is still warming up.

## Evaluations

| Command | What it does | Cost |
| --- | --- | --- |
| `yarn eval:snapshot` | runs the full matching pipeline twice and checks 8 gates (A-14) | free |
| `yarn eval:faithfulness` | dry run: shows what a live run would send | free |
| `yarn eval:faithfulness --self-check` | checks the A-16 scoring with a fake perfect AI | free |
| `AI_PROVIDER=coecs yarn eval:faithfulness --live` | real AI summaries scored against the answer key | **paid** (12 calls) |
| `yarn eval:faithfulness --replay <file>` | rescores saved live replies | free |
| `yarn verify:prototype --demo-date <date> --db` | checks the demo data and results before the demo (A-15) | free |

## Final audit

`node src/scripts/auditArchive.js` checks for committed secrets, personal data and missing files (A-19). Run it **outside** the container in Git Bash, from `packages/server`, because it needs git.

## More detail

Each task has its own doc in `docs/`: `g32-a11-a12-matching-evaluation.md`, `g32-a13-organization-isolation.md`, `g32-a14-integrated-evaluation-snapshot.md`, `g32-a15-verify-prototype.md`, `g32-a16-faithfulness-evaluation.md`, `g32-a17-failure-tests.md`, `g32-a19-archive-audit.md`.
