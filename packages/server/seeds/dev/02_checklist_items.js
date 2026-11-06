const { createHash } = require('crypto');
const moment = require('moment');

const agencies = require('./ref/agencies');
const users = require('./ref/users');

const usdrAgency = agencies.find((a) => a.abbreviation === 'USDR');
const seedUser = users.find((u) => u.agency_id === usdrAgency.id);

const SEED_DOCUMENT_SHA256 = createHash('sha256').update('g32-seed-sample-grant-notice').digest('hex');

const dstr = (mdate) => (mdate ? mdate.format('YYYY-MM-DD') : null);

const seedDocument = {
    agency_id: usdrAgency.id,
    grant_id: '335255',
    uploaded_by: seedUser.id,
    filename: 'seed-sample-grant-notice.pdf',
    mime_type: 'application/pdf',
    size_bytes: 0,
    sha256: SEED_DOCUMENT_SHA256,
    page_count: 30,
    extraction_quality: 'readable',
    storage_bucket: 'grant-documents',
    storage_key: `${usdrAgency.id}/${SEED_DOCUMENT_SHA256}-seed-sample-grant-notice.pdf`,
};

const checklistItems = [
    {
        category: 'reporting',
        description: 'Submit quarterly financial status report',
        due_date: dstr(moment().subtract(10, 'days')),
        completion_status: 'notStarted',
        completed_at: null,
        verification_status: 'verified',
        verified_by: seedUser.id,
        verified_at: moment().subtract(5, 'days').toDate(),
        is_user_edited: false,
        source: {
            pageNumber: 12,
            excerpt: 'Recipients must submit a quarterly Federal Financial Report (SF-425) no later than 30 calendar days after the end of each calendar quarter.',
        },
    },
    {
        category: 'submission',
        description: 'Submit updated subrecipient monitoring plan',
        due_date: dstr(moment().add(2, 'days')),
        completion_status: 'notStarted',
        completed_at: null,
        verification_status: 'unverified',
        verified_by: null,
        verified_at: null,
        is_user_edited: false,
        source: {
            pageNumber: 18,
            excerpt: 'An updated subrecipient monitoring plan must be submitted to the program office for review prior to issuing any new subawards.',
        },
    },
    {
        category: 'reporting',
        description: 'Complete annual performance report',
        due_date: dstr(moment().add(3, 'weeks')),
        completion_status: 'notStarted',
        completed_at: null,
        verification_status: 'verified',
        verified_by: seedUser.id,
        verified_at: moment().subtract(1, 'days').toDate(),
        is_user_edited: false,
        source: {
            pageNumber: 14,
            excerpt: 'The recipient shall submit an annual performance report describing progress toward each approved project objective.',
        },
    },
    {
        category: 'reporting',
        description: 'Submit close-out financial report',
        due_date: dstr(moment().subtract(20, 'days')),
        completion_status: 'completed',
        completed_at: moment().subtract(18, 'days').toDate(),
        verification_status: 'verified',
        verified_by: seedUser.id,
        verified_at: moment().subtract(18, 'days').toDate(),
        is_user_edited: true,
        source: {
            pageNumber: 22,
            excerpt: 'All final financial reports must be submitted within 120 calendar days after the end of the period of performance.',
        },
    },
    {
        category: 'submission',
        description: 'Submit annual audit certification',
        due_date: dstr(moment().subtract(15, 'days')),
        completion_status: 'completed',
        completed_at: moment().subtract(17, 'days').toDate(),
        verification_status: 'verified',
        verified_by: seedUser.id,
        verified_at: moment().subtract(16, 'days').toDate(),
        is_user_edited: false,
        source: {
            pageNumber: 25,
            excerpt: 'Recipients that expend $1,000,000 or more in federal awards during the fiscal year must certify completion of a single audit.',
        },
    },
    {
        category: 'other',
        description: 'Complete civil rights compliance self-assessment',
        due_date: dstr(moment().add(10, 'days')),
        completion_status: 'notStarted',
        completed_at: null,
        verification_status: 'unverified',
        verified_by: null,
        verified_at: null,
        is_user_edited: false,
        source: null,
    },
    {
        category: 'recordRetention',
        description: 'Maintain records supporting ongoing grant obligations',
        due_date: null,
        completion_status: 'notStarted',
        completed_at: null,
        verification_status: 'unverified',
        verified_by: null,
        verified_at: null,
        is_user_edited: false,
        source: {
            pageNumber: 27,
            excerpt: 'Financial records, supporting documents, and all other records pertinent to the award must be retained for three years from the date of submission of the final expenditure report.',
        },
    },
];

exports.seed = async (knex) => {
    await knex('grant_documents').where({ sha256: SEED_DOCUMENT_SHA256 }).del();

    const [document] = await knex('grant_documents').insert(seedDocument).returning('id');

    await knex('checklist_items').insert(checklistItems.map(({ source, ...item }) => ({
        ...item,
        document_id: document.id,
        found: source !== null,
        sources: JSON.stringify(source ? [{ documentId: document.id, ...source }] : []),
    })));
};
