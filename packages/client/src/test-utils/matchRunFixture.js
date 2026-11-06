// Synthetic display controls only; not real grants or evidence of ranking quality.
export const matchContext = { organizationId: 0, profileId: 1, profileVersion: 2 };

export function makeMatchRun() {
  const run = {
    ...matchContext,
    methodVersion: 'matcher-minilm-v2',
    explanationVersion: 'grounded-match-v1',
    explanationMethod: 'extractive-template',
    model: 'synthetic-display-test-model',
    screenedOn: '2026-10-25',
    inputHash: 'a'.repeat(64),
    explanationHash: 'b'.repeat(64),
    candidateCount: 5,
    rankedCount: 3,
    blockedCount: 1,
  };
  run.results = [
    {
      grantId: 1, rank: 1, score: 0.295913, disposition: 'eligible', title: 'Synthetic flood program',
    },
    {
      grantId: 2, rank: 2, score: 0.293755, disposition: 'reviewRequired', title: 'Synthetic basin program', uncertainties: ['Geographic eligibility is unverified.'],
    },
    {
      grantId: 3, rank: 3, score: 0, disposition: 'eligible', title: 'Synthetic zero-score program',
    },
    {
      grantId: 4,
      rank: null,
      score: null,
      disposition: 'blocked',
      title: 'Synthetic closed program',
      blockers: [
        { code: 'OPPORTUNITY_CLOSED', severity: 'hard', message: 'The opportunity is closed.' },
        { code: 'MATCHING_FUNDS_UNAVAILABLE', severity: 'hard', message: 'Matching funds are unavailable.' },
      ],
      uncertainties: ['Review the geographic restrictions as well.'],
    },
    {
      grantId: 5, rank: null, score: null, disposition: 'reviewRequired', title: '', uncertainties: ['Listing text is missing.'],
    },
  ].map(({ title, ...input }) => {
    const row = {
      blockers: [],
      uncertainties: [],
      ...input,
      sourceRevision: 1,
      sourceTextHash: 'c'.repeat(64),
      explanation: `Synthetic explanation for grant ${input.grantId}.`,
    };
    const provenance = {
      ...matchContext,
      inputHash: run.inputHash,
      grantId: row.grantId,
      sourceRevision: 1,
      sourceTextHash: row.sourceTextHash,
      screenedOn: run.screenedOn,
    };
    const evidence = [{
      id: 'profile-focus', kind: 'profileField', profileId: 1, profileVersion: 2, field: 'focusAreas', value: ['flooding'],
    }, {
      id: 'screening',
      kind: 'screeningAndReviewResult',
      grantId: row.grantId,
      screenedOn: run.screenedOn,
      disposition: row.disposition,
      blockers: row.blockers,
      uncertainties: row.uncertainties,
    }];
    if (row.score !== null) {
      evidence.push({
        id: 'ranking', kind: 'rankingResult', grantId: row.grantId, rank: row.rank, score: row.score, inputHash: run.inputHash,
      });
    }
    if (title) {
      evidence.push({
        id: 'listing-title',
        kind: 'listingText',
        grantId: row.grantId,
        sourceRevision: 1,
        sourceTextHash: row.sourceTextHash,
        field: 'title',
        normalizedField: 'title',
        excerpt: title,
        startOffset: 0,
        endOffset: title.length,
        truncated: false,
      });
    }
    return {
      ...row,
      explanationDetails: {
        version: 'grounded-match-v1',
        method: 'extractive-template',
        model: null,
        verificationStatus: 'unverified',
        provenance,
        evidence,
        claims: [{ code: 'PROFILE_FOCUS', text: 'Saved focus: flooding.', evidenceIds: ['profile-focus'] }],
        limitations: ['Review the full notice. These listing excerpts are not PDF citations.'],
      },
    };
  });
  return run;
}
