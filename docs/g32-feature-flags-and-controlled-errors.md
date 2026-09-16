# G32 Feature Flags and Controlled-Error Conventions

**Task:** C-03 Define feature flags and controlled-error conventions  
**Owner:** Connor Delk  
**Version:** 1.0 draft for team review  
**Date:** September 13, 2026  
**Applies to:** New Grant Compliance Assistant features added to GOST

## Purpose

This document defines how Group 32 will release unfinished Grant Compliance Assistant capabilities safely and how new compliance routes will return predictable, user-safe errors. It supplements the repository's general [feature-flag guidance](feature-flags.md) and the [G32 shared API contracts](g32-shared-api-contracts.md). If either document changes, this convention must be reviewed for consistency.

These rules apply only to new Grant Compliance Assistant work. They do not require a refactor of unrelated legacy GOST routes.

## Core Rules

1. New compliance capabilities remain inactive until their owner demonstrates the acceptance path and the team approves enabling them in the target environment.
2. A missing, malformed, or non-boolean client flag is treated as `false`. A missing or non-string server flag is also treated as `false`.
3. Client flags control visibility and navigation only. Server authorization, tenant isolation, validation, and ownership checks always run independently.
4. Routes, services, workers, and adapters return errors using the C-02 standard error shape.
5. Only safe, actionable messages leave the server. Diagnostic context stays in restricted server logs and is correlated by `requestId`.
6. Feature flags are temporary release controls. The flag and its inactive code path are removed after a feature is accepted and stable, or after the feature is abandoned.

## Feature-Flag Registry

The client uses affirmative `camelCase` names. The server uses matching affirmative `ENABLE_*` environment variables. Every capability flag also depends on the master Grant Compliance Assistant flag.

| Capability | Client flag | Server flag | Additional dependency | Initial state |
| --- | --- | --- | --- | --- |
| Grant Compliance Assistant entry point and routes | `grantComplianceEnabled` | `ENABLE_GRANT_COMPLIANCE` | None | Off |
| Organization profile | `organizationProfilesEnabled` | `ENABLE_ORGANIZATION_PROFILES` | Master flag | Off |
| Grant matching and prioritization | `grantMatchingEnabled` | `ENABLE_GRANT_MATCHING` | Organization profile | Off |
| Notice upload, extraction, brief, and source mapping | `grantDocumentAnalysisEnabled` | `ENABLE_GRANT_DOCUMENT_ANALYSIS` | Master flag | Off |
| Editable compliance checklist | `complianceChecklistsEnabled` | `ENABLE_COMPLIANCE_CHECKLISTS` | Document analysis | Off |
| Deadline dashboard and calendar | `complianceDeadlinesEnabled` | `ENABLE_COMPLIANCE_DEADLINES` | Checklist | Off |
| Reporting assistant stretch feature | `reportingAssistantEnabled` | `ENABLE_REPORTING_ASSISTANT` | Checklist and team approval | Off |

### Dependency behavior

- A capability is active only when its own flag, the master flag, and every listed dependency are active.
- A client helper returns `false` when any dependency is inactive. The interface must not show a link that leads only to a disabled route.
- The server checks its own flags even when the client already hid the feature.
- Enabling a dependent flag without its prerequisite is a configuration error. The effective value remains off and the server records one sanitized warning during startup.
- The stretch reporting assistant remains off unless the core end-to-end workflow is accepted and the team explicitly schedules the feature.

## Configuration and Evaluation

### Client

1. Add local values to `packages/client/public/deploy-config.js` under `window.APP_CONFIG.featureFlags`.
2. Add one getter per flag to `packages/client/src/helpers/featureFlags/index.js`.
3. Evaluate flags with strict comparison to the boolean value `true`.
4. Application code imports the getter; it does not read or change `window.APP_CONFIG.featureFlags` directly.
5. Add helper tests for true, false, missing, null, string, and dependency-disabled cases.
6. Session overrides are for developer testing only and do not replace committed environment configuration.

Example evaluation:

```js
export function grantComplianceEnabled() {
  return getFeatureFlags().grantComplianceEnabled === true;
}
```

### Server

1. Read server flags through one shared compliance configuration module when implementation begins. Do not scatter direct environment-variable checks across routes.
2. Evaluate a server flag with strict comparison to the string `'true'`.
3. Routes call a shared capability guard before starting work or calling an external service.
4. Workers recheck the applicable server capability before claiming a queued run so disabling a feature also prevents new background work.
5. A flag name, effective value, and environment may be logged at startup. Tokens, credentials, document text, prompts, and provider responses must never be logged with the flag snapshot.

Example evaluation:

```js
const grantComplianceEnabled = process.env.ENABLE_GRANT_COMPLIANCE === 'true';
```

### Environment rollout

| Environment | Rule |
| --- | --- |
| Local development | Keep all committed flags off by default. A developer enables only the capability currently being tested and its prerequisites. |
| Owl Cloud or other shared test environment | Enable a capability only after its owner demonstrates its primary path, inactive path, authorization checks, and controlled-error path. |
| Final demonstration environment | Enable only the accepted end-to-end capabilities needed for the demonstration. Keep stretch or unstable capabilities off. |
| Production, if used | Deploy the code with flags off first. Enable a capability only after team approval and a rollback check. |

Owl Cloud deployment details are not yet known. When they are confirmed, configuration must be stored in the approved deployment mechanism rather than committed secrets. Existing Terraform environments continue to use `website_feature_flags` for client flags.

## Disabled-Feature Behavior

When the client flag is off:

- Hide the navigation entry and action controls.
- Preserve existing GOST behavior and data.
- Do not delete cached or stored compliance data merely because the flag is off.

When a client calls a compliance route but the server capability is off, return HTTP `404` with:

```json
{
  "error": {
    "code": "FEATURE_DISABLED",
    "message": "This feature is not currently available.",
    "retryable": false,
    "requestId": "req-7ec92f",
    "details": []
  }
}
```

Using `404` prevents an inactive or unfinished capability from being advertised as available. A required dependency that is enabled but temporarily unhealthy instead returns `503 DEPENDENCY_UNAVAILABLE` and may be retryable.

Turning a flag off must stop new work without corrupting existing work:

- Do not accept new processing runs.
- A queued run stays recorded and is not claimed while the flag is off.
- An already processing run may finish only if cancellation could leave partial data; otherwise the worker stops at the next safe boundary.
- Previously completed results remain readable only through capabilities the team intentionally leaves enabled.

## Standard Controlled-Error Shape

All new compliance endpoints use the C-02 shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request contains invalid fields.",
    "retryable": false,
    "requestId": "req-7ec92f",
    "details": [
      {
        "field": "population",
        "issue": "must be a nonnegative integer"
      }
    ]
  }
}
```

Required fields:

- `code`: stable uppercase identifier used by the client and tests.
- `message`: plain-language text safe to display to an authorized user.
- `retryable`: whether retrying the same operation later may succeed without changing its input.
- `requestId`: non-secret correlation identifier generated or accepted by the server.
- `details`: sanitized structured details; use an empty array when no safe details apply.

## Error Catalog

| HTTP | Code | Retryable | Use |
| --- | --- | --- | --- |
| `400` | `VALIDATION_ERROR` | No | Malformed fields, query parameters, or unknown request fields |
| `403` | `FORBIDDEN` | No | Missing GOST session or inaccessible organization route under current GOST behavior |
| `404` | `NOT_FOUND` | No | Authorized organization cannot access the requested record, including tenant-safe not-found responses |
| `404` | `FEATURE_DISABLED` | No | Compliance capability is inactive on the server |
| `409` | `VERSION_CONFLICT` | No | Optimistic version does not match the stored version |
| `409` | `DUPLICATE_OPERATION` | No | Equivalent active work already exists; return a safe reference when authorized |
| `413` | `FILE_TOO_LARGE` | No | Upload exceeds the configured byte or page limit |
| `415` | `UNSUPPORTED_FILE_TYPE` | No | Upload is not an accepted PDF type or signature |
| `422` | `UNPROCESSABLE_DOCUMENT` | No | Valid PDF cannot be reliably extracted or validated without different input |
| `429` | `RATE_LIMITED` | Yes | Local or provider rate limit; include a safe retry delay when known |
| `500` | `INTERNAL_ERROR` | No | Unexpected server failure after sensitive details are removed |
| `502` | `AI_RESPONSE_INVALID` | Yes | Provider response fails the expected structured-output schema |
| `502` | `EXTERNAL_RESPONSE_INVALID` | Yes | Non-AI external service returns an unusable response |
| `503` | `DEPENDENCY_UNAVAILABLE` | Yes | Database, queue, storage, or another required internal dependency is temporarily unavailable |
| `503` | `EXTERNAL_SERVICE_UNAVAILABLE` | Yes | Grants.gov or AI provider cannot currently be reached or used |

`retryable: true` permits a controlled retry; it does not command the browser to retry automatically. Validation, authorization, file, and version errors require a user or data change and therefore are not retryable.

## Server Handling Convention

The implementation should use one typed controlled-error class and one final Express error middleware for new compliance routes.

1. Validate authentication, organization access, feature availability, and request shape before starting side effects.
2. Domain services and adapters throw a controlled error with `status`, `code`, safe `message`, `retryable`, and sanitized `details`.
3. Routes pass errors to the final error middleware; they do not create one-off error response shapes.
4. The middleware assigns or preserves `requestId`, writes restricted diagnostic information to server logs, and sends only the standard safe shape.
5. Unknown errors become `500 INTERNAL_ERROR` with the message `The request could not be completed.` The stack trace remains server-side.
6. Provider errors are translated at the adapter boundary. Provider bodies, prompts, model output, credentials, storage keys, SQL text, and stack traces never enter the client response.
7. A failed asynchronous attempt is recorded as `failed` and does not overwrite the last valid completed result.
8. Retrying asynchronous work creates a new run with `parentRunId` and an incremented `attempt`, as defined by C-02.

Expected restricted log fields are `requestId`, route, method, authenticated user ID, tenant ID, organization ID, controlled code, HTTP status, retryable value, subsystem, run ID when present, and the original error stack. Do not log full uploaded documents or confidential organization-profile content by default.

## Client Handling Convention

- Display the safe server `message`; do not expose a raw exception or stringify the full response.
- Show validation `details` beside the matching field when possible.
- For `FEATURE_DISABLED`, remove or disable the stale action and advise the user to refresh if the client and server configurations disagree.
- For `VERSION_CONFLICT`, reload the current record and ask the user to review before resubmitting.
- For `RATE_LIMITED` or a retryable `502`/`503`, show one clear retry action. Background polling may use capped exponential backoff and must stop at a defined limit.
- `reviewRequired` is a successful processing state requiring human action, not an error.
- A failed run remains visible with its request ID and safe recovery guidance.
- Never infer authorization, verification, ownership, or successful completion from a client flag or HTTP response alone.

## Verification Scenarios

Each new capability must pass these checks before its flag is enabled in a shared environment:

1. With the master flag off, navigation is hidden and the server returns `404 FEATURE_DISABLED`.
2. With the capability flag off, the same inactive behavior occurs even if the master flag is on.
3. With a dependency off, the dependent feature remains inactive and records a sanitized configuration warning.
4. Missing, null, string, numeric, and malformed flag values all resolve to inactive.
5. An authenticated user can complete the capability's approved happy path only within their organization.
6. An inaccessible organization returns the tenant-safe `403` or `404` behavior defined by C-02.
7. Invalid input returns the standard error shape and no side effect is created.
8. A simulated dependency or provider failure returns the expected controlled code, retryability, and request ID.
9. An unexpected exception returns `500 INTERNAL_ERROR`; the response contains no stack trace, secret, prompt, provider body, or document content.
10. Turning the flag off prevents new work and preserves already stored valid results.

## Ownership and Change Control

| Area | Primary owner | Required reviewer or consumer |
| --- | --- | --- |
| Flag registry and shared error middleware | Connor | All subsystem owners |
| Organization profile and matching errors | Connor | Allison for data and adapter boundaries |
| Document analysis and checklist errors | Anthony | Allison for storage and AI adapter boundaries |
| Deadline and portfolio errors | Manuel | Anthony for checklist handoff |
| Grants.gov, storage, queue, and AI adapter translation | Allison | Calling subsystem owner |
| Client flag configuration and error presentation | Implementing feature owner | At least one teammate |

Any pull request that adds a flag or controlled error must update this registry or explicitly state that it uses an existing entry. A pull request that enables a flag in a shared environment includes evidence for the applicable verification scenarios and a rollback instruction.

## Acceptance Checklist

C-03 is ready for team acceptance when:

- [x] G32 client and server flag names, dependencies, and inactive defaults are documented.
- [x] Local, shared-test, demonstration, and production rollout rules are documented.
- [x] Client and server evaluation locations and strict comparison rules are documented.
- [x] Disabled-feature behavior and preservation of existing data are documented.
- [x] The shared controlled-error shape and stable error catalog are documented.
- [x] Server logging, redaction, request-correlation, retry, and prior-result preservation rules are documented.
- [x] Client display and recovery behavior is documented.
- [x] Verification scenarios and ownership are documented.
- [ ] Each subsystem owner confirms the conventions in the pull request before dependent implementation is merged.

## Decisions Recorded

1. G32 uses one master flag plus capability flags with explicit dependencies.
2. All flags are affirmative, strict, and inactive by default.
3. Client and server flags are paired, but server checks remain authoritative.
4. A server-disabled compliance capability returns `404 FEATURE_DISABLED`.
5. An enabled but unhealthy dependency returns a retryable `503` error.
6. New compliance routes use one controlled-error shape and a centralized final error handler.
7. Unexpected failures are converted to a safe, non-retryable `500 INTERNAL_ERROR` response.
8. Retryability is explicit and never causes unlimited automatic client retries.
9. Failed work never replaces a prior valid completed result.
10. Owl Cloud configuration will be added only after the deployment mechanism is confirmed; no secret or environment-specific credential is committed.
