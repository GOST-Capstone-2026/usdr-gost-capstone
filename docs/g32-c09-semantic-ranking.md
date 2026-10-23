# C-09: reproducible local semantic-ranking baseline

Owner: Connor Delk. Prepared and verified October 23, 2026.

Planner bucket: **Grant Finder and AI Matcher**. This branch builds on C-06 screening and the C-08/T-03 verification commit. It does not change or re-report those implementations.

## Deliverable and limits

`rankGrantRows(profile, rows, { asOfDate, expectedProfileVersion, embedder })` provides a real sentence-embedding ranking baseline for explicit stored GOST candidate rows. It screens candidates with the existing C-06 service first, then compares the saved profile's focus areas with the opportunity title and description using local MiniLM embeddings and cosine similarity.

This is a callable server service and a terminal rehearsal, not a new browser page, public match-run endpoint, persisted asynchronous job, or production recommendation system. C-10 grounded explanations and C-11 ranked-results interface/integration remain separate work. No database migrations, seeding, PDF changes, feature-flag changes, or cloud credentials are needed. Allison's unmerged text-generation adapter is not required for this local embedding baseline.

The caller must obtain the authorized organization-owned saved profile and candidates on the server before invoking this service. Input validation and a profile-version check are not a substitute for authorization. A future authorized route must map errors into the existing controlled HTTP error envelope, record actual job timestamps and run metadata, enforce request limits, and persist the input snapshot/provenance. This task does not expose or claim those routes.

## Model and reproducibility

The checked-in `packages/server/src/lib/semanticModelManifest.json` pins:

- Model: `Xenova/all-MiniLM-L6-v2` at commit `751bff37182d3f1213fa05d7196b954e230abad9`.
- Quantized ONNX weights, tokenizer JSON/config, and each file's SHA-256 checksum.
- 384 dimensions; attention-aware equivalent mean pooling for individually processed, unpadded sequences; L2 normalization.
- Maximum 256 tokens, preserving the opening/final special tokens. Truncation produces an explicit review warning.
- `onnxruntime-web` **1.22.0**, single-threaded WASM, and `@huggingface/tokenizers` **0.2.0**. These two direct dependencies are exact-pinned in the server package and root Yarn lockfile. Existing dependency resolution entries were preserved.

WASM avoids relying on a native glibc ONNX binding in the current Alpine-based development container. Connor reported the Docker checks below passed on October 23; the agent session itself could not access the engine.

Model files total approximately 24 MB and are stored under the repository's already ignored `.cache/g32-matcher/<revision>/` directory. Model assets are downloaded only with explicit opt-in. Only fixed public model URLs are requested: profile and grant text are processed locally, not sent to Hugging Face or a paid inference API. After dependencies and model assets are cached, the rehearsal runs without requesting remote inference. Cached files are verified before use; a modified file fails closed rather than silently changing the model.

Method version: `matcher-minilm-v1`. Text preprocessing version: `focus-title-description-v1`.

Each run records the model manifest, explicit business date, profile version/identity, canonical SHA-256 input snapshot hash, source revisions, normalized source text hashes, and screening method version. Candidate rows are sorted numerically by ID before inference. Scores are clamped to `[0,1]`, rounded to six decimals, and tied scores use ascending numeric grant ID. No wall-clock date or random score enters the ranking.

Repeated fixed inputs on the tested runtime produced identical results, including after reversing candidate order. Do not interpret this as a guarantee of bit-for-bit floating-point equality on every hardware/runtime combination. Changes to model, runtime, preprocessing, profile, source snapshot, or screening date require a new recorded run.

## Safety and ranking behavior

- Closed, elapsed, unsupported-applicant, and unavailable-funds hard blockers remain visible. A blocked grant receives `rank: null` and `score: null`; its text is not embedded.
- Nonblocked `reviewRequired` candidates may receive a relevance rank, but their warnings are retained. Ranking does not convert them into certified eligible grants.
- Missing title/description adds a review warning. Completely missing text stays visible and unranked; it is not assigned a fabricated zero embedding.
- A missing/changed model, invalid vectors, unknown focus areas, duplicate candidate IDs, stale profile version, or model failure produces an error, not fake successful output.
- At most 250 candidates are accepted per baseline call; title and description are limited to 32,000 characters each and 64,000 combined. Larger candidate pools require explicit future batching/candidate-selection work.
- The baseline returns every supplied candidate, including blocked and unrankable controls. Pagination, HTTP `limit`, asynchronous job persistence, and UI filtering are future integration work, not silently implemented here.
- The one current score factor is `FOCUS_AREA_MATCH` with weight `1`. There is no invented geography, staffing, population, award-size, or funding-success score. Additional justified factors and thresholds need evaluation before adoption.
- Cosine similarity is relevance, not a funding probability, source citation, or eligibility certification. The generic factor text describes the method only; grounded evidence-based explanations belong to C-10.

## Use from an authorized server caller

```javascript
const { createLocalEmbedder } = require('./packages/server/src/lib/localSemanticEmbedding');
const { rankGrantRows } = require('./packages/server/src/lib/semanticRanking');

// Load storedProfile and storedRows through existing authorization first.
const embedder = await createLocalEmbedder(); // Cached, pinned assets only; no implicit model download.
try {
    const run = await rankGrantRows(storedProfile, storedRows, {
        asOfDate: '2026-10-23',
        expectedProfileVersion: storedProfile.version,
        embedder,
    });
    // Store/return run only through the future authorized match-run wrapper.
} finally {
    await embedder.dispose();
}
```

The local session permits one active embedding call and must be disposed when finished. Mean pooling includes all attended tokens, including special tokens, matching the model-card procedure; no padding enters the average. Model load and inference are lazy and are not triggered by ordinary GOST startup.

## Verification recorded October 23

- **155 server checks passed:** the existing 109 eligibility/profile checks plus **46 new C-09 tests**. The new mechanics tests explicitly use synthetic vectors; they are not presented as real-model quality evaluation.
- **ESLint passed** for the five new JavaScript files.
- **Real quantized-model rehearsal passed:** six synthetic candidate controls, repeated run, reversed candidate order, independent hard blockers, missing text, and retained unrestricted-applicant warning.
- Example real scores on the tested runtime: flood mitigation `0.609293`, runoff management `0.492199`, library preservation `0.145199`. The closed and unavailable-funds controls remained unranked; the missing-text control required review.
- A cold-cache opt-in download succeeded with checksum verification. The actual model returned normalized 384-value vectors; a long-text probe was capped at 256 tokens and flagged as truncated.
- A separate clean installation of the new dependencies using the root lockfile and `--frozen-lockfile` succeeded. All pre-existing lock resolution entries were preserved. No advisory was returned for the pinned tokenizer, ONNX Web runtime, or ONNX common package by the npm bulk-advisory query on this date; this was not a full repository security audit.

These agent runs used the original source checkout and isolated workspace dependency installations. The 155 checks and real-model rehearsal were also rerun successfully with the repository's exact **Node 20.11.1** version on Windows; the recorded scores and input hash were unchanged. Docker execution was **not** performed by the agent because access to the Docker engine was denied.

**User-reported Docker verification, October 23:** Connor confirmed the requested checks passed: installing the frozen dependency lock in the existing container, the 155-test suite, ESLint, the opt-in real-model rehearsal, and the cached-model rerun. Retain the terminal screenshots with the model revision, input hash, and final PASS line as evidence. These are separately identified user-run results, not direct agent observation of the Docker terminal.

There was no database access or reseeding in these checks, and no live API run, representative-grant quality benchmark, or C-10 explanation evaluation was performed. T-04 ranking-quality evaluation remains distinct; six synthetic controls are a smoke test, not accuracy evidence.

## Repeat in the existing Docker container

Keep the existing database/container data. Do not run `docker compose down`, recreate PostgreSQL, or seed the database for these checks.

Install the updated dependency lock into the existing running container once:

```powershell
docker exec gost-app sh -lc 'cd /app && HUSKY_SKIP_INSTALL=1 yarn install --frozen-lockfile --ignore-scripts'
```

Run the focused regression suite (explicit file list; do not use fixture-reseeding `yarn test:lib`):

```powershell
docker exec gost-app sh -lc 'cd /app/packages/server && yarn mocha __tests__/lib/eligibilityBlockers.test.js __tests__/lib/grantsEligibilityAdapter.test.js __tests__/lib/eligibilityProfileIntegration.test.js __tests__/lib/eligibilityBoundaries.test.js __tests__/lib/eligibilityProfileValidation.test.js __tests__/lib/semanticRanking.test.js __tests__/lib/localSemanticEmbedding.test.js'
```

Run code-style checks and the real-model rehearsal:

```powershell
docker exec gost-app sh -lc 'cd /app/packages/server && yarn eslint src/lib/semanticRanking.js src/lib/localSemanticEmbedding.js src/scripts/rehearseSemanticRanking.js __tests__/lib/semanticRanking.test.js __tests__/lib/localSemanticEmbedding.test.js'
docker exec gost-app sh -lc 'cd /app && node packages/server/src/scripts/rehearseSemanticRanking.js --download-model'
```

`--download-model` downloads only absent pinned files and verifies all checksums. The agent-prepared cache may already be visible through the repository bind mount. Then rerun without download permission to verify the cached path:

```powershell
docker exec gost-app sh -lc 'cd /app && node packages/server/src/scripts/rehearseSemanticRanking.js'
```

Add `--json` for the full result and reproducibility metadata. Unknown CLI options fail with usage instructions. The rehearsal fixture declares its synthetic scope and uses the fixed screening date; it does not query or modify the local grant database.

## Evidence and review handoff

Capture the `155 passing` summary, clean ESLint completion, and real-model result table with the final `PASS` line. Keep model revision/input hash visible. Only report the Docker checks as passed after personally running them.

This change consists of ten files: the server package, root Yarn lockfile, model manifest, two implementation modules, two test files, synthetic fixture, rehearsal script, and this guide. No generated model binaries or dependency folders belong in the commit.

The `c09-semantic-ranking` branch starts from the C-08/T-03 commit. Initially compare against `c08-t03-eligibility-tests` to isolate C-09. Respect the dependency order: C-06 PR #18, C-08/T-03 PR #25, then C-09. After prerequisite merges, retarget and recheck the comparison before merging. C-10 starts after this baseline is verified; its work must be separately identified.

## Primary references

- [Original MiniLM sentence-embedding model and mean-pooling procedure](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2).
- [Exact ONNX model revision used here](https://huggingface.co/Xenova/all-MiniLM-L6-v2/tree/751bff37182d3f1213fa05d7196b954e230abad9).
- [Official Hugging Face JavaScript tokenizer](https://github.com/huggingface/tokenizers.js).
- [ONNX Runtime Web and single-threaded Node.js WASM support](https://onnxruntime.ai/docs/get-started/with-javascript/web.html).
