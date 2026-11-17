// A-16: checking that ai briefs (AN-10) and checklist items (AN-14) stick to the notice
// all automatic, no ai call. each fact needs a real quote from its page, and dates/amounts have to match it
const { BRIEF_FIELD_NAMES, computeNotFoundFields } = require('./grantBriefSchema');

const CHECKS = {
    FOUND_HAS_SOURCE: 'every fact marked found cites at least one page number and excerpt',
    NOT_FOUND_IS_EMPTY: 'a field marked not found has no value and no sources',
    PAGE_EXISTS: 'every cited page number is a real page of the document',
    EXCERPT_ON_PAGE: 'every excerpt is real text from the page it cites (spacing and quote marks ignored)',
    DATE_VALID: 'every date is a real YYYY-MM-DD calendar date',
    DATE_SUPPORTED: 'every date appears in its own excerpt',
    AMOUNT_VALID: 'funding amounts are whole, non-negative cents and the minimum is not above the maximum',
    AMOUNT_SUPPORTED: 'every non-zero funding amount appears in its own excerpt',
    NOT_FOUND_LIST_MATCHES: 'notFoundFields lists exactly the fields that are empty',
    CATEGORY_VALID: 'every checklist item uses one of the contract categories',
    MARKED_UNVERIFIED: 'nothing ai-generated is marked verified before a person checks it',
};

const CHECKLIST_CATEGORIES = [
    'eligibility', 'applicationMaterial', 'submission', 'costShare', 'reporting', 'recordRetention', 'deadline', 'other',
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// normalizing spacing, curly quotes, dashes and case
function normalize(text) {
    return String(text || '')
        .replace(/[‘’]/g, '\'')
        .replace(/[“”]/g, '"')
        .replace(/[–—]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

// excerpts can skip text with "...", so each piece has to be on the page in order
function excerptOnPage(excerpt, pageText) {
    const page = normalize(pageText);
    const pieces = normalize(excerpt).split(/\s*(?:\.\.\.|…)\s*/).filter(Boolean);
    if (!pieces.length) return false;
    let from = 0;
    return pieces.every((piece) => {
        const at = page.indexOf(piece, from);
        if (at === -1) return false;
        from = at + piece.length;
        return true;
    });
}

function isCalendarDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// date formats a notice might use ("November 16, 2026", "11/16/2026", ...)
function dateInText(value, text) {
    const [y, m, d] = value.split('-').map(Number);
    const month = MONTHS[m - 1];
    const short = month.slice(0, 3);
    const t = normalize(text).replace(/(\d)(st|nd|rd|th)\b/g, '$1');
    const forms = [
        value,
        `${month} ${d}, ${y}`, `${month} ${d} ${y}`, `${d} ${month} ${y}`,
        `${short} ${d}, ${y}`, `${short}. ${d}, ${y}`, `${short} ${d} ${y}`, `${d} ${short} ${y}`,
        `${m}/${d}/${y}`, `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`,
    ];
    return forms.some((f) => t.includes(f.toLowerCase()));
}

// pulling every dollar amount out of the text ("$80,000,000", "$80 million", "$1.5M")
function amountsInText(text) {
    const scale = {
        thousand: 1e3, k: 1e3, million: 1e6, m: 1e6, mil: 1e6, billion: 1e9, b: 1e9, bn: 1e9,
    };
    const found = [];
    const re = /\$?\s?(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|mil|bn|k|m|b)?\b/gi;
    let match = re.exec(String(text || ''));
    while (match) {
        const base = Number(match[1].replace(/,/g, ''));
        const mult = match[2] ? scale[match[2].toLowerCase()] : 1;
        if (Number.isFinite(base)) found.push(Math.round(base * mult * 100));
        match = re.exec(String(text || ''));
    }
    return found;
}

function excerptsOf(sources) {
    return (sources || []).map((s) => s.excerpt || '').join(' ');
}

// source checks shared by every found fact
function checkSources(fact, pagesByNumber, fail) {
    const sources = Array.isArray(fact.sources) ? fact.sources : [];
    if (fact.found) {
        if (!sources.length || sources.some((s) => !s || !s.pageNumber || !s.excerpt)) fail('FOUND_HAS_SOURCE');
    }
    sources.forEach((s) => {
        if (!s || !s.pageNumber) return;
        const page = pagesByNumber.get(Number(s.pageNumber));
        if (!page) {
            fail('PAGE_EXISTS');
            return;
        }
        if (s.excerpt && !excerptOnPage(s.excerpt, page.text)) fail('EXCERPT_ON_PAGE');
    });
}

function checkNotFound(fact, fail, valueKeys) {
    if (fact.found) return;
    const hasValue = valueKeys.some((k) => fact[k] !== null && fact[k] !== undefined);
    if (hasValue || (fact.sources && fact.sources.length)) fail('NOT_FOUND_IS_EMPTY');
}

function checkDate(value, sources, fail) {
    if (!isCalendarDate(value)) {
        fail('DATE_VALID');
        return;
    }
    if (!dateInText(value, excerptsOf(sources))) fail('DATE_SUPPORTED');
}

// checking one brief against its extracted pages, one entry per problem
function checkBrief(brief, pages) {
    const problems = [];
    const pagesByNumber = new Map((pages || []).map((p) => [Number(p.pageNumber), p]));
    const seen = new Set();
    const failFor = (field, index) => (code) => {
        const key = `${field}|${index}|${code}`;
        if (!seen.has(key)) {
            seen.add(key);
            problems.push({ field, index, code });
        }
    };

    // single facts
    const purpose = brief.purpose || {};
    checkSources(purpose, pagesByNumber, failFor('purpose', null));
    checkNotFound(purpose, failFor('purpose', null), ['value']);

    const funding = brief.fundingRange || {};
    const failFunding = failFor('fundingRange', null);
    checkSources(funding, pagesByNumber, failFunding);
    checkNotFound(funding, failFunding, ['minimumAmountCents', 'maximumAmountCents']);
    if (funding.found) {
        const { minimumAmountCents: min, maximumAmountCents: max } = funding;
        const bad = [min, max].some((v) => v !== null && v !== undefined && (!Number.isInteger(v) || v < 0));
        if (bad || (Number.isInteger(min) && Number.isInteger(max) && min > max)) failFunding('AMOUNT_VALID');
        const written = amountsInText(excerptsOf(funding.sources));
        [min, max].filter((v) => Number.isInteger(v) && v > 0).forEach((v) => {
            if (!written.includes(v)) failFunding('AMOUNT_SUPPORTED');
        });
    }

    const cost = brief.costShare || {};
    checkSources(cost, pagesByNumber, failFor('costShare', null));
    if (!cost.found && ((cost.sources && cost.sources.length) || cost.required !== null)) failFor('costShare', null)('NOT_FOUND_IS_EMPTY');

    // list facts
    ['eligibility', 'keyRequirements', 'keyDates'].forEach((field) => {
        (Array.isArray(brief[field]) ? brief[field] : []).forEach((fact, i) => {
            const fail = failFor(field, i);
            checkSources(fact || {}, pagesByNumber, fail);
            if (field === 'keyDates') checkDate(fact && fact.date, fact && fact.sources, fail);
        });
    });

    const expected = computeNotFoundFields(brief);
    const listed = Array.isArray(brief.notFoundFields) ? brief.notFoundFields : [];
    if (expected.length !== listed.length || expected.some((f) => !listed.includes(f))) {
        failFor('notFoundFields', null)('NOT_FOUND_LIST_MATCHES');
    }
    if (brief.verificationStatus !== 'unverified') failFor('brief', null)('MARKED_UNVERIFIED');
    return problems;
}

// checking checklist items (generated or read back from the api) against the pages
function checkChecklistItems(items, pages) {
    const problems = [];
    const pagesByNumber = new Map((pages || []).map((p) => [Number(p.pageNumber), p]));
    (items || []).forEach((item, i) => {
        const seen = new Set();
        const fail = (code) => {
            if (!seen.has(code)) {
                seen.add(code);
                problems.push({ field: 'checklist', index: i, code });
            }
        };
        if (!CHECKLIST_CATEGORIES.includes(item.category)) fail('CATEGORY_VALID');
        checkSources(item, pagesByNumber, fail);
        if (!item.found && item.sources && item.sources.length) fail('NOT_FOUND_IS_EMPTY');
        if (item.dueDate !== null && item.dueDate !== undefined) checkDate(item.dueDate, item.sources, fail);
        // read-back items may already be verified by a person, so only flagging verified with no reviewer
        if (item.verificationStatus === 'verified' && !item.verifiedBy) fail('MARKED_UNVERIFIED');
    });
    return problems;
}

// flattening every fact in a brief so they can be counted
function listBriefFacts(brief) {
    const facts = [];
    ['purpose', 'fundingRange', 'costShare'].forEach((field) => {
        if (brief[field] && brief[field].found) facts.push({ field, index: null });
    });
    ['eligibility', 'keyRequirements', 'keyDates'].forEach((field) => {
        (brief[field] || []).forEach((f, i) => { if (f && f.found !== false) facts.push({ field, index: i }); });
    });
    return facts;
}

// grading a brief against the answer key, skipping fields set to null in the key
function compareBriefToGold(brief, gold) {
    const out = [];
    const grade = (field, expectedPresent, found, valueOk) => {
        let outcome;
        if (expectedPresent && !found) outcome = 'missed';
        else if (!expectedPresent && found) outcome = 'invented';
        else if (!expectedPresent) outcome = 'correctlyEmpty';
        else outcome = valueOk ? 'correct' : 'wrong';
        out.push({ field, outcome });
    };

    if (typeof gold.purpose === 'boolean') grade('purpose', gold.purpose, !!(brief.purpose && brief.purpose.found), true);
    if (typeof gold.eligibility === 'boolean') grade('eligibility', gold.eligibility, (brief.eligibility || []).length > 0, true);

    if (gold.fundingRange !== null && gold.fundingRange !== undefined) {
        const f = brief.fundingRange || {};
        const g = gold.fundingRange;
        const ok = !g || (
            (g.maximumAmountCents === undefined || f.maximumAmountCents === g.maximumAmountCents)
            && (g.minimumAmountCents === undefined || (g.minimumAmountCents === null
                ? !f.minimumAmountCents : f.minimumAmountCents === g.minimumAmountCents))
        );
        grade('fundingRange', !!g, !!f.found, ok);
    }

    if (gold.costShare !== null && gold.costShare !== undefined) {
        const c = brief.costShare || {};
        const g = gold.costShare;
        grade('costShare', !!g, !!c.found, !g || g.required === undefined || c.required === g.required);
    }

    // each expected date is its own item, extra dates count as invented
    if (Array.isArray(gold.keyDates)) {
        const got = (brief.keyDates || []).map((d) => d.date);
        gold.keyDates.forEach((g) => out.push({ field: 'keyDates', outcome: got.includes(g.date) ? 'correct' : 'missed' }));
        const wanted = gold.keyDates.map((g) => g.date);
        const allowed = wanted.concat(gold.otherAllowedDates || []);
        got.filter((d) => !allowed.includes(d)).forEach(() => out.push({ field: 'keyDates', outcome: 'invented' }));
    }
    return out;
}

module.exports = {
    BRIEF_FIELD_NAMES,
    CHECKLIST_CATEGORIES,
    CHECKS,
    amountsInText,
    checkBrief,
    checkChecklistItems,
    compareBriefToGold,
    dateInText,
    excerptOnPage,
    isCalendarDate,
    listBriefFacts,
};
