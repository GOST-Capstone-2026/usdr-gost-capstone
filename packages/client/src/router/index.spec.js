import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import { createRouter, createWebHistory } from 'vue-router';

import defaultRouter, { routes } from '@/router';
import store from '@/store';

// Exercise the real guards without loading page-only Bootstrap/Vue-compat integrations.
vi.mock('@/views/GrantsView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/views/OrganizationProfileView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/views/ComplianceDeadlinesView.vue', () => ({ default: { template: '<div />' } }));

describe('Router logic', () => {
  it('displays 404 page for unknown route', async () => {
    const router = createRouter({ routes, history: createWebHistory() });
    await router.push('/rants');
    expect(router.currentRoute.value.name).toBe('notFound');
  });

  it('redirects hash URLs to non-hash URLS', async () => {
    const router = createRouter({ routes, history: createWebHistory() });
    await router.push('/#/login');
    expect(router.currentRoute.value.fullPath).toBe('/login');
    expect(router.currentRoute.value.name).toBe('login');
  });

  describe('organization-profile and deadline integration guards', () => {
    const allOn = {
      grantComplianceEnabled: true,
      organizationProfilesEnabled: true,
      grantDocumentAnalysisEnabled: true,
      complianceChecklistsEnabled: true,
      complianceDeadlinesEnabled: true,
    };
    let previousConfig;
    let previousUser;
    let previousOverrides;

    beforeEach(async () => {
      previousConfig = window.APP_CONFIG;
      previousUser = store.state.users.loggedInUser;
      previousOverrides = window.sessionStorage.getItem('featureFlags');
      window.sessionStorage.removeItem('featureFlags');
      window.APP_CONFIG = { featureFlags: { ...allOn } };
      store.commit('users/SET_LOGGED_IN_USER', {
        id: 1, role: { name: 'admin' }, agency: { id: 0, subagencies: [] },
      });
      await defaultRouter.push('/grants');
    });

    afterEach(() => {
      store.commit('users/SET_LOGGED_IN_USER', previousUser);
      if (previousConfig === undefined) delete window.APP_CONFIG;
      else window.APP_CONFIG = previousConfig;
      if (previousOverrides === null) window.sessionStorage.removeItem('featureFlags');
      else window.sessionStorage.setItem('featureFlags', previousOverrides);
    });

    it('keeps separate authenticated profile, deadline, and document-demo routes', () => {
      const { children } = routes.find(({ name }) => name === 'layout');
      ['/compliance/profile', '/compliance/deadlines', '/grant-document-demo'].forEach((path) => {
        const matches = children.filter((route) => route.path === path);
        expect(matches).toHaveLength(1);
        expect(matches[0].meta.requiresAuth).toBe(true);
      });
      expect(children.find(({ name }) => name === 'complianceProfile').meta.requiresOrganizationProfilesEnabled).toBe(true);
      expect(children.find(({ name }) => name === 'complianceDeadlines').meta.requiresComplianceDeadlinesEnabled).toBe(true);
    });

    it('allows profiles without enabling the document/deadline feature chain', async () => {
      window.APP_CONFIG.featureFlags = { grantComplianceEnabled: true, organizationProfilesEnabled: true };
      await defaultRouter.push('/compliance/profile');
      expect(defaultRouter.currentRoute.value.name).toBe('complianceProfile');
    });

    it.each(['grantComplianceEnabled', 'organizationProfilesEnabled'])('blocks the profile route when %s is off', async (flag) => {
      window.APP_CONFIG.featureFlags[flag] = false;
      await defaultRouter.push('/compliance/profile');
      expect(defaultRouter.currentRoute.value.name).toBe('grants');
    });

    it('keeps the deadline route independent of the organization-profile flag', async () => {
      window.APP_CONFIG.featureFlags.organizationProfilesEnabled = false;
      await defaultRouter.push('/compliance/deadlines');
      expect(defaultRouter.currentRoute.value.name).toBe('complianceDeadlines');
    });

    it.each([
      'grantComplianceEnabled', 'grantDocumentAnalysisEnabled', 'complianceChecklistsEnabled', 'complianceDeadlinesEnabled',
    ])('blocks the deadline route when %s is off', async (flag) => {
      window.APP_CONFIG.featureFlags[flag] = false;
      await defaultRouter.push('/compliance/deadlines');
      expect(defaultRouter.currentRoute.value.name).toBe('grants');
    });

    it('requires login for the profile route and preserves the return URL', async () => {
      store.commit('users/SET_LOGGED_IN_USER', null);
      await defaultRouter.push('/compliance/profile');
      expect(defaultRouter.currentRoute.value.name).toBe('login');
      expect(defaultRouter.currentRoute.value.query.redirect_to).toBe('/compliance/profile');
    });
  });
});
