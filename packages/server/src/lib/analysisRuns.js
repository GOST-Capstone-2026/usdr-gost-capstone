// F1 — Grant Analysis and Compliance Checklist subsystem (AN-08, extended by AN-10 and AN-14).
// Runs the actual processing work for one analysis run: fetch the stored PDF back from S3,
// extract its pages, rate extraction quality (AN-06), chunk it for the AI step (AN-07), save the
// results, then synthesize a grant brief (AN-10) and generate checklist items (AN-14) from those
// chunks. This matches the contract's own description of this endpoint: "Start extraction, brief,
// and checklist processing" is all one run, not three separate triggers. This is deliberately
// separate from the Express route in routes/compliance.js, so the route only has to worry about
// HTTP concerns (create the run, respond, kick this off) and this file only has to worry about
// doing the work.
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getGrantDocumentsS3Client } = require('./gost-aws');
const { extractPages } = require('./pdfTextExtraction');
const { assessExtractionQuality } = require('./extractionQuality');
const { chunkPages } = require('./documentChunking');
const { synthesizeGrantBrief } = require('./grantBriefSynthesis');
const { generateChecklistItems } = require('./checklistGeneration');
const { BRIEF_FIELD_NAMES, isBriefFullyEmpty } = require('./grantBriefSchema');
const { generateTextAudited } = require('./ai-audit');
const { log } = require('./logging');
const db = require('../db');

const GRANT_BRIEF_PROMPT_VERSION = 'grant-brief-v1';
const CHECKLIST_GENERATION_PROMPT_VERSION = 'checklist-generation-v1';

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
    const s3 = getGrantDocumentsS3Client();
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
 * @param {{id: number, agency_id: number, storage_bucket: string, storage_key: string}} document
 * @param {{userId?: number, tenantId?: number}} requestedBy who asked for this run, so the AI
 *   audit trail (ai_audit_records) can say which user and organization triggered the call
 */
async function runAnalysis(analysisRun, document, requestedBy = {}) {
    const { userId, tenantId } = requestedBy;
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

        // True once anything below hits a chunk that errored or came back unparseable, so a run
        // that only partly succeeded is still visibly distinct from one that fully did (AN-17
        // follow-up: Connor's report that a retry could neither fill in a missed obligation nor
        // tell a person the result was incomplete in the first place).
        let incomplete = false;

        // A document rated unreadable has essentially no real text for the AI to read, so there
        // is nothing to synthesize; the checklist can explain why using extractionQuality alone.
        if (assessment.quality !== 'unreadable') {
            try {
                const briefStats = {};
                const brief = await synthesizeGrantBrief({
                    documentId: document.id,
                    runId: analysisRun.id,
                    chunks,
                    generateText: (args) => generateTextAudited(
                        {
                            task: 'grantBrief', grantId: document.grant_id, promptVersion: GRANT_BRIEF_PROMPT_VERSION, userId, tenantId,
                        },
                        args,
                        { knex: db.knex },
                    ),
                    runStats: briefStats,
                });

                // A brief with nothing found at all, right after a chunk actually failed, is most
                // likely a full provider outage (every chunk unreadable to the AI), not a notice
                // that genuinely says nothing. If a usable brief already exists, keep it instead
                // of overwriting it with this empty one.
                const existingBrief = isBriefFullyEmpty(brief) && briefStats.failedChunkCount > 0
                    ? await db.getLatestGrantBrief({ documentId: document.id })
                    : null;
                const keepPreviousBrief = existingBrief
                    && existingBrief.not_found_fields.length < BRIEF_FIELD_NAMES.length;

                if (keepPreviousBrief) {
                    log.warn({
                        documentId: document.id, analysisRunId: analysisRun.id,
                    }, 'brief synthesis found nothing on this run after a chunk failed; keeping the previously saved brief instead of overwriting it with an empty one');
                } else {
                    await db.createGrantBrief({ documentId: document.id, runId: analysisRun.id, brief });
                }
                incomplete = incomplete || briefStats.failedChunkCount > 0;
            } catch (briefErr) {
                // Extraction and chunking already succeeded, so one failed brief attempt should
                // not erase that work or fail the whole run. GET .../brief simply has nothing to
                // return yet, and this can be retried later.
                log.error({
                    err: briefErr, documentId: document.id, analysisRunId: analysisRun.id,
                }, 'grant brief synthesis failed');
                incomplete = true;
            }

            try {
                const existingItems = await db.getChecklistItemsForDocument({
                    documentId: document.id, agencyId: document.agency_id,
                });

                // Once items exist, only try again if the run that created them was itself
                // incomplete: otherwise a fully-successful document would call the AI again on
                // every rerun for nothing. A retry here only ever adds items a previous run
                // missed; it never touches an item a person has since edited or verified.
                if (existingItems.length === 0 || document.analysis_incomplete) {
                    const checklistStats = {};
                    const items = await generateChecklistItems({
                        documentId: document.id,
                        grantId: document.grant_id,
                        chunks,
                        lowTextPages: assessment.lowTextPages,
                        generateText: (args) => generateTextAudited(
                            {
                                task: 'checklistGeneration', grantId: document.grant_id, promptVersion: CHECKLIST_GENERATION_PROMPT_VERSION, userId, tenantId,
                            },
                            args,
                            { knex: db.knex },
                        ),
                        runStats: checklistStats,
                    });
                    if (existingItems.length === 0) {
                        await db.createInitialChecklistItems({ documentId: document.id, items });
                    } else {
                        await db.addMissingChecklistItems({ documentId: document.id, items });
                    }
                    incomplete = incomplete || checklistStats.failedChunkCount > 0;
                }
            } catch (checklistErr) {
                // Same reasoning as the grant-brief catch above: a failed generation attempt should
                // not erase the extraction work that already succeeded, and can be retried later.
                log.error({
                    err: checklistErr, documentId: document.id, analysisRunId: analysisRun.id,
                }, 'checklist generation failed');
                incomplete = true;
            }
        }

        await db.setDocumentAnalysisIncomplete({ documentId: document.id, incomplete });

        log.info({
            documentId: document.id, analysisRunId: analysisRun.id, chunkCount: chunks.length, incomplete,
        }, 'analysis run completed');
        await db.completeAnalysisRun({ runId: analysisRun.id, chunkCount: chunks.length });
    } catch (err) {
        log.error({ err, documentId: document.id, analysisRunId: analysisRun.id }, 'analysis run failed');
        await db.failAnalysisRun({ runId: analysisRun.id, errorMessage: err.message });
    }
}

module.exports = { runAnalysis };
