# A-19: Final archive audit (data, tests, secrets)

Allison Cerna, November 4, 2026 (practice run; the final run is Dec 15)

## What this is

One command that checks the final project is safe and complete to hand off: no secrets committed, no personal data, and every data file and test our docs mention is actually there.

## How to run it

In Git Bash (not the container, because it needs git), from `packages/server`:

```sh
node src/scripts/auditArchive.js
```

It only reads. It **never prints a secret**, only where one was found. It takes about 1.5 minutes, because it searches the whole git history.

## What it checks

**Secrets**
- No `.env` files are committed, and `.gitignore` keeps them out.
- `.env.example` leaves the AI keys blank.
- No real-looking API keys, tokens or private keys anywhere in the committed files.
- **The real keys in your local `.env` (like the CoECS key) were never committed**, on any branch, in the whole history. Values that match the shared dev defaults in `.env.example` are skipped, since those are public on purpose.
- The AI audit table stores hashes, never the prompt or the AI's reply.

**Data**
- No personal email addresses in the evaluation or demo data.
- The demo grants come from the public Grants.gov API.
- The evaluation inputs and an A-14 snapshot are committed. It also checks for a live A-16 report.
- No huge files committed by accident (over 5 MB).

**Tests**
- Every test and evaluation command in our docs exists, and the files it runs are there.
- No leftover `.only` in a test file (that would quietly skip every other test).

## Practice run (Nov 4)

Every secrets check passes. My CoECS key has never been in git.

Two things are expected to change before the final run:
- `evaluation/faithfulness-fixtures.json` shows as "not committed" until this work is committed.
- No live A-16 report yet.

## For the final run (Dec 15)

1. Pull the final `main` and run the audit. It should show no FAIL.
2. Run the test suites from the A-18 README.
3. Make sure everyone's CoECS and Gemini keys are only in their own `.env`. Once the class is over, rotate or delete the keys.
