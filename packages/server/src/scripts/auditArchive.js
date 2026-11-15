// A-19: auditing the final archive (data, tests, secrets)
// read-only, never prints a secret, only where it was found
// needs git, so running it in git bash from packages/server:
//   node src/scripts/auditArchive.js
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const SERVER = path.join(__dirname, '..', '..');
const REPO = path.join(SERVER, '..', '..');
const MAX_SCAN_BYTES = 2 * 1024 * 1024;
const BIG_FILE_BYTES = 5 * 1024 * 1024;

const results = [];
const record = (group, status, name, detail = '') => results.push({
    group, status, name, detail,
});

const git = (...args) => execFileSync('git', args, { cwd: REPO, maxBuffer: 64 * 1024 * 1024 }).toString();

// strict key formats, any hit is a real problem
const KEY_PATTERNS = [
    ['aws access key', /\bAKIA[0-9A-Z]{16}\b/],
    ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
    ['openai-style key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/],
    ['google api key', /\bAIza[0-9A-Za-z_-]{35}\b/],
    ['github token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
    ['slack token', /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/],
];

// looser "name = long value" matches, listed for review
const ASSIGNMENT = /\b([A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD))\s*[:=]\s*['"]?([^\s'"#]{16,})/;
const PLACEHOLDER = /^(?:x+|\*+|changeme|your[-_].*|<.*>|\$\{.*\}|test|example.*|dummy.*|fake.*|placeholder.*|process\.env.*)$/i;
// files where long fake values are expected (tests, docs, terraform)
// .env.example has the shared dev defaults on purpose
const REVIEW_SKIP = /(__tests__|\.spec\.|\.test\.|^docs\/|\.md$|^terraform\/|\.tf$|localstack|docker-compose|\.env\.example$)/;

function trackedFiles() {
    return git('ls-files', '-z').split('\0').filter(Boolean);
}

function isText(buf) {
    return !buf.subarray(0, 8000).includes(0);
}

// --- secrets ---

function checkEnvFiles(files) {
    const envs = files.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !/\.env\.(example|sample|template)$/.test(f));
    record('secrets', envs.length ? 'FAIL' : 'PASS', 'no .env files are committed', envs.join(', '));

    const ignored = spawnSync('git', ['check-ignore', '-q', 'packages/server/.env'], { cwd: REPO }).status === 0;
    record('secrets', ignored ? 'PASS' : 'FAIL', '.gitignore keeps packages/server/.env out of git');

    const example = path.join(SERVER, '.env.example');
    if (fs.existsSync(example)) {
        const filled = fs.readFileSync(example, 'utf8').split('\n')
            .filter((l) => /^(COECS_API_KEY|GEMINI_API_KEY)\s*=\s*\S+/.test(l))
            .map((l) => l.split('=')[0]);
        record('secrets', filled.length ? 'FAIL' : 'PASS', '.env.example leaves the ai keys blank', filled.join(', '));
    }
}

function scanContents(files) {
    const hits = [];
    const review = [];
    files.forEach((f) => {
        const full = path.join(REPO, f);
        let stat;
        try { stat = fs.statSync(full); } catch (err) { return; }
        if (!stat.isFile() || stat.size > MAX_SCAN_BYTES) return;
        const buf = fs.readFileSync(full);
        if (!isText(buf)) return;
        buf.toString('utf8').split('\n').forEach((line, i) => {
            KEY_PATTERNS.forEach(([name, re]) => {
                if (re.test(line)) hits.push(`${f}:${i + 1} (${name})`);
            });
            const m = ASSIGNMENT.exec(line);
            if (m && !REVIEW_SKIP.test(f) && !PLACEHOLDER.test(m[2])) review.push(`${f}:${i + 1} (${m[1]})`);
        });
    });
    record('secrets', hits.length ? 'FAIL' : 'PASS', 'no real-looking api keys, tokens or private keys in committed files', hits.join('\n          '));
    record('secrets', review.length ? 'WARN' : 'PASS', 'no long values assigned to *_KEY/SECRET/TOKEN/PASSWORD outside tests and docs', review.length ? `look at: ${review.slice(0, 15).join(', ')}${review.length > 15 ? ` (+${review.length - 15} more)` : ''}` : '');
}

// checking that none of the real values in the local .env were ever committed, on any branch
function checkLocalSecretsNeverCommitted() {
    const envFile = path.join(SERVER, '.env');
    if (!fs.existsSync(envFile)) {
        record('secrets', 'WARN', 'local secrets never committed', 'no packages/server/.env on this machine, skipped');
        return;
    }
    const secrets = fs.readFileSync(envFile, 'utf8').split('\n')
        .map((l) => /^\s*([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD))\s*=\s*['"]?([^'"\s#]+)/.exec(l))
        .filter((m) => m && m[2].length >= 12 && !PLACEHOLDER.test(m[2]))
        .map((m) => ({ name: m[1], value: m[2] }));
    // skipping values copied from .env.example (shared dev defaults)
    const exampleFile = path.join(SERVER, '.env.example');
    const example = new Map((fs.existsSync(exampleFile) ? fs.readFileSync(exampleFile, 'utf8') : '').split('\n')
        .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*['"]?([^'"\s#]*)/.exec(l))
        .filter(Boolean)
        .map((m) => [m[1], m[2]]));
    const devDefaults = secrets.filter(({ name, value }) => example.get(name) === value);
    const real = secrets.filter((s) => !devDefaults.includes(s));
    const leaked = real.filter(({ value }) => {
        // searching all history for the value, passed as an arg (no shell) and never printed
        const out = spawnSync('git', ['log', '--all', '--format=%h', '-S', value], { cwd: REPO, maxBuffer: 16 * 1024 * 1024 });
        return out.stdout.toString().trim().length > 0;
    }).map((s) => s.name);
    record(
        'secrets',
        leaked.length ? 'FAIL' : 'PASS',
        `none of your ${real.length} real local secret value(s) appear anywhere in git history`,
        [
            leaked.length ? `found in history: ${leaked.join(', ')}. rotate these keys` : `checked: ${real.map((s) => s.name).join(', ') || 'none'}`,
            devDefaults.length ? `skipped (same as the .env.example dev default): ${devDefaults.map((s) => s.name).join(', ')}` : '',
        ].filter(Boolean).join('. '),
    );
}

function checkAuditTableStoresNoText() {
    const migrations = path.join(SERVER, 'migrations');
    const file = fs.readdirSync(migrations).map((f) => path.join(migrations, f))
        .find((f) => /ai_audit_records/.test(fs.readFileSync(f, 'utf8')) && /createTable/.test(fs.readFileSync(f, 'utf8')));
    if (!file) {
        record('secrets', 'WARN', 'ai audit table stores hashes, not prompt or output text', 'migration not found');
        return;
    }
    const src = fs.readFileSync(file, 'utf8');
    const textCols = (src.match(/table\.\w+\(\s*'(prompt|output|response|completion|api_key)'/g) || []);
    const hashed = /prompt_sha256/.test(src) && /output_sha256/.test(src);
    record('secrets', !textCols.length && hashed ? 'PASS' : 'FAIL', 'ai audit table stores hashes, not prompt or output text', path.basename(file));
}

// --- data ---

function checkData(files) {
    const dataFiles = files.filter((f) => /^packages\/server\/(evaluation|seeds\/demo)\//.test(f));
    const emails = [];
    dataFiles.forEach((f) => {
        const text = fs.readFileSync(path.join(REPO, f), 'utf8');
        (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [])
            .filter((e) => !/@(example\.(com|org)|usdigitalresponse\.org|[a-z.]*\.gov)$/i.test(e))
            .forEach((e) => emails.push(`${f}: ${e.replace(/^(.).*@/, '$1***@')}`));
    });
    record('data', emails.length ? 'WARN' : 'PASS', 'evaluation and demo data have no personal email addresses', emails.join(', '));

    const demo = JSON.parse(fs.readFileSync(path.join(SERVER, 'seeds', 'demo', 'opportunities.json'), 'utf8'));
    record('data', /grants\.gov/i.test(demo.source) ? 'PASS' : 'WARN', 'demo grants come from the public grants.gov api', `${demo.source}, fetched ${demo.fetched_on}`);

    const expected = [
        'evaluation/matching-fixtures.json',
        'evaluation/faithfulness-fixtures.json',
        'seeds/demo/opportunities.json',
    ];
    const missing = expected.filter((f) => !files.includes(`packages/server/${f}`));
    record('data', missing.length ? 'FAIL' : 'PASS', 'evaluation inputs are committed', missing.length ? `not committed: ${missing.join(', ')}` : expected.join(', '));

    const snaps = files.filter((f) => /^packages\/server\/evaluation\/snapshots\/.*\.json$/.test(f)).map((f) => path.basename(f));
    record('data', snaps.some((f) => f.startsWith('a14-')) ? 'PASS' : 'FAIL', 'an A-14 snapshot is committed', snaps.join(', '));
    record('data', snaps.some((f) => /^a16-faithfulness-(live|replay)-/.test(f)) ? 'PASS' : 'WARN', 'an A-16 live faithfulness report is committed', snaps.some((f) => f.startsWith('a16-')) ? '' : 'none yet');

    const big = files.filter((f) => {
        try { return fs.statSync(path.join(REPO, f)).size > BIG_FILE_BYTES; } catch (err) { return false; }
    });
    record('data', big.length ? 'WARN' : 'PASS', 'no committed file is over 5 MB', big.join(', '));
}

// --- tests ---

function checkTests() {
    const pkg = JSON.parse(fs.readFileSync(path.join(SERVER, 'package.json'), 'utf8'));
    const ours = ['test:eval', 'test:failures', 'test:isolation', 'eval:snapshot', 'eval:faithfulness', 'verify:prototype'];
    const missingScripts = ours.filter((s) => !pkg.scripts[s]);
    record('tests', missingScripts.length ? 'FAIL' : 'PASS', 'all evaluation and test commands exist in package.json', missingScripts.join(', '));

    const missingFiles = [];
    ours.filter((s) => pkg.scripts[s]).forEach((s) => {
        (pkg.scripts[s].match(/(__tests__|src)\/[\w./-]+\.js/g) || []).forEach((f) => {
            if (!fs.existsSync(path.join(SERVER, f))) missingFiles.push(`${s}: ${f}`);
        });
    });
    record('tests', missingFiles.length ? 'FAIL' : 'PASS', 'every file those commands run exists', missingFiles.join(', '));

    const exclusive = [];
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
        const p = path.join(dir, d.name);
        if (d.isDirectory()) walk(p);
        else if (/\.(test|spec)\.js$/.test(d.name) && /\b(it|describe)\.only\(/.test(fs.readFileSync(p, 'utf8'))) exclusive.push(path.relative(SERVER, p));
    });
    walk(path.join(SERVER, '__tests__'));
    record('tests', exclusive.length ? 'FAIL' : 'PASS', 'no test file has a leftover .only (which would silently skip the rest)', exclusive.join(', '));
}

function print() {
    console.log('\nA-19 archive audit');
    console.log('='.repeat(60));
    let group = null;
    results.forEach((r) => {
        if (r.group !== group) {
            group = r.group;
            console.log(`\n${group}`);
        }
        console.log(`  ${r.status.padEnd(4)}  ${r.name}${r.detail ? `\n          ${r.detail}` : ''}`);
    });
    const fails = results.filter((r) => r.status === 'FAIL').length;
    const warns = results.filter((r) => r.status === 'WARN').length;
    console.log(`\n${fails ? `${fails} FAIL` : 'no failures'}, ${warns} warning(s)`);
    console.log('the test suites themselves run in the container, see docs/g32-a18-data-and-tests-readme.md');
    if (fails) process.exitCode = 1;
}

function main() {
    const files = trackedFiles();
    checkEnvFiles(files);
    scanContents(files);
    checkLocalSecretsNeverCommitted();
    checkAuditTableStoresNoText();
    checkData(files);
    checkTests();
    print();
}

if (require.main === module) main();
