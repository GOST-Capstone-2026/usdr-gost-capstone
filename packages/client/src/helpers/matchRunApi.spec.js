import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import * as fetchApi from '@/helpers/fetchApi';
import {
  organizationId, parseCandidateIds, matchApiError, loadMatchProfile, loadSavedMatch, startSavedMatch,
} from '@/helpers/matchRunApi';
import { makeMatchRun } from '@/test-utils/matchRunFixture';

vi.mock('@/helpers/fetchApi', () => ({ get: vi.fn(), post: vi.fn() }));
const profile = () => ({
  id: 1, version: 2, organizationId: 0, focusAreas: ['flooding'],
});
const envelope = () => ({
  run: {
    id: 9,
    organizationId: 0,
    profileId: 1,
    profileVersion: 2,
    kind: 'grantMatching',
    status: 'reviewRequired',
    result: makeMatchRun(),
  },
});
beforeEach(() => vi.resetAllMocks());

describe('C-11 organization-owned match API client', () => {
  it('keeps organization zero valid without coercing missing, boolean, fractional or scientific IDs', () => {
    expect(organizationId('0')).toBe(0);
    expect(organizationId(3)).toBe(3);
    [null, undefined, '', false, true, -1, 0.1, '1e2', '0x10', 2147483648].forEach((value) => expect(organizationId(value)).toBeNull());
  });
  it('parses bounded explicit candidates and leaves an empty selection to the server', () => {
    expect(parseCandidateIds('930001, 930004\n930005', 3)).toEqual([930001, 930004, 930005]);
    expect(parseCandidateIds(' ', 25)).toBeUndefined();
  });
  it.each(['1,1', '1,01', '-1', '1.1', '1e3', '0xff', 'abc', '9007199254740992'])('rejects invalid candidate text %s', (value) => {
    expect(() => parseCandidateIds(value, 25)).toThrow('VALIDATION_ERROR');
  });
  it('rejects a candidate count exceeding the limit and invalid limits', () => {
    expect(() => parseCandidateIds('1,2', 1)).toThrow();
    [0, 51, 1.5, '25', null].forEach((limit) => expect(() => parseCandidateIds('', limit)).toThrow());
  });
  it('loads and validates the saved profile instead of accepting browser-authored profile input', async () => {
    fetchApi.get.mockResolvedValue({ profile: profile() });
    expect(await loadMatchProfile(0)).toEqual(profile());
    expect(fetchApi.get).toHaveBeenCalledWith('/api/organizations/0/compliance/profile');
    fetchApi.get.mockResolvedValue({ profile: { ...profile(), organizationId: 2 } });
    await expect(loadMatchProfile(0)).rejects.toThrow('INVALID_MATCH_RESULTS');
  });
  it('sends only profile identity/version, numeric candidate IDs, and limit', async () => {
    fetchApi.post.mockResolvedValue(envelope());
    await startSavedMatch(0, profile(), { limit: 2, candidateText: '930001,930004' });
    expect(fetchApi.post).toHaveBeenCalledWith('/api/organizations/0/compliance/match-runs', {
      profileId: 1, profileVersion: 2, limit: 2, candidateGrantIds: [930001, 930004],
    });
    expect(fetchApi.post.mock.calls[0][1]).not.toHaveProperty('profile');
    expect(fetchApi.post.mock.calls[0][1]).not.toHaveProperty('tenantId');
  });
  it('constructs its own organization-scoped saved-run URL and ignores returned links', async () => {
    fetchApi.get.mockResolvedValue({ ...envelope(), links: { self: 'https://evil.test/' } });
    expect((await loadSavedMatch(0, profile(), '9')).id).toBe(9);
    expect(fetchApi.get).toHaveBeenCalledWith('/api/organizations/0/compliance/match-runs/9');
  });
  it.each(['0', '-1', '1.5', '1e2', 'abc', 'https://evil.test', '2147483648'])('rejects invalid saved-run ID %s before fetching', async (id) => {
    await expect(loadSavedMatch(0, profile(), id)).rejects.toThrow('VALIDATION_ERROR');
    expect(fetchApi.get).not.toHaveBeenCalled();
  });
  it('rejects stale versions and responses with different identity or unfinished state', async () => {
    const data = envelope();
    data.run.profileVersion = 1;
    fetchApi.get.mockResolvedValue(data);
    await expect(loadSavedMatch(0, profile(), 9)).rejects.toThrow('VERSION_CONFLICT');
    await [{ organizationId: 2 }, { profileId: 2 }, { id: 10 }, { status: 'processing' }, { kind: 'documentAnalysis' }].reduce((previous, update) => previous.then(async () => {
      fetchApi.get.mockResolvedValue({ run: { ...envelope().run, ...update } });
      await expect(loadSavedMatch(0, profile(), 9)).rejects.toThrow('INVALID_MATCH_RESULTS');
    }), Promise.resolve());
  });
  it('rejects otherwise successful responses with unsafe ranking/explanation content', async () => {
    const data = envelope();
    data.run.result.results[3].rank = 1;
    fetchApi.post.mockResolvedValue(data);
    await expect(startSavedMatch(0, profile(), { limit: 25, candidateText: '' })).rejects.toThrow('INVALID_MATCH_RESULTS');
  });
  it('preserves only controlled error codes/retry flags, never raw server text', () => {
    expect(matchApiError(new Error(JSON.stringify({ error: { code: 'MATCHING_BUSY', retryable: true, message: 'private SQL secret' } })))).toEqual({ code: 'MATCHING_BUSY', retryable: true });
    expect(matchApiError(new Error('private SQL secret'))).toEqual({ code: 'INTERNAL_ERROR', retryable: true });
    expect(matchApiError(Object.assign(new Error('private'), { code: 'VERSION_CONFLICT' }))).toEqual({ code: 'VERSION_CONFLICT', retryable: false });
  });
});
