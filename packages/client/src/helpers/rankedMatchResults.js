const DISPOSITIONS = new Set(['eligible', 'reviewRequired', 'blocked']);
const HASH = /^[a-f0-9]{64}$/;
const text = (value) => typeof value === 'string' && value.length <= 32000;
const id = (value) => Number.isSafeInteger(value) && value >= 0;
const fail = (code) => { throw Object.assign(new Error(code), { code }); };

export function matchDisplayError(code) {
  const messages = {
    STALE_MATCH_RESULTS: 'These results belong to a different organization or profile version. Load results for the current selection.',
    INVALID_MATCH_RESULTS: 'These results could not be safely displayed. Reload them or contact the team.',
    FORBIDDEN: 'You do not have access to these results.',
    FEATURE_DISABLED: 'Grant matching is not currently available.',
    VERSION_CONFLICT: 'The saved profile changed. Reload it before starting another match.',
    NOT_FOUND: 'No saved match run was found for this selection.',
    MODEL_NOT_CACHED: 'The matching service is not ready. Ask the team to prepare the pinned model.',
    VALIDATION_ERROR: 'Check the candidate IDs and limit. Use unique integer IDs, with no more IDs than the selected limit.',
    PROFILE_FOCUS_REQUIRED: 'Add at least one focus area to the saved organization profile.',
    MATCHING_BUSY: 'The matcher is busy. Wait briefly, then start a new match.',
    MATCH_STORAGE_UNAVAILABLE: 'Saved-match storage is not ready. Ask the team to apply the migration.',
    INVALID_PROFILE: 'Review and save the organization profile before matching.',
  };
  return Object.prototype.hasOwnProperty.call(messages, code)
    ? messages[code] : 'The results could not be loaded. Try again later.';
}

function evidenceMatches(item, row, run) {
  if (!item || !text(item.id) || !item.id || !text(item.kind)) return false;
  if (item.kind === 'profileField') {
    return item.profileId === run.profileId && item.profileVersion === run.profileVersion;
  }
  if (!id(item.grantId) || item.grantId !== row.grantId) return false;
  if (item.kind === 'rankingResult') {
    return item.score === row.score && item.rank === row.rank && item.inputHash === run.inputHash;
  }
  if (item.kind === 'screeningAndReviewResult') {
    return item.disposition === row.disposition && item.screenedOn === run.screenedOn
      && JSON.stringify(item.blockers) === JSON.stringify(row.blockers)
      && JSON.stringify(item.uncertainties) === JSON.stringify(row.uncertainties);
  }
  if (item.kind !== 'listingText') return false;
  return ['title', 'description'].includes(item.normalizedField) && text(item.field)
    && text(item.excerpt) && item.excerpt.length <= 240
    && Number.isSafeInteger(item.startOffset) && item.startOffset >= 0
    && Number.isSafeInteger(item.endOffset) && item.endOffset >= item.startOffset
    && item.endOffset - item.startOffset === item.excerpt.length
    && typeof item.truncated === 'boolean' && item.sourceRevision === row.sourceRevision
    && item.sourceTextHash === row.sourceTextHash;
}

function validDetails(row, run) {
  const details = row.explanationDetails;
  const provenance = details?.provenance;
  if (!details || details.version !== 'grounded-match-v1' || details.method !== 'extractive-template' || details.model !== null
    || details.verificationStatus !== 'unverified' || !provenance
    || provenance.organizationId !== run.organizationId || provenance.profileId !== run.profileId
    || provenance.profileVersion !== run.profileVersion || provenance.inputHash !== run.inputHash
    || provenance.grantId !== row.grantId || provenance.sourceRevision !== row.sourceRevision
    || provenance.sourceTextHash !== row.sourceTextHash || provenance.screenedOn !== run.screenedOn
    || !Array.isArray(details.evidence) || !details.evidence.length || details.evidence.length > 32
    || !Array.isArray(details.claims) || !details.claims.length || details.claims.length > 128
    || !Array.isArray(details.limitations) || !details.limitations.every(text)) return false;
  const evidenceIds = new Set(details.evidence.map((item) => item?.id));
  return evidenceIds.size === details.evidence.length
    && details.evidence.every((item) => evidenceMatches(item, row, run))
    && details.claims.every((claim) => text(claim?.text) && text(claim.code)
      && Array.isArray(claim.evidenceIds) && claim.evidenceIds.length > 0
      && claim.evidenceIds.every((reference) => evidenceIds.has(reference)));
}

// Display validation is not server authorization or cryptographic verification of the source.
// The parent must supply the currently selected, authorized saved-profile identity.
export function presentMatchRun(run, context) {
  if (!context || !id(context.organizationId) || !id(context.profileId) || context.profileId < 1
    || !Number.isSafeInteger(context.profileVersion) || context.profileVersion < 1) fail('STALE_MATCH_RESULTS');
  if (!run || run.organizationId !== context.organizationId || run.profileId !== context.profileId
    || run.profileVersion !== context.profileVersion) fail('STALE_MATCH_RESULTS');
  if (run.explanationVersion !== 'grounded-match-v1' || run.explanationMethod !== 'extractive-template'
    || !HASH.test(run.inputHash) || !HASH.test(run.explanationHash)
    || !text(run.screenedOn) || !/^\d{4}-\d{2}-\d{2}$/.test(run.screenedOn)
    || !Number.isFinite(new Date(`${run.screenedOn}T00:00:00.000Z`).getTime())
    || new Date(`${run.screenedOn}T00:00:00.000Z`).toISOString().slice(0, 10) !== run.screenedOn
    || !text(run.model) || !text(run.methodVersion)
    || !Array.isArray(run.results) || run.results.length > 250
    || run.candidateCount !== run.results.length) fail('INVALID_MATCH_RESULTS');
  const seen = new Set();
  let ranked = 0;
  let blocked = 0;
  let unrankedSeen = false;
  let lastScore = Infinity;
  const rows = run.results.map((row) => {
    if (!row || !id(row.grantId) || seen.has(row.grantId) || !DISPOSITIONS.has(row.disposition)
      || !text(row.explanation) || !Array.isArray(row.blockers) || !Array.isArray(row.uncertainties)
      || !row.uncertainties.every(text) || !row.blockers.every((item) => item?.severity === 'hard' && text(item.code) && text(item.message))
      || !HASH.test(row.sourceTextHash) || !validDetails(row, run)) fail('INVALID_MATCH_RESULTS');
    seen.add(row.grantId);
    if (row.disposition === 'blocked') {
      blocked += 1;
      if (!row.blockers.length || row.rank !== null || row.score !== null) fail('INVALID_MATCH_RESULTS');
    } else if (row.blockers.length || (row.disposition === 'eligible' && row.uncertainties.length)
      || (row.disposition === 'reviewRequired' && !row.uncertainties.length)) fail('INVALID_MATCH_RESULTS');
    if (row.score === null) {
      if (row.rank !== null || row.disposition === 'eligible') fail('INVALID_MATCH_RESULTS');
      unrankedSeen = true;
    } else {
      ranked += 1;
      if (typeof row.score !== 'number' || !Number.isFinite(row.score) || row.score < 0 || row.score > 1
        || row.score > lastScore || row.rank !== ranked || unrankedSeen) fail('INVALID_MATCH_RESULTS');
      lastScore = row.score;
    }
    const title = row.explanationDetails.evidence.find((item) => item.kind === 'listingText' && item.normalizedField === 'title');
    return {
      ...row,
      displayTitle: title?.excerpt || `Grant ${row.grantId}`,
      titleIsPartial: title?.truncated === true,
      displayScore: row.score === null ? 'Not ranked' : row.score.toFixed(6),
      displayDisposition: {
        eligible: 'No hard blocker found', reviewRequired: 'Review required', blocked: 'Blocked — not ranked',
      }[row.disposition],
    };
  });
  if (run.rankedCount !== ranked || run.blockedCount !== blocked) fail('INVALID_MATCH_RESULTS');
  return {
    rows,
    ranked,
    blocked,
    reviewRequired: rows.filter((row) => row.disposition === 'reviewRequired').length,
    unranked: rows.length - ranked,
  };
}
