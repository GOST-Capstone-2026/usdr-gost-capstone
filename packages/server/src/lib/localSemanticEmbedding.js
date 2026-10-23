/* eslint-env es2020 */
/* eslint-disable no-await-in-loop -- Downloads and single-threaded model calls are intentionally sequential. */
const fs = require('fs/promises');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const manifest = require('./semanticModelManifest.json');

const defaultCacheDir = path.resolve(__dirname, '../../../../.cache/g32-matcher', manifest.revision);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function modelError(code, message) {
    return Object.assign(new Error(message), { code });
}

async function verifiedAssets(cacheDir, { allowDownload = false } = {}) {
    const assets = {};
    // Sequential downloads keep memory bounded. Only fixed public model URLs are requested; no input text is sent.
    for (const asset of manifest.assets) {
        const file = path.join(cacheDir, asset.fileName);
        let bytes;
        try {
            bytes = await fs.readFile(file);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            if (!allowDownload) {
                throw modelError('MODEL_NOT_CACHED', 'Run the C-09 rehearsal with --download-model once to cache the pinned model.');
            }
            const url = `https://huggingface.co/${manifest.modelId}/resolve/${manifest.revision}/${asset.remotePath}`;
            const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
            if (!response.ok || Number(response.headers.get('content-length')) > asset.maxBytes) {
                throw modelError('MODEL_DOWNLOAD_FAILED', `Could not download the pinned ${asset.fileName}.`);
            }
            const chunks = [];
            let length = 0;
            for await (const chunk of response.body) {
                length += chunk.length;
                if (length > asset.maxBytes) throw modelError('MODEL_DOWNLOAD_FAILED', 'Model asset exceeds its size limit.');
                chunks.push(chunk);
            }
            bytes = Buffer.concat(chunks);
            if (sha256(bytes) !== asset.sha256) throw modelError('MODEL_INTEGRITY_ERROR', `Checksum mismatch: ${asset.fileName}.`);
            await fs.mkdir(cacheDir, { recursive: true });
            const temporary = `${file}.${randomUUID()}.tmp`;
            await fs.writeFile(temporary, bytes, { flag: 'wx' });
            try {
                await fs.rename(temporary, file);
            } finally {
                await fs.unlink(temporary).catch((cleanupError) => { if (cleanupError.code !== 'ENOENT') throw cleanupError; });
            }
        }
        if (bytes.length > asset.maxBytes || sha256(bytes) !== asset.sha256) {
            throw modelError('MODEL_INTEGRITY_ERROR', `Cached asset failed verification: ${asset.fileName}. Do not use modified model files.`);
        }
        assets[asset.fileName] = bytes;
    }
    return assets;
}

function meanPool(hiddenState, tokenCount) {
    const [batch, length, dimensions] = hiddenState.dims;
    if (batch !== 1 || length !== tokenCount || dimensions !== manifest.dimensions) {
        throw modelError('INVALID_EMBEDDING', 'Unexpected model output dimensions.');
    }
    // Every input token is attended; texts are processed separately, with no padding to include in the mean.
    const vector = Array(dimensions).fill(0);
    for (let token = 0; token < length; token += 1) {
        for (let dimension = 0; dimension < dimensions; dimension += 1) {
            vector[dimension] += hiddenState.data[token * dimensions + dimension] / length;
        }
    }
    const norm = Math.hypot(...vector);
    if (!Number.isFinite(norm) || norm === 0) throw modelError('INVALID_EMBEDDING', 'The model returned an invalid vector.');
    return vector.map((value) => value / norm);
}

async function createLocalEmbedder({ cacheDir = defaultCacheDir, allowDownload = false } = {}) {
    const assets = await verifiedAssets(cacheDir, { allowDownload });
    // Lazy loading avoids a model download or WASM initialization during ordinary GOST startup.
    // eslint-disable-next-line global-require
    const { Tokenizer } = require('@huggingface/tokenizers');
    // eslint-disable-next-line global-require
    const ort = require('onnxruntime-web');
    if (ort.env.versions.web !== manifest.runtimeVersion) throw modelError('MODEL_RUNTIME_MISMATCH', 'Install the locked ONNX runtime.');
    const tokenizerPackage = JSON.parse(await fs.readFile(path.resolve(path.dirname(require.resolve('@huggingface/tokenizers')), '../package.json'), 'utf8'));
    if (tokenizerPackage.version !== manifest.tokenizerVersion) throw modelError('MODEL_RUNTIME_MISMATCH', 'Install the locked tokenizer.');
    const tokenizer = new Tokenizer(JSON.parse(assets['tokenizer.json']), JSON.parse(assets['tokenizer_config.json']));
    ort.env.wasm.numThreads = manifest.threads;
    ort.env.wasm.proxy = false;
    const session = await ort.InferenceSession.create(assets['model_quantized.onnx'], {
        executionProviders: [manifest.executionProvider], graphOptimizationLevel: 'all',
    });
    let busy = false;
    let disposed = false;
    return {
        manifest: JSON.parse(JSON.stringify(manifest)),
        async embed(texts) {
            if (disposed || busy) throw modelError('EMBEDDING_UNAVAILABLE', 'Use one active request per local embedding session.');
            if (!Array.isArray(texts) || texts.length > 251
                || texts.some((text) => typeof text !== 'string' || !text.trim() || text.length > 64000)) {
                throw modelError('INVALID_EMBEDDING_INPUT', 'Expected at most 251 nonempty bounded strings.');
            }
            busy = true;
            try {
                const results = [];
                for (const text of texts) {
                    const encoded = tokenizer.encode(text, { add_special_tokens: true });
                    const truncated = encoded.ids.length > manifest.maxTokens;
                    // Preserve [CLS] and the final [SEP] when limiting the body to the model's training window.
                    const ids = truncated ? [...encoded.ids.slice(0, manifest.maxTokens - 1), encoded.ids[encoded.ids.length - 1]] : encoded.ids;
                    const tensor = (values) => new ort.Tensor('int64', BigInt64Array.from(values, BigInt), [1, values.length]);
                    const output = await session.run({
                        input_ids: tensor(ids), attention_mask: tensor(ids.map(() => 1)), token_type_ids: tensor(ids.map(() => 0)),
                    });
                    results.push({ vector: meanPool(output.last_hidden_state, ids.length), tokenCount: ids.length, truncated });
                }
                return results;
            } finally {
                busy = false;
            }
        },
        async dispose() {
            if (busy) throw modelError('EMBEDDING_UNAVAILABLE', 'Cannot dispose an active embedding session.');
            if (!disposed) {
                disposed = true;
                await session.release();
            }
        },
    };
}

module.exports = {
    createLocalEmbedder, verifiedAssets, meanPool, defaultCacheDir,
};
