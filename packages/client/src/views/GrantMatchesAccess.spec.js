import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import { shallowMount } from '@vue/test-utils';
import { createStore } from 'vuex';
import BaseLayout from '@/components/BaseLayout.vue';
import { grantMatchingEnabled } from '@/helpers/featureFlags';
import router from '@/router';
import store from '@/store';

// Exercise the actual route guards without loading the unrelated legacy grants table runtime.
vi.mock('@/views/GrantsView.vue', () => ({ default: { template: '<div>Browse Grants</div>' } }));

const enabledFlags = { grantComplianceEnabled: true, organizationProfilesEnabled: true, grantMatchingEnabled: true };
let wrapper;
beforeEach(() => {
  window.sessionStorage.removeItem('featureFlags');
  window.APP_CONFIG = { featureFlags: { ...enabledFlags } };
});
afterEach(() => {
  wrapper?.unmount();
  store.commit('users/SET_LOGGED_IN_USER', null);
  window.sessionStorage.removeItem('featureFlags');
});
function nav(role) {
  wrapper = shallowMount(BaseLayout, {
    global: {
      plugins: [createStore({
        getters: {
          'users/loggedInUser': () => ({ name: 'Test User' }),
          'users/userRole': () => role,
          'users/selectedAgency': () => null,
          'users/selectedAgencyId': () => '0',
          'alerts/alerts': () => [],
        },
      })],
      mocks: { $route: { meta: {} } },
      stubs: ['router-view'],
    },
  });
  return wrapper.find('[to="/compliance/matches"]').exists();
}

describe('C-11 route and navigation flags', () => {
  it.each(Object.keys(enabledFlags))('requires literal true for %s and stays off when missing', (name) => {
    expect(grantMatchingEnabled()).toBe(true);
    delete window.APP_CONFIG.featureFlags[name];
    expect(grantMatchingEnabled()).toBe(false);
    window.APP_CONFIG.featureFlags[name] = 'true';
    expect(grantMatchingEnabled()).toBe(false);
  });
  it.each(['admin', 'staff'])('shows the entry point to a supported %s account', (role) => {
    expect(nav(role)).toBe(true);
  });
  it('hides the entry point for unsupported roles and disabled flags', () => {
    expect(nav('viewer')).toBe(false);
    wrapper.unmount(); window.APP_CONFIG.featureFlags.grantMatchingEnabled = false;
    expect(nav('admin')).toBe(false);
  });
  it('redirects unauthenticated direct navigation to login', async () => {
    store.commit('users/SET_LOGGED_IN_USER', null);
    await router.push('/compliance/matches');
    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query.redirect_to).toContain('/compliance/matches');
  });
  it('blocks direct navigation when matching is disabled, and admits it when enabled', async () => {
    store.commit('users/SET_LOGGED_IN_USER', { role: { name: 'staff' }, agency: { id: 0 } });
    window.APP_CONFIG.featureFlags.grantMatchingEnabled = false;
    await router.push('/compliance/matches');
    expect(router.currentRoute.value.name).toBe('grants');
    window.APP_CONFIG.featureFlags.grantMatchingEnabled = true;
    await router.push('/compliance/matches?runId=9');
    expect(router.currentRoute.value.name).toBe('grantMatches');
  });
});
