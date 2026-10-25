# A-11 / A-12: Matching evaluation (blockers and ranking)

Owner: Allison Cerna. A-11 reviewed evaluation fixtures, A-12 blocker and ranking evaluation metrics.

This measures how well the grant matcher does on **real Grants.gov listings**: Connor's deterministic eligibility screener (C-06, `eligibility-v1`) and the local semantic ranker (C-09, `matcher-minilm-v1`). The C-09 doc notes that its six synthetic controls are "a smoke test, not accuracy evidence". This set is the accuracy evidence.

Everything runs locally: no database, no network after the model is cached, and no paid API. The screener and ranker don't call CoECS, so evaluating them costs nothing.

## Files

| File | What it is |
| --- | --- |
| `packages/server/evaluation/matching-fixtures.json` | the labeled evaluation set (A-11) |
| `review_matching_fixtures.py` | interactive review tool for the labels (A-11) |
| `packages/server/src/lib/evaluation-metrics.js` | metric functions (A-12) |
| `packages/server/src/scripts/evaluateMatching.js` | runs the screener and ranker on the fixtures and prints the metrics (A-12) |
| `packages/server/__tests__/lib/evaluation-metrics.test.js` | metric math checked against hand-worked and brute-force values |
| `packages/server/__tests__/lib/matching-fixtures.test.js` | fixture integrity and harness tests |

## The evaluation set (A-11)

- **Grants:** the 11 real, posted Grants.gov opportunities from the A-09 demo set (`seeds/demo/opportunities.json`, fetched 2026-10-10). Each is turned into a row with the real ingest mapping (`mapSourceDataToGrant`), so the screener sees exactly what it would see in the database.
- **Profiles:** five synthetic local governments with different applicant types and matching-fund situations:

| Profile | Type | Focus areas | Matching funds |
| --- | --- | --- | --- |
| `fl-city-flood` | city (02), FL | flood mitigation, stormwater, disaster preparedness | available, amount unknown |
| `mi-county-forest` | county (01), MI | forest conservation, parks, wildlife habitat | available, up to $500k |
| `tx-city-justice` | city (02), TX | criminal justice, public safety, juvenile justice | none |
| `wa-transport-district` | special district (04), WA | transportation safety, highway infrastructure | available, amount unknown |
| `ak-tribe-marine` | tribal government, AK | fisheries workforce, marine education | none |

- **Scenarios:** each scenario fixes a screening date, so results don't depend on when the script runs.
  - `main` (2026-10-20): all 5 profiles × 11 grants, with every grant open. Used for both blockers and ranking.
  - `after-nov-deadlines` (2026-11-18): the city profile × 11 grants. Two grants closed on 11-16.
  - `after-archive` (2026-12-20): the special district × 11 grants. Most grants are closed or archived.

  The later dates exercise the deadline and closed blockers on **real** dates instead of edited data.
- **77 cases** in total. Each case has an expected disposition, the expected hard blocker codes, a 0/1/2 relevance label (ranking scenario only), any "not modeled" ineligibility, a written rationale, and a review record.

### Labeling guide

Labels are worked out by reading the listing (applicant codes, cost share, dates, description), **never by running the screener**.

- **blockers:** a hard blocker the listing proves.
  - `APPLICANT_TYPE_UNSUPPORTED`: the listed applicant codes exclude the profile's type, with no 25 Others or 99 Unrestricted. For example, a code-00-only grant excludes every local government, including a tribe.
  - `MATCHING_FUNDS_UNAVAILABLE`: cost share is required and the profile has no matching funds.
  - `DEADLINE_PASSED`: the closing date is before the screening date.
  - `OPPORTUNITY_CLOSED`: the grant is closed or archived on the screening date.
- **disposition:**
  - `blocked` if any blocker applies.
  - Otherwise `reviewRequired` if someone has to check the notice before applying. That covers 25 Others or 99 Unrestricted on the applicant list, required cost share with no confirmed amount, an unconfirmed tribal applicant category, and closing-time instructions.
  - Otherwise `eligible`.
  - These follow the documented C-06 policy, so disposition agreement measures whether the code applies that policy correctly on real data.
- **notModeled:** the profile probably can't apply for a reason the screener has no rule for.
  - `GEOGRAPHY`: the program is limited to an area the profile isn't in, e.g. Lake Superior Basin or Alaska only.
  - `APPLICANT_TYPE_IN_NOTICE_TEXT`: the description itself limits applicants, e.g. "ERCs are academic institutions".
  - These measure gaps in the policy itself, not bugs in the code.
- **relevance:** how well the grant fits the profile's focus areas, judged from title and description: `0` not relevant, `1` partly, `2` directly.

### Review

The labels start as **drafts**: AI-drafted from the listings and not yet human-checked. The evaluation script prints a warning while any case is still a draft. To review:

```bash
python review_matching_fixtures.py            # going through draft cases, enter = agree, e = edit
python review_matching_fixtures.py --status   # checking progress
```

The tool records the reviewer, date, any note, and whether the label changed in review. Every answer is saved immediately, so a review can be split across sessions. Rerun `yarn test:eval` after reviewing, so an edit that breaks the fixture format gets caught.

**Review done 2026-10-24 by Allison Cerna, all 77 cases.**
- **Rules labels** (disposition and blockers): first cross-checked against the listing facts by a separate script that applies the labeling guide directly, without using the screener. It found 0 disagreements.
- **Judgment labels** (relevance and not-modeled): reviewed one profile at a time.
- **One label changed:** `main/tx-city-justice/355417` relevance went from 0 to 1, since workplace safety research is partly related to public safety.

## Metrics (A-12)

**Blocker screening**, over all 77 cases:

| Metric | Meaning |
| --- | --- |
| disposition accuracy + 3×3 confusion matrix | expected vs predicted `eligible` / `reviewRequired` / `blocked` |
| **false block rate** | share of not-blocked cases the screener blocked, i.e. a grant the org could apply for gets hidden |
| **missed block rate** | share of blocked cases the screener let through to ranking |
| blocker precision / recall / F1 | each (case, blocker code) pair is one prediction, micro-averaged, also broken down per code |
| exact blocker match | share of cases where the predicted code set equals the expected set |
| not-modeled pass-through | cases with a `notModeled` tag the screener marked `eligible` (silently passing an ineligible grant) |

**Ranking**, for each profile in the `main` scenario. The ideal list is every grant that is truly not blocked, with its reviewed relevance.

| Metric | Meaning |
| --- | --- |
| precision@k, recall@k | k = 1, 3, 5, counting relevance ≥ 1 as relevant |
| nDCG@k | graded gain `2^rel − 1`, log2 discount |
| reciprocal rank | 1 / position of the first relevant grant |
| random baseline | the exact expected score of a random ordering of the same candidates, so the model has something to beat |
| **blocked leaks** | truly blocked grants that still got a rank. Must be 0 |

Ranking results are macro-averaged across profiles. Grants the screener wrongly blocks lower the ranking score too, because they're in the ideal list but can't be ranked.

## Running it

In the existing `gost-app` container, with the C-09 dependencies installed and the model cached once (see `docs/g32-c09-semantic-ranking.md`):

```bash
docker exec gost-app sh -lc 'cd /app/packages/server && yarn test:eval'
docker exec gost-app sh -lc 'cd /app/packages/server && yarn eval:matching'
docker exec gost-app sh -lc 'cd /app/packages/server && yarn eval:matching --screening-only'
docker exec gost-app sh -lc 'cd /app/packages/server && yarn eval:matching --out evaluation/report.json'
```

- `yarn test:eval`: 19 tests, no model needed.
- `yarn eval:matching`: blockers and ranking.
- `--screening-only`: blockers only, no model needed.
- `--out`: also saves the full JSON report, e.g. for the A-14 snapshot.

## Results (2026-10-24, reviewed labels)

**Blocker screening** (77 cases): disposition accuracy 100%, false block rate 0%, missed block rate 0%, blocker precision 100%, recall 97.6%, F1 98.8%.

| Code | TP | FP | FN |
| --- | --- | --- | --- |
| APPLICANT_TYPE_UNSUPPORTED | 8 | 0 | 1 |
| DEADLINE_PASSED | 9 | 0 | 0 |
| MATCHING_FUNDS_UNAVAILABLE | 14 | 0 | 0 |
| OPPORTUNITY_CLOSED | 9 | 0 | 0 |

19 cases are ineligible for reasons the screener doesn't model. None of them were passed as `eligible`; all fell back to review or another blocker.

**Ranking** (5 profiles, `Xenova/all-MiniLM-L6-v2@751bff3…:q8-wasm`): no blocked grant was ranked (0 leaks).

| | precision | recall | nDCG | random nDCG |
| --- | --- | --- | --- | --- |
| @1 | 1.000 | 0.667 | 1.000 | 0.242 |
| @3 | 0.600 | 1.000 | 1.000 | 0.386 |
| @5 | 0.400 | 1.000 | 1.000 | 0.490 |

Mean reciprocal rank is 1.000, against 0.513 for a random ordering. Precision@3 is capped below 1 for most profiles because they only have 1–3 relevant grants. For every profile, every relevant grant was ranked above every non-relevant one.

## Findings

1. **The ranker rejects real ingested rows.** Ingest stores `grant_id` as a string (`'364009'`), but `rankGrantRows` requires an integer and throws `INVALID_CANDIDATES`. The evaluation converts the IDs itself (`buildRow`). The future match-run route (C-11) needs to convert them too, or the ranker should accept numeric strings.
2. **Tribal profiles can't be blocked by applicant type.** For a grant open only to code 00 (state governments), a tribal profile gets review instead of `APPLICANT_TYPE_UNSUPPORTED` (`main/ak-tribe-marine/363856`). That's the one missed blocker. It's safe in this case, because the matching-funds blocker still applied, but it would surface an ineligible grant otherwise.
3. **Location limits aren't modeled.** 19 of 77 cases are ineligible because of location or applicant limits stated only in the description. They're all caught as review today, mostly because those listings include code 25. A location-limited grant without code 25 would show as `eligible`.
4. **One ranking win is narrow.** For `wa-transport-district`, the relevant grant beat a non-relevant one by only 0.002 (0.2959 vs 0.2938). Small wording changes could flip it.

## Limits

- 11 grants and 5 profiles is a small set. The perfect ranking scores mostly show that the topics in this set are easy to tell apart. Treat them as a baseline, not proof of quality.
- Profiles are synthetic and there's one labeler. Inter-rater agreement would need a second reviewer.
- The screener has no geography rule, so geography is measured only as the `notModeled` count.
- This doesn't evaluate C-10 explanations or generated text. That's A-16 (faithfulness), which will need live CoECS calls.
