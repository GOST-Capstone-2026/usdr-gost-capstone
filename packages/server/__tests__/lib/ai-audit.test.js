const { expect } = require('chai');
const sinon = require('sinon');
const { AiProviderError, createAiProvider, getAiConfig } = require('../../src/lib/ai-provider');
const {
    buildAuditRecord, generateTextAudited, hashPrompt, listAiAuditRecords,
} = require('../../src/lib/ai-audit');

describe('ai-audit', () => {
    const context = {
        task: 'grant_summary', grantId: '364009', userId: 7, tenantId: 1,
    };
    const okResult = {
        text: 'a short summary',
        provider: 'coecs',
        model: 'gpt-5.6-luna',
        finishReason: 'stop',
        truncated: false,
        usage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 },
    };
    let knexQuery;
    let knex;
    let provider;
    let now;

    beforeEach(() => {
        // fake knex, no db needed. same idea as the grants-ingest tests
        knexQuery = {
            insert: sinon.stub().returnsThis(),
            returning: sinon.stub().resolves([{ id: 42 }]),
        };
        knex = sinon.stub().returns(knexQuery);
        provider = { name: 'coecs', model: 'gpt-5.6-luna', generateText: sinon.stub().resolves(okResult) };
        // clock that jumps 250ms per call so duration is predictable
        const clock = sinon.stub();
        clock.onFirstCall().returns(1000);
        clock.onSecondCall().returns(1250);
        now = clock;
    });

    const savedRecord = () => knexQuery.insert.firstCall.args[0];

    describe('generateTextAudited', () => {
        it('writes a success record with who, what, model and token usage', async () => {
            const result = await generateTextAudited(context, { prompt: 'summarize this grant' }, { knex, provider, now });

            expect(knex.firstCall.args[0]).to.equal('ai_audit_records');
            expect(savedRecord()).to.include({
                task: 'grant_summary',
                grant_id: '364009',
                user_id: 7,
                tenant_id: 1,
                provider: 'coecs',
                model: 'gpt-5.6-luna',
                status: 'success',
                error_code: null,
                finish_reason: 'stop',
                truncated: false,
                duration_ms: 250,
                input_tokens: 12,
                output_tokens: 6,
                total_tokens: 18,
            });
            expect(result.text).to.equal('a short summary');
            expect(result.audit).to.deep.equal({ requestId: savedRecord().request_id, id: 42 });
        });

        it('stores hashes and lengths, never the prompt or output text', async () => {
            const prompt = 'summarize this very private grant note';
            await generateTextAudited(context, { prompt, system: 'be brief' }, { knex, provider, now });

            const record = savedRecord();
            const serialized = JSON.stringify(record);
            expect(serialized).to.not.include(prompt);
            expect(serialized).to.not.include('be brief');
            expect(serialized).to.not.include(okResult.text);
            expect(record.prompt_sha256).to.match(/^[0-9a-f]{64}$/);
            expect(record.output_sha256).to.match(/^[0-9a-f]{64}$/);
            expect(record.prompt_chars).to.equal(prompt.length);
            expect(record.output_chars).to.equal(okResult.text.length);
        });

        it('records a failed call with its error code, then rethrows it', async () => {
            const failure = new AiProviderError('out of budget', { code: 'budget', status: 402, provider: 'coecs' });
            provider.generateText.rejects(failure);

            let thrown;
            try {
                await generateTextAudited(context, { prompt: 'hi' }, { knex, provider, now });
            } catch (err) {
                thrown = err;
            }

            expect(thrown).to.equal(failure);
            expect(savedRecord()).to.include({
                status: 'error', error_code: 'budget', provider: 'coecs', model: 'gpt-5.6-luna', output_sha256: null, total_tokens: null,
            });
        });

        it('still returns the ai result if the audit write itself fails', async () => {
            knexQuery.returning.rejects(new Error('db is down'));

            const result = await generateTextAudited(context, { prompt: 'hi' }, { knex, provider, now });

            expect(result.text).to.equal('a short summary');
            expect(result.audit.id).to.be.null;
        });

        it('records the prompt version when the caller gives one', async () => {
            await generateTextAudited(
                { ...context, promptVersion: 'grant_summary_v1' }, { prompt: 'hi' }, { knex, provider, now },
            );
            expect(savedRecord().prompt_version).to.equal('grant_summary_v1');
        });

        it('leaves prompt version and validation empty when the caller gives neither', async () => {
            await generateTextAudited(context, { prompt: 'hi' }, { knex, provider, now });
            expect(savedRecord()).to.include({ prompt_version: null, validation_status: null });
        });

        it('records "passed" when the output passes the validation check', async () => {
            const validate = sinon.stub().returns(true);
            const result = await generateTextAudited(context, { prompt: 'hi' }, {
                knex, provider, now, validate,
            });

            expect(validate.firstCall.args[0]).to.equal('a short summary');
            expect(savedRecord()).to.include({ status: 'success', validation_status: 'passed', error_code: null });
            expect(result.text).to.equal('a short summary');
        });

        it('records malformed output as a failed validation and throws invalid_output', async () => {
            // the usual real check: output was supposed to be json and isn't
            const validate = (text) => Boolean(JSON.parse(text));

            let thrown;
            try {
                await generateTextAudited(context, { prompt: 'hi' }, {
                    knex, provider, now, validate,
                });
            } catch (err) {
                thrown = err;
            }

            expect(thrown).to.be.instanceOf(AiProviderError);
            expect(thrown.code).to.equal('invalid_output');
            // the call itself worked, so tokens and the output hash still get recorded
            expect(savedRecord()).to.include({
                status: 'error', error_code: 'invalid_output', validation_status: 'failed', total_tokens: 18,
            });
            expect(savedRecord().output_sha256).to.match(/^[0-9a-f]{64}$/);
        });

        it('does not run validation when the provider call itself failed', async () => {
            provider.generateText.rejects(new AiProviderError('timed out', { code: 'timeout' }));
            const validate = sinon.stub().returns(true);

            await generateTextAudited(context, { prompt: 'hi' }, {
                knex, provider, now, validate,
            }).catch(() => {});

            expect(validate.called).to.be.false;
            expect(savedRecord()).to.include({ error_code: 'timeout', validation_status: null });
        });

        it('refuses to run without a task, so nothing goes unlabeled', async () => {
            let thrown;
            try {
                await generateTextAudited({ grantId: '1' }, { prompt: 'hi' }, { knex, provider, now });
            } catch (err) {
                thrown = err;
            }
            expect(thrown.message).to.equal('audit context needs a task');
            expect(provider.generateText.called).to.be.false;
        });

        it('gives every call its own request id', async () => {
            const first = await generateTextAudited(context, { prompt: 'hi' }, { knex, provider });
            const second = await generateTextAudited(context, { prompt: 'hi' }, { knex, provider });
            expect(first.audit.requestId).to.not.equal(second.audit.requestId);
        });

        it('works with the real mock provider from the adapter', async () => {
            const mock = createAiProvider(getAiConfig({}));
            await generateTextAudited({ task: 'ai_check' }, { prompt: 'hello' }, { knex, provider: mock });
            expect(savedRecord()).to.include({
                provider: 'mock', model: 'mock', status: 'success', grant_id: null, user_id: null,
            });
        });
    });

    describe('hashPrompt', () => {
        it('is stable for the same input and changes when the system prompt changes', () => {
            expect(hashPrompt({ prompt: 'a', system: 'b' })).to.equal(hashPrompt({ prompt: 'a', system: 'b' }));
            expect(hashPrompt({ prompt: 'a', system: 'b' })).to.not.equal(hashPrompt({ prompt: 'a', system: 'c' }));
            expect(hashPrompt({ prompt: 'a' })).to.not.equal(hashPrompt({ prompt: 'b' }));
        });
    });

    describe('buildAuditRecord', () => {
        it('falls back to "unknown" when an error has no code', () => {
            const record = buildAuditRecord({
                requestId: 'r1', context, args: { prompt: 'hi' }, provider, error: new Error('boom'), durationMs: 5,
            });
            expect(record).to.include({ status: 'error', error_code: 'unknown' });
        });
    });

    describe('listAiAuditRecords', () => {
        it('filters by grant and returns newest first', async () => {
            const query = {
                select: sinon.stub().returnsThis(),
                orderBy: sinon.stub().returnsThis(),
                limit: sinon.stub().returnsThis(),
                where: sinon.stub().returnsThis(),
            };
            await listAiAuditRecords(sinon.stub().returns(query), { grantId: '364009', limit: 5 });

            expect(query.orderBy.firstCall.args).to.deep.equal(['id', 'desc']);
            expect(query.limit.firstCall.args[0]).to.equal(5);
            expect(query.where.firstCall.args[0]).to.deep.equal({ grant_id: '364009' });
        });
    });
});
