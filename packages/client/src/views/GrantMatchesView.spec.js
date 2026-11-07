import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';
import { createStore } from 'vuex';
import GrantMatchesView from '@/views/GrantMatchesView.vue';
import * as api from '@/helpers/matchRunApi';
import * as flags from '@/helpers/featureFlags';
import { makeMatchRun } from '@/test-utils/matchRunFixture';

vi.mock('@/helpers/matchRunApi', async (original) => ({
  ...await original(), loadMatchProfile: vi.fn(), loadSavedMatch: vi.fn(), startSavedMatch: vi.fn(),
}));
vi.mock('@/helpers/featureFlags', async (original) => ({ ...await original(), grantMatchingEnabled: vi.fn() }));
const profile = (organizationId = 0) => ({
  id: organizationId + 1, version: 2, organizationId, focusAreas: ['flooding'],
});
const run = () => ({ id: 9, status: 'reviewRequired', result: makeMatchRun() });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
let wrapper;
let store;
let route;
let router;
beforeEach(() => {
  vi.resetAllMocks();
  flags.grantMatchingEnabled.mockReturnValue(true);
  api.loadMatchProfile.mockResolvedValue(profile());
  api.loadSavedMatch.mockResolvedValue(run());
  api.startSavedMatch.mockResolvedValue(run());
  store = createStore({
    state: { selected: '0', role: 'staff' },
    getters: { 'users/selectedAgencyId': (state) => state.selected, 'users/userRole': (state) => state.role },
  });
  route = reactive({ query: {} });
  router = { replace: vi.fn().mockResolvedValue(), hasRoute: () => true };
});
afterEach(() => wrapper?.unmount());
function render() {
  wrapper = mount(GrantMatchesView, { global: { plugins: [store], mocks: { $route: route, $router: router } } });
  return wrapper;
}

describe('C-11 live match page request lifecycle', () => {
  it('loads the selected saved profile and does not start inference automatically', async () => {
    render(); await flushPromises();
    expect(api.loadMatchProfile).toHaveBeenCalledWith(0);
    expect(api.startSavedMatch).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Profile 1, version 2');
    expect(wrapper.text()).toContain('not an exhaustive search');
  });
  it('starts a match explicitly, renders actual results, and records a reopenable URL', async () => {
    render(); await flushPromises();
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(api.startSavedMatch).toHaveBeenCalledWith(0, profile(), { limit: 25, candidateText: '' });
    expect(wrapper.findAll('article')).toHaveLength(5);
    expect(wrapper.text()).toContain('Saved run 9');
    expect(router.replace).toHaveBeenCalledWith({ name: 'grantMatches', query: { runId: '9' } });
  });
  it('reopens a saved run only after loading the current profile', async () => {
    route.query.runId = '9'; render(); await flushPromises();
    expect(api.loadSavedMatch).toHaveBeenCalledWith(0, profile(), '9');
    expect(api.startSavedMatch).not.toHaveBeenCalled();
    expect(wrapper.findAll('article')).toHaveLength(5);
  });
  it('disables all run inputs and hides previous results while matching', async () => {
    const request = deferred(); api.startSavedMatch.mockReturnValue(request.promise);
    render(); await flushPromises(); await wrapper.get('form').trigger('submit');
    expect(wrapper.get('input').attributes('disabled')).toBeDefined();
    expect(wrapper.get('textarea').attributes('disabled')).toBeDefined();
    expect(wrapper.findAll('article')).toHaveLength(0);
    expect(wrapper.text()).toContain('Matching and saving');
    request.resolve(run()); await flushPromises();
  });
  it('ignores an old organization profile response after selection changes', async () => {
    const old = deferred(); api.loadMatchProfile.mockReturnValueOnce(old.promise).mockResolvedValueOnce(profile(3));
    render(); store.state.selected = '3'; await flushPromises();
    old.resolve(profile()); await flushPromises();
    expect(wrapper.text()).toContain('Team 3');
    expect(wrapper.text()).not.toContain('Profile 1, version 2');
    expect(wrapper.findAll('article')).toHaveLength(0);
  });
  it('never shows a completed old-org match or changes the URL after selection changes', async () => {
    const old = deferred(); api.startSavedMatch.mockReturnValueOnce(old.promise);
    render(); await flushPromises(); await wrapper.get('form').trigger('submit');
    api.loadMatchProfile.mockResolvedValue(profile(3)); store.state.selected = '3'; await flushPromises();
    old.resolve(run()); await flushPromises();
    expect(wrapper.findAll('article')).toHaveLength(0);
    expect(router.replace).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Team 3');
  });
  it('hides loaded results when the account loses its supported role', async () => {
    route.query.runId = '9'; render(); await flushPromises();
    store.state.role = 'viewer'; await flushPromises();
    expect(wrapper.findAll('article')).toHaveLength(0);
    expect(wrapper.text()).toContain('not available for this account');
  });
  it('does not fetch when flags are off or no valid organization is selected', async () => {
    flags.grantMatchingEnabled.mockReturnValue(false); render(); await flushPromises();
    expect(api.loadMatchProfile).not.toHaveBeenCalled();
    wrapper.unmount(); flags.grantMatchingEnabled.mockReturnValue(true); store.state.selected = '';
    render(); await flushPromises();
    expect(api.loadMatchProfile).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Select a team');
  });
  it('requires a saved profile and focus area before enabling a match', async () => {
    api.loadMatchProfile.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'NOT_FOUND' }));
    render(); await flushPromises();
    expect(wrapper.text()).toContain('No saved organization profile');
    expect(wrapper.find('form').exists()).toBe(false);
    wrapper.unmount(); api.loadMatchProfile.mockResolvedValueOnce({ ...profile(), focusAreas: [] });
    render(); await flushPromises();
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
  });
  it('handles version conflicts without displaying stale saved results', async () => {
    route.query.runId = '9'; api.loadSavedMatch.mockRejectedValueOnce(Object.assign(new Error('raw SQL secret'), { code: 'VERSION_CONFLICT' }));
    render(); await flushPromises();
    expect(wrapper.findAll('article')).toHaveLength(0);
    expect(wrapper.text()).toContain('profile changed');
    expect(wrapper.text()).not.toContain('SQL secret');
  });
  it('handles failed starts without inventing a saved run or replaying the POST', async () => {
    api.startSavedMatch.mockRejectedValueOnce(new Error(JSON.stringify({ error: { code: 'MATCHING_BUSY', retryable: true } })));
    render(); await flushPromises(); await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(wrapper.text()).toContain('matcher is busy');
    expect(wrapper.findAll('article')).toHaveLength(0);
    expect(router.replace).not.toHaveBeenCalled();
    const retry = wrapper.findAll('button').find((button) => button.text() === 'Retry loading results');
    await retry.trigger('click'); await flushPromises();
    expect(api.startSavedMatch).toHaveBeenCalledTimes(1);
  });
});
