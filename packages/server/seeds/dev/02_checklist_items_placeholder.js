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
        completion_status: 'open',
        verification_status: 'verified',
        verified_by: 1,
        verified_at: moment().subtract(5, 'days').toDate(),
        is_user_edited: false,
    },
    {
        agency_id: usdrAgency.id,
        category: 'Compliance',
        description: 'Submit updated subrecipient monitoring plan',
        due_date: dstr(moment().add(2, 'days')),
        completion_status: 'open',
        verification_status: 'pending',
        verified_by: null,
        verified_at: null,
        is_user_edited: false,
    },
    {
        agency_id: usdrAgency.id,
        category: 'Programmatic',
        description: 'Complete annual performance report',
        due_date: dstr(moment().add(3, 'weeks')),
        completion_status: 'open',
        verification_status: 'verified',
        verified_by: 1,
        verified_at: moment().subtract(1, 'days').toDate(),
        is_user_edited: false,
    },
    {
        agency_id: usdrAgency.id,
        category: 'Financial Reporting',
        description: 'Submit close-out financial report',
        due_date: dstr(moment().subtract(20, 'days')),
        completion_status: 'complete',
        verification_status: 'verified',
        verified_by: 1,
        verified_at: moment().subtract(18, 'days').toDate(),
        is_user_edited: true,
    },
    {
        agency_id: usdrAgency.id,
        category: 'Compliance',
        description: 'Complete civil rights compliance self-assessment',
        due_date: dstr(moment().add(10, 'days')),
        completion_status: 'open',
        verification_status: 'unverified',
        verified_by: null,
        verified_at: null,
        is_user_edited: false,
    },
    {
        agency_id: usdrAgency.id,
        category: 'Programmatic',
        description: 'Maintain records supporting ongoing grant obligations',
        due_date: null,
        completion_status: 'open',
        verification_status: 'unverified',
        verified_by: null,
        verified_at: null,
        is_user_edited: false,
    },
];

exports.seed = async (knex) => {
    await knex('checklist_items_placeholder').del();

    await knex('checklist_items_placeholder').insert(checklistItems);
};
