import * as fetchApi from '@/helpers/fetchApi';
import { presentMatchRun } from '@/helpers/rankedMatchResults';

const invalid = (code = 'VALIDATION_ERROR') => Object.assign(new Error(code), { code });

export function organizationId(value) {
  if (!['string', 'number'].includes(typeof value) || !/^(0|[1-9]\d*)$/.test(String(value))) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= 2147483647 ? parsed : null;
}

export function parseCandidateIds(value, limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || typeof value !== 'string') throw invalid();
  if (!value.trim()) return undefined;
  const tokens = value.trim().split(/[\s,]+/);
  if (tokens.length > limit || tokens.some((token) => !/^\d+$/.test(token))) throw invalid();
  const ids = tokens.map(Number);
  if (ids.some((valueId) => !Number.isSafeInteger(valueId)) || new Set(ids).size !== ids.length) throw invalid();
  return ids;
}

export function matchApiError(error) {
  if (error?.code) return { code: error.code, retryable: false };
  try {
    const envelope = JSON.parse(error.message);
    if (typeof envelope?.error?.code === 'string') {
      return { code: envelope.error.code, retryable: envelope.error.retryable === true };
    }
  } catch (ignored) { /* Never display raw transport/provider text. */ }
  return { code: 'INTERNAL_ERROR', retryable: true };
}

function base(agencyId) {
  if (organizationId(agencyId) === null) throw invalid();
  return `/api/organizations/${agencyId}/compliance`;
}

export async function loadMatchProfile(agencyId) {
  const { profile } = await fetchApi.get(`${base(agencyId)}/profile`);
  if (!profile || profile.organizationId !== agencyId || !Number.isInteger(profile.id) || profile.id < 1
    || !Number.isInteger(profile.version) || profile.version < 1 || !Array.isArray(profile.focusAreas)) {
    throw invalid('INVALID_MATCH_RESULTS');
  }
  return profile;
}

function checkRun(envelope, agencyId, profile, expectedId) {
  const run = envelope?.run;
  if (!run || !Number.isInteger(run.id) || run.id < 1 || run.id > 2147483647
    || (expectedId !== undefined && run.id !== expectedId)
    || !['completed', 'reviewRequired'].includes(run.status) || run.kind !== 'grantMatching'
    || run.organizationId !== agencyId || run.profileId !== profile.id) throw invalid('INVALID_MATCH_RESULTS');
  if (run.profileVersion !== profile.version) throw invalid('VERSION_CONFLICT');
  presentMatchRun(run.result, { organizationId: agencyId, profileId: profile.id, profileVersion: profile.version });
  return run;
}

export async function loadSavedMatch(agencyId, profile, runId) {
  if (!/^[1-9]\d*$/.test(String(runId)) || Number(runId) > 2147483647) throw invalid();
  return checkRun(await fetchApi.get(`${base(agencyId)}/match-runs/${runId}`), agencyId, profile, Number(runId));
}

export async function startSavedMatch(agencyId, profile, { limit, candidateText }) {
  const candidateGrantIds = parseCandidateIds(candidateText, limit);
  const body = {
    profileId: profile.id,
    profileVersion: profile.version,
    limit,
    ...(candidateGrantIds === undefined ? {} : { candidateGrantIds }),
  };
  return checkRun(await fetchApi.post(`${base(agencyId)}/match-runs`, body), agencyId, profile);
}
