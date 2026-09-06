# G32 LocalStack setup and verification

## Scope

The local Compose stack uses LocalStack to emulate AWS services. The tested image requires authentication and exits with code 55 when credentials are missing. Compose forwards `LOCALSTACK_AUTH_TOKEN` from the host environment and fails early if it is empty or unset.

The image is pinned to the repository digest reported from Connor's tested container:

```text
localstack/localstack@sha256:2a81e5da4c32bb53e8d86e92050a12937f9be1915c5a4afad0931f75c112fc7e
```

Pinning prevents a moving image tag from silently changing the local environment. It does not remove authentication or subscription requirements. Teammates still need to verify access with their own accounts and machines. This is a local-development fix, not an Owl Cloud deployment configuration.

## Before starting Compose

1. Start Docker Desktop and wait until its engine is running.
2. Open PowerShell in the repository root. Complete the existing Docker setup prerequisites, including the application environment files.
3. Obtain your own LocalStack auth token following the [official authentication instructions](https://docs.localstack.cloud/aws/getting-started/auth-token/). Confirm your account permits the services used below; do not assume every plan has identical capabilities.
4. Enter the token without placing its literal value in command history:

```powershell
$localstackSecret = Read-Host "Paste your LocalStack auth token" -AsSecureString
$env:LOCALSTACK_AUTH_TOKEN = [System.Net.NetworkCredential]::new("", $localstackSecret).Password
Remove-Variable localstackSecret
docker compose config --quiet
```

The token lasts for this terminal session and is passed to the container. Repeat the token entry in a new terminal. Treat the container environment as sensitive: secure input prevents terminal echo, but does not encrypt the environment variable. Never commit the token, paste it in Teams, or include it in screenshots. Do not share full `docker compose config` or unrestricted container inspection output, which can expose it. Compose may require this variable even for commands targeting other services because it parses the whole configuration.

## Start or update only LocalStack

On the machine that already has the tested image, first confirm the pinned reference is available locally:

```powershell
docker image inspect localstack/localstack@sha256:2a81e5da4c32bb53e8d86e92050a12937f9be1915c5a4afad0931f75c112fc7e --format '{{.Id}}'
```

If the pinned reference is missing locally, including on a teammate's first setup, download that exact image:

```powershell
docker compose pull localstack
```

Then recreate only the LocalStack service:

```powershell
docker compose up -d --no-deps --force-recreate --pull never localstack
docker compose ps -a localstack
docker compose logs --since 5m --tail 100 localstack
docker inspect gost-localstack_main --format '{{.Config.Image}}'
```

Expect the container to remain running, without the license-activation failure, and the final command to show the pinned digest above. Allow initialization to finish before checking resources. Recreation interrupts LocalStack and may discard emulated resources depending on persistence support; do not rely on it to preserve test data. The initialization script recreates baseline resources. Do not run `docker compose down -v`, remove database containers, or reseed the database for this fix.

## Verify initialized AWS resources

```powershell
docker compose exec localstack awslocal s3api list-buckets --region us-west-2
docker compose exec localstack awslocal sqs list-queues --region us-west-2
docker compose exec localstack awslocal ses list-identities --region us-west-2
```

Expected results from `localstack/entrypoint/init-aws.sh`:

- S3: bucket `arpa-audit-reports` exists.
- SQS: queue URLs include `grants-ingest-events`, `arpa-queue`, and `full-file-export-queue`.
- SES: identity `grants-identification@usdigitalresponse.org` exists.

These checks verify initialization and service access, not application upload, queue processing, or email delivery. Record a failure rather than treating a running container alone as a pass.

## Application regression check

If needed, start the other existing services without recreating them:

```powershell
docker compose up -d --no-recreate postgres mailpit app frontend
```

1. Open GOST at `http://localhost:8080`.
2. For the existing seeded development database, request login for `admin@example.com`.
3. Open Mailpit at `http://localhost:8025` and use the access link in the login email.
4. Search for a seeded grant. If results are empty, include Closed/Archived opportunity statuses and remove restrictive date filters. Older seed records may be excluded by the default status filter; this does not by itself indicate a database failure.
5. Open a grant and verify its details load.

Do not reseed an existing database merely to make search results appear. Login and grant search exercise the application/database path; they do not prove S3/SQS integration works.

## Evidence and review

On September 5, 2026, Connor reported that all requested post-pin checks passed on branch `fix/localstack-auth` (working-tree changes based on `fe895cf3`):

- Compose configuration validation.
- LocalStack-only recreation and startup without the license-activation error.
- Running container image reference matched the pinned digest above.
- Expected S3 bucket, all three SQS queues, and SES identity were listed.
- Application grant search and opening grant details worked. Login had also been verified earlier.

These are operator-reported results; automated Docker verification was not run by the editing assistant. The opportunity-status filter explained the initially empty search results. Independent teammate reproduction remains pending. Object upload/download, message send/receive, and application ingestion were not covered by these checks.

For each verification run, record the date, branch/commit, pinned digest, container status, the three resource-check outcomes, and login/search/detail outcomes. Keep evidence free of tokens. A teammate should repeat the checks with their own token before the team treats the fix as reproduced.

Review only the intended Compose/documentation changes before committing. Keep Planner updates until after the fix and its evidence are prepared.
