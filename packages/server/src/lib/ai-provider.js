// server-side ai adapter. the rest of the app calls generateText() and never
// touches a provider sdk, url, or api key directly. keys stay on the server.
//
// providers:
//   mock   - default. no key, no network, free. use for dev + tests
//   coecs  - school llm portal (trussed ai gateway, openai-style api). $10/month cap per key
//   gemini - google ai studio free tier

const { createLogger } = require('./logging');

const log = createLogger({ name: 'ai-provider' });

const PROVIDERS = ['mock', 'coecs', 'gemini'];
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const DEFAULTS = {
    provider: 'mock',
    models: { coecs: 'gpt-5.6-luna', gemini: 'gemini-3.8-flash', mock: 'mock' },
    // gpt-5 models spend part of this on hidden reasoning, so coecs needs more room
    maxOutputTokens: { coecs: 4096, gemini: 2048, mock: 2048 },
    temperature: 0.2,
    timeoutMs: 30000,
    maxRetries: 2,
};

// error codes callers can branch on. retryable = worth trying again later
class AiProviderError extends Error {
    constructor(message, {
        code, status = null, retryable = false, provider = null,
    } = {}) {
        super(message);
        this.name = 'AiProviderError';
        this.code = code;
        this.status = status;
        this.retryable = retryable;
        this.provider = provider;
    }
}

function toInt(value, fallback) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
}

function toFloat(value, fallback) {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
}

// reads config from env once. throws early if a real provider is missing its key or url
function getAiConfig(env = process.env) {
    const provider = (env.AI_PROVIDER || DEFAULTS.provider).trim().toLowerCase();
    if (!PROVIDERS.includes(provider)) {
        throw new AiProviderError(`unknown AI_PROVIDER "${provider}" (use ${PROVIDERS.join(', ')})`, { code: 'config' });
    }

    const config = {
        provider,
        model: provider === 'mock' ? 'mock' : (env.AI_MODEL || DEFAULTS.models[provider]),
        apiKey: { coecs: env.COECS_API_KEY, gemini: env.GEMINI_API_KEY }[provider],
        baseUrl: provider === 'coecs' ? (env.COECS_BASE_URL || '').replace(/\/+$/, '') : undefined,
        maxOutputTokens: toInt(env.AI_MAX_OUTPUT_TOKENS, DEFAULTS.maxOutputTokens[provider]),
        // null = let the model use its default (gpt-5 models reject anything else)
        temperature: env.AI_TEMPERATURE ? toFloat(env.AI_TEMPERATURE, null) : null,
        timeoutMs: toInt(env.AI_TIMEOUT_MS, DEFAULTS.timeoutMs),
        maxRetries: toInt(env.AI_MAX_RETRIES, DEFAULTS.maxRetries),
    };
    if (provider === 'gemini' && config.temperature === null) config.temperature = DEFAULTS.temperature;

    if (provider === 'coecs' && !config.apiKey) {
        throw new AiProviderError('AI_PROVIDER=coecs but COECS_API_KEY is not set', { code: 'config', provider });
    }
    if (provider === 'coecs' && !config.baseUrl) {
        throw new AiProviderError('AI_PROVIDER=coecs but COECS_BASE_URL is not set', { code: 'config', provider });
    }
    if (provider === 'gemini' && !config.apiKey) {
        throw new AiProviderError('AI_PROVIDER=gemini but GEMINI_API_KEY is not set', { code: 'config', provider });
    }
    return config;
}

// never print the key, just enough to tell which one is loaded
function describeConfig(config) {
    const { apiKey, ...rest } = config;
    const described = { ...rest, apiKey: apiKey ? `set (...${apiKey.slice(-4)})` : 'not set' };
    Object.keys(described).forEach((k) => described[k] === undefined && delete described[k]);
    return described;
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// maps an http status to our error codes
function errorFromStatus(status, message, provider) {
    // out of monthly budget. retrying won't help until it resets, so don't
    if (status === 402 || /budget|quota exceeded|spend limit/i.test(message)) {
        return new AiProviderError(message, { code: 'budget', status, provider });
    }
    if (status === 400) return new AiProviderError(message, { code: 'bad_request', status, provider });
    if (status === 401 || status === 403) return new AiProviderError(message, { code: 'auth', status, provider });
    if (status === 404) return new AiProviderError(message, { code: 'model_not_found', status, provider });
    if (status === 429) {
        return new AiProviderError(message, {
            code: 'rate_limit', status, retryable: true, provider,
        });
    }
    if (status >= 500) {
        return new AiProviderError(message, {
            code: 'unavailable', status, retryable: true, provider,
        });
    }
    return new AiProviderError(message, { code: 'unknown', status, provider });
}

// one http call with a timeout. shared by every real provider
async function postJson({
    url, headers, body, timeoutMs, provider, fetchFn,
}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
        res = await fetchFn(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(body),
            signal: controller.signal,
            // apis don't redirect. a redirect usually means the url is a login page, so stop
            redirect: 'manual',
        });
    } catch (err) {
        if (err.name === 'AbortError') {
            throw new AiProviderError(`${provider} timed out after ${timeoutMs}ms`, { code: 'timeout', retryable: true, provider });
        }
        throw new AiProviderError(`network error calling ${provider}: ${err.message}`, { code: 'network', retryable: true, provider });
    } finally {
        clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
        throw new AiProviderError(
            `${provider} redirected (http ${res.status}), so the base url is probably a website/login page, not the api endpoint`,
            { code: 'config', status: res.status, provider },
        );
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = (data.error && (data.error.message || data.error)) || data.detail || `${provider} returned http ${res.status}`;
        throw errorFromStatus(res.status, String(msg), provider);
    }
    return data;
}

// retry only the stuff that might work next time (429, 5xx, timeouts), with backoff
async function withRetries(fn, { maxRetries, provider, sleepFn }) {
    for (let attempt = 0; ; attempt += 1) {
        try {
            // eslint-disable-next-line no-await-in-loop
            return await fn();
        } catch (err) {
            if (!err.retryable || attempt >= maxRetries) throw err;
            const waitMs = 500 * (2 ** attempt);
            log.warn({
                provider, code: err.code, attempt: attempt + 1, waitMs,
            }, 'ai call failed, retrying');
            // eslint-disable-next-line no-await-in-loop
            await sleepFn(waitMs);
        }
    }
}

// log metadata only, never the prompt or the output
function logOk(result) {
    log.info({
        provider: result.provider, model: result.model, finishReason: result.finishReason, usage: result.usage,
    }, 'ai call ok');
}

// openai-style chat completions api, which is what the trussed ai gateway speaks
function createCoecsProvider(config, { fetchFn = global.fetch, sleepFn = sleep } = {}) {
    const url = `${config.baseUrl}/chat/completions`;

    async function generate({
        prompt, system, maxOutputTokens, temperature,
    } = {}) {
        if (!prompt) throw new AiProviderError('prompt is required', { code: 'bad_request', provider: 'coecs' });

        const messages = [];
        if (system) messages.push({ role: 'system', content: system });
        messages.push({ role: 'user', content: prompt });
        const body = {
            model: config.model,
            messages,
            max_completion_tokens: maxOutputTokens || config.maxOutputTokens,
        };
        const temp = temperature ?? config.temperature;
        if (temp !== null && temp !== undefined) body.temperature = temp;

        const data = await withRetries(() => postJson({
            url,
            headers: { Authorization: `Bearer ${config.apiKey}` },
            body,
            timeoutMs: config.timeoutMs,
            provider: 'coecs',
            fetchFn,
        }), { maxRetries: config.maxRetries, provider: 'coecs', sleepFn });

        const choice = (data.choices || [])[0];
        if (!choice) throw new AiProviderError('coecs returned no choices', { code: 'empty', provider: 'coecs' });
        const message = choice.message || {};
        if (message.refusal) {
            throw new AiProviderError(`model refused: ${message.refusal}`, { code: 'blocked', provider: 'coecs' });
        }
        if (choice.finish_reason === 'content_filter') {
            throw new AiProviderError('response blocked by content filter', { code: 'blocked', provider: 'coecs' });
        }

        const usage = data.usage || {};
        const result = {
            text: message.content || '',
            provider: 'coecs',
            model: data.model || config.model,
            finishReason: choice.finish_reason || null,
            truncated: choice.finish_reason === 'length',
            usage: {
                inputTokens: usage.prompt_tokens ?? null,
                outputTokens: usage.completion_tokens ?? null,
                totalTokens: usage.total_tokens ?? null,
            },
        };
        logOk(result);
        return result;
    }

    return { name: 'coecs', model: config.model, generateText: generate };
}

function createGeminiProvider(config, { fetchFn = global.fetch, sleepFn = sleep } = {}) {
    const url = `${GEMINI_BASE_URL}/models/${encodeURIComponent(config.model)}:generateContent`;

    async function generate({
        prompt, system, maxOutputTokens, temperature,
    } = {}) {
        if (!prompt) throw new AiProviderError('prompt is required', { code: 'bad_request', provider: 'gemini' });

        const body = {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                maxOutputTokens: maxOutputTokens || config.maxOutputTokens,
                temperature: temperature ?? config.temperature,
            },
        };
        if (system) body.systemInstruction = { parts: [{ text: system }] };

        const data = await withRetries(() => postJson({
            url,
            // key goes in a header, not the query string, so it can't leak into url logs
            headers: { 'x-goog-api-key': config.apiKey },
            body,
            timeoutMs: config.timeoutMs,
            provider: 'gemini',
            fetchFn,
        }), { maxRetries: config.maxRetries, provider: 'gemini', sleepFn });

        if (data.promptFeedback && data.promptFeedback.blockReason) {
            throw new AiProviderError(`prompt blocked by gemini: ${data.promptFeedback.blockReason}`, { code: 'blocked', provider: 'gemini' });
        }
        const candidate = (data.candidates || [])[0];
        if (!candidate) throw new AiProviderError('gemini returned no candidates', { code: 'empty', provider: 'gemini' });

        const text = ((candidate.content && candidate.content.parts) || [])
            .map((p) => p.text || '')
            .join('');
        if (candidate.finishReason === 'SAFETY' && !text) {
            throw new AiProviderError('response blocked by gemini safety filters', { code: 'blocked', provider: 'gemini' });
        }

        const usage = data.usageMetadata || {};
        const result = {
            text,
            provider: 'gemini',
            model: config.model,
            finishReason: candidate.finishReason || null,
            truncated: candidate.finishReason === 'MAX_TOKENS',
            usage: {
                inputTokens: usage.promptTokenCount ?? null,
                outputTokens: usage.candidatesTokenCount ?? null,
                totalTokens: usage.totalTokenCount ?? null,
            },
        };
        logOk(result);
        return result;
    }

    return { name: 'gemini', model: config.model, generateText: generate };
}

// fake provider for local dev + tests. no network, no key, same return shape
function createMockProvider(config) {
    async function generate({ prompt } = {}) {
        if (!prompt) throw new AiProviderError('prompt is required', { code: 'bad_request', provider: 'mock' });
        const preview = prompt.length > 80 ? `${prompt.slice(0, 80)}...` : prompt;
        return {
            text: `[mock response] ${preview}`,
            provider: 'mock',
            model: config.model,
            finishReason: 'STOP',
            truncated: false,
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
    }
    return { name: 'mock', model: config.model, generateText: generate };
}

function createAiProvider(config = getAiConfig(), deps = {}) {
    if (config.provider === 'coecs') return createCoecsProvider(config, deps);
    if (config.provider === 'gemini') return createGeminiProvider(config, deps);
    return createMockProvider(config);
}

// one shared instance for the app, built on first use
let cached = null;
function getAiProvider() {
    if (!cached) cached = createAiProvider();
    return cached;
}

function resetAiProvider() {
    cached = null;
}

async function generateText(args) {
    return getAiProvider().generateText(args);
}

module.exports = {
    AiProviderError,
    getAiConfig,
    describeConfig,
    createAiProvider,
    getAiProvider,
    resetAiProvider,
    generateText,
};
