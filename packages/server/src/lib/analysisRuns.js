// F1 — Grant Analysis and Compliance Checklist subsystem (AN-08, extended by AN-10).
// Runs the actual processing work for one analysis run: fetch the stored PDF back from S3,
// extract its pages, rate extraction quality (AN-06), chunk it for the AI step (AN-07), save the
// results, then synthesize a grant brief from those chunks (AN-10). This matches the contract's
// own description of this endpoint: "Start extraction, brief, and checklist processing" is all
// one run, not three separate triggers. This is deliberately separate from the Express route in
// routes/compliance.js, so the route only has to worry about HTTP concerns (create the run,
// respond, kick this off) and this file only has to worry about doing the work.
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getS3Client } = require('./gost-aws');
const { extractPages } = require('./pdfTextExtraction');
const { assessExtractionQuality } = require('./extractionQuality');
const { chunkPages } = require('./documentChunking');
const { synthesizeGrantBrief } = require('./grantBriefSynthesis');
const { generateTextAudited } = require('./ai-audit');
const { log } = require('./logging');
const db = require('../db');

const GRANT_BRIEF_PROMPT_VERSION = 'grant-brief-v1';

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

        // A document rated unreadable has essentially no real text for the AI to read, so there
        // is nothing to synthesize; the checklist can explain why using extractionQuality alone.
        if (assessment.quality !== 'unreadable') {
            try {
                const brief = await synthesizeGrantBrief({
                    documentId: document.id,
                    runId: analysisRun.id,
                    chunks,
                    generateText: (args) => generateTextAudited(
                        { task: 'grantBrief', grantId: document.grant_id, promptVersion: GRANT_BRIEF_PROMPT_VERSION },
                        args,
                        { knex: db.knex },
                    ),
                });
                await db.createGrantBrief({ documentId: document.id, runId: analysisRun.id, brief });
            } catch (briefErr) {
                // Extraction and chunking already succeeded, so one failed brief attempt should
                // not erase that work or fail the whole run. GET .../brief simply has nothing to
                // return yet, and this can be retried later.
                log.error({
                    err: briefErr, documentId: document.id, analysisRunId: analysisRun.id,
                }, 'grant brief synthesis failed');
            }
        }

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
