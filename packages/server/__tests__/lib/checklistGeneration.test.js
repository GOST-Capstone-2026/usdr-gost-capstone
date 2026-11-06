const { expect } = require('chai');
const { generateChecklistItems } = require('../../src/lib/checklistGeneration');

function chunk(chunkIndex, pages) {
    return {
        chunkIndex, startPage: pages[0].pageNumber, endPage: pages[pages.length - 1].pageNumber, pages,
    };
}

function fakeAi(responsesByChunkIndex) {
    let callIndex = 0;
    return async () => {
        const text = responsesByChunkIndex[callIndex];
        callIndex += 1;
        return { text };
    };
}

describe('generateChecklistItems', () => {
    it('builds a checklist item from an obligation the AI finds, with a validated citation', async () => {
        const chunks = [chunk(0, [{ pageNumber: 1, text: 'Quarterly performance reports are due within 30 days after each quarter.' }])];
        const generateText = fakeAi([JSON.stringify([{
            category: 'reporting',
            description: 'Submit quarterly performance reports within 30 days after each quarter.',
            dueDate: null,
            pageNumber: 1,
            excerpt: 'Quarterly performance reports are due within 30 days',
        }])]);

        const items = await generateChecklistItems({
            documentId: 27, grantId: '335255', chunks, generateText,
        });

        expect(items).to.have.length(1);
        expect(items[0]).to.include({
            documentId: 27, category: 'reporting', found: true, dueDate: null, possiblyAffectedByQualityIssue: false,
        });
        expect(items[0].sources).to.deep.equal([
            { documentId: 27, pageNumber: 1, excerpt: 'Quarterly performance reports are due within 30 days' },
        ]);
    });

    it('collects obligations from every chunk, not just the first', async () => {
        const chunks = [
            chunk(0, [{ pageNumber: 1, text: 'A 10% local cost share is required.' }]),
            chunk(1, [{ pageNumber: 5, text: 'Records must be retained for three years after closeout.' }]),
        ];
        const generateText = fakeAi([
            JSON.stringify([{
                category: 'costShare', description: 'Provide a 10% local cost share.', dueDate: null, pageNumber: 1, excerpt: 'A 10% local cost share is required.',
            }]),
            JSON.stringify([{
                category: 'recordRetention', description: 'Retain records for three years after closeout.', dueDate: null, pageNumber: 5, excerpt: 'Records must be retained for three years',
            }]),
        ]);

        const items = await generateChecklistItems({
            documentId: 27, grantId: '335255', chunks, generateText,
        });

        expect(items).to.have.length(2);
        expect(items.map((i) => i.category)).to.deep.equal(['costShare', 'recordRetention']);
    });

    it('drops an item whose citation does not actually appear on the cited page', async () => {
        const chunks = [chunk(0, [{ pageNumber: 1, text: 'This page says nothing about reporting.' }])];
        const generateText = fakeAi([JSON.stringify([{
            category: 'reporting', description: 'A hallucinated obligation.', dueDate: null, pageNumber: 1, excerpt: 'Text that was never actually on this page.',
        }])]);

        const items = await generateChecklistItems({
            documentId: 27, grantId: '335255', chunks, generateText,
        });

        expect(items).to.deep.equal([]);
    });

    it('drops an item with a category outside the contract', async () => {
        const chunks = [chunk(0, [{ pageNumber: 1, text: 'Submit the attached form.' }])];
        const generateText = fakeAi([JSON.stringify([{
            category: 'notARealCategory', description: 'Submit the attached form.', dueDate: null, pageNumber: 1, excerpt: 'Submit the attached form.',
        }])]);

        const items = await generateChecklistItems({
            documentId: 27, grantId: '335255', chunks, generateText,
        });

        expect(items).to.deep.equal([]);
    });

    it('drops an item with no description', async () => {
        const chunks = [chunk(0, [{ pageNumber: 1, text: 'Submit the attached form.' }])];
        const generateText = fakeAi([JSON.stringify([{
            category: 'submission', description: '', dueDate: null, pageNumber: 1, excerpt: 'Submit the attached form.',
        }])]);

        const items = await generateChecklistItems({
            documentId: 27, grantId: '335255', chunks, generateText,
        });

        expect(items).to.deep.equal([]);
    });

    it('keeps a due date when the AI reports one', async () => {
        const chunks = [chunk(0, [{ pageNumber: 3, text: 'Applications are due by December 31, 2026.' }])];
        const generateText = fakeAi([JSON.stringify([{
            category: 'deadline', description: 'Submit the application.', dueDate: '2026-12-31', pageNumber: 3, excerpt: 'Applications are due by December 31',
        }])]);

        const items = await generateChecklistItems({
            documentId: 27, grantId: '335255', chunks, generateText,
        });

        expect(items[0].dueDate).to.equal('2026-12-31');
    });

    it('marks an item possibly affected by a quality issue when its page was flagged low-text', async () => {
        const chunks = [chunk(0, [{ pageNumber: 9, text: 'Submit the signature page.' }])];
        const generateText = fakeAi([JSON.stringify([{
            category: 'submission', description: 'Submit the signature page.', dueDate: null, pageNumber: 9, excerpt: 'Submit the signature page.',
        }])]);

        const items = await generateChecklistItems({
            documentId: 27, grantId: '335255', chunks, lowTextPages: [9], generateText,
        });

        expect(items[0].possiblyAffectedByQualityIssue).to.equal(true);
    });

    it('skips a chunk whose response is not valid JSON instead of failing the whole document', async () => {
        const chunks = [
            chunk(0, [{ pageNumber: 1, text: 'nothing useful here' }]),
            chunk(1, [{ pageNumber: 2, text: 'Submit the attached form.' }]),
        ];
        const generateText = fakeAi([
            'not json at all',
            JSON.stringify([{
                category: 'submission', description: 'Submit the attached form.', dueDate: null, pageNumber: 2, excerpt: 'Submit the attached form.',
            }]),
        ]);

        const items = await generateChecklistItems({
            documentId: 27, grantId: '335255', chunks, generateText,
        });

        expect(items).to.have.length(1);
        expect(items[0].category).to.equal('submission');
    });

    it('skips a chunk whose response is a JSON object instead of the requested array', async () => {
        const chunks = [chunk(0, [{ pageNumber: 1, text: 'Submit the attached form.' }])];
        const generateText = fakeAi([JSON.stringify({ category: 'submission', description: 'not an array' })]);

        const items = await generateChecklistItems({
            documentId: 27, grantId: '335255', chunks, generateText,
        });

        expect(items).to.deep.equal([]);
    });

    it('strips a markdown code fence before parsing', async () => {
        const chunks = [chunk(0, [{ pageNumber: 1, text: 'Submit the attached form.' }])];
        const generateText = fakeAi([
            `\`\`\`json\n${JSON.stringify([{
                category: 'submission', description: 'Submit the attached form.', dueDate: null, pageNumber: 1, excerpt: 'Submit the attached form.',
            }])}\n\`\`\``,
        ]);

        const items = await generateChecklistItems({
            documentId: 27, grantId: '335255', chunks, generateText,
        });

        expect(items).to.have.length(1);
    });

    it('returns no items for a document with no chunks', async () => {
        const generateText = async () => { throw new Error('should not be called'); };
        const items = await generateChecklistItems({
            documentId: 27, grantId: '335255', chunks: [], generateText,
        });
        expect(items).to.deep.equal([]);
    });

    it('returns no items when a chunk names no obligation', async () => {
        const chunks = [chunk(0, [{ pageNumber: 1, text: 'This page is background information only.' }])];
        const generateText = fakeAi([JSON.stringify([])]);

        const items = await generateChecklistItems({
            documentId: 27, grantId: '335255', chunks, generateText,
        });

        expect(items).to.deep.equal([]);
    });
});
