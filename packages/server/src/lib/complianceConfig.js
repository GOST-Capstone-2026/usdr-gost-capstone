function profileEnabled() {
    return process.env.ENABLE_GRANT_COMPLIANCE === 'true'
        && process.env.ENABLE_ORGANIZATION_PROFILES === 'true';
}

function matchingEnabled() {
    return profileEnabled() && process.env.ENABLE_GRANT_MATCHING === 'true';
}

module.exports = { profileEnabled, matchingEnabled };
