function profileEnabled() {
    return process.env.ENABLE_GRANT_COMPLIANCE === 'true'
        && process.env.ENABLE_ORGANIZATION_PROFILES === 'true';
}

module.exports = { profileEnabled };
