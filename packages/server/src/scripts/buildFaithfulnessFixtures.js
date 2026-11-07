// building evaluation/faithfulness-fixtures.json for A-16
// each fixture is a short notice from a real grants.gov demo listing (A-09):
// page 1 = listing details, page 2 = description. answers come from the same fields
// plus the real HUD sample pdf (first 2 pages) as a trap document
//
// run inside the container: node src/scripts/buildFaithfulnessFixtures.js
const fs = require('fs');
const path = require('path');
const { extractPages } = require('../lib/pdfTextExtraction');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'evaluation', 'faithfulness-fixtures.json');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// grants.gov date format, e.g. "Nov 16, 2026"
function gg(date) {
    const [y, m, d] = date.split('-').map(Number);
    return `${MONTHS[m - 1]} ${d}, ${y}`;
}

const dollars = (n) => `$${Number(n).toLocaleString('en-US')}`;

// dates mentioned in the description itself, so reporting them isn't counted as invented
function datesInDescription(text) {
    const out = [];
    (text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g) || []).forEach((s) => {
        const [m, d, y] = s.split('/');
        out.push(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
    });
    return out;
}

function listingDocument(listing) {
    const o = listing.opportunity;
    const ms = o.milestones || {};
    const award = listing.award || {};
    const lines = [
        o.title,
        `Opportunity Number: ${o.number}`,
        `Agency: ${listing.agency.name.trim()}`,
        `Posted Date: ${gg(ms.post_date)}`,
        `Close Date for Applications: ${gg(ms.close.date)}`,
    ];
    if (ms.archive_date) lines.push(`Archive Date: ${gg(ms.archive_date)}`);
    lines.push(`Cost Sharing or Matching Requirement: ${listing.cost_sharing_or_matching_requirement ? 'Yes' : 'No'}`);
    if (award.estimated_total_program_funding) lines.push(`Estimated Total Program Funding: ${dollars(award.estimated_total_program_funding)}`);
    if (award.ceiling) lines.push(`Award Ceiling: ${dollars(award.ceiling)}`);
    if (award.floor) lines.push(`Award Floor: ${dollars(award.floor)}`);
    if (award.expected_number_of_awards) lines.push(`Expected Number of Awards: ${award.expected_number_of_awards}`);
    lines.push(`Eligible Applicants: ${listing.eligible_applicants.map((a) => a.name).join('; ')}`);

    const ceiling = Number(award.ceiling || 0);
    const floor = Number(award.floor || 0);
    let fundingRange;
    if (ceiling > 0) {
        // $0 floor = no minimum, so an empty minimum is also correct
        fundingRange = { maximumAmountCents: ceiling * 100, minimumAmountCents: floor > 0 ? floor * 100 : null };
    } else if (award.estimated_total_program_funding) {
        // program total only, no per-award range, so not graded
        fundingRange = null;
    } else {
        fundingRange = false;
    }

    return {
        id: `listing-${o.id}`,
        grantId: o.id,
        source: listing.demo.source_url,
        kind: 'listing',
        pages: [
            { pageNumber: 1, text: lines.join('\n') },
            { pageNumber: 2, text: `Description\n${o.description}` },
        ],
        gold: {
            purpose: true,
            eligibility: true,
            fundingRange,
            costShare: { required: !!listing.cost_sharing_or_matching_requirement },
            keyDates: [{ label: 'application close', date: ms.close.date }],
            otherAllowedDates: [ms.post_date, ms.archive_date, ...datesInDescription(o.description)].filter(Boolean),
        },
    };
}

async function samplePdfDocument() {
    const buffer = fs.readFileSync(path.join(ROOT, '__tests__', 'fixtures', 'an08-sample.pdf'));
    const { pages } = await extractPages(buffer);
    return {
        id: 'hud-pro-housing-sample',
        grantId: null,
        source: 'packages/server/__tests__/fixtures/an08-sample.pdf (first 2 of 107 pages of HUD CPD-2600-DC-0098)',
        kind: 'pdf',
        pages: pages.map((p) => ({ pageNumber: p.pageNumber, text: p.text })),
        // cover + table of contents only. cost sharing and eligible applicants are listed as headings
        // with no details, so a faithful brief leaves them empty
        gold: {
            purpose: null,
            eligibility: false,
            fundingRange: false,
            costShare: false,
            keyDates: [{ label: 'application due', date: '2026-08-03' }],
            otherAllowedDates: [],
        },
    };
}

async function main() {
    const demo = JSON.parse(fs.readFileSync(path.join(ROOT, 'seeds', 'demo', 'opportunities.json'), 'utf8'));
    const documents = demo.opportunities.map(listingDocument);
    documents.push(await samplePdfDocument());
    const fixtures = {
        version: 'faithfulness-v1',
        builtFrom: { listings: `seeds/demo/opportunities.json (fetched ${demo.fetched_on})`, pdf: 'an08-sample.pdf' },
        note: 'null in a gold field = not graded. false = the notice does not say it, so reporting it counts as invented.',
        documents,
    };
    fs.writeFileSync(OUT, `${JSON.stringify(fixtures, null, 2)}\n`);
    console.log(`wrote ${documents.length} documents to ${path.relative(ROOT, OUT)}`);
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = { listingDocument };
