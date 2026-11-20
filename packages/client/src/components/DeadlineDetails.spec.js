import {
  describe, it, expect, vi,
} from 'vitest';
import { mount, flushPromises, RouterLinkStub } from '@vue/test-utils';
import DeadlineDetails from '@/components/DeadlineDetails.vue';
import { grantDocumentAnalysisEnabled } from '@/helpers/featureFlags';

vi.mock('@/helpers/featureFlags', () => ({ grantDocumentAnalysisEnabled: vi.fn(() => false) }));

const makeItem = (overrides) => ({
  checklistItemId: 1,
  title: 'Deadline',
  dueDate: '2026-10-15',
  completionStatus: 'notStarted',
  verificationStatus: 'verified',
  verifiedAt: '2026-09-20T15:00:00.000Z',
  source: { pageNumber: 14, excerpt: 'Quarterly reports are due within 30 days.' },
  ...overrides,
});

const mountDetails = (overrides, dispatch = vi.fn().mockResolvedValue(undefined), canVerify = false) => mount(DeadlineDetails, {
  props: { item: makeItem(overrides), canVerify },
  global: {
    mocks: { $store: { dispatch, getters: { 'users/selectedAgencyId': 0 } } },
    stubs: { 'router-link': RouterLinkStub },
  },
});

const httpError = (status) => Object.assign(new Error('request failed'), { response: { status } });

describe('DeadlineDetails.vue', () => {
  it('shows the source page and exact excerpt', () => {
    const wrapper = mountDetails();
    expect(wrapper.get('[data-testid="deadline-source"]').text())
      .toBe('Page 14: "Quarterly reports are due within 30 days."');
  });

  it('shows Source not found when there is no source', () => {
    const wrapper = mountDetails({ source: null });
    expect(wrapper.get('[data-testid="deadline-source"]').text()).toBe('Source not found');
  });

  it('shows the verified date for a verified item', () => {
    const wrapper = mountDetails();
    expect(wrapper.get('[data-testid="deadline-verification"]').text()).toBe('Verified on Sep 20, 2026');
  });

  describe('link to the source document', () => {
    const documentLink = (wrapper) => wrapper.find('[data-testid="deadline-document-link"]');

    it('links to the document analysis page for its grant and document', () => {
      grantDocumentAnalysisEnabled.mockReturnValueOnce(true);
      const wrapper = mountDetails({ grantId: '335255', documentId: 6 });
      expect(documentLink(wrapper).text()).toBe('Open document');
      expect(wrapper.getComponent(RouterLinkStub).props('to')).toEqual({
        name: 'grantDocumentAnalysis',
        params: { grantId: '335255' },
        query: { organizationId: '0', documentId: '6', checklistItemId: '1' },
      });
    });

    it('is hidden when document analysis is turned off', () => {
      const wrapper = mountDetails({ grantId: '335255', documentId: 6 });
      expect(documentLink(wrapper).exists()).toBe(false);
    });

    it('is hidden when the deadline has no document', () => {
      grantDocumentAnalysisEnabled.mockReturnValueOnce(true);
      const wrapper = mountDetails({ grantId: '335255', documentId: null });
      expect(documentLink(wrapper).exists()).toBe(false);
    });
  });

  it('shows who verified the item and when', () => {
    const wrapper = mountDetails({ verifiedByName: 'Alex Allain' });
    expect(wrapper.get('[data-testid="deadline-verification"]').text()).toBe('Verified by Alex Allain on Sep 20, 2026');
  });

  it('shows Verified without a date when no verified time is recorded', () => {
    const wrapper = mountDetails({ verifiedAt: null });
    expect(wrapper.get('[data-testid="deadline-verification"]').text()).toBe('Verified');
  });

  it('shows Not yet verified for an unverified item', () => {
    const wrapper = mountDetails({ verificationStatus: 'unverified', verifiedAt: null });
    expect(wrapper.get('[data-testid="deadline-verification"]').text()).toBe('Not yet verified');
  });

  it('shows all citations and sends the reviewed version when verifying', async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountDetails({
      version: 3,
      verificationStatus: 'unverified',
      sources: [{ pageNumber: 4, excerpt: 'First citation.' }, { pageNumber: 8, excerpt: 'Second citation.' }],
    }, dispatch, true);
    expect(wrapper.get('[data-testid="deadline-source"]').text()).toContain('Page 8: "Second citation."');
    await wrapper.get('[data-testid="action-verify"]').trigger('click');
    expect(dispatch).toHaveBeenCalledWith('deadlines/updateDeadline', {
      checklistItemId: 1, changes: { expectedVersion: 3 }, successMessage: 'Verified "Deadline" against its source.', verify: true,
    });
  });

  describe('actions', () => {
    const shown = (wrapper) => ['complete', 'not-applicable', 'reopen', 'change-date']
      .filter((action) => wrapper.find(`[data-testid="action-${action}"]`).exists());

    it('offers complete, not applicable, and change due date for an open item', () => {
      expect(shown(mountDetails())).toEqual(['complete', 'not-applicable', 'change-date']);
    });

    it('offers not applicable, reopen, and change due date for a completed item', () => {
      expect(shown(mountDetails({ completionStatus: 'completed' }))).toEqual(['not-applicable', 'reopen', 'change-date']);
    });

    it('offers complete, reopen, and change due date for an item marked not applicable', () => {
      expect(shown(mountDetails({ completionStatus: 'notApplicable' }))).toEqual(['complete', 'reopen', 'change-date']);
    });

    it('marks an item complete with a confirmation message', async () => {
      const dispatch = vi.fn().mockResolvedValue(undefined);
      const wrapper = mountDetails({ title: 'Quarterly report' }, dispatch);

      await wrapper.get('[data-testid="action-complete"]').trigger('click');

      expect(dispatch).toHaveBeenCalledWith('deadlines/updateDeadline', {
        checklistItemId: 1,
        changes: { completionStatus: 'completed' },
        successMessage: 'Marked "Quarterly report" complete.',
      });
    });

    it('marks an item not applicable', async () => {
      const dispatch = vi.fn().mockResolvedValue(undefined);
      const wrapper = mountDetails({}, dispatch);

      await wrapper.get('[data-testid="action-not-applicable"]').trigger('click');

      expect(dispatch.mock.calls[0][1].changes).toEqual({ completionStatus: 'notApplicable' });
    });

    it('reopens a completed item as in progress, since work on it had started', async () => {
      const dispatch = vi.fn().mockResolvedValue(undefined);
      const wrapper = mountDetails({ completionStatus: 'completed' }, dispatch);

      await wrapper.get('[data-testid="action-reopen"]').trigger('click');

      expect(dispatch.mock.calls[0][1]).toMatchObject({
        changes: { completionStatus: 'inProgress' },
        successMessage: 'Reopened "Deadline" as in progress.',
      });
    });

    it('reopens a not applicable item as not started', async () => {
      const dispatch = vi.fn().mockResolvedValue(undefined);
      const wrapper = mountDetails({ completionStatus: 'notApplicable' }, dispatch);

      await wrapper.get('[data-testid="action-reopen"]').trigger('click');

      expect(dispatch.mock.calls[0][1]).toMatchObject({
        changes: { completionStatus: 'notStarted' },
        successMessage: 'Reopened "Deadline".',
      });
    });

    it('disables the actions while a change is saving', async () => {
      let finish;
      const dispatch = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
      const wrapper = mountDetails({}, dispatch);

      await wrapper.get('[data-testid="action-complete"]').trigger('click');

      expect(wrapper.get('[data-testid="action-complete"]').attributes('disabled')).toBeDefined();
      expect(wrapper.get('[data-testid="action-change-date"]').attributes('disabled')).toBeDefined();

      finish();
      await flushPromises();
      expect(wrapper.get('[data-testid="action-complete"]').attributes('disabled')).toBeUndefined();
    });

    it('shows an error and keeps the item unchanged when saving fails', async () => {
      const wrapper = mountDetails({}, vi.fn().mockRejectedValue(httpError(500)));

      await wrapper.get('[data-testid="action-complete"]').trigger('click');
      await flushPromises();

      expect(wrapper.get('[data-testid="deadline-action-error"]').text()).toBe('The change could not be saved. Please try again.');
      expect(wrapper.get('[data-testid="deadline-action-error"]').attributes('role')).toBe('alert');
    });

    it('explains when the deadline is no longer available', async () => {
      const wrapper = mountDetails({}, vi.fn().mockRejectedValue(httpError(404)));

      await wrapper.get('[data-testid="action-complete"]').trigger('click');
      await flushPromises();

      expect(wrapper.get('[data-testid="deadline-action-error"]').text()).toBe('This deadline is no longer available.');
    });
  });

  describe('changing the due date', () => {
    it('opens a labeled date input with the current date and a re-verification warning', async () => {
      const wrapper = mountDetails();

      await wrapper.get('[data-testid="action-change-date"]').trigger('click');

      const input = wrapper.get('[data-testid="due-date-input"]');
      expect(input.element.value).toBe('2026-10-15');
      expect(wrapper.get(`label[for="${input.attributes('id')}"]`).text()).toContain('New due date');
      expect(wrapper.get('[data-testid="due-date-editor"]').text())
        .toContain('Changing the date marks this deadline unverified until someone confirms it again.');
    });

    it('only allows saving a valid date that differs from the current one', async () => {
      const wrapper = mountDetails();
      await wrapper.get('[data-testid="action-change-date"]').trigger('click');

      expect(wrapper.get('[data-testid="due-date-save"]').attributes('disabled')).toBeDefined();

      await wrapper.get('[data-testid="due-date-input"]').setValue('');
      expect(wrapper.get('[data-testid="due-date-save"]').attributes('disabled')).toBeDefined();

      await wrapper.get('[data-testid="due-date-input"]').setValue('2026-12-01');
      expect(wrapper.get('[data-testid="due-date-save"]').attributes('disabled')).toBeUndefined();
    });

    it('saves the new date and closes the editor', async () => {
      const dispatch = vi.fn().mockResolvedValue(undefined);
      const wrapper = mountDetails({ title: 'Quarterly report' }, dispatch);
      await wrapper.get('[data-testid="action-change-date"]').trigger('click');
      await wrapper.get('[data-testid="due-date-input"]').setValue('2026-12-01');

      await wrapper.get('[data-testid="due-date-save"]').trigger('click');
      await flushPromises();

      expect(dispatch).toHaveBeenCalledWith('deadlines/updateDeadline', {
        checklistItemId: 1,
        changes: { dueDate: '2026-12-01' },
        successMessage: 'Changed the due date of "Quarterly report" to Dec 1, 2026. It needs to be verified again.',
      });
      expect(wrapper.find('[data-testid="due-date-editor"]').exists()).toBe(false);
    });

    it('lets an undated item get its first due date', async () => {
      const dispatch = vi.fn().mockResolvedValue(undefined);
      const wrapper = mountDetails({ dueDate: null }, dispatch);
      await wrapper.get('[data-testid="action-change-date"]').trigger('click');

      expect(wrapper.get('[data-testid="due-date-input"]').element.value).toBe('');
      expect(wrapper.get('[data-testid="due-date-save"]').attributes('disabled')).toBeDefined();

      await wrapper.get('[data-testid="due-date-input"]').setValue('2027-01-15');
      await wrapper.get('[data-testid="due-date-save"]').trigger('click');

      expect(dispatch.mock.calls[0][1].changes).toEqual({ dueDate: '2027-01-15' });
    });

    it('says the item still needs verifying when it was never verified', async () => {
      const dispatch = vi.fn().mockResolvedValue(undefined);
      const wrapper = mountDetails({
        title: 'Monitoring plan', dueDate: null, verificationStatus: 'unverified', verifiedAt: null,
      }, dispatch);
      await wrapper.get('[data-testid="action-change-date"]').trigger('click');
      await wrapper.get('[data-testid="due-date-input"]').setValue('2027-01-15');
      await wrapper.get('[data-testid="due-date-save"]').trigger('click');

      expect(dispatch.mock.calls[0][1].successMessage)
        .toBe('Changed the due date of "Monitoring plan" to Jan 15, 2027. It still needs to be verified.');
    });

    it('keeps the editor open with an error when saving the date fails', async () => {
      const wrapper = mountDetails({}, vi.fn().mockRejectedValue(httpError(400)));
      await wrapper.get('[data-testid="action-change-date"]').trigger('click');
      await wrapper.get('[data-testid="due-date-input"]').setValue('2026-12-01');

      await wrapper.get('[data-testid="due-date-save"]').trigger('click');
      await flushPromises();

      expect(wrapper.find('[data-testid="due-date-editor"]').exists()).toBe(true);
      expect(wrapper.get('[data-testid="deadline-action-error"]').text()).toBe('The change could not be saved. Please try again.');
    });

    it('cancels without saving', async () => {
      const dispatch = vi.fn();
      const wrapper = mountDetails({}, dispatch);
      await wrapper.get('[data-testid="action-change-date"]').trigger('click');

      await wrapper.get('[data-testid="due-date-cancel"]').trigger('click');

      expect(wrapper.find('[data-testid="due-date-editor"]').exists()).toBe(false);
      expect(dispatch).not.toHaveBeenCalled();
    });
  });
});
