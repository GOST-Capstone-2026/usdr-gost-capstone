import {
  describe, beforeEach, afterEach, it, expect, vi,
} from 'vitest';
import { h } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import ComplianceDeadlinesView from '@/views/ComplianceDeadlinesView.vue';

const BTableStub = {
  props: ['items', 'fields', 'emptyText'],
  setup(props, { slots }) {
    return () => h('table', props.items.length
      ? props.items.map((item) => h('tr', { 'data-testid': 'deadline-row' }, props.fields.map((field) => {
        const cell = slots[`cell(${field.key})`];
        return h('td', cell ? cell({ item }) : item[field.key]);
      })))
      : [h('tr', [h('td', props.emptyText)])]);
  },
};

const BButtonStub = {
  setup(props, { slots, attrs }) {
    return () => h('button', { onClick: attrs.onClick }, slots.default && slots.default());
  },
};

const PassThroughStub = {
  setup(props, { slots }) {
    return () => h('div', slots.default && slots.default());
  },
};

const stubs = {
  'b-table': BTableStub,
  'b-button': BButtonStub,
  'b-alert': PassThroughStub,
  'b-badge': PassThroughStub,
};

const makeItem = (overrides) => ({
  checklistItemId: 1,
  title: 'Deadline',
  dueDate: '2026-10-15',
  status: 'upcoming',
  completionStatus: 'notStarted',
  completedAt: null,
  verificationStatus: 'verified',
  verifiedBy: 1,
  verifiedAt: '2026-09-20T15:00:00.000Z',
  source: null,
  ...overrides,
});

const portfolio = [
  makeItem({ checklistItemId: 1, title: 'Overdue report', status: 'overdue' }),
  makeItem({ checklistItemId: 2, title: 'Today report', status: 'dueToday' }),
  makeItem({ checklistItemId: 3, title: 'Soon report', status: 'dueSoon' }),
  makeItem({ checklistItemId: 4, title: 'Later report', status: 'upcoming' }),
  makeItem({
    checklistItemId: 5, title: 'Late finished report', status: 'completedLate', completionStatus: 'completed', completedAt: '2026-09-12T15:00:00.000Z',
  }),
  makeItem({
    checklistItemId: 6, title: 'On time report', status: 'completed', completionStatus: 'completed', completedAt: '2026-09-10T15:00:00.000Z',
  }),
];

const reviewNeeded = [
  makeItem({
    checklistItemId: 7, title: 'Unverified plan', status: 'dueSoonUnverified', verificationStatus: 'unverified', verifiedBy: null, verifiedAt: null,
  }),
  makeItem({
    checklistItemId: 8, title: 'Undated records', dueDate: null, status: 'reviewNeeded', verificationStatus: 'unverified', verifiedBy: null, verifiedAt: null,
  }),
];

const paginationFor = (portfolioTotal, reviewNeededTotal) => ({
  portfolio: {
    currentPage: 1, perPage: 500, total: portfolioTotal, lastPage: 1,
  },
  reviewNeeded: {
    currentPage: 1, perPage: 500, total: reviewNeededTotal, lastPage: 1,
  },
});

let wrapper;
let fetchDeadlines;

function mountView({
  portfolioItems = portfolio,
  reviewNeededItems = reviewNeeded,
  pagination = paginationFor(portfolioItems.length, reviewNeededItems.length),
  fetchImpl = () => Promise.resolve(),
} = {}) {
  fetchDeadlines = vi.fn(fetchImpl);
  const store = createStore({
    getters: {
      'deadlines/portfolio': () => portfolioItems,
      'deadlines/reviewNeeded': () => reviewNeededItems,
      'deadlines/pagination': () => pagination,
      'users/selectedAgency': () => undefined,
    },
    actions: {
      'deadlines/fetchDeadlines': fetchDeadlines,
    },
  });
  wrapper = mount(ComplianceDeadlinesView, {
    global: {
      plugins: [store],
      stubs,
    },
  });
  return flushPromises();
}

const section = (key) => wrapper.get(`[data-testid="deadline-section-${key}"]`);
const rowTitles = (key) => section(key).findAll('[data-testid="deadline-row"]').map((row) => row.find('td').text());

afterEach(() => {
  wrapper = undefined;
});

describe('ComplianceDeadlinesView.vue', () => {
  describe('when deadlines load', () => {
    beforeEach(async () => {
      await mountView();
    });

    it('fetches deadlines on mount', () => {
      expect(fetchDeadlines).toHaveBeenCalledTimes(1);
    });

    it('places each portfolio item in the section matching its server status', () => {
      expect(rowTitles('overdue')).toEqual(['Overdue report']);
      expect(rowTitles('dueToday')).toEqual(['Today report']);
      expect(rowTitles('dueSoon')).toEqual(['Soon report']);
      expect(rowTitles('upcoming')).toEqual(['Later report']);
    });

    it('shows the verification state next to each portfolio deadline', () => {
      const text = section('overdue').text();
      expect(text).toContain('Verified');
      expect(text).toContain('Overdue');
    });

    it('lists reviewNeeded items with their unverified status labels', () => {
      expect(rowTitles('reviewNeeded')).toEqual(['Unverified plan', 'Undated records']);
      const text = section('reviewNeeded').text();
      expect(text).toContain('Due Soon Unverified');
      expect(text).toContain('Unverified');
    });

    it('shows "No due date" and the Review Needed label for an undated item', () => {
      const undatedRow = section('reviewNeeded').findAll('[data-testid="deadline-row"]')[1];
      expect(undatedRow.text()).toContain('No due date');
      expect(undatedRow.text()).toContain('Review Needed');
    });

    it('hides completed items until requested, then shows on-time and late labels', async () => {
      const completed = section('completed');
      expect(completed.findAll('[data-testid="deadline-row"]')).toHaveLength(0);
      expect(completed.text()).toContain('Show closed (2)');
      expect(completed.text()).toContain('Completed or marked not applicable.');

      await completed.get('button').trigger('click');

      expect(rowTitles('completed')).toEqual(['Late finished report', 'On time report']);
      expect(section('completed').text()).toContain('Complete (Was Overdue)');
    });

    it('does not show a truncation warning when every item fits', () => {
      expect(wrapper.text()).not.toContain('Not every deadline is shown');
    });
  });

  describe('when the server returns no reviewNeeded items', () => {
    beforeEach(async () => {
      await mountView({ reviewNeededItems: [] });
    });

    it('still shows the Review Needed section with an empty message', () => {
      expect(section('reviewNeeded').text()).toContain('Review Needed');
      expect(section('reviewNeeded').text()).toContain('No deadlines in this section.');
    });
  });

  describe('status display', () => {
    it('uses the server status instead of recalculating it from the due date', async () => {
      await mountView({
        portfolioItems: [makeItem({ title: 'Server says upcoming', dueDate: '2000-01-01', status: 'upcoming' })],
        reviewNeededItems: [],
      });
      expect(rowTitles('upcoming')).toEqual(['Server says upcoming']);
      expect(rowTitles('overdue')).toEqual([]);
    });
  });

  describe('when an item is not applicable', () => {
    beforeEach(async () => {
      await mountView({
        portfolioItems: [makeItem({
          title: 'Waived report', dueDate: '2000-01-01', status: 'notApplicable', completionStatus: 'notApplicable',
        })],
        reviewNeededItems: [],
      });
    });

    it('keeps it out of the active sections', () => {
      ['overdue', 'dueToday', 'dueSoon', 'upcoming'].forEach((key) => {
        expect(rowTitles(key)).toEqual([]);
      });
    });

    it('lists it with completed items under a Not Applicable label', async () => {
      const completed = section('completed');
      expect(completed.text()).toContain('Show closed (1)');

      await completed.get('button').trigger('click');

      expect(rowTitles('completed')).toEqual(['Waived report']);
      const rowText = section('completed').get('[data-testid="deadline-row"]').text();
      expect(rowText).toContain('Not Applicable');
      expect(rowText).toContain('N/A');
      expect(rowText).not.toContain('Complete');
      expect(rowText).not.toContain('Not recorded');
    });
  });

  describe('when more deadlines exist than were returned', () => {
    it('shows a truncation warning', async () => {
      await mountView({ pagination: paginationFor(portfolio.length + 1, reviewNeeded.length) });
      expect(wrapper.text()).toContain('Not every deadline is shown');
    });
  });

  describe('when loading fails', () => {
    beforeEach(async () => {
      await mountView({ fetchImpl: () => Promise.reject(new Error('network down')) });
    });

    it('shows a recoverable error instead of the sections', () => {
      expect(wrapper.text()).toContain('Deadlines could not be loaded');
      expect(wrapper.find('[data-testid="deadline-section-overdue"]').exists()).toBe(false);
    });

    it('retries the request when Retry is clicked', async () => {
      await wrapper.get('button').trigger('click');
      await flushPromises();
      expect(fetchDeadlines).toHaveBeenCalledTimes(2);
    });
  });
});
