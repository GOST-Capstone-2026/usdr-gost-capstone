const { expect } = require('chai');
const sinon = require('sinon');
const {
    AiProviderError, getAiConfig, describeConfig, createAiProvider,
} = require('../../src/lib/ai-provider');

// fake fetch response, same shape the real one has
const fakeResponse = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
});

const geminiOk = (text = 'hello from gemini') => ({
    candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 4, totalTokenCount: 9 },
});

describe('ai-provider', () => {
    describe('getAiConfig', () => {
        it('defaults to mock so dev works with no key', () => {
            const config = getAiConfig({});
            expect(config.provider).to.equal('mock');
            expect(config.apiKey).to.be.undefined;
        });

        it('throws a config error when gemini has no key', () => {
            expect(() => getAiConfig({ AI_PROVIDER: 'gemini' }))
                .to.throw(AiProviderError, 'GEMINI_API_KEY is not set');
        });

        it('rejects unknown providers', () => {
            expect(() => getAiConfig({ AI_PROVIDER: 'skynet' })).to.throw(AiProviderError, 'unknown AI_PROVIDER');
        });

        it('reads gemini settings from env', () => {
            const config = getAiConfig({
                AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'abc123xyz9', AI_MODEL: 'gemini-test', AI_MAX_RETRIES: '0',
            });
            expect(config).to.include({ provider: 'gemini', model: 'gemini-test', maxRetries: 0 });
        });

        it('describeConfig never prints the full key', () => {
            const described = describeConfig(getAiConfig({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'supersecretkey9876' }));
            expect(JSON.stringify(described)).to.not.include('supersecretkey');
            expect(described.apiKey).to.equal('set (...9876)');
        });
    });

    describe('mock provider', () => {
        it('returns the normal result shape without calling anything', async () => {
            const provider = createAiProvider(getAiConfig({}));
            const result = await provider.generateText({ prompt: 'summarize this grant' });
            expect(result.provider).to.equal('mock');
            expect(result.text).to.include('summarize this grant');
            expect(result).to.have.keys('text', 'provider', 'model', 'finishReason', 'truncated', 'usage');
        });
    });

    describe('coecs provider', () => {
        const env = {
            AI_PROVIDER: 'coecs', COECS_API_KEY: 'coecs-key-5678', COECS_BASE_URL: 'https://llm.example.edu/v1/', AI_MAX_RETRIES: '2',
        };
        const coecsOk = (text = 'hello from coecs') => ({
            model: 'gpt-5.6-luna',
            choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
        });
        let fetchFn;
        let sleepFn;

        beforeEach(() => {
            fetchFn = sinon.stub();
            sleepFn = sinon.stub().resolves();
        });

        it('needs both a key and a base url', () => {
            expect(() => getAiConfig({ AI_PROVIDER: 'coecs', COECS_BASE_URL: 'https://x' }))
                .to.throw(AiProviderError, 'COECS_API_KEY is not set');
            expect(() => getAiConfig({ AI_PROVIDER: 'coecs', COECS_API_KEY: 'k' }))
                .to.throw(AiProviderError, 'COECS_BASE_URL is not set');
        });

        it('defaults to gpt-5.6-luna and no temperature', () => {
            const config = getAiConfig(env);
            expect(config).to.include({ model: 'gpt-5.6-luna', temperature: null, baseUrl: 'https://llm.example.edu/v1' });
        });

        it('sends an openai-style request with a bearer key and normalizes the response', async () => {
            fetchFn.resolves(fakeResponse(200, coecsOk()));
            const provider = createAiProvider(getAiConfig(env), { fetchFn, sleepFn });

            const result = await provider.generateText({ prompt: 'hi', system: 'be brief' });

            const [url, opts] = fetchFn.firstCall.args;
            expect(url).to.equal('https://llm.example.edu/v1/chat/completions');
            expect(url).to.not.include('coecs-key-5678');
            expect(opts.headers.Authorization).to.equal('Bearer coecs-key-5678');
            const body = JSON.parse(opts.body);
            expect(body.model).to.equal('gpt-5.6-luna');
            expect(body.messages).to.deep.equal([
                { role: 'system', content: 'be brief' },
                { role: 'user', content: 'hi' },
            ]);
            expect(body.max_completion_tokens).to.equal(4096);
            expect(body).to.not.have.property('temperature');
            expect(result).to.deep.include({ text: 'hello from coecs', provider: 'coecs', truncated: false });
            expect(result.usage).to.deep.equal({ inputTokens: 12, outputTokens: 6, totalTokens: 18 });
        });

        it('does not retry once the monthly budget is used up', async () => {
            fetchFn.resolves(fakeResponse(429, { error: { message: 'Budget exceeded for this key' } }));
            const provider = createAiProvider(getAiConfig(env), { fetchFn, sleepFn });

            const err = await provider.generateText({ prompt: 'hi' }).catch((e) => e);
            expect(err).to.include({ code: 'budget', retryable: false });
            expect(fetchFn.callCount).to.equal(1);
        });

        it('still retries a normal rate limit', async () => {
            fetchFn.onFirstCall().resolves(fakeResponse(429, { error: { message: 'Too many requests' } }));
            fetchFn.onSecondCall().resolves(fakeResponse(200, coecsOk('ok now')));
            const provider = createAiProvider(getAiConfig(env), { fetchFn, sleepFn });

            const result = await provider.generateText({ prompt: 'hi' });
            expect(result.text).to.equal('ok now');
            expect(fetchFn.callCount).to.equal(2);
        });

        it('flags truncated output', async () => {
            const body = coecsOk('cut off');
            body.choices[0].finish_reason = 'length';
            fetchFn.resolves(fakeResponse(200, body));
            const provider = createAiProvider(getAiConfig(env), { fetchFn, sleepFn });

            const result = await provider.generateText({ prompt: 'hi' });
            expect(result.truncated).to.equal(true);
        });

        it('stops on a redirect instead of following it to a login page', async () => {
            fetchFn.resolves(fakeResponse(302, {}));
            const provider = createAiProvider(getAiConfig(env), { fetchFn, sleepFn });

            const err = await provider.generateText({ prompt: 'hi' }).catch((e) => e);
            expect(err).to.include({ code: 'config', status: 302, retryable: false });
            expect(fetchFn.firstCall.args[1].redirect).to.equal('manual');
            expect(fetchFn.callCount).to.equal(1);
        });

        it('turns a model refusal into a blocked error', async () => {
            fetchFn.resolves(fakeResponse(200, {
                choices: [{ message: { content: null, refusal: 'cannot help with that' }, finish_reason: 'stop' }],
            }));
            const provider = createAiProvider(getAiConfig(env), { fetchFn, sleepFn });

            const err = await provider.generateText({ prompt: 'hi' }).catch((e) => e);
            expect(err.code).to.equal('blocked');
        });
    });

    describe('gemini provider', () => {
        const config = getAiConfig({
            AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-key-1234', AI_MAX_RETRIES: '2',
        });
        let fetchFn;
        let sleepFn;

        beforeEach(() => {
            fetchFn = sinon.stub();
            sleepFn = sinon.stub().resolves();
        });

        it('sends the key in a header (not the url) and normalizes the response', async () => {
            fetchFn.resolves(fakeResponse(200, geminiOk()));
            const provider = createAiProvider(config, { fetchFn, sleepFn });

            const result = await provider.generateText({ prompt: 'hi', system: 'be brief' });

            const [url, opts] = fetchFn.firstCall.args;
            expect(url).to.include(':generateContent');
            expect(url).to.not.include('test-key-1234');
            expect(opts.headers['x-goog-api-key']).to.equal('test-key-1234');
            const body = JSON.parse(opts.body);
            expect(body.systemInstruction.parts[0].text).to.equal('be brief');
            expect(body.contents[0].parts[0].text).to.equal('hi');
            expect(result).to.deep.include({ text: 'hello from gemini', provider: 'gemini', truncated: false });
            expect(result.usage).to.deep.equal({ inputTokens: 5, outputTokens: 4, totalTokens: 9 });
        });

        it('retries 429s then succeeds', async () => {
            fetchFn.onFirstCall().resolves(fakeResponse(429, { error: { message: 'quota' } }));
            fetchFn.onSecondCall().resolves(fakeResponse(200, geminiOk('second try')));
            const provider = createAiProvider(config, { fetchFn, sleepFn });

            const result = await provider.generateText({ prompt: 'hi' });
            expect(result.text).to.equal('second try');
            expect(fetchFn.callCount).to.equal(2);
            expect(sleepFn.callCount).to.equal(1);
        });

        it('gives up after maxRetries on 503', async () => {
            fetchFn.resolves(fakeResponse(503, { error: { message: 'overloaded' } }));
            const provider = createAiProvider(config, { fetchFn, sleepFn });

            const err = await provider.generateText({ prompt: 'hi' }).catch((e) => e);
            expect(err).to.be.instanceOf(AiProviderError);
            expect(err).to.include({ code: 'unavailable', retryable: true, status: 503 });
            expect(fetchFn.callCount).to.equal(3); // 1 try + 2 retries
        });

        it('does not retry a bad key', async () => {
            fetchFn.resolves(fakeResponse(403, { error: { message: 'API key not valid' } }));
            const provider = createAiProvider(config, { fetchFn, sleepFn });

            const err = await provider.generateText({ prompt: 'hi' }).catch((e) => e);
            expect(err).to.include({ code: 'auth', retryable: false });
            expect(fetchFn.callCount).to.equal(1);
        });

        it('turns a blocked prompt into a blocked error', async () => {
            fetchFn.resolves(fakeResponse(200, { promptFeedback: { blockReason: 'SAFETY' } }));
            const provider = createAiProvider(config, { fetchFn, sleepFn });

            const err = await provider.generateText({ prompt: 'hi' }).catch((e) => e);
            expect(err.code).to.equal('blocked');
        });

        it('flags truncated output', async () => {
            const body = geminiOk('cut off');
            body.candidates[0].finishReason = 'MAX_TOKENS';
            fetchFn.resolves(fakeResponse(200, body));
            const provider = createAiProvider(config, { fetchFn, sleepFn });

            const result = await provider.generateText({ prompt: 'hi' });
            expect(result.truncated).to.equal(true);
        });

        it('maps network failures to a retryable error', async () => {
            fetchFn.rejects(new Error('ECONNRESET'));
            const provider = createAiProvider({ ...config, maxRetries: 0 }, { fetchFn, sleepFn });

            const err = await provider.generateText({ prompt: 'hi' }).catch((e) => e);
            expect(err).to.include({ code: 'network', retryable: true });
        });
    });
});
