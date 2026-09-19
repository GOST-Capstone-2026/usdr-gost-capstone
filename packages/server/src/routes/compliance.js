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
const { extractPages } = require('../lib/pdfTextExtraction');
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

        // Read the pages before storing anything, so a PDF that cannot be read is rejected
        // without leaving an orphaned object in S3.
        let extracted;
        try {
            extracted = await extractPages(req.file.buffer);
        } catch (err) {
            req.log.warn({ err }, 'could not extract text from uploaded grant document');
            return sendError(req, res, 422, 'UNPROCESSABLE_DOCUMENT', 'The uploaded PDF could not be read.');
        }

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
                pageCount: extracted.pageCount,
                pages: extracted.pages,
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

module.exports = router;
