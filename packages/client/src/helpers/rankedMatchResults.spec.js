import { describe, it, expect } from 'vitest';
import { matchDisplayError, presentMatchRun } from '@/helpers/rankedMatchResults';
import { makeMatchRun, matchContext } from '@/test-utils/matchRunFixture';

describe('C-11 match-result display contract', () => {
  it('preserves server order and ranks, distinguishes ranked zero from unranked null, and counts all candidates', () => {
    const result = presentMatchRun(makeMatchRun(), matchContext);
    expect(result.rows.map((row) => row.grantId)).toEqual([1, 2, 3, 4, 5]);
    expect(result.rows.map((row) => row.displayScore)).toEqual(['0.295913', '0.293755', '0.000000', 'Not ranked', 'Not ranked']);
    expect(result).toMatchObject({
      ranked: 3, blocked: 1, reviewRequired: 2, unranked: 2,
    });
  });

  it('does not mutate producer-owned inputs or claim that an eligible disposition certifies eligibility', () => {
    const run = makeMatchRun();
    const before = JSON.stringify(run);
    expect(presentMatchRun(run, matchContext).rows[0].displayDisposition).toBe('No hard blocker found');
    expect(JSON.stringify(run)).toBe(before);
  });

  it('supports a valid empty run without making a no-grants claim', () => {
    const run = {
      ...makeMatchRun(), results: [], candidateCount: 0, rankedCount: 0, blockedCount: 0,
    };
    expect(presentMatchRun(run, matchContext).rows).toEqual([]);
  });

  it('uses an ID fallback for missing titles and labels partial source titles', () => {
    const run = makeMatchRun();
    run.results[0].explanationDetails.evidence.find((item) => item.kind === 'listingText').truncated = true;
    const result = presentMatchRun(run, matchContext);
    expect(result.rows[0].titleIsPartial).toBe(true);
    expect(result.rows[4].displayTitle).toBe('Grant 5');
  });

  it.each([
    null,
    { ...matchContext, organizationId: 9 },
    { ...matchContext, organizationId: '0' },
    { ...matchContext, profileId: 2 },
    { ...matchContext, profileId: null },
    { ...matchContext, profileVersion: 3 },
    { ...matchContext, profileVersion: 0 },
  ])('hides results when the selected context does not match: %j', (context) => {
    expect(() => presentMatchRun(makeMatchRun(), context)).toThrow('STALE_MATCH_RESULTS');
  });

  const invalidCases = [
    ['unsupported explanation version', (state) => { state.explanationVersion = 'future-v2'; }],
    ['wrong explanation method', (state) => { state.explanationMethod = 'generative'; }],
    ['invalid hash', (state) => { state.inputHash = ''; }],
    ['impossible calendar date', (state) => { state.screenedOn = '2026-02-30'; }],
    ['invalid calendar date', (state) => { state.screenedOn = 'not-a-date'; }],
    ['wrong count', (state) => { state.candidateCount = 4; }],
    ['wrong ranked count', (state) => { state.rankedCount = 4; }],
    ['wrong blocked count', (state) => { state.blockedCount = 0; }],
    ['oversized candidate set', (state) => { state.results = Array(251).fill(state.results[0]); state.candidateCount = 251; }],
    ['missing results', (state) => { state.results = null; }],
    ['duplicate grant ID', (state) => { state.results[1].grantId = 1; }],
    ['unknown disposition', (state) => { state.results[0].disposition = 'verified'; }],
    ['invented rank', (state) => { state.results[0].rank = 2; }],
    ['invalid score', (state) => { state.results[0].score = 1.1; }],
    ['nonfinite score', (state) => { state.results[0].score = NaN; }],
    ['misordered ranks', (state) => { state.results.reverse(); }],
    ['blocked grant with rank', (state) => { state.results[3].rank = 4; }],
    ['blocked grant with score', (state) => { state.results[3].score = 0.99; }],
    ['blocked grant without blockers', (state) => { state.results[3].blockers = []; }],
    ['hidden eligible warning', (state) => { state.results[0].uncertainties = ['Notice needs review.']; }],
    ['review without warnings', (state) => { state.results[1].uncertainties = []; }],
    ['missing explanation', (state) => { state.results[0].explanationDetails = null; }],
    ['false human verification', (state) => { state.results[0].explanationDetails.verificationStatus = 'verified'; }],
    ['invented explanation model', (state) => { state.results[0].explanationDetails.model = 'not-the-extractive-method'; }],
    ['cross-organization provenance', (state) => { state.results[0].explanationDetails.provenance.organizationId = 4; }],
    ['stale provenance', (state) => { state.results[0].explanationDetails.provenance.profileVersion = 1; }],
    ['wrong source hash', (state) => { state.results[0].explanationDetails.provenance.sourceTextHash = 'f'.repeat(64); }],
    ['missing claim reference', (state) => { state.results[0].explanationDetails.claims[0].evidenceIds = []; }],
    ['dangling claim reference', (state) => { state.results[0].explanationDetails.claims[0].evidenceIds = ['external-url']; }],
    ['duplicate evidence ID', (state) => { state.results[0].explanationDetails.evidence.push(state.results[0].explanationDetails.evidence[0]); }],
    ['wrong evidence grant ID', (state) => { state.results[0].explanationDetails.evidence[1].grantId = 2; }],
    ['wrong evidence rank', (state) => { state.results[0].explanationDetails.evidence[2].rank = 2; }],
    ['wrong evidence score', (state) => { state.results[0].explanationDetails.evidence[2].score = 1; }],
    ['wrong evidence profile', (state) => { state.results[0].explanationDetails.evidence[0].profileId = 2; }],
    ['contradictory screening evidence', (state) => { state.results[0].explanationDetails.evidence[1].uncertainties = ['A contradictory warning.']; }],
    ['bad excerpt offsets', (state) => { state.results[0].explanationDetails.evidence[3].endOffset = 200; }],
    ['oversized excerpt', (state) => { const item = state.results[0].explanationDetails.evidence[3]; item.excerpt = 'x'.repeat(241); item.endOffset = 241; }],
    ['invented PDF evidence', (state) => { state.results[0].explanationDetails.evidence[3].kind = 'pdfPage'; }],
  ];
  it.each(invalidCases)('rejects %s instead of presenting a successful result', (name, mutate) => {
    const run = makeMatchRun();
    mutate(run);
    expect(() => presentMatchRun(run, matchContext)).toThrow('INVALID_MATCH_RESULTS');
  });

  it('maps errors to controlled messages without displaying raw server or provider text', () => {
    expect(matchDisplayError('VERSION_CONFLICT')).toContain('profile changed');
    expect(matchDisplayError('MODEL_NOT_CACHED')).toContain('pinned model');
    expect(matchDisplayError('secret SQL payload')).not.toContain('secret');
    expect(matchDisplayError('__proto__')).toBe(matchDisplayError('unknown'));
    expect(matchDisplayError('constructor')).toBe(matchDisplayError('unknown'));
  });
});
