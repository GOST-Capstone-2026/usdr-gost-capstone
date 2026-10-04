#!/usr/bin/env node
// quick check that the ai adapter is wired up. prints config (key masked) + one test call.
// usage: yarn ai:check "your prompt here"
require('dotenv').config();
const { getAiConfig, describeConfig, createAiProvider } = require('../lib/ai-provider');

async function main() {
    const prompt = process.argv[2] || 'In one sentence, what is a federal grant?';
    const config = getAiConfig();
    console.log('ai config:', describeConfig(config));

    const provider = createAiProvider(config);
    const started = Date.now();
    const result = await provider.generateText({
        system: 'You help state and local governments understand grant opportunities. Be concise.',
        prompt,
    });
    console.log(`\nprompt: ${prompt}`);
    console.log(`response (${Date.now() - started}ms):\n${result.text}\n`);
    console.log('meta:', {
        provider: result.provider, model: result.model, finishReason: result.finishReason, usage: result.usage,
    });
}

if (require.main === module) {
    main().catch((err) => {
        // only print code + message, never the raw error object (could hold request details)
        console.error(`ai check failed [${err.code || 'error'}]: ${err.message}`);
        process.exit(1);
    });
}
