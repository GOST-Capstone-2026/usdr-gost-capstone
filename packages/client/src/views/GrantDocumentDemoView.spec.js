import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createRouter, createMemoryHistory } from 'vue-router';
import GrantDocumentDemoView from '@/views/GrantDocumentDemoView.vue';
import * as api from '@/helpers/fetchApi';
import * as flags from '@/helpers/featureFlags';

vi.mock('@/helpers/fetchApi', () => ({ get: vi.fn(), post: vi.fn(), postFormData: vi.fn() }));
vi.mock('@/helpers/featureFlags', () => ({ grantDocumentAnalysisEnabled: vi.fn(), grantMatchingEnabled: vi.fn() }));
const document = (overrides = {}) => ({
  id: 7,
  grantId: '364009',
  organizationId: 0,
  filename: 'selected-notice.pdf',
  pageCount: null,
  extractionQuality: null,
  ...overrides,
});
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
let wrapper;
let store;
let router;
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  flags.grantDocumentAnalysisEnabled.mockReturnValue(true);
  flags.grantMatchingEnabled.mockReturnValue(true);
  api.postFormData.mockResolvedValue({ document: document() });
  api.get.mockResolvedValue({ document: document() });
  api.post.mockResolvedValue({ analysisRun: { id: 12, documentId: 7, status: 'queued' } });
  store = createStore({
    state: { selected: '0', role: 'staff' },
    getters: { 'users/selectedAgencyId': (state) => state.selected, 'users/userRole': (state) => state.role },
  });
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { name: 'grantDocumentAnalysis', path: '/compliance/grants/:grantId/documents', component: GrantDocumentDemoView },
      { name: 'grantDocumentDemo', path: '/grant-document-demo', component: GrantDocumentDemoView },
      { name: 'grantMatches', path: '/compliance/matches', component: { template: '<div>Matches</div>' } },
    ],
  });
});
afterEach(() => { wrapper?.unmount(); vi.useRealTimers(); });
async function render(query = {}, grantId = '364009') {
  await router.push({ name: 'grantDocumentAnalysis', params: { grantId }, query: { organizationId: '0', matchRunId: '9', ...query } });
  wrapper = mount(GrantDocumentDemoView, { global: { plugins: [store, router] } });
  await flushPromises();
  return wrapper;
}
async function upload() {
  const input = wrapper.get('input[type="file"]');
  Object.defineProperty(input.element, 'files', { value: [new File(['%PDF-1.4'], 'notice.pdf', { type: 'application/pdf' })] });
  await input.trigger('change');
  await wrapper.get('form').trigger('submit');
  await flushPromises();
}
const startButton = () => wrapper.findAll('button').find((button) => button.text() === 'Start Analysis');

describe('C-12 selected grant document workflow', () => {
  it('shows the selected grant/team and does not upload, analyze or fetch automatically', async () => {
    await render();
    expect(wrapper.text()).toContain('Selected grant 364009 · Team 0');
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    expect(router.resolve(wrapper.vm.returnToMatches).href).toBe('/compliance/matches?runId=9');
  });
  it('uploads to the selected organization with the selected grant rather than the old sample', async () => {
    await render(); await upload();
    const [url, body] = api.postFormData.mock.calls[0];
    expect(url).toBe('/api/organizations/0/compliance/documents');
    expect(body.get('grantId')).toBe('364009');
    expect(body.get('file').name).toBe('notice.pdf');
    expect(api.post).not.toHaveBeenCalled();
    expect(router.currentRoute.value.query.documentId).toBe('7');
    expect(wrapper.text()).toContain('selected-notice.pdf');
    expect(router.currentRoute.value.query.matchRunId).toBe('9');
  });
  it('reopens an existing document after a page load without uploading it again', async () => {
    await render({ documentId: '7' });
    expect(api.get).toHaveBeenCalledWith('/api/organizations/0/compliance/documents/7');
    expect(api.postFormData).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Document 7 · Grant 364009');
  });
  it('opens a known document ID and rejects malformed IDs without requesting them', async () => {
    await render();
    await wrapper.get('#existing-document-id').setValue('../8');
    await wrapper.findAll('form')[1].trigger('submit'); await flushPromises();
    expect(api.get).not.toHaveBeenCalled();
    await wrapper.get('#existing-document-id').setValue('7');
    await wrapper.findAll('form')[1].trigger('submit'); await flushPromises();
    expect(api.get).toHaveBeenCalledWith('/api/organizations/0/compliance/documents/7');
  });
  it('requires an explicit start, polls sequentially, and refreshes completed document metadata', async () => {
    await render({ documentId: '7' });
    await startButton().trigger('click'); await flushPromises();
    expect(api.post).toHaveBeenCalledWith('/api/organizations/0/compliance/documents/7/analysis-runs');
    api.get.mockResolvedValueOnce({
      analysisRun: {
        id: 12, documentId: 7, status: 'completed', chunkCount: 40,
      },
    })
      .mockResolvedValueOnce({ document: document({ pageCount: 107, extractionQuality: 'good' }) });
    await vi.advanceTimersByTimeAsync(1500); await flushPromises();
    expect(wrapper.text()).toContain('Page count: 107. Chunk count: 40.');
    expect(wrapper.text()).toContain('does not verify the extracted content');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not overlap poll requests while the previous request is outstanding', async () => {
    await render({ documentId: '7' });
    await startButton().trigger('click'); await flushPromises();
    const request = deferred(); api.get.mockReturnValueOnce(request.promise);
    await vi.advanceTimersByTimeAsync(10000);
    expect(api.get.mock.calls.filter(([url]) => url.includes('analysis-runs'))).toHaveLength(1);
    request.resolve({ analysisRun: { id: 12, documentId: 7, status: 'queued' } }); await flushPromises();
    expect(vi.getTimerCount()).toBe(1);
  });
  it('catches polling failures and resumes by GET without starting a second analysis', async () => {
    await render({ documentId: '7' });
    await startButton().trigger('click'); await flushPromises();
    api.get.mockRejectedValueOnce(new Error('private database detail'));
    await vi.advanceTimersByTimeAsync(1500); await flushPromises();
    expect(wrapper.text()).toContain('request could not be completed');
    expect(wrapper.text()).not.toContain('private database');
    expect(vi.getTimerCount()).toBe(0);
    api.get.mockResolvedValueOnce({ analysisRun: { id: 12, documentId: 7, status: 'processing' } });
    const retry = wrapper.findAll('button').find((button) => button.text() === 'Refresh analysis status');
    await retry.trigger('click'); await flushPromises();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('processing');
  });
  it('rejects a document returned for another grant before analysis can start', async () => {
    api.get.mockResolvedValueOnce({ document: document({ grantId: '335255' }) });
    await render({ documentId: '7' });
    expect(wrapper.text()).toContain('does not match');
    expect(startButton()).toBeUndefined();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('rejects an analysis response for another document and never polls it', async () => {
    await render({ documentId: '7' });
    api.post.mockResolvedValueOnce({ analysisRun: { id: 12, documentId: 8, status: 'queued' } });
    await startButton().trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('does not match');
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['role', 'team', 'grant'])('discards outstanding upload results after changing the %s', async (change) => {
    const request = deferred(); api.postFormData.mockReturnValueOnce(request.promise);
    await render(); await upload();
    if (change === 'role') store.state.role = 'viewer';
    if (change === 'team') store.state.selected = '3';
    if (change === 'grant') await router.push({ name: 'grantDocumentAnalysis', params: { grantId: '999' }, query: { organizationId: '0' } });
    await flushPromises();
    request.resolve({ document: document() }); await flushPromises();
    expect(wrapper.text()).not.toContain('selected-notice.pdf');
    expect(router.currentRoute.value.query.documentId).toBeUndefined();
  });
  it('discards a late polling response and stops timers after team switching', async () => {
    await render({ documentId: '7' }); await startButton().trigger('click'); await flushPromises();
    const request = deferred(); api.get.mockReturnValueOnce(request.promise);
    await vi.advanceTimersByTimeAsync(1500);
    store.state.selected = '3'; await flushPromises();
    request.resolve({ analysisRun: { id: 12, documentId: 7, status: 'completed' } }); await flushPromises();
    expect(wrapper.text()).not.toContain('Document 7');
    expect(wrapper.text()).toContain('currently selected team');
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['flag', 'role', 'team'])('prevents requests without an authorized %s context', async (change) => {
    if (change === 'flag') flags.grantDocumentAnalysisEnabled.mockReturnValue(false);
    if (change === 'role') store.state.role = 'viewer';
    if (change === 'team') store.state.selected = '3';
    await render({ documentId: '7' });
    expect(api.get).not.toHaveBeenCalled();
    expect(wrapper.find('form').exists()).toBe(false);
  });
  it('shows duplicate-upload recovery and renders filenames as text', async () => {
    await render();
    api.postFormData.mockRejectedValueOnce(new Error('{"error":{"code":"DUPLICATE_DOCUMENT"}}'));
    await upload();
    expect(wrapper.text()).toContain('already uploaded');
    api.get.mockResolvedValueOnce({ document: document({ filename: '<img src=x onerror=alert(1)>' }) });
    await router.replace({ query: { organizationId: '0', documentId: '7' } }); await flushPromises();
    expect(wrapper.text()).toContain('<img src=x');
    expect(wrapper.find('img').exists()).toBe(false);
  });
  it('stops polling on unmount', async () => {
    await render({ documentId: '7' }); await startButton().trigger('click'); await flushPromises();
    expect(vi.getTimerCount()).toBe(1);
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
