function profileEnabled() {
    return process.env.ENABLE_GRANT_COMPLIANCE === 'true'
        && process.env.ENABLE_ORGANIZATION_PROFILES === 'true';
}

function matchingEnabled() {
    return profileEnabled() && process.env.ENABLE_GRANT_MATCHING === 'true';
}

function documentAnalysisEnabled() {
    return process.env.ENABLE_GRANT_COMPLIANCE === 'true'
        && process.env.ENABLE_GRANT_DOCUMENT_ANALYSIS === 'true';
}

function checklistsEnabled() {
    return documentAnalysisEnabled() && process.env.ENABLE_COMPLIANCE_CHECKLISTS === 'true';
}

function deadlinesEnabled() {
    return checklistsEnabled() && process.env.ENABLE_COMPLIANCE_DEADLINES === 'true';
}

module.exports = {
    profileEnabled, matchingEnabled, documentAnalysisEnabled, checklistsEnabled, deadlinesEnabled,
};
