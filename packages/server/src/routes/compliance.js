// F1 — Grant Analysis and Compliance Checklist subsystem.
// Routes here implement docs/g32-shared-api-contracts.md, "Grant Document Contract".
// Mounted at /api/organizations/:organizationId/compliance in configure.js.
const express = require('express');
const multer = require('multer');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { requireUser } = require('../lib/access-helpers');
const { ensureAsyncContext } = require('../arpa_reporter/lib/ensure-async-context');
const { getS3Client } = require('../lib/gost-aws');
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
            const s3 = getS3Client();
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

// POST /api/organizations/:organizationId/compliance/documents/:documentId/analysis-runs
// Starts processing (extract, rate quality, chunk for AI) and returns immediately; poll
// GET .../analysis-runs/:runId for progress instead of waiting on this request.
router.post('/documents/:documentId/analysis-runs', requireUser, async (req, res) => {
    const { selectedAgency } = req.session;
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
    runAnalysis(analysisRun, document).catch((err) => {
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
