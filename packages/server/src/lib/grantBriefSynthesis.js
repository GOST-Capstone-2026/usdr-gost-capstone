// F1 — Grant Analysis and Compliance Checklist subsystem (AN-10).
// Sends each of a document's chunks (AN-07) to the AI, one at a time, and merges whatever facts
// it finds into a single grant brief (AN-09's schema). A long notice rarely fits in one AI
// request, so this is deliberately a "ask every chunk, combine the answers" design rather than
// one call for the whole document.
//
// The AI-calling function is passed in rather than imported directly, so this file stays fully
// testable with a fake response and has no dependency on which AI provider is actually wired up.
const { createEmptyBrief, computeNotFoundFields } = require('./grantBriefSchema');
const { log } = require('./logging');

const SYSTEM_PROMPT = 'You are extracting compliance information from a U.S. federal grant notice '
    + 'for a nonprofit or local government reader. Only report a fact if it is explicitly present '
    + 'in the text you are given. Never guess or infer a value that is not stated. Respond with '
    + 'nothing but a single JSON object, no explanation and no markdown formatting.';

const RESPONSE_SHAPE = `{
  "purpose": { "found": boolean, "value": string or null, "pageNumber": number or null, "excerpt": string or null },
  "eligibility": [ { "value": string, "pageNumber": number, "excerpt": string } ],
  "fundingRange": { "found": boolean, "minimumAmountCents": number or null, "maximumAmountCents": number or null, "pageNumber": number or null, "excerpt": string or null },
  "keyDates": [ { "label": string, "date": "YYYY-MM-DD", "pageNumber": number, "excerpt": string } ],
  "costShare": { "found": boolean, "required": boolean or null, "description": string or null, "pageNumber": number or null, "excerpt": string or null },
  "keyRequirements": [ { "value": string, "pageNumber": number, "excerpt": string } ]
}`;

function buildPrompt(chunk) {
    const pageText = chunk.pages
        .map((page) => `--- Page ${page.pageNumber} ---\n${page.text}`)
        .join('\n\n');

    return `Here is an excerpt from a grant notice, covering pages ${chunk.startPage} to ${chunk.endPage}:\n\n"""\n${pageText}\n"""\n\n`
        + `Return a JSON object with exactly this shape. Use the page markers above to report the correct pageNumber for anything you find. Leave a field as not found if this excerpt does not contain it:\n\n${RESPONSE_SHAPE}`;
}

// Models occasionally wrap JSON in a code fence despite instructions not to. A chunk whose
// response still isn't valid JSON after that contributes nothing, rather than failing the whole
// document over one bad chunk.
function parseChunkResponse(text) {
    const cleaned = text.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    try {
        return JSON.parse(cleaned);
    } catch (err) {
        return null;
    }
}

function toSources(documentId, pageNumber, excerpt) {
    if (!pageNumber || !excerpt) return [];
    return [{ documentId, pageNumber, excerpt }];
}

// First chunk to find a one-time fact wins; later chunks claiming the same fact are ignored.
function mergeSingleField(target, candidate, documentId) {
    if (target.found || !candidate || !candidate.found) return target;
    return { found: true, value: candidate.value ?? null, sources: toSources(documentId, candidate.pageNumber, candidate.excerpt) };
}

function mergeFundingRange(target, candidate, documentId) {
    if (target.found || !candidate || !candidate.found) return target;
    return {
        found: true,
        minimumAmountCents: candidate.minimumAmountCents ?? null,
        maximumAmountCents: candidate.maximumAmountCents ?? null,
        currency: 'USD',
        sources: toSources(documentId, candidate.pageNumber, candidate.excerpt),
    };
}

function mergeCostShare(target, candidate, documentId) {
    if (target.found || !candidate || !candidate.found) return target;
    return {
        found: true,
        required: candidate.required ?? null,
        description: candidate.description || 'Not found in the processed notice.',
        sources: toSources(documentId, candidate.pageNumber, candidate.excerpt),
    };
}

// List facts (eligibility rules, dates, requirements) can be spread across many chunks, so every
// chunk's findings are appended rather than only keeping the first.
function mergeListField(target, candidateList, documentId) {
    if (!Array.isArray(candidateList)) return target;
    const additions = candidateList
        .filter((entry) => entry && entry.value)
        .map((entry) => ({ found: true, value: entry.value, sources: toSources(documentId, entry.pageNumber, entry.excerpt) }));
    return [...target, ...additions];
}

function mergeKeyDates(target, candidateList, documentId) {
    if (!Array.isArray(candidateList)) return target;
    const additions = candidateList
        .filter((entry) => entry && entry.label && entry.date)
        .map((entry) => ({
            found: true, label: entry.label, date: entry.date, sources: toSources(documentId, entry.pageNumber, entry.excerpt),
        }));
    return [...target, ...additions];
}

/**
 * @param {{documentId: number, runId: number, chunks: Array, generateText: Function}} args
 *   generateText matches Allison's AI adapter's shape: async ({ system, prompt }) => ({ text })
 * @returns {Promise<object>} a brief shaped like grantBriefSchema.js's createEmptyBrief()
 */
async function synthesizeGrantBrief({
    documentId, runId, chunks, generateText,
}) {
    let brief = createEmptyBrief({ documentId, runId });

    // eslint-disable-next-line no-restricted-syntax
    for (const chunk of chunks) {
        // eslint-disable-next-line no-await-in-loop
        const response = await generateText({ system: SYSTEM_PROMPT, prompt: buildPrompt(chunk) });
        const candidate = parseChunkResponse(response.text);

        if (!candidate) {
            log.warn({ documentId, chunkIndex: chunk.chunkIndex }, 'could not parse AI response for chunk, skipping it');
            // eslint-disable-next-line no-continue
            continue;
        }

        brief = {
            ...brief,
            purpose: mergeSingleField(brief.purpose, candidate.purpose, documentId),
            fundingRange: mergeFundingRange(brief.fundingRange, candidate.fundingRange, documentId),
            costShare: mergeCostShare(brief.costShare, candidate.costShare, documentId),
            eligibility: mergeListField(brief.eligibility, candidate.eligibility, documentId),
            keyRequirements: mergeListField(brief.keyRequirements, candidate.keyRequirements, documentId),
            keyDates: mergeKeyDates(brief.keyDates, candidate.keyDates, documentId),
        };
    }

    brief.notFoundFields = computeNotFoundFields(brief);
    brief.generatedAt = new Date().toISOString();
    return brief;
}

module.exports = { synthesizeGrantBrief };
