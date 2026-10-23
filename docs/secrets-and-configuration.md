# Secrets and Configuration

How this repo handles secrets (API keys, passwords) and regular config, locally and in deployed environments. Includes the AI provider settings added for the server-side AI adapter (`packages/server/src/lib/ai-provider.js`).

## Secret vs. config

A **secret** is anything that grants access or would cost money or data if leaked. **Config** is everything else. Both are environment variables, but they're handled differently.

| Variable | Type | What it is |
| --- | --- | --- |
| `COECS_API_KEY` | secret | personal key from the CoECS LLM Self-Service Portal (Trussed AI), main AI provider |
| `GEMINI_API_KEY` | secret | Google AI Studio key, backup AI provider |
| `POSTGRES_URL` | secret | DB connection string, includes the password |
| `COOKIE_SECRET` | secret | signs session cookies |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | secret | `test`/`test` locally for localstack, real creds never go in `.env` |
| `NODEMAILER_EMAIL_PW` | secret | SMTP password |
| `DD_API_KEY` | secret | Datadog (prod only) |
| `COECS_BASE_URL`, `AI_PROVIDER`, `AI_MODEL`, `AI_MAX_OUTPUT_TOKENS`, `AI_TEMPERATURE`, `AI_TIMEOUT_MS`, `AI_MAX_RETRIES` | config | AI adapter behavior, safe to commit defaults |
| `WEBSITE_DOMAIN`, `ENABLE_*`, queue URLs, etc. | config | app behavior |

## Local development

1. Copy the template: `cp packages/server/.env.example packages/server/.env`
2. Fill in real values **only in `.env`**. `.env` is gitignored (root `.gitignore`, line 78), `.env.example` is committed and must only ever hold placeholders or safe local defaults.
3. How it gets loaded:
   - in docker, `docker-compose.yml` passes `packages/server/.env` to the `gost-app` container via `env_file`
   - outside docker, `src/configure.js` calls `require('dotenv').config()`
   - after editing `.env`, restart the container (`docker compose restart app`) so the new values load

### Setting up the AI provider

The adapter defaults to `AI_PROVIDER=mock`, which needs no key and makes no network calls. Dev and tests work out of the box and cost nothing.

| `AI_PROVIDER` | Needs | Notes |
| --- | --- | --- |
| `mock` (default) | nothing | fake responses, for dev + tests |
| `coecs` | `COECS_API_KEY`, `COECS_BASE_URL` | school-provided models through Trussed AI, main provider |
| `gemini` | `GEMINI_API_KEY` | Google AI Studio free tier, backup |

#### CoECS portal (main provider)

The course project **Grant Compliance Assistant (ED2-G29)** is set up in Trussed AI with access to `gpt-5.6-luna` and `gpt-5.6-solo`.

1. Create your **own** key in the CoECS LLM Self-Service Portal (https://trussedportal.hpc.fau.edu/, FAU SSO login). Keys are per student. Don't share one key across the team.
2. Add to `packages/server/.env`:
   ```
   AI_PROVIDER=coecs
   COECS_API_KEY=<your key>
   COECS_BASE_URL=https://trussed.eng.fau.edu/provider/generic
   AI_MODEL=gpt-5.6-luna
   ```
3. Check it: `cd packages/server && yarn ai:check "what is a federal grant?"`. Config is printed with the key masked to its last 4 characters.

The gateway uses the OpenAI-style chat completions API, so the adapter sends `POST {COECS_BASE_URL}/chat/completions` (i.e. `https://trussed.eng.fau.edu/provider/generic/chat/completions`) with the key as an `Authorization: Bearer` header.

> **Portal vs. API:** `trussedportal.hpc.fau.edu` is only the website for creating and managing keys. It sits behind FAU SSO, so API requests sent there just redirect to the login page. The API is `trussed.eng.fau.edu`.

**Budget:** each key has a **$10/month** recurring budget. Unused budget doesn't roll over, and once it's used up, requests are rejected until the next month. The adapter is built around this:
- `mock` is the default, so tests, CI and normal dev never spend money
- a budget-exceeded error (`code: 'budget'`) is **not** retried, because retrying can't succeed until the reset
- output is capped by `AI_MAX_OUTPUT_TOKENS` (default 4096; gpt-5 models use part of it for hidden reasoning)
- retries are capped by `AI_MAX_RETRIES` (default 2)
- only switch `AI_PROVIDER` to `coecs` when you actually need real output

#### Gemini (backup)

1. Create a key at https://aistudio.google.com/apikey (free, no billing needed).
2. Set `AI_PROVIDER=gemini`, `GEMINI_API_KEY=<your key>`, and optionally `AI_MODEL=gemini-3.8-flash`.

> **Free tier data note:** Google may use free-tier prompts and responses to improve its products. Only send public data (e.g. grant listings from grants.gov) through Gemini. Never send user PII, internal notes, or anything tenant-specific.

If the selected provider is missing its key (or `COECS_BASE_URL`), the adapter throws a config error such as `COECS_API_KEY is not set` as soon as it is created, before any request goes out.

## Rules for handling secrets in code

These are enforced by how `ai-provider.js` is written, and should be followed for any new integration:

- **Server only.** Secrets are read from `process.env` in `packages/server` only. The browser calls our API, and our API calls the provider. The client is built with Vite, and any `VITE_*` variable is bundled into public JavaScript, so a secret must **never** get a `VITE_` prefix or be read in `packages/client`.
- **Single entry point.** Only `ai-provider.js` reads `COECS_API_KEY` / `GEMINI_API_KEY`. Other code calls `generateText()` and never sees the key.
- **Keys in headers, not URLs.** Keys are sent as headers (`Authorization: Bearer` for CoECS, `x-goog-api-key` for Gemini), never as `?key=` in the URL, because URLs end up in access logs, traces (dd-trace), and error messages.
- **Never log secrets or payloads.** The adapter logs provider, model, finish reason, and token counts only, never the key, prompt, or response text. `describeConfig()` masks the key for debugging output.
- **Fail fast.** A missing required secret throws a clear config error when the adapter is created, not a confusing 403 from the provider later.
- **Errors don't echo secrets.** Provider errors are converted to `AiProviderError` with a `code` (`auth`, `budget`, `rate_limit`, `timeout`, ...). The check script prints only `code` and `message`.
- **Tests never use real keys.** `__tests__/lib/ai-provider.test.js` stubs `fetch` and uses fake keys, and it also asserts the key is absent from the request URL.

## Deployed environments (AWS)

Production and staging do **not** use `.env` files. Secrets live in **AWS SSM Parameter Store as `SecureString`** (encrypted with the `alias/aws/ssm` KMS key) and ECS injects them into the container as env vars at task start. See `terraform/modules/gost_api/secrets.tf` and the `map_secrets` block in `task.tf`. That's how `COOKIE_SECRET` and `POSTGRES_URL` already work.

To add `COECS_API_KEY` the same way (not applied yet, this is the plan; same steps for `GEMINI_API_KEY`):

1. Store the key out of band, so it never lands in terraform state or git:
   ```
   aws ssm put-parameter --type SecureString \
     --name "<ssm_path_prefix>/ai/coecs_api_key" --value "<key>"
   ```
2. Reference it in `terraform/modules/gost_api/secrets.tf` with a `data "aws_ssm_parameter"` block named `coecs_api_key` (same pattern as `datadog_api_key`), and add its ARN to the `GetSecretParameters` statement in `decrypt_secrets_policy`.
3. Add `COECS_API_KEY = join("", data.aws_ssm_parameter.coecs_api_key[*].arn)` to `map_secrets` in `task.tf`.
4. Set the non-secret `AI_PROVIDER` / `AI_MODEL` / `COECS_BASE_URL` via `api_container_environment` in the env's `.tfvars`.

Note: CoECS keys are personal student keys meant for development. A real deployment should get its own project-level key, not one tied to a student.

## Rotation and leaks

- **Rotate:** create a new key, update `.env` (local) or the SSM parameter (deployed), restart the app or redeploy the ECS service, then delete the old key in the CoECS portal (or AI Studio).
- **If a key is committed or pasted somewhere public:** revoke it in the CoECS portal (or AI Studio) immediately, since anyone with it can spend your $10 budget. Deleting the commit is not enough, because the key is already in git history and possibly scraped. Then rotate as above and tell the team.
- Before committing, run `git diff --cached` and check that no `.env` file or key-looking string is staged.

## Verifying (for review)

```
cd packages/server
yarn test:ai                 # adapter unit tests, no network, no key
yarn ai:check                # mock provider, works with no key
AI_PROVIDER=coecs yarn ai:check    # with no key set: fails fast with a config error
git check-ignore -v .env     # proves .env is ignored
```
