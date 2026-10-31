const moment = require('moment');

const agencies = require('./ref/agencies');

const usdrAgency = agencies.find((a) => a.abbreviation === 'USDR');

const dstr = (mdate) => (mdate ? mdate.format('YYYY-MM-DD') : null);

const checklistItems = [
    {
        agency_id: usdrAgency.id,
        category: 'Financial Reporting',
        description: 'Submit quarterly financial status report',
        due_date: dstr(moment().subtract(10, 'days')),
        completion_status: 'notStarted',
        completed_at: null,
        verification_status: 'verified',
        verified_by: 1,
        verified_at: moment().subtract(5, 'days').toDate(),
        is_user_edited: false,
        source_page_number: 12,
        source_excerpt: 'Recipients must submit a quarterly Federal Financial Report (SF-425) no later than 30 calendar days after the end of each calendar quarter.',
    },
    {
        agency_id: usdrAgency.id,
        category: 'Compliance',
        description: 'Submit updated subrecipient monitoring plan',
        due_date: dstr(moment().add(2, 'days')),
        completion_status: 'notStarted',
        completed_at: null,
        verification_status: 'unverified',
        verified_by: null,
        verified_at: null,
        is_user_edited: false,
        source_page_number: 18,
        source_excerpt: 'An updated subrecipient monitoring plan must be submitted to the program office for review prior to issuing any new subawards.',
    },
    {
        agency_id: usdrAgency.id,
        category: 'Programmatic',
        description: 'Complete annual performance report',
        due_date: dstr(moment().add(3, 'weeks')),
        completion_status: 'notStarted',
        completed_at: null,
        verification_status: 'verified',
        verified_by: 1,
        verified_at: moment().subtract(1, 'days').toDate(),
        is_user_edited: false,
        source_page_number: 14,
        source_excerpt: 'The recipient shall submit an annual performance report describing progress toward each approved project objective.',
    },
    {
        agency_id: usdrAgency.id,
        category: 'Financial Reporting',
        description: 'Submit close-out financial report',
        due_date: dstr(moment().subtract(20, 'days')),
        completion_status: 'completed',
        completed_at: moment().subtract(18, 'days').toDate(),
        verification_status: 'verified',
        verified_by: 1,
        verified_at: moment().subtract(18, 'days').toDate(),
        is_user_edited: true,
        source_page_number: 22,
        source_excerpt: 'All final financial reports must be submitted within 120 calendar days after the end of the period of performance.',
    },
    {
        agency_id: usdrAgency.id,
        category: 'Compliance',
        description: 'Submit annual audit certification',
        due_date: dstr(moment().subtract(15, 'days')),
        completion_status: 'completed',
        completed_at: moment().subtract(17, 'days').toDate(),
        verification_status: 'verified',
        verified_by: 1,
        verified_at: moment().subtract(16, 'days').toDate(),
        is_user_edited: false,
        source_page_number: 25,
        source_excerpt: 'Recipients that expend $1,000,000 or more in federal awards during the fiscal year must certify completion of a single audit.',
    },
    {
        agency_id: usdrAgency.id,
        category: 'Compliance',
        description: 'Complete civil rights compliance self-assessment',
        due_date: dstr(moment().add(10, 'days')),
        completion_status: 'notStarted',
        completed_at: null,
        verification_status: 'unverified',
        verified_by: null,
        verified_at: null,
        is_user_edited: false,
        source_page_number: null,
        source_excerpt: null,
    },
    {
        agency_id: usdrAgency.id,
        category: 'Programmatic',
        description: 'Maintain records supporting ongoing grant obligations',
        due_date: null,
        completion_status: 'notStarted',
        completed_at: null,
        verification_status: 'unverified',
        verified_by: null,
        verified_at: null,
        is_user_edited: false,
        source_page_number: 27,
        source_excerpt: 'Financial records, supporting documents, and all other records pertinent to the award must be retained for three years from the date of submission of the final expenditure report.',
    },
];

exports.seed = async (knex) => {
    await knex('checklist_items_placeholder').del();

    await knex('checklist_items_placeholder').insert(checklistItems);
};
