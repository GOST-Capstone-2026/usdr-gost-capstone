import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import OrganizationProfileView from '@/views/OrganizationProfileView.vue';
import * as fetchApi from '@/helpers/fetchApi';

vi.mock('@/helpers/fetchApi', () => ({ get: vi.fn(), put: vi.fn() }));

const sampleProfile = {
  version: 3,
  jurisdiction: {
    type: 'city', name: 'Example City', stateCode: 'FL', countyName: null,
  },
  population: 42000,
  focusAreas: ['stormwater'],
  staffingCapacity: { level: 'limited', fullTimeEquivalent: 1.5, notes: null },
  matchingFunds: { available: true, maximumAmountCents: 250000, notes: null },
};

function profileStore(agencyId = 4) {
  return createStore({
    state: { agencyId },
    getters: {
      'users/selectedAgencyId': (state) => state.agencyId,
      'users/selectedAgency': (state) => ({ name: `Team ${state.agencyId}` }),
    },
    mutations: {
      setAgencyId(state, id) { state.agencyId = id; },
    },
  });
}

describe('OrganizationProfileView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads the selected organization and saves edits with its profile version', async () => {
    vi.mocked(fetchApi.get).mockResolvedValue({ profile: sampleProfile });
    vi.mocked(fetchApi.put).mockResolvedValue({ profile: { ...sampleProfile, version: 4 } });
    const wrapper = mount(OrganizationProfileView, { global: { plugins: [profileStore()] } });
    await flushPromises();

    expect(fetchApi.get).toHaveBeenCalledWith('/api/organizations/4/compliance/profile');
    expect(wrapper.get('#jurisdiction-name').element.value).toBe('Example City');
    await wrapper.get('#jurisdiction-name').setValue('Updated City');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(fetchApi.put).toHaveBeenCalledWith(
      '/api/organizations/4/compliance/profile',
      expect.objectContaining({
        expectedVersion: 3,
        jurisdiction: expect.objectContaining({ name: 'Updated City' }),
        matchingFunds: expect.objectContaining({ maximumAmountCents: 250000 }),
      }),
    );
    expect(wrapper.text()).toContain('Organization profile saved.');
  });

  it('offers creation when the selected organization has no profile', async () => {
    const error = new Error(JSON.stringify({
      error: { code: 'NOT_FOUND', message: 'The organization profile was not found.' },
    }));
    error.response = { status: 404 };
    vi.mocked(fetchApi.get).mockRejectedValue(error);
    const wrapper = mount(OrganizationProfileView, { global: { plugins: [profileStore()] } });
    await flushPromises();

    expect(wrapper.text()).toContain('No profile exists');
    expect(wrapper.get('button[type="submit"]').text()).toBe('Save profile');
  });

  it('does not treat a disabled feature as an empty profile', async () => {
    const error = new Error(JSON.stringify({
      error: { code: 'FEATURE_DISABLED', message: 'This feature is not currently available.' },
    }));
    error.response = { status: 404 };
    vi.mocked(fetchApi.get).mockRejectedValue(error);
    const wrapper = mount(OrganizationProfileView, { global: { plugins: [profileStore()] } });
    await flushPromises();

    expect(wrapper.text()).toContain('This feature is not currently available.');
    expect(wrapper.find('form').exists()).toBe(false);
  });

  it('requires reload after a version conflict', async () => {
    vi.mocked(fetchApi.get).mockResolvedValue({ profile: sampleProfile });
    vi.mocked(fetchApi.put).mockRejectedValue(new Error(JSON.stringify({
      error: { code: 'VERSION_CONFLICT', message: 'The profile changed.' },
    })));
    const wrapper = mount(OrganizationProfileView, { global: { plugins: [profileStore()] } });
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('The profile changed.');
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('Reload latest profile');
  });

  it('reloads when the selected team changes', async () => {
    vi.mocked(fetchApi.get).mockResolvedValue({ profile: sampleProfile });
    const store = profileStore();
    const wrapper = mount(OrganizationProfileView, { global: { plugins: [store] } });
    await flushPromises();
    store.commit('setAgencyId', 5);
    await flushPromises();
    expect(fetchApi.get).toHaveBeenCalledWith('/api/organizations/5/compliance/profile');
    expect(wrapper.text()).toContain('Team 5');
  });
});
