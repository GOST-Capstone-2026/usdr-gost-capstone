# A-15: Verify prototype data and evaluation results

Allison Cerna, November 4, 2026

## What this is

One command that checks the demo data and our evaluation results are still correct before the demo, video and poster. It also saves the **headline numbers** in one file, so every place we show them uses the same numbers.

## How to run it

```sh
docker exec gost-app sh -lc 'cd /app/packages/server && yarn verify:prototype --demo-date 2026-12-04 --db'
```

- `--demo-date` checks which grants will still be open on that day (default is today).
- `--db` also checks the grants loaded in the dev database.
- It only reads. The one file it writes is `evaluation/headline-numbers.json`.

## What it checks

| Area | Checks |
| --- | --- |
| Demo data | all 11 listings are there, complete, and go through the real importer |
| Test data | the A-11 cases and A-16 test notices match the current demo data |
| Demo day | which grants are open, closing soon, or closed on the demo date |
| Database | every demo grant is loaded with the right close date and version |
| Results | the A-14 snapshot passes all 8 gates, was made with the current code versions and commit, and A-16 has a live run |

## Results (Nov 4, checking for Dec 4)

No failures, 4 warnings:

1. ⚠️ **5 of the 11 demo grants will be closed by Dec 4.** 364009 and 364035 close Nov 16, 364037 and 363856 close Nov 20, and 363815 closes Dec 1. Two more close right after the demo (364026 on Dec 7, 361418 on Dec 8).
2. ⚠️ **The saved status in the database goes out of date.** It's set once when the grants are loaded, so closed grants still say "posted." The main grant search works the status out from the close date, so it's right there. Only the older grants list uses the saved value.
3. ⚠️ A-16 doesn't have a live AI run yet (see the A-16 doc).
4. ✅ I reran the A-14 snapshot on today's code (after merging the latest `develop`). All 8 gates still pass with the same numbers.

## Team decision needed

For the closing grants, we can:

- **Pick a fixed "as of" date for the demo** (for example Nov 10). Matching already takes a date, so the results stay the same every time we show it.
- **Or demo with the 6 grants that stay open.**
- **Or refresh the demo data** with newer Grants.gov listings. This means redoing the A-11 review and the A-12/A-14 numbers, so it's the most work.

Closed grants being blocked is also a good thing to show: it proves the deadline check works.

## Before the final demo (Dec 1–4)

```sh
docker exec gost-app sh -lc 'cd /app/packages/server && AI_PROVIDER=mock yarn test:eval && AI_PROVIDER=mock yarn test:failures && AI_PROVIDER=mock yarn test:isolation'
docker exec gost-app sh -lc 'cd /app/packages/server && yarn eval:snapshot'
docker exec gost-app sh -lc 'cd /app/packages/server && yarn verify:prototype --demo-date <demo day> --db'
```

Then copy the numbers from `evaluation/headline-numbers.json` into the poster, demo script and video.
