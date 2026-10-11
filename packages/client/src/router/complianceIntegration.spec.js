import {
  describe, it, expect, vi,
} from 'vitest';
import { routes } from '@/router';

vi.mock('@/store', () => ({ default: { getters: { 'users/loggedInUser': null } } }));

describe('first-demo route integration', () => {
  const { children } = routes.find((route) => route.name === 'layout');

  it('preserves the profile, extraction-demo, and portfolio routes together', () => {
    expect(children.map((route) => route.path)).toEqual(expect.arrayContaining([
      '/compliance/profile', '/grant-document-demo', '/compliance/deadlines',
    ]));
  });

  it('keeps authentication required for all three demo routes', () => {
    ['/compliance/profile', '/grant-document-demo', '/compliance/deadlines'].forEach((path) => {
      expect(children.find((route) => route.path === path).meta.requiresAuth).toBe(true);
    });
  });

  it('retains each profile and portfolio feature gate', () => {
    expect(children.find((route) => route.path === '/compliance/profile').meta.requiresOrganizationProfilesEnabled).toBe(true);
    expect(children.find((route) => route.path === '/compliance/deadlines').meta.requiresComplianceDeadlinesEnabled).toBe(true);
  });

  it('does not duplicate route names when combining the subsystems', () => {
    const names = children.map((route) => route.name).filter(Boolean);
    expect(new Set(names).size).toBe(names.length);
  });
});
