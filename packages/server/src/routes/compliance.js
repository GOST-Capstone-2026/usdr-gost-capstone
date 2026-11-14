// F1 — Grant Analysis and Compliance Checklist subsystem.
// Routes here implement docs/g32-shared-api-contracts.md, "Grant Document Contract" and
// "Checklist Contract". Mounted at /api/organizations/:organizationId/compliance in configure.js.
const express = require('express');
const multer = require('multer');
// eslint-disable-next-line import/no-unresolved
const { stringify: csvStringify } = require('csv-stringify/sync');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { requireUser } = require('../lib/access-helpers');
const { ensureAsyncContext } = require('../arpa_reporter/lib/ensure-async-context');
const { getGrantDocumentsS3Client } = require('../lib/gost-aws');
const { validateGrantDocumentUpload, sha256Hex } = require('../lib/grantDocumentValidation');
const { runAnalysis } = require('../lib/analysisRuns');
const db = require('../db');

const router = express.Router({ mergeParams: true });
const multerUpload = multer({ storage: multer.memoryStorage() });

const GRANT_DOCUMENTS_BUCKET = process.env.GRANT_DOCUMENTS_BUCKET || 'grant-documents';

function sendError(req, res, status, code, message, details) {
    return res.status(status).json({
        error: {
            code,
            message,
            retryable: status >= 500,
            requestId: req.id,
            details,
        },
    });
}

function serializeDocument(row) {
    return {
        id: row.id,
        organizationId: row.agency_id,
        grantId: row.grant_id,
        filename: row.filename,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        sha256: row.sha256,
        pageCount: row.page_count,
        sourceUrl: row.source_url,
        extractionQuality: row.extraction_quality,
        uploadedBy: row.uploaded_by,
        uploadedAt: row.uploaded_at,
    };
}

function serializeGrantBrief(row, document) {
    return {
        documentId: row.document_id,
        grantId: document.grant_id,
        purpose: row.purpose,
        eligibility: row.eligibility,
        fundingRange: row.funding_range,
        keyDates: row.key_dates,
        costShare: row.cost_share,
        keyRequirements: row.key_requirements,
        notFoundFields: row.not_found_fields,
        verificationStatus: row.verification_status,
        runId: row.run_id,
        model: row.model,
        promptVersion: row.prompt_version,
        generatedAt: row.generated_at,
    };
}

const CHECKLIST_EXPORT_CATEGORY_LABELS = {
    eligibility: 'Eligibility',
    applicationMaterial: 'Application material',
    submission: 'Submission',
    costShare: 'Cost share',
    reporting: 'Reporting',
    recordRetention: 'Record retention',
    deadline: 'Deadline',
    other: 'Other',
};

const CHECKLIST_EXPORT_COMPLETION_LABELS = {
    notStarted: 'Not started',
    inProgress: 'In progress',
    completed: 'Completed',
    notApplicable: 'Not applicable',
};

// One readable row per checklist item for the Checklist Contract's
// GET .../checklist-export (AN-16). The contract specifies the route but not a column format,
// so this follows the same human-readable CSV convention routes/grants.js already uses
// (csv-stringify, Content-Disposition attachment) rather than inventing a new export mechanism.
function checklistExportRow(row, verifierName) {
    const sources = Array.isArray(row.sources) ? row.sources : [];
    return {
        category: CHECKLIST_EXPORT_CATEGORY_LABELS[row.category] || row.category,
        description: row.description,
        found: row.found ? 'Yes' : 'No',
        sourceCitations: sources.map((source) => `p.${source.pageNumber}: ${source.excerpt}`).join(' | '),
        possiblyAffectedByQualityIssue: row.possibly_affected_by_quality_issue ? 'Yes' : 'No',
        dueDate: row.due_date || '',
        completionStatus: CHECKLIST_EXPORT_COMPLETION_LABELS[row.completion_status] || row.completion_status,
        verificationStatus: row.verification_status,
        verifiedBy: verifierName || '',
        // Explicitly re-serialized rather than handed to csv-stringify as-is: a timestamptz
        // column can come back as a real Date object, which csv-stringify would otherwise cast
        // to a raw epoch number instead of a readable date.
        verifiedAt: row.verified_at ? new Date(row.verified_at).toISOString() : '',
        userNotes: row.user_notes || '',
        isUserEdited: row.is_user_edited ? 'Yes' : 'No',
    };
}

function serializeAnalysisRun(row) {
    return {
        id: row.id,
        documentId: row.document_id,
        status: row.status,
        errorMessage: row.error_message,
        chunkCount: row.chunk_count,
        createdAt: row.created_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
    };
}

const UPLOAD_ERROR_STATUS = {
    VALIDATION_ERROR: 400,
    UNSUPPORTED_MEDIA_TYPE: 415,
    PAYLOAD_TOO_LARGE: 413,
};

// POST /api/organizations/:organizationId/compliance/documents
// multipart/form-data: file (required PDF), grantId (required), sourceUrl (optional)
router.post(
    '/documents',
    requireUser,
    // ensureAsyncContext works around an AsyncLocalStorage/multer interaction issue in Express
    // (see arpa_reporter/lib/ensure-async-context.js and expressjs/multer#814).
    ensureAsyncContext(multerUpload.single('file')),
    async (req, res) => {
        const { selectedAgency, user } = req.session;
        const { grantId, sourceUrl } = req.body;

        if (!grantId) {
            return sendError(req, res, 400, 'VALIDATION_ERROR', 'The request contains invalid fields.', [
                { field: 'grantId', issue: 'required' },
            ]);
        }

        const validationError = validateGrantDocumentUpload(req.file);
        if (validationError) {
            return sendError(
                req,
                res,
                UPLOAD_ERROR_STATUS[validationError.code] || 400,
                validationError.code,
                validationError.message,
            );
        }

        const sha256 = sha256Hex(req.file.buffer);
        const storageKey = `${selectedAgency}/${sha256}-${req.file.originalname}`;

        try {
            const s3 = getGrantDocumentsS3Client();
            await s3.send(new PutObjectCommand({
                Bucket: GRANT_DOCUMENTS_BUCKET,
                Key: storageKey,
                Body: req.file.buffer,
                ContentType: req.file.mimetype,
            }));
        } catch (err) {
            req.log.error({ err }, 'failed to upload grant document to S3');
            return sendError(req, res, 502, 'STORAGE_UNAVAILABLE', 'Could not store the uploaded document.');
        }

        let document;
        try {
            document = await db.createGrantDocument({
                agencyId: selectedAgency,
                grantId,
                uploadedBy: user.id,
                filename: req.file.originalname,
                mimeType: req.file.mimetype,
                sizeBytes: req.file.size,
                sha256,
                sourceUrl,
                storageBucket: GRANT_DOCUMENTS_BUCKET,
                storageKey,
                // pageCount and extractionQuality start unset. A POST to .../analysis-runs
                // (AN-08) does the actual reading and fills these in, so upload itself stays
                // fast instead of making the browser wait on processing a 100+ page PDF.
            });
        } catch (err) {
            // Postgres error code 23505 = unique_violation. The grant_documents migration enforces
            // one (agency_id, sha256) pair, so this means the organization already uploaded this
            // exact file. Surface it as a clean 409 instead of the generic 500 handler in configure.js.
            if (err.code === '23505') {
                return sendError(req, res, 409, 'DUPLICATE_DOCUMENT', 'This organization has already uploaded this exact document.');
            }
            throw err;
        }

        return res.status(201).json({ document: serializeDocument(document) });
    },
);

// GET /api/organizations/:organizationId/compliance/documents/:documentId
router.get('/documents/:documentId', requireUser, async (req, res) => {
    const { selectedAgency } = req.session;
    const document = await db.getGrantDocument({
        documentId: req.params.documentId,
        agencyId: selectedAgency,
    });

    if (!document) {
        return sendError(req, res, 404, 'NOT_FOUND', 'Document not found.');
    }

    return res.json({ document: serializeDocument(document) });
});

// GET /api/organizations/:organizationId/compliance/documents/:documentId/brief
router.get('/documents/:documentId/brief', requireUser, async (req, res) => {
    const { selectedAgency } = req.session;
    const document = await db.getGrantDocument({
        documentId: req.params.documentId,
        agencyId: selectedAgency,
    });

    if (!document) {
        return sendError(req, res, 404, 'NOT_FOUND', 'Document not found.');
    }

    const brief = await db.getLatestGrantBrief({ documentId: document.id });
    if (!brief) {
        return sendError(req, res, 404, 'NOT_FOUND', 'No grant brief has been generated for this document yet.');
    }

    return res.json({ brief: serializeGrantBrief(brief, document) });
});

// GET /api/organizations/:organizationId/compliance/documents/:documentId/checklist-export
// Downloads the document's current checklist as a readable CSV, the same Content-Disposition
// download convention routes/grants.js already uses, rather than returning JSON for a browser
// to turn into a file itself.
router.get('/documents/:documentId/checklist-export', requireUser, async (req, res) => {
    const { selectedAgency } = req.session;
    const document = await db.getGrantDocument({
        documentId: req.params.documentId,
        agencyId: selectedAgency,
    });

    if (!document) {
        return sendError(req, res, 404, 'NOT_FOUND', 'Document not found.');
    }

    const items = await db.getChecklistItemsForDocument({ documentId: document.id, agencyId: selectedAgency });

    const verifierIds = [...new Set(items.map((item) => item.verified_by).filter((id) => id != null))];
    const verifiers = verifierIds.length > 0 ? await db.getUsersEmailAndName(verifierIds) : [];
    const verifierNames = new Map(verifiers.map((verifier) => [verifier.id, verifier.name || verifier.email]));

    const rows = items.map((item) => checklistExportRow(item, verifierNames.get(item.verified_by)));
    // Matches routes/grants.js's own CSV exports: with zero rows, csv-stringify would not even
    // emit the header, producing a confusing, totally empty file.
    if (rows.length === 0) rows.push({});

    const csv = csvStringify(rows, {
        header: true,
        columns: [
            { key: 'category', header: 'Category' },
            { key: 'description', header: 'Description' },
            { key: 'found', header: 'Found' },
            { key: 'sourceCitations', header: 'Source Citations' },
            { key: 'possiblyAffectedByQualityIssue', header: 'Possibly Affected By Quality Issue' },
            { key: 'dueDate', header: 'Due Date' },
            { key: 'completionStatus', header: 'Completion Status' },
            { key: 'verificationStatus', header: 'Verification Status' },
            { key: 'verifiedBy', header: 'Verified By' },
            { key: 'verifiedAt', header: 'Verified At' },
            { key: 'userNotes', header: 'User Notes' },
            { key: 'isUserEdited', header: 'Edited By User' },
        ],
    });

    const filename = `checklist-document-${document.id}.csv`;
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Length', csv.length);
    return res.send(csv);
});

// POST /api/organizations/:organizationId/compliance/documents/:documentId/analysis-runs
// Starts processing (extract, rate quality, chunk for AI) and returns immediately; poll
// GET .../analysis-runs/:runId for progress instead of waiting on this request.
router.post('/documents/:documentId/analysis-runs', requireUser, async (req, res) => {
    const { selectedAgency, user } = req.session;
    const document = await db.getGrantDocument({
        documentId: req.params.documentId,
        agencyId: selectedAgency,
    });

    if (!document) {
        return sendError(req, res, 404, 'NOT_FOUND', 'Document not found.');
    }

    const analysisRun = await db.createAnalysisRun({ documentId: document.id });

    // Deliberately not awaited: the point of this endpoint is that the caller does not wait for
    // processing to finish. runAnalysis reports its own success/failure into the analysis_runs
    // row, so there is nothing more to do with its result here.
    runAnalysis(analysisRun, document, { userId: user.id, tenantId: user.tenant_id }).catch((err) => {
        req.log.error({ err, analysisRunId: analysisRun.id }, 'unhandled error starting analysis run');
    });

    return res.status(202).json({ analysisRun: serializeAnalysisRun(analysisRun) });
});

// GET /api/organizations/:organizationId/compliance/analysis-runs/:runId
router.get('/analysis-runs/:runId', requireUser, async (req, res) => {
    const { selectedAgency } = req.session;
    const analysisRun = await db.getAnalysisRun({
        runId: req.params.runId,
        agencyId: selectedAgency,
    });

    if (!analysisRun) {
        return sendError(req, res, 404, 'NOT_FOUND', 'Analysis run not found.');
    }

    return res.json({ analysisRun: serializeAnalysisRun(analysisRun) });
});

module.exports = router;
