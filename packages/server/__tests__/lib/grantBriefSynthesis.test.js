const { expect } = require('chai');
const { synthesizeGrantBrief } = require('../../src/lib/grantBriefSynthesis');

function chunk(chunkIndex, startPage, endPage) {
    return {
        chunkIndex, startPage, endPage, pages: [{ pageNumber: startPage, text: 'placeholder' }],
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

describe('synthesizeGrantBrief', () => {
    it('takes the first chunk that finds a one-time fact and ignores a later duplicate claim', async () => {
        const chunks = [chunk(0, 1, 2), chunk(1, 3, 4)];
        const generateText = fakeAi([
            JSON.stringify({
                purpose: {
                    found: true, value: 'Supports stormwater projects.', pageNumber: 1, excerpt: 'The program supports...',
                },
            }),
            JSON.stringify({
                purpose: {
                    found: true, value: 'A different, wrong answer.', pageNumber: 3, excerpt: 'Something else...',
                },
            }),
        ]);

        const brief = await synthesizeGrantBrief({
            documentId: 27, runId: 5, chunks, generateText,
        });

        expect(brief.purpose).to.deep.equal({
            found: true,
            value: 'Supports stormwater projects.',
            sources: [{ documentId: 27, pageNumber: 1, excerpt: 'The program supports...' }],
        });
    });

    it('collects list facts from every chunk that finds any, not just the first', async () => {
        const chunks = [chunk(0, 1, 2), chunk(1, 3, 4)];
        const generateText = fakeAi([
            JSON.stringify({ eligibility: [{ value: 'Must be a city or county', pageNumber: 2, excerpt: 'Eligible applicants...' }] }),
            JSON.stringify({ eligibility: [{ value: 'Must serve a rural area', pageNumber: 3, excerpt: 'Rural areas...' }] }),
        ]);

        const brief = await synthesizeGrantBrief({
            documentId: 27, runId: 5, chunks, generateText,
        });

        expect(brief.eligibility).to.have.length(2);
        expect(brief.eligibility.map((e) => e.value)).to.deep.equal(['Must be a city or county', 'Must serve a rural area']);
    });

    it('collects key dates with their label and date from multiple chunks', async () => {
        const chunks = [chunk(0, 1, 2), chunk(1, 3, 4)];
        const generateText = fakeAi([
            JSON.stringify({
                keyDates: [{
                    label: 'Application deadline', date: '2026-12-31', pageNumber: 2, excerpt: 'Applications due...',
                }],
            }),
            JSON.stringify({ keyDates: [] }),
        ]);

        const brief = await synthesizeGrantBrief({
            documentId: 27, runId: 5, chunks, generateText,
        });

        expect(brief.keyDates).to.deep.equal([{
            found: true,
            label: 'Application deadline',
            date: '2026-12-31',
            sources: [{ documentId: 27, pageNumber: 2, excerpt: 'Applications due...' }],
        }]);
    });

    it('keeps a certification requirement from being listed as grant eligibility', async () => {
        const tribal = {
            value: 'Federally recognized tribal governments',
            pageNumber: 5,
            excerpt: 'Eligible applicants include federally recognized tribal governments.',
        };
        const certificationScope = {
            value: 'Applicant state or local government entities only',
            pageNumber: 14,
            excerpt: 'Certification by the Chief Executive Officer (or senior official) of the Applicant Government: Applicant state or local government entities only—',
        };
        const requirement = {
            value: 'State and local government applicants must submit the certification.',
            pageNumber: 14,
            excerpt: `${certificationScope.excerpt} Upload the certification.`,
        };
        const brief = await synthesizeGrantBrief({
            documentId: 1,
            runId: 4,
            chunks: [chunk(0, 5, 14)],
            generateText: fakeAi([JSON.stringify({
                eligibility: [tribal, certificationScope],
                keyRequirements: [requirement],
            })]),
        });

        expect(brief.eligibility.map((item) => item.value)).to.deep.equal([tribal.value]);
        expect(brief.keyRequirements).to.deep.equal([{
            found: true,
            value: requirement.value,
            sources: [{ documentId: 1, pageNumber: 14, excerpt: requirement.excerpt }],
        }]);
    });

    it('prefers the scoped certification requirement to the blanket checklist entry', async () => {
        const checklistEntry = {
            value: 'Applications must include the certification.',
            pageNumber: 10,
            excerpt: 'Certification by the Chief Executive Officer (or senior official) of the Applicant Government (Appendix 1) *Required*',
        };
        const scopedEntry = {
            value: 'State or local government applicants must submit the Appendix 1 certification.',
            pageNumber: 14,
            excerpt: 'Applicant state or local government entities only—Upload properly executed “Certification by the Chief Executive Officer (or senior official) of the Applicant Government.”',
        };
        const exemption = {
            value: 'Tribal government entities and educational organizations are exempt from the certification.',
            pageNumber: 5,
            excerpt: 'Tribal government entities and educational organizations (e.g., public or state-controlled institutions of higher education) are not required to submit this certification.',
        };
        const timeline = {
            value: 'Include a project timeline.',
            pageNumber: 14,
            excerpt: 'Timeline *Required*',
        };
        const brief = await synthesizeGrantBrief({
            documentId: 1,
            runId: 6,
            chunks: [chunk(0, 5, 10), chunk(1, 14, 14)],
            generateText: fakeAi([
                JSON.stringify({ keyRequirements: [exemption, checklistEntry] }),
                JSON.stringify({ keyRequirements: [scopedEntry, timeline] }),
            ]),
        });

        expect(brief.keyRequirements.map((item) => item.value)).to.deep.equal([exemption.value, scopedEntry.value, timeline.value]);
        expect(brief.keyRequirements[1].sources).to.deep.equal([
            { documentId: 1, pageNumber: 14, excerpt: scopedEntry.excerpt },
        ]);
    });

    it('retains a certification checklist entry when there is no cited scope', async () => {
        const entry = {
            value: 'Applications must include the certification.',
            pageNumber: 10,
            excerpt: 'Certification by the Chief Executive Officer (Appendix 1) *Required*',
        };
        const brief = await synthesizeGrantBrief({
            documentId: 1,
            runId: 6,
            chunks: [chunk(0, 10, 10)],
            generateText: fakeAi([JSON.stringify({ keyRequirements: [entry] })]),
        });

        expect(brief.keyRequirements.map((item) => item.value)).to.deep.equal([entry.value]);
    });

    it('skips a chunk whose response is not valid JSON instead of failing the whole document', async () => {
        const chunks = [chunk(0, 1, 2), chunk(1, 3, 4)];
        const generateText = fakeAi([
            'not json at all',
            JSON.stringify({
                purpose: {
                    found: true, value: 'Found it', pageNumber: 3, excerpt: 'quote',
                },
            }),
        ]);

        const brief = await synthesizeGrantBrief({
            documentId: 27, runId: 5, chunks, generateText,
        });

        expect(brief.purpose.found).to.equal(true);
        expect(brief.purpose.value).to.equal('Found it');
    });

    it('strips a markdown code fence before parsing', async () => {
        const chunks = [chunk(0, 1, 2)];
        const generateText = fakeAi([
            `\`\`\`json\n${JSON.stringify({
                purpose: {
                    found: true, value: 'Fenced', pageNumber: 1, excerpt: 'quote',
                },
            })}\n\`\`\``,
        ]);

        const brief = await synthesizeGrantBrief({
            documentId: 27, runId: 5, chunks, generateText,
        });

        expect(brief.purpose.found).to.equal(true);
        expect(brief.purpose.value).to.equal('Fenced');
    });

    it('lists a field in notFoundFields when no chunk ever finds it', async () => {
        const chunks = [chunk(0, 1, 2)];
        const generateText = fakeAi([JSON.stringify({})]);

        const brief = await synthesizeGrantBrief({
            documentId: 27, runId: 5, chunks, generateText,
        });

        expect(brief.notFoundFields).to.include('costShare');
        expect(brief.costShare.found).to.equal(false);
    });

    it('merges a funding range with its minimum and maximum amounts', async () => {
        const chunks = [chunk(0, 1, 2)];
        const generateText = fakeAi([
            JSON.stringify({
                fundingRange: {
                    found: true, minimumAmountCents: 5000000, maximumAmountCents: 50000000, pageNumber: 2, excerpt: 'Awards range from...',
                },
            }),
        ]);

        const brief = await synthesizeGrantBrief({
            documentId: 27, runId: 5, chunks, generateText,
        });

        expect(brief.fundingRange).to.deep.equal({
            found: true,
            minimumAmountCents: 5000000,
            maximumAmountCents: 50000000,
            currency: 'USD',
            sources: [{ documentId: 27, pageNumber: 2, excerpt: 'Awards range from...' }],
        });
    });

    it('returns an unchanged, fully not-found brief for a document with no chunks', async () => {
        const generateText = async () => { throw new Error('should not be called'); };
        const brief = await synthesizeGrantBrief({
            documentId: 27, runId: 5, chunks: [], generateText,
        });
        expect(brief.notFoundFields).to.have.length(6);
    });
});
