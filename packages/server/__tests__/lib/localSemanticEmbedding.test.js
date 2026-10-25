const { expect } = require('chai');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { meanPool, verifiedAssets } = require('../../src/lib/localSemanticEmbedding');
const manifest = require('../../src/lib/semanticModelManifest.json');

describe('C-09 local embedding pooling and model-cache safety', () => {
    it('mean-pools token vectors and L2-normalizes the result', () => {
        const data = new Float32Array(2 * manifest.dimensions);
        data[0] = 2; data[manifest.dimensions + 1] = 2;
        const vector = meanPool({ dims: [1, 2, manifest.dimensions], data }, 2);
        expect(vector[0]).to.be.closeTo(Math.SQRT1_2, 1e-12);
        expect(vector[1]).to.be.closeTo(Math.SQRT1_2, 1e-12);
        expect(Math.hypot(...vector)).to.be.closeTo(1, 1e-12);
    });

    it('rejects unexpected model output dimensions', () => {
        expect(() => meanPool({ dims: [1, 2, 10], data: [] }, 2)).to.throw('Unexpected model output dimensions');
    });

    it('rejects zero or nonfinite pooled vectors', () => {
        const data = new Float32Array(manifest.dimensions);
        expect(() => meanPool({ dims: [1, 1, manifest.dimensions], data }, 1)).to.throw('invalid vector');
        data[0] = NaN;
        expect(() => meanPool({ dims: [1, 1, manifest.dimensions], data }, 1)).to.throw('invalid vector');
    });

    it('does not initiate a download when the cache is absent', async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g32-c09-cache-'));
        let error;
        try {
            try { await verifiedAssets(directory); } catch (caught) { error = caught; }
            expect(error.code).to.equal('MODEL_NOT_CACHED');
            expect(await fs.readdir(directory)).to.deep.equal([]);
        } finally {
            await fs.rmdir(directory);
        }
    });

    it('rejects a tampered asset without overwriting or downloading a replacement', async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g32-c09-tamper-'));
        const file = path.join(directory, manifest.assets[0].fileName);
        let error;
        try {
            await fs.writeFile(file, 'not the approved model');
            try { await verifiedAssets(directory, { allowDownload: true }); } catch (caught) { error = caught; }
            expect(error.code).to.equal('MODEL_INTEGRITY_ERROR');
            expect(await fs.readFile(file, 'utf8')).to.equal('not the approved model');
        } finally {
            await fs.unlink(file);
            await fs.rmdir(directory);
        }
    });
});
