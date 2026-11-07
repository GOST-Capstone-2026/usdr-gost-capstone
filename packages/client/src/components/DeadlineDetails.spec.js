import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import DeadlineDetails from '@/components/DeadlineDetails.vue';

const makeItem = (overrides) => ({
  checklistItemId: 1,
  title: 'Deadline',
  verificationStatus: 'verified',
  verifiedAt: '2026-09-20T15:00:00.000Z',
  source: { pageNumber: 14, excerpt: 'Quarterly reports are due within 30 days.' },
  ...overrides,
});

const mountDetails = (overrides) => mount(DeadlineDetails, { props: { item: makeItem(overrides) } });

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

  it('shows Verified without a date when no verified time is recorded', () => {
    const wrapper = mountDetails({ verifiedAt: null });
    expect(wrapper.get('[data-testid="deadline-verification"]').text()).toBe('Verified');
  });

  it('shows Not yet verified for an unverified item', () => {
    const wrapper = mountDetails({ verificationStatus: 'unverified', verifiedAt: null });
    expect(wrapper.get('[data-testid="deadline-verification"]').text()).toBe('Not yet verified');
  });
});
