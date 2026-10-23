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

  it('loads and saves the seeded organization with numeric ID zero', async () => {
    vi.mocked(fetchApi.get).mockResolvedValue({ profile: sampleProfile });
    vi.mocked(fetchApi.put).mockResolvedValue({ profile: { ...sampleProfile, version: 4 } });
    const wrapper = mount(OrganizationProfileView, { global: { plugins: [profileStore(0)] } });
    await flushPromises();
    expect(fetchApi.get).toHaveBeenCalledWith('/api/organizations/0/compliance/profile');
    expect(wrapper.find('form').exists()).toBe(true);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(fetchApi.put).toHaveBeenCalledWith(
      '/api/organizations/0/compliance/profile',
      expect.objectContaining({ expectedVersion: 3 }),
    );
    expect(wrapper.text()).toContain('Organization profile saved.');
    wrapper.unmount();
  });

  it.each([null, undefined, ''])('does not load a profile without a selected team (%s)', async (agencyId) => {
    const store = profileStore();
    store.commit('setAgencyId', agencyId);
    const wrapper = mount(OrganizationProfileView, { global: { plugins: [store] } });
    await flushPromises();
    expect(fetchApi.get).not.toHaveBeenCalled();
    expect(wrapper.find('form').exists()).toBe(false);
    expect(wrapper.text()).toContain('Select a team');
    wrapper.unmount();
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

  it('locks every profile field during saving and prevents duplicate requests', async () => {
    let finishSave;
    vi.mocked(fetchApi.get).mockResolvedValue({ profile: sampleProfile });
    vi.mocked(fetchApi.put).mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }));
    const wrapper = mount(OrganizationProfileView, { global: { plugins: [profileStore()] } });
    await flushPromises();
    const controls = wrapper.findAll('input, select, textarea');
    expect(controls).toHaveLength(12);
    controls.forEach((control) => expect(control.element.disabled).toBe(false));
    await wrapper.get('#jurisdiction-name').setValue('Saved City');
    await wrapper.get('form').trigger('submit');
    controls.forEach((control) => expect(control.element.disabled).toBe(true));
    expect(wrapper.get('button[type="submit"]').element.disabled).toBe(true);
    await wrapper.get('form').trigger('submit');
    expect(fetchApi.put).toHaveBeenCalledTimes(1);
    finishSave({ profile: { ...sampleProfile, version: 4, jurisdiction: { ...sampleProfile.jurisdiction, name: 'Saved City' } } });
    await flushPromises();
    wrapper.findAll('input, select, textarea').forEach((control) => expect(control.element.disabled).toBe(false));
    expect(wrapper.get('#jurisdiction-name').element.value).toBe('Saved City');
    expect(wrapper.text()).toContain('Organization profile saved.');
    wrapper.unmount();
  });

  it('unlocks fields after a failed save without discarding the entered values', async () => {
    let failSave;
    vi.mocked(fetchApi.get).mockResolvedValue({ profile: sampleProfile });
    vi.mocked(fetchApi.put).mockImplementation(() => new Promise((resolve, reject) => { failSave = reject; }));
    const wrapper = mount(OrganizationProfileView, { global: { plugins: [profileStore()] } });
    await flushPromises();
    await wrapper.get('#jurisdiction-name').setValue('Keep My Edit');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.get('#jurisdiction-name').element.disabled).toBe(true);
    failSave(new Error('Network failure'));
    await flushPromises();
    wrapper.findAll('input, select, textarea').forEach((control) => expect(control.element.disabled).toBe(false));
    expect(wrapper.get('#jurisdiction-name').element.value).toBe('Keep My Edit');
    expect(wrapper.text()).toContain('Could not save the organization profile.');
    expect(wrapper.vm.profileVersion).toBe(3);
    wrapper.unmount();
  });

  it('creates a missing profile with expectedVersion zero', async () => {
    const missing = new Error(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'The organization profile was not found.' } }));
    missing.response = { status: 404 };
    vi.mocked(fetchApi.get).mockRejectedValue(missing);
    vi.mocked(fetchApi.put).mockResolvedValue({ profile: { ...sampleProfile, version: 1 } });
    const wrapper = mount(OrganizationProfileView, { global: { plugins: [profileStore(0)] } });
    await flushPromises();
    await wrapper.get('#jurisdiction-name').setValue('New City');
    await wrapper.get('#state-code').setValue('FL');
    await wrapper.get('#population').setValue('1000');
    await wrapper.get('#staffing-fte').setValue('1');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(fetchApi.put).toHaveBeenCalledWith('/api/organizations/0/compliance/profile', expect.objectContaining({ expectedVersion: 0 }));
    expect(wrapper.vm.profileVersion).toBe(1);
    expect(wrapper.text()).toContain('Organization profile saved.');
    wrapper.unmount();
  });

  it('ignores a late load response from the previously selected team', async () => {
    let finishOld;
    vi.mocked(fetchApi.get).mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockResolvedValueOnce({ profile: { ...sampleProfile, jurisdiction: { ...sampleProfile.jurisdiction, name: 'New Team City' } } });
    const store = profileStore(4);
    const wrapper = mount(OrganizationProfileView, { global: { plugins: [store] } });
    await flushPromises();
    store.commit('setAgencyId', 5);
    await flushPromises();
    finishOld({ profile: sampleProfile });
    await flushPromises();
    expect(wrapper.get('#jurisdiction-name').element.value).toBe('New Team City');
    wrapper.unmount();
  });

  it('ignores a late save response after switching to a different team', async () => {
    let finishOldSave;
    vi.mocked(fetchApi.get).mockResolvedValueOnce({ profile: sampleProfile })
      .mockResolvedValueOnce({ profile: { ...sampleProfile, version: 8, jurisdiction: { ...sampleProfile.jurisdiction, name: 'New Team City' } } });
    vi.mocked(fetchApi.put).mockImplementation(() => new Promise((resolve) => { finishOldSave = resolve; }));
    const store = profileStore(4);
    const wrapper = mount(OrganizationProfileView, { global: { plugins: [store] } });
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    store.commit('setAgencyId', 5);
    await flushPromises();
    finishOldSave({ profile: { ...sampleProfile, version: 4 } });
    await flushPromises();
    expect(wrapper.get('#jurisdiction-name').element.value).toBe('New Team City');
    expect(wrapper.vm.profileVersion).toBe(8);
    expect(wrapper.text()).not.toContain('Organization profile saved.');
    wrapper.unmount();
  });
});
