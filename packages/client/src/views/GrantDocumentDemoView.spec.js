import {
  beforeEach, afterEach, describe, it, expect, vi,
} from 'vitest';
import { shallowMount } from '@vue/test-utils';
import { createStore } from 'vuex';
import GrantDocumentDemoView from '@/views/GrantDocumentDemoView.vue';
import * as fetchApi from '@/helpers/fetchApi';

vi.mock('@/helpers/fetchApi', () => ({ postFormData: vi.fn(), post: vi.fn(), get: vi.fn() }));

function demoWrapper() {
  const store = createStore({ getters: { 'users/selectedAgencyId': () => 0 } });
  return shallowMount(GrantDocumentDemoView, {
    global: { plugins: [store], stubs: { 'b-alert': true, 'b-badge': true } },
  });
}

describe('first-demo document identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('FormData', window.FormData);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('does not silently associate the notice with the seeded NSF fellowship', () => {
    const wrapper = demoWrapper();
    expect(wrapper.vm.grantId).toBe('');
    expect(wrapper.vm.validGrantId).toBe(false);
    expect(wrapper.find('#grant-opportunity-id').exists()).toBe(true);
    wrapper.unmount();
  });

  it.each(['', 'HUD-notice', '-1'])('rejects invalid opportunity ID %s before uploading', async (grantId) => {
    const wrapper = demoWrapper();
    await wrapper.setData({ grantId, selectedFile: new File(['sample'], 'notice.pdf', { type: 'application/pdf' }) });
    await wrapper.vm.uploadDocument();
    expect(fetchApi.postFormData).not.toHaveBeenCalled();
    expect(wrapper.vm.errorMessage).toContain('matching local grant opportunity ID');
    wrapper.unmount();
  });

  it('uploads using the explicitly selected ID and supports organization zero', async () => {
    vi.mocked(fetchApi.postFormData).mockResolvedValue({ document: { id: 7, grantId: '123456' } });
    const wrapper = demoWrapper();
    const file = new File(['sample'], 'notice.pdf', { type: 'application/pdf' });
    await wrapper.setData({ grantId: '123456' });
    wrapper.vm.onFileChange({ target: { files: [file] } });
    await wrapper.vm.uploadDocument();
    const [url, form] = vi.mocked(fetchApi.postFormData).mock.calls[0];
    expect(url).toBe('/api/organizations/0/compliance/documents');
    expect(form.get('grantId')).toBe('123456');
    expect(form.get('file')).toBe(file);
    expect(wrapper.vm.document.id).toBe(7);
    wrapper.unmount();
  });
});
