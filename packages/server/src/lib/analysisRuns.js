// F1 — Grant Analysis and Compliance Checklist subsystem (AN-08).
// Runs the actual processing work for one analysis run: fetch the stored PDF back from S3,
// extract its pages, rate extraction quality (AN-06), chunk it for the AI step (AN-07), then save
// the results. This is deliberately separate from the Express route in routes/compliance.js, so
// the route only has to worry about HTTP concerns (create the run, respond, kick this off) and
// this file only has to worry about doing the work.
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getS3Client } = require('./gost-aws');
const { extractPages } = require('./pdfTextExtraction');
const { assessExtractionQuality } = require('./extractionQuality');
const { chunkPages } = require('./documentChunking');
const { log } = require('./logging');
const db = require('../db');

async function streamToBuffer(stream) {
    const chunks = [];
    // eslint-disable-next-line no-restricted-syntax
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

/**
 * @param {{id: number, storage_bucket: string, storage_key: string}} document
 * @returns {Promise<Buffer>}
 */
async function fetchStoredPdf(document) {
    const s3 = getS3Client();
    const response = await s3.send(new GetObjectCommand({
        Bucket: document.storage_bucket,
        Key: document.storage_key,
    }));
    return streamToBuffer(response.Body);
}

/**
 * Does the real work for one analysis run and updates its status as it goes. Meant to be started
 * without the caller awaiting it (see POST .../analysis-runs), so the HTTP response isn't held up
 * by PDF processing.
 *
 * @param {{id: number}} analysisRun
 * @param {{id: number, storage_bucket: string, storage_key: string}} document
 */
async function runAnalysis(analysisRun, document) {
    await db.startAnalysisRun({ runId: analysisRun.id });
    try {
        const buffer = await fetchStoredPdf(document);
        const extracted = await extractPages(buffer);
        const assessment = assessExtractionQuality(extracted.pages);
        const chunks = chunkPages(assessment.pages);

        await db.saveDocumentAnalysisResults({
            documentId: document.id,
            pageCount: extracted.pageCount,
            pages: assessment.pages,
            extractionQuality: assessment.quality,
        });

        log.info({
            documentId: document.id, analysisRunId: analysisRun.id, chunkCount: chunks.length,
        }, 'analysis run completed');
        await db.completeAnalysisRun({ runId: analysisRun.id, chunkCount: chunks.length });
    } catch (err) {
        log.error({ err, documentId: document.id, analysisRunId: analysisRun.id }, 'analysis run failed');
        await db.failAnalysisRun({ runId: analysisRun.id, errorMessage: err.message });
    }
}

module.exports = { runAnalysis };
