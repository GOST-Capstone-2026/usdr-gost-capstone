import { getFeatureFlags } from '@/helpers/featureFlags/utils';

export function grantMatchingEnabled() {
  const flags = getFeatureFlags();
  return flags.grantComplianceEnabled === true && flags.organizationProfilesEnabled === true
    && flags.grantMatchingEnabled === true;
}
