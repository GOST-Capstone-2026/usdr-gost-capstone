# G32 October 13 Demo Rehearsal

Prepared October 11, 2026. Owner: Connor Delk.

## Current state

The original project folder is on local branch `c07-first-demo-rehearsal`. It combines the October 11 heads of PRs 13, 14, 16, 17, and 18. Shared router, navigation, and feature-flag conflicts were resolved while preserving the profile, PDF demo, and deadline dashboard. Local merge commit `1878a00f` contains the combined PR work. A follow-up adds route-integration tests and an explicit grant-ID input with five regression tests: seeded grant 335255 is an NSF fellowship, not the HUD notice. Record the follow-up commit with the demo evidence.

No PR has been merged on GitHub. The branch has no upstream and must not be pushed to develop. Required reviews and the shared develop freeze remain outstanding. The local rehearsal can support demo preparation, but is not evidence of an approved shared release.

Local verification on October 11: 48 server component tests passed using workspace dependencies. The original merged frontend matched the tested workspace candidate. After the grant-ID fix, seven targeted frontend test files passed together with 80 tests, including five document-identity tests. Targeted frontend lint and the Vite production compilation passed; the compilation reported existing dependency-annotation and large-bundle warnings. Seven synthetic screening controls and three page-mapped chunks also passed. The agent's local checks used Node 24.19.0. Connor then reported that the same three automated commands all passed in Docker, whose runtime is Node 20.11.1.

## Confirmed local rehearsal results — October 11

The screenshots showed 80 development migrations completed and initially zero users, tenants, agencies, and grants. The configured app database was verified as postgres/usdr_grants. Connor initialized development seed data only after this empty-database check and then confirmed successful login as admin@example.com. Do not repeat seeding on a populated database: it replaces grants and related sample records.

The initial blank page was traced to the backend crashing with MODULE_NOT_FOUND for pdf-parse; the frontend proxy consequently reported ECONNREFUSED. The dependency was already pinned as 1.1.1 in packages/server/package.json and yarn.lock. After installing locked dependencies in Docker and restarting app/frontend, Connor confirmed the application loaded.

Connor confirmed these live checks passed, with local browser flags enabled and the seeded USDR team selected:

- Organization profile saved; values persisted after refresh; an edit persisted after refresh; a blank jurisdiction name was rejected without replacing the saved value.
- Deadline dashboard loaded seeded entries, separated unverified/undated entries into Review Needed, showed and hid closed items, and retained its results after refresh.
- Document upload and analysis passed using packages/server/__tests__/fixtures/an08-sample.pdf, associated explicitly with the fictional Test Grant 666999 for a controlled test. The existing API test expects two readable pages and a positive chunk count; retain the actual browser result and document/run IDs as evidence rather than assuming these values from the test expectation.

These live results were reported by Connor; the agent could not independently access Docker or localhost. The HUD PDF was unavailable and the local housing/0098 lookup returned zero rows. The actual HUD notice workflow remains unverified. The dashboard entries are seeded examples and are not generated from the PDF. Shared reviews, develop merges, and an approved release freeze remain outstanding.

## Start the full local stack

Open Docker Desktop and wait for Engine running. In PowerShell:

```powershell
cd C:\Users\Bonnor\Documents\GitHub\usdr-gost-capstone
git status --short --branch
docker info
$demoTokenEntry = Read-Host 'Enter your real LocalStack token' -AsSecureString
$env:LOCALSTACK_AUTH_TOKEN = [System.Net.NetworkCredential]::new('', $demoTokenEntry).Password
Remove-Variable demoTokenEntry
docker compose up -d
docker compose ps
```

Do not use the component-test placeholder token for this full startup. Do not display or screenshot tokens, environment files, cookies, or Compose's expanded configuration.

The server's ignored local .env now enables ENABLE_GRANT_COMPLIANCE and ENABLE_ORGANIZATION_PROFILES. NODE_ENV remains development and credentials were not changed.

Expected services: gost-app and gost-frontend running, gost-postgres healthy, gost-localstack_main running, and Mailpit available. Do not reseed data or remove volumes. If a service fails, inspect only that service's recent logs before proceeding.

Confirm the database is the local development database using a read-only check:

```powershell
docker exec -it gost-postgres psql -U postgres -d usdr_grants -W -c 'SELECT current_database();'
```

Enter the project's local development PostgreSQL password at the prompt; do not include it in screenshots. Once confirmed, apply pending migrations without reseeding:

```powershell
docker exec gost-app sh -lc 'cd /app && yarn db:migrate'
```

If the running app cannot start until migrations are applied, run this command anyway while the app container is running; stop and share errors if it has exited. Do not switch to an unrelated database to bypass an error.

If app logs show the same missing pdf-parse dependency, synchronize the existing Docker dependency volume with the checked-in lockfile, then restart app and frontend:

```powershell
docker exec gost-app sh -lc 'cd /app && HUSKY_SKIP_INSTALL=1 yarn install --frozen-lockfile'
docker restart gost-app gost-frontend
```

Restart only after installation succeeds. This does not recreate PostgreSQL, delete data, or change the lockfile. Check recent app logs and /api/health before continuing.

## Automated evidence

```powershell
docker exec gost-app sh -lc 'cd /app/packages/server && yarn mocha __tests__/lib/eligibilityBlockers.test.js __tests__/lib/grantsEligibilityAdapter.test.js __tests__/lib/documentChunking.test.js __tests__/lib/eligibilityProfileIntegration.test.js'
docker exec gost-frontend sh -lc 'cd /app/packages/client && yarn test --run src/helpers/complianceProfileForm.spec.js src/helpers/featureFlags/index.spec.js src/views/OrganizationProfileView.spec.js src/components/BaseLayout.spec.js src/views/ComplianceDeadlinesView.spec.js src/router/complianceIntegration.spec.js src/views/GrantDocumentDemoView.spec.js'
docker exec gost-app sh -lc 'cd /app && node packages/server/src/scripts/rehearseFirstDemo.js'
```

Expected: 48 server tests, 80 frontend tests, seven screening cases, and three source-mapped chunks passing. Capture the actual output. These commands do not load destructive database fixtures.

API fixture tests must use a separate test database: their setup deletes and reseeds test data. Do not run them against usdr_grants for this rehearsal.

## Live browser rehearsal

1. Open http://localhost:8080 and log in using the existing seeded admin account, admin@example.com. Retrieve its login email through Mailpit at http://localhost:8025. Confirm a seeded demo team is selected; do not alter a real organization's information.
2. On localhost, open browser developer tools, select Console, and enable only the needed browser flags:

```javascript
sessionStorage.setItem('featureFlags', JSON.stringify({
  ...JSON.parse(sessionStorage.getItem('featureFlags') || '{}'),
  grantComplianceEnabled: true,
  organizationProfilesEnabled: true,
  grantDocumentAnalysisEnabled: true,
  complianceChecklistsEnabled: true,
  complianceDeadlinesEnabled: true,
}));
location.reload();
```

These are local browser overrides. Production defaults remain off. Do not enter unrelated scripts or expose login cookies in screenshots.

3. Visit /compliance/profile. On the designated demo team, create a profile if absent, or record its existing values before a test edit. Save, refresh, confirm persistence, edit one field, save, and refresh again. Test invalid input without saving it. Capture the populated form and success message. Restore existing values after testing if appropriate.
4. Visit /grant-document-demo. This temporary demo page is not linked from navigation; enter the path in the browser's address bar. For a real notice, enter the actual local opportunity ID matching the approved PDF. The old hardcoded 335255 is an NSF fellowship in the seed data and must not be described as the HUD opportunity. Confirm the correct record exists locally before uploading; do not invent an ID or silently attach an unrelated PDF. For a clearly labeled controlled test only, use the included an08-sample.pdf fixture with fictional Test Grant 666999, as done on October 11. Start Analysis and wait for completed status; record document ID, run ID, page count, extraction quality, and chunk count. A duplicate-upload response may mean the file is already stored: do not delete it or change its bytes to bypass the check. Reuse the existing document through the authorized API, or ask Anthony to guide the repeatable demo flow. The page does not reload an existing document after a browser refresh, so a repeatable presentation flow still needs preparation. If the HUD opportunity is not present, coordinate its legitimate ingestion with Anthony or Allison before claiming a correctly linked HUD demo.
5. Visit /compliance/deadlines. Confirm the portfolio loads, verified dated items appear in the portfolio, and unverified or undated items appear in the review-needed area. Explain that the data are seeded examples, not automatically generated verified requirements. Dates and status groups may differ from old screenshots because the seed dates were relative to when seeding occurred.
6. Demonstrate C-06's terminal screening controls separately. It is a server service, not a browser match-ranking page. The PDF extraction and dashboard are separate demonstrated subsystems, not a fully connected AI-generated checklist workflow.

## Finish and evidence

Capture stack status, test summaries, profile persistence, completed PDF analysis, dashboard, exact Git commit, and known limitations. Keep secrets out of the captures.

The controlled live checks have been reported as passed. Next, retain screenshots and actual document/run IDs, review and commit the explicit grant-ID fix, its regression tests, route-integration tests, and this runbook. Record the resulting commit and avoid changing the candidate immediately before the demonstration. Do not claim the shared release is frozen while approvals and develop merges remain pending. Obtain the real HUD PDF and matching record/import procedure from Anthony and Allison, and prepare a repeatable existing-document presentation flow before October 13.

Slide-ready claims already supported: organization-profile interface, deterministic eligibility controls, source-page preservation/chunking, and a seeded portfolio dashboard. Describe AI ranking, generated checklists, real-data dashboard linkage, and Owl Cloud deployment as pending unless separately verified.
