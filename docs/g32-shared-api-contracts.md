# G32 Shared API and Processing State Contracts

**Task:** C-02 Define shared request response and processing state contracts  
**Owner:** Connor Delk  
**Version:** 1.0 draft for team review  
**Date:** September 9, 2026  
**Applies to:** New Grant Compliance Assistant features added to GOST

## Purpose

This document defines the shared interfaces used by the organization profile, grant matcher, document analysis, compliance checklist, and deadline tracker. It provides one baseline that each subsystem can implement independently without bypassing GOST authentication, duplicating records, or inventing incompatible field names.

The contract follows the submitted proposal and the existing GOST design:

- The Vue client calls only the Express API.
- External Grants.gov and AI services are called only by server-side adapters.
- Every new route is scoped to an organization and protected by the existing session middleware.
- PostgreSQL remains the system of record.
- Longer operations use durable processing records.
- AI claims retain source evidence and remain visibly unverified until a person reviews them.
- Verified checklist dates feed the portfolio; the portfolio does not maintain a duplicate deadline record.

## Contract Rules

### Route and authorization rules

1. All new routes begin with `/api/organizations/:organizationId/compliance`.
2. Every route uses the existing `requireUser` middleware or a stricter authorization function.
3. The server loads the current user and tenant from the signed session cookie.
4. The server verifies that `organizationId` belongs to the authenticated tenant. It never trusts an organization or tenant identifier supplied only in the request body.
5. A record outside the authorized tenant returns `404 NOT_FOUND` when revealing its existence would leak information. A user who cannot access the organization route returns `403 FORBIDDEN`, consistent with the current GOST middleware.
6. Frontend visibility and feature flags improve usability but are not security controls.

### Naming and data rules

- New JSON fields use `camelCase`. Repository functions map them to the existing `snake_case` PostgreSQL columns.
- Resource identifiers are positive integers unless a later migration explicitly chooses UUIDs.
- Calendar dates use `YYYY-MM-DD` and have no implied time zone.
- Timestamps use ISO 8601 UTC, for example `2026-09-09T18:30:00.000Z`.
- Currency amounts are integer cents in API requests and storage. Responses may also include a formatted display value.
- Page numbers are one-based so they match the visible PDF.
- `null` means a known empty value. An omitted field means it was not requested or is not available in that response.
- The server assigns IDs, ownership, audit timestamps, and `createdBy` or `updatedBy` values. The client cannot set them.
- Unknown request fields are rejected with `VALIDATION_ERROR` instead of being silently stored.

### Standard success shapes

A single resource is returned directly under its resource name:

```json
{
  "profile": {
    "id": 12,
    "organizationId": 4,
    "version": 3
  }
}
```

A collection follows GOST's existing data and pagination structure:

```json
{
  "data": [],
  "pagination": {
    "currentPage": 1,
    "perPage": 25,
    "total": 0,
    "lastPage": 0
  }
}
```

A newly accepted asynchronous operation returns HTTP `202`:

```json
{
  "run": {
    "id": 81,
    "kind": "documentAnalysis",
    "status": "queued",
    "progressPercent": 0,
    "reviewRequired": false,
    "attempt": 1,
    "parentRunId": null,
    "createdAt": "2026-09-09T18:30:00.000Z",
    "startedAt": null,
    "completedAt": null,
    "error": null
  },
  "links": {
    "self": "/api/organizations/4/compliance/analysis-runs/81",
    "result": "/api/organizations/4/compliance/documents/27/brief"
  }
}
```

### Standard error shape

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

Rules for errors:

- `message` is safe to display to a user.
- `details` contains field-level validation information when useful.
- Provider responses, prompts, stack traces, access tokens, storage keys, and secrets never appear in an API error.
- `retryable` indicates whether repeating the same operation may succeed without changing input.
- Server logs use `requestId` to connect the safe client error to restricted diagnostic information.

| HTTP status | Contract use |
| --- | --- |
| `200` | Successful read or update |
| `201` | Resource created synchronously |
| `202` | Background operation accepted |
| `400` | Malformed request or query |
| `403` | Missing session or inaccessible organization route under existing GOST behavior |
| `404` | Resource unavailable within the authorized organization |
| `409` | Version conflict or duplicate active operation |
| `413` | Uploaded file exceeds the configured limit |
| `415` | Unsupported file type |
| `422` | Well-formed input cannot be processed or fails schema validation |
| `429` | Rate limit reached |
| `500` | Unexpected internal failure |
| `502` | External provider returned an unusable response |
| `503` | Required external service is unavailable |

## Processing State Contract

Processing status describes a background operation. It does not describe whether a person verified the result or completed a checklist obligation.

| State | Meaning | Allowed next states |
| --- | --- | --- |
| `queued` | Request is stored and waiting for a worker | `processing`, `failed` |
| `processing` | A worker has claimed the run | `reviewRequired`, `completed`, `failed` |
| `reviewRequired` | A result exists but quality, missing evidence, or policy requires human action | `completed`, `failed` |
| `completed` | The operation finished and its stored result passed machine validation | Final; reprocessing creates a new run |
| `failed` | The attempt ended with a controlled error and did not replace a valid prior result | Final; retry creates a new run |

Required run fields:

```json
{
  "id": 81,
  "organizationId": 4,
  "kind": "documentAnalysis",
  "subjectType": "grantDocument",
  "subjectId": 27,
  "status": "processing",
  "progressPercent": 45,
  "reviewRequired": false,
  "attempt": 1,
  "parentRunId": null,
  "methodVersion": "document-analysis-v1",
  "model": "provider-model-name-or-null",
  "promptVersion": "grant-notice-v1",
  "createdBy": 7,
  "createdAt": "2026-09-09T18:30:00.000Z",
  "startedAt": "2026-09-09T18:30:04.000Z",
  "completedAt": null,
  "error": null
}
```

Failure example:

```json
{
  "status": "failed",
  "progressPercent": 60,
  "completedAt": "2026-09-09T18:31:12.000Z",
  "error": {
    "code": "AI_RESPONSE_INVALID",
    "message": "The analysis response did not match the required schema.",
    "retryable": true
  }
}
```

Processing rules:

- A worker updates `queued` to `processing` in one database transaction when claiming work.
- Retrying creates a new run with a new ID, increments `attempt`, and sets `parentRunId`.
- A failed run does not delete or overwrite the last completed result.
- `progressPercent` is optional when no reliable percentage is available; status text must not fabricate precision.
- A worker may write final domain records and mark the run complete in one transaction.
- Duplicate POST requests use an `Idempotency-Key` header. Reusing a key for the same authenticated user, route, organization, and body returns the original accepted run.

## Human Verification and Completion States

Verification status applies to AI-derived facts, checklist items, and dates:

| Value | Meaning |
| --- | --- |
| `unverified` | No authorized person has confirmed the value |
| `verified` | An authorized person confirmed the value against its cited source |
| `rejected` | An authorized person determined that the value is incorrect or unsupported |

Checklist completion status is separate:

| Value | Meaning |
| --- | --- |
| `notStarted` | Work on the obligation has not begun |
| `inProgress` | Work has begun but is incomplete |
| `completed` | The organization completed the obligation |
| `notApplicable` | A person determined that the obligation does not apply |

`isUserEdited` records whether a person changed AI-generated content. It does not imply verification. The server sets `verifiedBy` and `verifiedAt` from the authenticated session when status becomes `verified` or `rejected`.

Only an item with `verificationStatus: "verified"` and a non-null `dueDate` appears in the published deadline feed.

## Source Traceability Contract

Every AI-generated factual claim that is marked as found contains at least one source reference:

```json
{
  "documentId": 27,
  "pageNumber": 14,
  "excerpt": "Quarterly performance reports are due within 30 days...",
  "startOffset": 812,
  "endOffset": 876
}
```

- `pageNumber` and `excerpt` are required when `found` is true.
- Character offsets are optional and apply to the stored text for that page.
- Excerpts are exact text from the stored extraction, not model-generated paraphrases.
- If a category is not located, `found` is false, `sources` is empty, and the interface says Not found rather than inventing content.
- `possiblyAffectedByQualityIssue` is true when poor extraction may explain a missing or uncertain item.

## Organization Profile Contract

### Endpoints

| Method | Route | Result |
| --- | --- | --- |
| `GET` | `/api/organizations/:organizationId/compliance/profile` | Return the organization's current profile |
| `PUT` | `/api/organizations/:organizationId/compliance/profile` | Create or replace the profile using optimistic version control |

### Update request

```json
{
  "expectedVersion": 2,
  "jurisdiction": {
    "type": "city",
    "name": "Example City",
    "stateCode": "FL",
    "countyName": "Example County"
  },
  "population": 42000,
  "focusAreas": ["stormwater", "public safety"],
  "staffingCapacity": {
    "level": "limited",
    "fullTimeEquivalent": 1.5,
    "notes": "One grants manager with part-time finance support"
  },
  "matchingFunds": {
    "available": true,
    "maximumAmountCents": 25000000,
    "notes": "Subject to commission approval"
  }
}
```

Allowed jurisdiction types are `city`, `county`, `town`, `village`, `tribalGovernment`, `specialDistrict`, and `other`. Allowed staffing levels are `limited`, `moderate`, and `substantial`. If `expectedVersion` does not match the stored version, the server returns `409 VERSION_CONFLICT`.

### Profile response

```json
{
  "profile": {
    "id": 12,
    "organizationId": 4,
    "version": 3,
    "jurisdiction": {
      "type": "city",
      "name": "Example City",
      "stateCode": "FL",
      "countyName": "Example County"
    },
    "population": 42000,
    "focusAreas": ["stormwater", "public safety"],
    "staffingCapacity": {
      "level": "limited",
      "fullTimeEquivalent": 1.5,
      "notes": "One grants manager with part-time finance support"
    },
    "matchingFunds": {
      "available": true,
      "maximumAmountCents": 25000000,
      "notes": "Subject to commission approval"
    },
    "createdBy": 7,
    "updatedBy": 7,
    "createdAt": "2026-09-08T20:00:00.000Z",
    "updatedAt": "2026-09-09T18:00:00.000Z"
  }
}
```

## Grant Matching Contract

### Endpoints

| Method | Route | Result |
| --- | --- | --- |
| `POST` | `/api/organizations/:organizationId/compliance/match-runs` | Start deterministic screening and semantic ranking |
| `GET` | `/api/organizations/:organizationId/compliance/match-runs/:runId` | Return status and results when available |

### Match request

```json
{
  "profileId": 12,
  "profileVersion": 3,
  "candidateGrantIds": [335255, 335260],
  "limit": 25
}
```

`candidateGrantIds` is optional. When absent, the server obtains normalized current opportunities from the approved data repository. A stale profile version returns `409 VERSION_CONFLICT` so results remain reproducible.

### Match result

```json
{
  "grantId": 335255,
  "disposition": "eligible",
  "rank": 1,
  "score": 0.87,
  "scoreFactors": [
    {
      "code": "FOCUS_AREA_MATCH",
      "label": "Focus area alignment",
      "value": 0.92,
      "weight": 0.45,
      "explanation": "The opportunity supports stormwater infrastructure."
    }
  ],
  "blockers": [],
  "uncertainties": ["Local match approval has not been confirmed."],
  "explanation": "Strong program alignment with a manageable unresolved match-fund question.",
  "methodVersion": "matcher-v1",
  "model": "provider-model-name-or-null",
  "generatedAt": "2026-09-09T18:32:00.000Z"
}
```

Allowed dispositions are `eligible`, `blocked`, and `reviewRequired`. Scores range from `0` to `1`. A deterministic hard blocker sets `disposition` to `blocked`, remains visible in results, and cannot be overridden by a high semantic score. A blocked result has `rank: null`; `score` may be retained only for evaluation and cannot be presented as eligibility.

Blocker shape:

```json
{
  "code": "APPLICANT_TYPE_UNSUPPORTED",
  "severity": "hard",
  "message": "The notice does not list city governments as eligible applicants.",
  "profileField": "jurisdiction.type",
  "grantField": "eligibilityCodes"
}
```

## Grant Document Contract

### Endpoints

| Method | Route | Result |
| --- | --- | --- |
| `POST` | `/api/organizations/:organizationId/compliance/documents` | Upload one PDF and link it to a grant |
| `GET` | `/api/organizations/:organizationId/compliance/documents/:documentId` | Return document metadata and latest processing state |
| `POST` | `/api/organizations/:organizationId/compliance/documents/:documentId/analysis-runs` | Start extraction, brief, and checklist processing |
| `GET` | `/api/organizations/:organizationId/compliance/analysis-runs/:runId` | Poll processing state |

The upload request is `multipart/form-data` with:

- `file`: one required PDF.
- `grantId`: required existing grant identifier.
- `sourceUrl`: optional Grants.gov source URL.

The server verifies the MIME type and PDF signature, enforces the configured size and page limits, calculates SHA-256, and stores an organization-scoped object. A filename or MIME type alone is not trusted.

### Upload response

```json
{
  "document": {
    "id": 27,
    "organizationId": 4,
    "grantId": 335255,
    "filename": "sample-notice.pdf",
    "mimeType": "application/pdf",
    "sizeBytes": 1842200,
    "sha256": "hexadecimal-sha256-value",
    "pageCount": null,
    "sourceUrl": "https://www.grants.gov/example",
    "extractionQuality": "unknown",
    "uploadedBy": 7,
    "uploadedAt": "2026-09-09T18:25:00.000Z"
  }
}
```

Storage bucket names, object keys, credentials, and provider-specific identifiers are not returned to the browser.

Allowed extraction-quality values are `unknown`, `readable`, `degraded`, and `unreadable`.

## Grant Brief Contract

### Endpoint

`GET /api/organizations/:organizationId/compliance/documents/:documentId/brief`

### Response

```json
{
  "brief": {
    "documentId": 27,
    "grantId": 335255,
    "purpose": {
      "found": true,
      "value": "Supports eligible local stormwater projects.",
      "sources": [
        {
          "documentId": 27,
          "pageNumber": 6,
          "excerpt": "The program supports eligible local stormwater projects..."
        }
      ]
    },
    "eligibility": [],
    "fundingRange": {
      "found": false,
      "minimumAmountCents": null,
      "maximumAmountCents": null,
      "currency": "USD",
      "sources": []
    },
    "keyDates": [],
    "costShare": {
      "found": false,
      "required": null,
      "description": "Not found in the processed notice.",
      "sources": []
    },
    "keyRequirements": [],
    "notFoundFields": ["fundingRange", "costShare"],
    "verificationStatus": "unverified",
    "runId": 81,
    "model": "provider-model-name-or-null",
    "promptVersion": "grant-brief-v1",
    "generatedAt": "2026-09-09T18:32:00.000Z"
  }
}
```

Purpose, eligibility claims, key dates, cost-share claims, and key requirements each follow the source traceability contract.

## Checklist Contract

### Endpoints

| Method | Route | Result |
| --- | --- | --- |
| `GET` | `/api/organizations/:organizationId/compliance/documents/:documentId/checklist-items` | Return checklist items for the document |
| `PATCH` | `/api/organizations/:organizationId/compliance/checklist-items/:itemId` | Edit, annotate, verify, reject, or update completion |
| `GET` | `/api/organizations/:organizationId/compliance/documents/:documentId/checklist-export` | Download the current readable export |

### Checklist item

```json
{
  "id": 104,
  "organizationId": 4,
  "documentId": 27,
  "grantId": 335255,
  "category": "reporting",
  "description": "Submit quarterly performance reports within 30 days after each quarter.",
  "found": true,
  "sources": [
    {
      "documentId": 27,
      "pageNumber": 14,
      "excerpt": "Quarterly performance reports are due within 30 days..."
    }
  ],
  "possiblyAffectedByQualityIssue": false,
  "dueDate": "2026-12-31",
  "completionStatus": "notStarted",
  "userNotes": "Confirm the first reporting period with the program officer.",
  "isUserEdited": false,
  "verificationStatus": "unverified",
  "verifiedBy": null,
  "verifiedAt": null,
  "version": 1,
  "createdAt": "2026-09-09T18:32:00.000Z",
  "updatedAt": "2026-09-09T18:32:00.000Z"
}
```

Allowed categories are `eligibility`, `applicationMaterial`, `submission`, `costShare`, `reporting`, `recordRetention`, `deadline`, and `other`.

### Checklist update request

```json
{
  "expectedVersion": 1,
  "description": "Submit the quarterly performance report within 30 days after the quarter ends.",
  "dueDate": "2026-12-31",
  "completionStatus": "inProgress",
  "userNotes": "First reporting period confirmed with the program officer.",
  "verificationStatus": "verified"
}
```

The server sets `isUserEdited`, `verifiedBy`, `verifiedAt`, `updatedAt`, and the next `version`. A version mismatch returns `409 VERSION_CONFLICT`. Verification requires at least one source when `found` is true. Rejecting an item preserves the original generation and revision history for evaluation.

## Deadline Contract

Deadlines are a read and update view over verified `checklist_items`; there is no duplicate deadline table.

### Endpoints

| Method | Route | Result |
| --- | --- | --- |
| `GET` | `/api/organizations/:organizationId/compliance/deadlines` | Return verified checklist items with non-null due dates |
| `PATCH` | `/api/organizations/:organizationId/compliance/deadlines/:checklistItemId` | Correct the underlying due date or completion status |

Supported query parameters are `from`, `through`, `status`, `currentPage`, and `perPage`. Allowed calculated statuses are `upcoming`, `dueSoon`, `overdue`, and `completed`. The server calculates status from `dueDate`, `completionStatus`, the current date, and an organization-configured warning window that defaults to seven days.

### Deadline response item

```json
{
  "checklistItemId": 104,
  "grantId": 335255,
  "documentId": 27,
  "title": "Quarterly performance report",
  "dueDate": "2026-12-31",
  "status": "upcoming",
  "completionStatus": "inProgress",
  "verificationStatus": "verified",
  "verifiedBy": 7,
  "verifiedAt": "2026-09-09T19:00:00.000Z",
  "source": {
    "pageNumber": 14,
    "excerpt": "Quarterly performance reports are due within 30 days..."
  }
}
```

The dashboard and calendar call the same endpoint so they cannot calculate conflicting statuses.

### Deadline correction and completion request

`PATCH /api/organizations/:organizationId/compliance/deadlines/:checklistItemId` accepts only `dueDate` and/or `completionStatus`; any other field is rejected as an unknown field, and the request body must include at least one of them.

```json
{
  "dueDate": "2026-12-31",
  "completionStatus": "completed"
}
```

- `dueDate` must be a `YYYY-MM-DD` string; `null` is not accepted (a checklist item with no known due date stays in "Review Needed" until an actual date can be supplied).
- Correcting `dueDate` resets `verificationStatus` to `unverified` and clears `verifiedBy`/`verifiedAt`, since a previously verified date is no longer trustworthy until a person re-confirms it.
- `completionStatus` must be one of `notStarted`, `inProgress`, `completed`, or `notApplicable`. The server sets `completedAt` when the value becomes `completed`, and clears it when the value moves away from `completed`.
- `verificationStatus`, `verifiedBy`, `verifiedAt`, and other checklist-item fields are not settable here; verifying or rejecting an item is done through Section 6.3's `PATCH /checklist-items/:itemId`.
- A `checklistItemId` outside the caller's organization, or one that does not exist, returns `404 NOT_FOUND`.

### Deadline correction and completion response

A single resource is returned directly under its resource name, per the standard success shape:

```json
{
  "deadline": {
    "checklistItemId": 104,
    "grantId": 335255,
    "documentId": 27,
    "title": "Quarterly performance report",
    "dueDate": "2026-12-31",
    "status": "completed",
    "completionStatus": "completed",
    "completedAt": "2026-12-30T19:00:00.000Z",
    "verificationStatus": "unverified",
    "verifiedBy": null,
    "verifiedAt": null,
    "source": {
      "pageNumber": 14,
      "excerpt": "Quarterly performance reports are due within 30 days..."
    }
  }
}
```

## External Adapter Contracts

External clients are server-side modules, not browser APIs.

### Grants.gov adapter output

The selected adapter returns normalized opportunity records that can be persisted through the existing grant repository:

```json
{
  "grantId": 335255,
  "revisionId": 18,
  "opportunityNumber": "ABC-2026-01",
  "title": "Example Opportunity",
  "description": "Normalized description",
  "agencyCode": "ABC",
  "opportunityStatus": "posted",
  "openDate": "2026-09-01",
  "closeDate": "2026-11-01",
  "archiveDate": null,
  "applicantTypes": ["cityGovernment", "countyGovernment"],
  "eligibilityCodes": ["12"],
  "fundingActivityCategories": ["ST"],
  "costShareRequired": true,
  "awardFloorCents": 5000000,
  "awardCeilingCents": 50000000,
  "sourceUrl": "https://www.grants.gov/example",
  "sourceRetrievedAt": "2026-09-09T17:00:00.000Z"
}
```

Refreshes are idempotent by `grantId` and `revisionId`. An older revision never replaces a newer stored record.

### AI adapter request and response

Subsystem services send only the fields required for the task:

```json
{
  "operation": "grantBrief",
  "schemaVersion": "grant-brief-v1",
  "promptVersion": "grant-brief-v1",
  "input": {
    "documentId": 27,
    "pages": []
  }
}
```

The adapter returns parsed structured data plus provider metadata. A domain service validates it before anything becomes a completed result. The adapter never returns credentials to a route and does not log full notice text by default.

## Frontend Consumption Rules

- Vuex stores each resource by organization and identifier; changing the selected organization clears or reloads compliance state.
- The browser sends cookies with `credentials: "include"` through the existing `fetchApi` helper.
- The UI polls the run `self` link while status is `queued` or `processing`.
- `reviewRequired` displays a clear review action and does not masquerade as failure or completion.
- The UI displays safe `error.message` text and may use `error.code` for a specific recovery action.
- The UI never derives organization ownership, verification identity, model version, or audit timestamps.
- A feature flag may hide unfinished routes, but the server must still enforce authorization.

## Database Mapping Baseline

| API resource | Proposed PostgreSQL structure | Primary ownership |
| --- | --- | --- |
| Profile | `organization_profiles` | Connor with Allison repository support |
| Match result | `grant_match_results` | Connor with Allison evaluation support |
| Uploaded notice | `grant_documents` | Anthony with Allison persistence support |
| Processing run | `ai_processing_runs` | Allison with all subsystem owners |
| Grant brief | `grant_briefs` or a versioned structured result linked to `grant_documents` | Anthony |
| Checklist item | `checklist_items` | Anthony |
| Published deadline | Read view over verified `checklist_items` | Manuel; no duplicate table |

Every new structure includes organization ownership directly or through a required foreign-key path that can be constrained in all reads and writes. Migrations and repositories must not rely on the browser to supply tenant ownership.

## Team Handoffs

| Producer | Consumer | Contract boundary |
| --- | --- | --- |
| Allison's opportunity adapter | Connor's matcher | Normalized opportunity record |
| Connor's profile service | Connor's blocker and matcher services | Profile ID and immutable profile version |
| Connor's selected match | Anthony's document workflow | Organization ID, grant ID, source URL, and available document metadata |
| Allison's AI adapter | Connor and Anthony | Structured response, model and prompt versions, safe provider error |
| Anthony's checklist | Manuel's portfolio | Verified checklist item with due date and source reference |
| Every subsystem | Vue frontend | Shared success, error, processing, verification, and completion shapes |

## Acceptance Checklist

C-02 is ready for team acceptance when each owner confirms the following in the pull request:

- Connor: profile and matching fields support deterministic blockers and reproducible ranking.
- Allison: adapter, persistence, audit, error, model, and prompt-version fields are implementable.
- Anthony: document, source, brief, checklist, quality, editing, and verification fields support the PDF workflow.
- Manuel: deadline response is sufficient for both dashboard and calendar without duplicating records.
- All members: organization authorization is enforced on the server and error responses expose no secrets.
- All members: processing status, verification status, and completion status are not combined.

Changes to a shared field, enum, state transition, or route require a pull-request update to this document before dependent code is merged.

## Decisions Recorded

1. New capstone endpoints use the `/compliance` namespace inside the existing organization-scoped API.
2. New JSON uses camelCase; database mappings may remain snake_case.
3. New collection responses retain GOST's `{ data, pagination }` convention.
4. Long operations use `queued`, `processing`, `reviewRequired`, `completed`, and `failed`.
5. Human verification and checklist completion use separate fields and enums.
6. Verified checklist dates are the single source for the portfolio and calendar.
7. Source references use one-based page numbers and exact extracted excerpts.
8. Retries create new processing-run records and preserve prior completed results and failures.
9. External services are accessed only through server-side adapters.
10. Secrets and provider internals are never returned in API responses or ordinary logs.
