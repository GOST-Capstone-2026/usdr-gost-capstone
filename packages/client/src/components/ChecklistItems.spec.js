import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import ChecklistItems from '@/components/ChecklistItems.vue';
import * as api from '@/helpers/fetchApi';

vi.mock('@/helpers/fetchApi', () => ({ get: vi.fn(), patch: vi.fn() }));

const makeItem = (overrides) => ({
  id: 104,
  organizationId: 0,
  documentId: 27,
  grantId: '335255',
  category: 'reporting',
  description: 'Submit quarterly performance reports within 30 days after each quarter.',
  found: true,
  sources: [{ documentId: 27, pageNumber: 14, excerpt: 'Quarterly performance reports are due...' }],
  possiblyAffectedByQualityIssue: false,
  dueDate: '2026-12-31',
  completionStatus: 'notStarted',
  userNotes: null,
  isUserEdited: false,
  verificationStatus: 'unverified',
  verifiedBy: null,
  verifiedAt: null,
  version: 1,
  ...overrides,
});

const paginationFor = (count) => ({
  currentPage: 1, perPage: count || 1, total: count, lastPage: 1,
});

const serverError = (status, code) => Object.assign(
  new Error(JSON.stringify({ error: { code } })),
  { response: { status } },
);

async function mountList(items = [makeItem()], canVerify = false) {
  api.get.mockResolvedValue({ data: items, pagination: paginationFor(items.length) });
  const wrapper = mount(ChecklistItems, { props: { organizationId: 0, documentId: 27, canVerify } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => { vi.resetAllMocks(); });

describe('ChecklistItems.vue', () => {
  it('loads and displays a checklist item with its source citation', async () => {
    const wrapper = await mountList();
    expect(api.get).toHaveBeenCalledWith('/api/organizations/0/compliance/documents/27/checklist-items');
    expect(wrapper.get('[data-testid="checklist-description"]').text())
      .toBe('Submit quarterly performance reports within 30 days after each quarter.');
    expect(wrapper.get('[data-testid="checklist-source"]').text())
      .toContain('Page 14Quarterly performance reports are due...');
    expect(wrapper.get('[data-testid="checklist-verification"]').text()).toBe('Unverified');
    expect(wrapper.get('[data-testid="checklist-completion"]').text()).toBe('Not started');
  });

  it('scrolls to and outlines the item a deadline link points to', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    api.get.mockResolvedValue({ data: [makeItem({ id: 104 }), makeItem({ id: 105 })], pagination: paginationFor(2) });
    const wrapper = mount(ChecklistItems, {
      props: {
        organizationId: 0, documentId: 27, focusItemId: 105,
      },
      attachTo: document.body,
    });
    await flushPromises();

    const [other, focused] = wrapper.findAll('[data-testid="checklist-item"]');
    expect(focused.attributes('id')).toBe('checklist-item-105');
    expect(focused.classes()).toContain('border-primary');
    expect(other.classes()).not.toContain('border-primary');
    expect(focused.get('details').element.open).toBe(true);
    expect(other.get('details').element.open).toBe(false);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(focused.element);
    wrapper.unmount();
    delete Element.prototype.scrollIntoView;
  });

  it('shows an empty state when the document has no checklist items', async () => {
    const wrapper = await mountList([]);
    expect(wrapper.get('[data-testid="checklist-empty"]').text())
      .toBe('No checklist items are saved for this document yet.');
  });

  it('shows a load error when the document cannot be found', async () => {
    api.get.mockRejectedValue(serverError(404, 'NOT_FOUND'));
    const wrapper = mount(ChecklistItems, { props: { organizationId: 0, documentId: 27 } });
    await flushPromises();
    expect(wrapper.get('[data-testid="checklist-load-error"]').text())
      .toBe('This checklist item is no longer available.');
  });

  it('hides verify and reject unless canVerify is true', async () => {
    const withoutRole = await mountList([makeItem()], false);
    expect(withoutRole.find('[data-testid="action-verify"]').exists()).toBe(false);
    expect(withoutRole.find('[data-testid="action-reject"]').exists()).toBe(false);

    const withRole = await mountList([makeItem()], true);
    expect(withRole.find('[data-testid="action-verify"]').exists()).toBe(true);
    expect(withRole.find('[data-testid="action-reject"]').exists()).toBe(true);
  });

  it('only shows reject for an already-verified item, not verify again', async () => {
    const wrapper = await mountList([makeItem({ verificationStatus: 'verified' })], true);
    expect(wrapper.find('[data-testid="action-verify"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="action-reject"]').exists()).toBe(true);
  });

  it('edits the description and notes, sending only the fields that changed', async () => {
    const wrapper = await mountList();
    const updated = makeItem({
      description: 'Updated description.', userNotes: 'Checked.', isUserEdited: true, version: 2,
    });
    api.patch.mockResolvedValue({ checklistItem: updated });

    await wrapper.get('[data-testid="action-edit"]').trigger('click');
    await wrapper.get('[data-testid="checklist-description-input"]').setValue('Updated description.');
    await wrapper.get('[data-testid="checklist-notes-input"]').setValue('Checked.');
    await wrapper.get('[data-testid="action-save"]').trigger('click');
    await flushPromises();

    expect(api.patch).toHaveBeenCalledWith('/api/organizations/0/compliance/checklist-items/104', {
      expectedVersion: 1,
      description: 'Updated description.',
      userNotes: 'Checked.',
    });
    expect(wrapper.find('[data-testid="checklist-description-input"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="checklist-description"]').text()).toBe('Updated description.');
  });

  it('does not save when nothing in the edit form actually changed', async () => {
    const wrapper = await mountList();
    await wrapper.get('[data-testid="action-edit"]').trigger('click');
    await wrapper.get('[data-testid="action-save"]').trigger('click');
    await flushPromises();
    expect(api.patch).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="checklist-description-input"]').exists()).toBe(false);
  });

  describe('refreshAfterAnalysis (AN-17 follow-up)', () => {
    it('reloads items a retry recovered, not only when the list was empty', async () => {
      const wrapper = await mountList([makeItem()]);
      api.get.mockResolvedValueOnce({
        data: [makeItem(), makeItem({ id: 105, description: 'Retain records for three years after closeout.' })],
        pagination: paginationFor(2),
      });

      await wrapper.vm.refreshAfterAnalysis();
      await flushPromises();

      expect(api.get).toHaveBeenCalledTimes(2);
      expect(wrapper.text()).toContain('Retain records for three years after closeout.');
    });

    it('does not reload while an item is mid-edit, so an in-progress edit is not lost', async () => {
      const wrapper = await mountList([makeItem()]);
      await wrapper.get('[data-testid="action-edit"]').trigger('click');
      api.get.mockClear();

      await wrapper.vm.refreshAfterAnalysis();
      await flushPromises();

      expect(api.get).not.toHaveBeenCalled();
      expect(wrapper.find('[data-testid="checklist-description-input"]').exists()).toBe(true);
    });
  });

  it('cancels editing without saving', async () => {
    const wrapper = await mountList();
    await wrapper.get('[data-testid="action-edit"]').trigger('click');
    await wrapper.get('[data-testid="checklist-description-input"]').setValue('Should not be sent.');
    await wrapper.get('[data-testid="action-cancel"]').trigger('click');
    expect(api.patch).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="checklist-description-input"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="checklist-description"]').text())
      .toBe('Submit quarterly performance reports within 30 days after each quarter.');
  });

  it('verifies an item and shows the updated status', async () => {
    const wrapper = await mountList([makeItem()], true);
    api.patch.mockResolvedValue({ checklistItem: makeItem({ verificationStatus: 'verified', verifiedBy: 9, version: 2 }) });

    await wrapper.get('[data-testid="action-verify"]').trigger('click');
    await flushPromises();

    expect(api.patch).toHaveBeenCalledWith('/api/organizations/0/compliance/checklist-items/104', {
      expectedVersion: 1,
      verificationStatus: 'verified',
    });
    expect(wrapper.get('[data-testid="checklist-verification"]').text()).toBe('Verified');
  });

  it('shows a specific message when a citation cannot be verified', async () => {
    const wrapper = await mountList([makeItem()], true);
    api.patch.mockRejectedValue(serverError(422, 'SOURCE_NOT_VERIFIABLE'));

    await wrapper.get('[data-testid="action-verify"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-testid="checklist-item-error"]').text())
      .toBe('The cited text could not be confirmed against the document, so this item cannot be verified.');
  });

  it('rejects an item', async () => {
    const wrapper = await mountList([makeItem()], true);
    api.patch.mockResolvedValue({ checklistItem: makeItem({ verificationStatus: 'rejected', verifiedBy: 9, version: 2 }) });

    await wrapper.get('[data-testid="action-reject"]').trigger('click');
    await flushPromises();

    expect(api.patch).toHaveBeenCalledWith('/api/organizations/0/compliance/checklist-items/104', {
      expectedVersion: 1,
      verificationStatus: 'rejected',
    });
    expect(wrapper.get('[data-testid="checklist-verification"]').text()).toBe('Rejected');
  });

  it('changes completion status from the select', async () => {
    const wrapper = await mountList();
    api.patch.mockResolvedValue({ checklistItem: makeItem({ completionStatus: 'completed', version: 2 }) });

    await wrapper.get('[data-testid="completion-select"]').setValue('completed');
    await flushPromises();

    expect(api.patch).toHaveBeenCalledWith('/api/organizations/0/compliance/checklist-items/104', {
      expectedVersion: 1,
      completionStatus: 'completed',
    });
    expect(wrapper.get('[data-testid="checklist-completion"]').text()).toBe('Completed');
  });

  it('reloads the list after a version conflict, so the next attempt starts from the saved state', async () => {
    const wrapper = await mountList([makeItem()], true);
    api.patch.mockRejectedValue(serverError(409, 'VERSION_CONFLICT'));
    api.get.mockResolvedValue({
      data: [makeItem({ version: 5, description: 'Already changed by someone else.' })],
      pagination: paginationFor(1),
    });

    await wrapper.get('[data-testid="action-verify"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-testid="checklist-item-error"]').text())
      .toBe('Someone else changed this item. The latest version is now shown below; review it before trying again.');
    expect(wrapper.get('[data-testid="checklist-description"]').text()).toBe('Already changed by someone else.');
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});
