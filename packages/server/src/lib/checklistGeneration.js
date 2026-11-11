// F1 — Grant Analysis and Compliance Checklist subsystem (AN-14).
// Sends each of a document's chunks (AN-07) to the AI and collects every compliance obligation it
// identifies into a list of checklist items (AN-11's schema), the same "ask every chunk, combine
// the answers" design AN-10 used for the grant brief. Unlike the brief's fixed set of fields,
// checklist items are an open list: a chunk simply contributes nothing if it names no obligation,
// rather than reporting one "not found".
//
// Each item's citation is checked against the real extracted text of the chunk it came from
// (AN-13) before it is kept. An item whose citation does not hold up is dropped rather than kept
// as an unverifiable compliance obligation: a missed obligation is safer than a fabricated one.
const { CHECKLIST_CATEGORIES, createChecklistItem } = require('./checklistItemSchema');
const { validateSource } = require('./sourceCitationValidation');
const { log } = require('./logging');
const { isCalendarDate } = require('./eligibilityBlockers');

const SYSTEM_PROMPT = 'You are extracting compliance checklist obligations from a U.S. federal grant '
    + 'notice for a nonprofit or local government reader. List every distinct obligation the recipient '
    + 'must follow, such as reporting, application materials, submission steps, cost-share requirements, '
    + 'eligibility conditions, record retention, and deadlines. Only report an obligation that is '
    + 'explicitly stated in the text you are given. Never guess or infer one that is not stated. Respond '
    + 'with nothing but a single JSON array, no explanation and no markdown formatting.';

const RESPONSE_SHAPE = `[
  {
    "category": "${CHECKLIST_CATEGORIES.join('" | "')}",
    "description": string,
    "dueDate": "YYYY-MM-DD" or null,
    "pageNumber": number,
    "excerpt": string
  }
]`;

function buildPrompt(chunk) {
    const pageText = chunk.pages
        .map((page) => `--- Page ${page.pageNumber} ---\n${page.text}`)
        .join('\n\n');

    return `Here is an excerpt from a grant notice, covering pages ${chunk.startPage} to ${chunk.endPage}:\n\n"""\n${pageText}\n"""\n\n`
        + 'Return a JSON array of every compliance obligation stated in this excerpt, with exactly this '
        + `shape. Use the page markers above to report the correct pageNumber for each one. Return an `
        + `empty array if this excerpt states no obligation:\n\n${RESPONSE_SHAPE}`;
}

// Models occasionally wrap JSON in a code fence, or return an object instead of the requested
// array, despite instructions not to. A chunk whose response can't be read as an array
// contributes nothing, rather than failing the whole document over one bad chunk.
function parseChunkResponse(text) {
    const cleaned = text.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    try {
        const parsed = JSON.parse(cleaned);
        return Array.isArray(parsed) ? parsed : null;
    } catch (err) {
        return null;
    }
}

/**
 * @param {{documentId: number, grantId: string|number, chunks: Array, lowTextPages?: number[], generateText: Function}} args
 *   chunks come from documentChunking.js's chunkPages(). lowTextPages are page numbers
 *   extractionQuality.js (AN-06) flagged as low-text, used to set possiblyAffectedByQualityIssue.
 *   generateText matches Allison's AI adapter's shape: async ({ system, prompt }) => ({ text })
 * @returns {Promise<Array>} items shaped like checklistItemSchema.js's createChecklistItem()
 */
async function generateChecklistItems({
    documentId, grantId, chunks, lowTextPages = [], generateText,
}) {
    const items = [];

    // eslint-disable-next-line no-restricted-syntax
    for (const chunk of chunks) {
        // eslint-disable-next-line no-await-in-loop
        const response = await generateText({ system: SYSTEM_PROMPT, prompt: buildPrompt(chunk) });
        const candidates = parseChunkResponse(response.text);

        if (!candidates) {
            log.warn({ documentId, chunkIndex: chunk.chunkIndex }, 'could not parse AI response for chunk, skipping it');
            // eslint-disable-next-line no-continue
            continue;
        }

        candidates.forEach((candidate) => {
            if (!candidate || !CHECKLIST_CATEGORIES.includes(candidate.category) || !candidate.description) {
                return;
            }

            const source = { documentId, pageNumber: candidate.pageNumber, excerpt: candidate.excerpt };
            const { valid, reason } = validateSource(source, chunk.pages, { expectedDocumentId: documentId });
            if (!valid) {
                log.warn({
                    documentId, chunkIndex: chunk.chunkIndex, category: candidate.category, reason,
                }, 'dropping a checklist item whose citation did not check out against the real page text');
                return;
            }

            const { dueDate } = candidate;
            items.push(createChecklistItem({
                documentId,
                grantId,
                category: candidate.category,
                description: candidate.description,
                found: true,
                sources: [source],
                dueDate: isCalendarDate(dueDate) && !dueDate.startsWith('0000-') ? dueDate : null,
                possiblyAffectedByQualityIssue: lowTextPages.includes(candidate.pageNumber),
            }));
        });
    }

    return items;
}

module.exports = { generateChecklistItems };
