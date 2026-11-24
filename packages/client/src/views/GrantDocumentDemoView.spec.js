import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createRouter, createMemoryHistory } from 'vue-router';
import GrantDocumentDemoView from '@/views/GrantDocumentDemoView.vue';
import * as api from '@/helpers/fetchApi';
import * as flags from '@/helpers/featureFlags';

vi.mock('@/helpers/fetchApi', () => ({
  get: vi.fn(), post: vi.fn(), patch: vi.fn(), postFormData: vi.fn(), apiURL: vi.fn((url) => url),
}));
vi.mock('@/helpers/featureFlags', () => ({
  complianceDeadlinesEnabled: vi.fn(),
  grantDocumentAnalysisEnabled: vi.fn(),
  grantMatchingEnabled: vi.fn(),
}));
const document = (overrides = {}) => ({
  id: 7,
  grantId: '364009',
  organizationId: 0,
  filename: 'selected-notice.pdf',
  pageCount: null,
  extractionQuality: null,
  analysisIncomplete: false,
  ...overrides,
});
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const brief = (overrides = {}) => ({
  documentId: 7,
  grantId: '364009',
  runId: 11,
  verificationStatus: 'unverified',
  keyDates: [{
    found: true,
    label: 'Application deadline',
    date: '2026-11-20',
    sources: [{ pageNumber: 4, excerpt: 'Submit by November 20, 2026.' }],
  }],
  ...overrides,
});
let wrapper;
let store;
let router;
let originalLocation;
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  // window.location is not normally reassignable in jsdom; redefined as a plain writable
  // property so exportChecklist's top-level navigation can be asserted on without triggering a
  // real (unsupported) navigation.
  originalLocation = window.location;
  Object.defineProperty(window, 'location', { writable: true, configurable: true, value: '' });
  flags.grantDocumentAnalysisEnabled.mockReturnValue(true);
  flags.grantMatchingEnabled.mockReturnValue(true);
  api.postFormData.mockResolvedValue({ document: document() });
  api.get.mockImplementation(async (url) => {
    if (url.endsWith('/brief')) throw Object.assign(new Error('Not found'), { response: { status: 404 } });
    if (url.endsWith('/checklist-items')) {
      return {
        data: [],
        pagination: {
          currentPage: 1, perPage: 1, total: 0, lastPage: 1,
        },
      };
    }
    return { document: document() };
  });
  api.post.mockResolvedValue({ analysisRun: { id: 12, documentId: 7, status: 'queued' } });
  api.apiURL.mockImplementation((url) => url);
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
      { name: 'complianceDeadlines', path: '/compliance/deadlines', component: { template: '<div>Deadlines</div>' } },
    ],
  });
});
afterEach(() => {
  wrapper?.unmount(); vi.useRealTimers();
  Object.defineProperty(window, 'location', { writable: true, configurable: true, value: originalLocation });
});
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
  it('links a loaded document to its deadlines with the original match context when enabled', async () => {
    flags.complianceDeadlinesEnabled.mockReturnValue(true);
    await render({ documentId: '7' });
    expect(wrapper.text()).toContain('View deadlines for this document');
    expect(router.resolve(wrapper.vm.deadlineLocation).href)
      .toBe('/compliance/deadlines?organizationId=0&grantId=364009&documentId=7&matchRunId=9');
  });
  it('exports the checklist as a CSV via a top-level navigation, not a fetch', async () => {
    await render({ documentId: '7' });
    const callsBeforeExport = api.get.mock.calls.length;
    const button = wrapper.findAll('button').find((candidate) => candidate.text() === 'Export checklist (CSV)');
    await button.trigger('click');
    expect(window.location).toBe('/api/organizations/0/compliance/documents/7/checklist-export');
    expect(api.get).toHaveBeenCalledTimes(callsBeforeExport); // the export is a navigation, not a fetch call
  });
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
  it('shows the saved brief with its run, deadline, and citation when reopening a document', async () => {
    api.get.mockResolvedValueOnce({ document: document() }).mockResolvedValueOnce({ brief: brief() });
    await render({ documentId: '7' });
    const saved = wrapper.get('section[aria-labelledby="saved-grant-brief-heading"]');
    expect(saved.text()).toContain('Analysis run 11 · Unverified');
    expect(saved.text()).toContain('Application deadline · Nov 20, 2026');
    expect(saved.get('blockquote').text()).toContain('Page 4');
    expect(saved.get('blockquote').text()).toContain('Submit by November 20, 2026.');
  });
  it('handles a missing brief without blocking analysis', async () => {
    await render({ documentId: '7' });
    expect(wrapper.text()).toContain('No grant brief is saved');
    expect(startButton().element.disabled).toBe(false);
  });
  it('rejects a saved brief returned for a different document', async () => {
    api.get.mockResolvedValueOnce({ document: document() }).mockResolvedValueOnce({ brief: brief({ documentId: 8 }) });
    await render({ documentId: '7' });
    expect(wrapper.text()).toContain('The saved brief does not match this grant or document.');
    expect(wrapper.find('section[aria-labelledby="saved-grant-brief-heading"]').exists()).toBe(false);
  });
  it('refreshes the brief for the newly completed run', async () => {
    api.get.mockResolvedValueOnce({ document: document() }).mockResolvedValueOnce({ brief: brief() });
    await render({ documentId: '7' });
    await startButton().trigger('click'); await flushPromises();
    api.get
      .mockResolvedValueOnce({ analysisRun: { id: 12, documentId: 7, status: 'completed' } })
      .mockResolvedValueOnce({ document: document() })
      .mockResolvedValueOnce({ brief: brief({ runId: 12 }) });
    await vi.advanceTimersByTimeAsync(1500); await flushPromises();
    expect(wrapper.get('section[aria-labelledby="saved-grant-brief-heading"]').text()).toContain('Analysis run 12 · Unverified');
    expect(wrapper.text()).not.toContain('Analysis run 11');
  });
  it('keeps a prior brief labeled with its original run when a new run produces none', async () => {
    api.get.mockResolvedValueOnce({ document: document() }).mockResolvedValueOnce({ brief: brief() });
    await render({ documentId: '7' });
    await startButton().trigger('click'); await flushPromises();
    api.get
      .mockResolvedValueOnce({ analysisRun: { id: 12, documentId: 7, status: 'completed' } })
      .mockResolvedValueOnce({ document: document() })
      .mockResolvedValueOnce({ brief: brief() });
    await vi.advanceTimersByTimeAsync(1500); await flushPromises();
    expect(wrapper.text()).toContain('Run 12 completed. The run produced no new brief.');
    expect(wrapper.text()).toContain('Showing the saved brief from run 11.');
  });
  it('keeps the prior brief visible when the new brief cannot be loaded', async () => {
    api.get.mockResolvedValueOnce({ document: document() }).mockResolvedValueOnce({ brief: brief() });
    await render({ documentId: '7' });
    await startButton().trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('Waiting to start.');
    expect(wrapper.text()).toContain('Showing the saved brief from run 11.');
    api.get
      .mockResolvedValueOnce({ analysisRun: { id: 12, documentId: 7, status: 'completed' } })
      .mockResolvedValueOnce({ document: document() })
      .mockRejectedValueOnce(new Error('brief request failed'));
    await vi.advanceTimersByTimeAsync(1500); await flushPromises();
    expect(wrapper.text()).toContain('The saved grant brief could not be loaded.');
    expect(wrapper.text()).toContain('Showing the saved brief from run 11.');
    api.get.mockResolvedValueOnce({ brief: brief({ runId: 12 }) });
    const retry = wrapper.findAll('button').find((button) => button.text() === 'Retry loading the brief');
    await retry.trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('Analysis run 12 · Unverified');
    expect(api.post).toHaveBeenCalledTimes(1);
  });
  it('loads the brief even when completed document metadata temporarily fails', async () => {
    await render({ documentId: '7' });
    await startButton().trigger('click'); await flushPromises();
    api.get
      .mockResolvedValueOnce({ analysisRun: { id: 12, documentId: 7, status: 'completed' } })
      .mockRejectedValueOnce(new Error('metadata request failed'))
      .mockResolvedValueOnce({ brief: brief({ runId: 12 }) });
    await vi.advanceTimersByTimeAsync(1500); await flushPromises();
    expect(wrapper.text()).toContain('updated page count and extraction quality could not be loaded');
    expect(wrapper.text()).toContain('Analysis run 12 · Unverified');
    api.get.mockResolvedValueOnce({ document: document({ pageCount: 17, extractionQuality: 'readable' }) });
    const retry = wrapper.findAll('button').find((button) => button.text() === 'Refresh analysis status');
    await retry.trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('Page count: 17');
    expect(wrapper.text()).not.toContain('could not be loaded');
    expect(api.post).toHaveBeenCalledTimes(1);
  });
  it('warns when a completed run is marked incomplete, and offers a retry (AN-17 follow-up)', async () => {
    await render({ documentId: '7' });
    await startButton().trigger('click'); await flushPromises();
    api.get
      .mockResolvedValueOnce({ analysisRun: { id: 12, documentId: 7, status: 'completed' } })
      .mockResolvedValueOnce({ document: document({ analysisIncomplete: true }) });
    await vi.advanceTimersByTimeAsync(1500); await flushPromises();
    expect(wrapper.text()).toContain('This analysis is incomplete');
    expect(wrapper.text()).toContain('Choose Start Analysis to retry');
  });
  it('does not show the incomplete warning for a fully successful run', async () => {
    await render({ documentId: '7' });
    await startButton().trigger('click'); await flushPromises();
    api.get
      .mockResolvedValueOnce({ analysisRun: { id: 12, documentId: 7, status: 'completed' } })
      .mockResolvedValueOnce({ document: document({ analysisIncomplete: false }) });
    await vi.advanceTimersByTimeAsync(1500); await flushPromises();
    expect(wrapper.text()).not.toContain('This analysis is incomplete');
  });
  it('keeps showing the incomplete warning on reopening a document, even with no active analysis run this session', async () => {
    api.get.mockImplementation(async (url) => {
      if (url.endsWith('/brief')) throw Object.assign(new Error('Not found'), { response: { status: 404 } });
      if (url.endsWith('/checklist-items')) {
        return {
          data: [],
          pagination: {
            currentPage: 1, perPage: 1, total: 0, lastPage: 1,
          },
        };
      }
      return { document: document({ analysisIncomplete: true }) };
    });
    await render({ documentId: '7' });
    expect(wrapper.text()).toContain('This analysis is incomplete');
  });
  it('gives a recovery action for a completed run on an unreadable PDF', async () => {
    await render({ documentId: '7' });
    await startButton().trigger('click'); await flushPromises();
    api.get
      .mockResolvedValueOnce({ analysisRun: { id: 12, documentId: 7, status: 'completed' } })
      .mockResolvedValueOnce({ document: document({ extractionQuality: 'unreadable' }) });
    await vi.advanceTimersByTimeAsync(1500); await flushPromises();
    expect(wrapper.text()).toContain('Upload a text-readable copy');
    expect(wrapper.text()).not.toContain('Choose Start Analysis to retry.');
  });
  it('allows a failed analysis to be retried without uploading again', async () => {
    await render({ documentId: '7' });
    await startButton().trigger('click'); await flushPromises();
    api.get.mockResolvedValueOnce({ analysisRun: { id: 12, documentId: 7, status: 'failed' } });
    await vi.advanceTimersByTimeAsync(1500); await flushPromises();
    expect(wrapper.text()).toContain('Analysis failed.');
    expect(startButton().element.disabled).toBe(false);
    api.post.mockResolvedValueOnce({ analysisRun: { id: 13, documentId: 7, status: 'queued' } });
    await startButton().trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('Run 13: queued');
    expect(api.postFormData).not.toHaveBeenCalled();
  });
  it('discards a delayed brief after switching teams', async () => {
    const pending = deferred();
    api.get.mockResolvedValueOnce({ document: document() }).mockReturnValueOnce(pending.promise);
    await render({ documentId: '7' });
    store.state.selected = '3'; await flushPromises();
    pending.resolve({ brief: brief() }); await flushPromises();
    expect(wrapper.text()).not.toContain('Application deadline');
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
  it('loads the newly generated checklist after the first successful analysis', async () => {
    await render({ documentId: '7' });
    expect(wrapper.find('[data-testid="checklist-empty"]').exists()).toBe(true);
    await startButton().trigger('click'); await flushPromises();
    api.get
      .mockResolvedValueOnce({ analysisRun: { id: 12, documentId: 7, status: 'completed' } })
      .mockResolvedValueOnce({ document: document({ pageCount: 17 }) })
      .mockResolvedValueOnce({ brief: brief({ runId: 12 }) })
      .mockResolvedValueOnce({
        data: [{
          id: 1,
          category: 'submission',
          description: 'Submit the application in JustGrants.',
          verificationStatus: 'unverified',
          completionStatus: 'notStarted',
          sources: [],
        }],
      });
    await vi.advanceTimersByTimeAsync(1500); await flushPromises();
    expect(wrapper.get('[data-testid="checklist-description"]').text()).toBe('Submit the application in JustGrants.');
    expect(api.get.mock.calls.filter(([url]) => url.endsWith('/checklist-items'))).toHaveLength(2);
    expect(api.post).toHaveBeenCalledTimes(1);
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
