const crypto = require('crypto');

// %PDF- in ASCII. Real PDF files start with this signature; a renamed non-PDF file does not,
// even if its filename or browser-supplied MIME type claims otherwise (Grant Document Contract:
// "verify the MIME type AND the PDF file signature ... a filename or MIME type alone is not trusted").
const PDF_SIGNATURE = Buffer.from('%PDF-', 'ascii');

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024; // 25 MB

function hasPdfSignature(buffer) {
    return Buffer.isBuffer(buffer)
        && buffer.length >= PDF_SIGNATURE.length
        && buffer.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE);
}

function getMaxUploadBytes() {
    const configured = Number(process.env.GRANT_DOCUMENT_MAX_BYTES);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_BYTES;
}

/**
 * Validate an uploaded file against the Grant Document Contract before it is stored.
 * Returns { code, message } for the first failure found, or null if the file is acceptable.
 * @param {{ buffer: Buffer, mimetype: string, size: number }} file - the multer file object
 */
function validateGrantDocumentUpload(file) {
    if (!file) {
        return { code: 'VALIDATION_ERROR', message: 'A PDF file is required.' };
    }
    if (file.mimetype !== 'application/pdf' || !hasPdfSignature(file.buffer)) {
        return { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'The uploaded file is not a valid PDF.' };
    }
    if (file.size > getMaxUploadBytes()) {
        return { code: 'PAYLOAD_TOO_LARGE', message: `The uploaded file exceeds the ${getMaxUploadBytes()}-byte limit.` };
    }
    return null;
}

function sha256Hex(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

module.exports = {
    hasPdfSignature,
    validateGrantDocumentUpload,
    sha256Hex,
    getMaxUploadBytes,
};
