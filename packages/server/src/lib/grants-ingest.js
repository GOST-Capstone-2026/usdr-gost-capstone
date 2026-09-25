const { ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');
const moment = require('moment');

/**
 * receiveNextMessageBatch long-polls an SQS queue for up to 10 messages.
 * @param { import('@aws-sdk/client-sqs').SQSClient } sqs AWS SDK client used to issue commands to the SQS API.
 * @param { string} queueUrl The URL identifying the queue to poll.
 * @returns { Array[import('@aws-sdk/client-sqs').Message] } Received messages, if any.
 */
async function receiveNextMessageBatch(sqs, queueUrl) {
    const resp = await sqs.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        WaitTimeSeconds: 20,
        MaxNumberOfMessages: 10,
    }));

    const messages = (resp && resp.Messages) ? resp.Messages : [];
    if (messages.length === 0) {
        console.log('Empty message batch received from SQS');
    }
    return messages;
}

function mapSourceDataToGrant(source) {
    const grant = {
        // Old defaults/placeholders:
        search_terms: '[in title/desc]+',
        status: 'inbox',
        notes: 'auto-inserted by script',
        reviewer_name: 'none',
        // Data from event:
        grant_id: source.opportunity.id,
        revision_id: source.revision.id,
        grant_number: source.opportunity.number,
        title: source.opportunity.title,
        description: source.opportunity.description,
        agency_code: source.agency ? source.agency.code : undefined,
        cost_sharing: source.cost_sharing_or_matching_requirement ? 'Yes' : 'No',
        opportunity_category: source.opportunity.category.name,
        cfda_list: (source.cfda_numbers || []).join(', '),
        eligibility_codes: (source.eligible_applicants || []).map((it) => it.code).join(' '),
        funding_activity_category_codes: (source.funding_activity?.categories || []).map((it) => it.code).join(' '),
        award_ceiling: source.award && source.award.ceiling ? source.award.ceiling : undefined,
        award_floor: source.award && source.award.floor ? source.award.floor : undefined,
        raw_body_json: source,
        bill: source.bill,
        funding_instrument_codes: (source.funding_instrument_types || []).map((it) => it.code).join(' '),
        grantor_contact_name: source.grantor?.name,
        grantor_contact_phone_number: source.grantor?.phone,
        fiscal_year: source.fiscal_year,
    };

    const { milestones } = source.opportunity;
    grant.open_date = milestones.post_date || milestones.estimated_start_date;
    grant.forecast_creation_date = milestones.forecast_creation_date;
    grant.award_date = milestones.award_date;
    grant.close_date = milestones.close && milestones.close.date
        ? milestones.close.date : '2100-01-01';
    grant.close_date_explanation = milestones?.close?.explanation ?? undefined;
    grant.archive_date = milestones.archive_date;
    const today = moment().startOf('day');
    if (milestones.archive_date && today.isSameOrAfter(moment(milestones.archive_date), 'date')) {
        grant.opportunity_status = 'archived';
    } else if (today.isSameOrAfter(moment(grant.close_date), 'date')) {
        grant.opportunity_status = 'closed';
    } else if (today.isBefore(moment(grant.open_date), 'date')) {
        // should we check for presence of !milestones.estimated_start_date instead?
        // else if (!!milestones.estimated_start_date)
        grant.opportunity_status = 'forecasted';
    } else {
        grant.opportunity_status = 'posted';
    }

    return grant;
}

// trims, drops blanks and dedupes so we don't trip the (grant_id, code) primary key
function uniqueCodes(values) {
    return [...new Set(values.map((it) => String(it ?? '').trim()).filter((it) => it !== ''))];
}

/**
 * Pulls the list fields out of a source opportunity, keyed by the table they get saved to.
 * @param { object } source The opportunity data from a grants-ingest event.
 * @returns { Record<string, string[]> }
 */
function mapSourceDataToCodes(source) {
    return {
        grants_cfda_numbers: uniqueCodes(source.cfda_numbers || []),
        grants_eligibility_codes: uniqueCodes((source.eligible_applicants || []).map((it) => it.code)),
        grants_funding_instrument_codes: uniqueCodes((source.funding_instrument_types || []).map((it) => it.code)),
        grants_funding_activity_category_codes: uniqueCodes(
            (source.funding_activity?.categories || []).map((it) => it.code),
        ),
    };
}

/**
 * Inserts a grant record into the database, or updates an exist record with the same grant_id value,
 * along with its normalized code rows.
 *
 * So as to prevent writes from events received out-of-order, updates will only occur when
 * the revision_id value of the incoming grant object is greater than that of the extant
 * database record, or when the extant record has no revision_id. Re-processing the same
 * revision is a no-op, so redelivered SQS messages are safe to handle more than once.
 *
 * Everything runs in one transaction so the grant and its codes can't end up out of sync.
 * The upsert locks the grant row, which also serializes concurrent events for the same grant.
 *
 * @param { import('knex').Knex } knex Database client for persisting grants.
 * @param { object } grant The Grant object to persist
 * @param { Record<string, string[]> } codes Code lists keyed by table name
 * @returns { Promise<boolean> } true if the grant was written, false if it was skipped as stale
 */
async function upsertGrant(knex, grant, codes = {}) {
    return knex.transaction(async (trx) => {
        const written = await trx('grants')
            .insert(grant)
            .onConflict('grant_id')
            .merge({ ...grant, ...{ updated_at: 'now' } })
            .where('grants.revision_id', '<', grant.revision_id)
            .orWhereNull('grants.revision_id')
            .returning('grant_id');

        // nothing came back = same or older revision, so leave the existing codes alone
        if (!written || written.length === 0) {
            return false;
        }

        for (const [tableName, values] of Object.entries(codes)) {
            // replace instead of diffing, the lists are tiny
            // eslint-disable-next-line no-await-in-loop
            await trx(tableName).where({ grant_id: grant.grant_id }).del();
            if (values.length > 0) {
                // eslint-disable-next-line no-await-in-loop
                await trx(tableName).insert(values.map((code) => ({ grant_id: grant.grant_id, code })));
            }
        }
        return true;
    });
}

async function deleteMessage(sqs, queueUrl, receiptHandle) {
    const command = new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
    });
    await sqs.send(command);
}

/**
 * processMessages Saves a batch of SQS messages containing JSON grant data sent
 * from the grants-ingest service to the database. Existing database records that match
 * a message's grant identifier are updated. After each message is processed, it is
 * deleted from the SQS queue.
 *
 * Any errors related to parsing or saving are logged and do not prevent further processing.
 * Errors interacting with SQS are fatal.
 *
 * @param { import('knex').Knex } knex Database client for persisting grants.
 * @param { import('@aws-sdk/client-sqs').SQSClient } sqs AWS SDK client used to issue commands to the SQS API.
 * @param { string } queueUrl The URL identifying the queue to poll.
 * @param { Array[import('@aws-sdk/client-sqs').Message] } messages Messages to process from SQS.
 */
async function processMessages(knex, sqs, queueUrl, messages) {
    let grantParseErrorCount = 0;
    let grantSaveSuccessCount = 0;
    let grantSkippedCount = 0;
    let grantSaveErrorCount = 0;
    let grantDeletionCount = 0;

    return Promise.all(messages.map(async (message) => {
        console.log('Processing message:', message.Body);

        let modificationEvent;
        try {
            modificationEvent = JSON.parse(message.Body).detail;
        } catch (e) {
            grantParseErrorCount += 1;
            console.error('Error parsing event data from SQS message:', e);
            return;
        }

        if (modificationEvent.type === 'delete') {
            grantDeletionCount += 1;
            const { opportunity } = modificationEvent.versions.previous;
            console.warn(`Received deletion event for Opportunity ID ${opportunity.id}`);
            return;
        }

        let grant;
        let codes;
        try {
            grant = mapSourceDataToGrant(modificationEvent.versions.new);
            codes = mapSourceDataToCodes(modificationEvent.versions.new);
        } catch (e) {
            grantParseErrorCount += 1;
            console.error('Error mapping data from grant modification event:', e);
            return;
        }

        try {
            const written = await upsertGrant(knex, grant, codes);
            if (written) {
                grantSaveSuccessCount += 1;
            } else {
                // stale or duplicate event, still fine to delete the message
                grantSkippedCount += 1;
            }
        } catch (e) {
            grantSaveErrorCount += 1;
            console.error(`Error on insert/update row with grant_id ${grant.grant_id}:`, e);
            return;
        }

        try {
            await deleteMessage(sqs, queueUrl, message.ReceiptHandle);
        } catch (e) {
            console.log(
                `Error deleting SQS message with receipt handle ${message.ReceiptHandle} `,
                `for grant ${grant.grant_id}`,
            );
            throw e;
        }

        console.log(`Processing completed successfully for grant ${grant.grant_id}`);
    })).then(() => {
        console.log(
            'Finished processing messages with the following results: ',
            `Grants Saved Successfully: ${grantSaveSuccessCount}`,
            `| Skipped (Stale/Duplicate): ${grantSkippedCount}`,
            `| Parsing Errors: ${grantParseErrorCount}`,
            `| Postgres Errors: ${grantSaveErrorCount}`,
            `| Unhandled Deletion Events: ${grantDeletionCount}`,
        );
    });
}

module.exports = {
    processMessages,
    receiveNextMessageBatch,
};
