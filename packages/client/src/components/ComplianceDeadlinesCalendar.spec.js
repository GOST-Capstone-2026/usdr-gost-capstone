import {
  describe, beforeEach, afterEach, it, expect, vi,
} from 'vitest';
import { h } from 'vue';
import { mount } from '@vue/test-utils';
import ComplianceDeadlinesCalendar from '@/components/ComplianceDeadlinesCalendar.vue';

const BBadgeStub = {
  setup(props, { slots }) {
    return () => h('span', slots.default && slots.default());
  },
};

const makeItem = (overrides) => ({
  checklistItemId: 1,
  title: 'Deadline',
  dueDate: '2026-10-20',
  status: 'upcoming',
  completionStatus: 'notStarted',
  completedAt: null,
  verificationStatus: 'verified',
  ...overrides,
});

const portfolio = [
  makeItem({
    checklistItemId: 1, title: 'Quarterly report', dueDate: '2026-10-20', status: 'upcoming',
  }),
  makeItem({
    checklistItemId: 2, title: 'Audit filing', dueDate: '2026-10-05', status: 'overdue',
  }),
  makeItem({
    checklistItemId: 3, title: 'Closed report', dueDate: '2026-10-02', status: 'completed', completionStatus: 'completed',
  }),
  makeItem({
    checklistItemId: 4, title: 'November report', dueDate: '2026-11-04', status: 'upcoming',
  }),
];

const reviewNeeded = [
  makeItem({
    checklistItemId: 5, title: 'Unverified plan', dueDate: '2026-10-15', status: 'dueSoonUnverified', verificationStatus: 'unverified',
  }),
  makeItem({
    checklistItemId: 6, title: 'Closed unverified', dueDate: '2026-10-09', status: 'completedUnverified', completionStatus: 'completed', verificationStatus: 'unverified',
  }),
  makeItem({
    checklistItemId: 7, title: 'Undated records', dueDate: null, status: 'reviewNeeded', verificationStatus: 'unverified',
  }),
];

let wrapper;

function mountCalendar(props = {}) {
  wrapper = mount(ComplianceDeadlinesCalendar, {
    props: { portfolio, reviewNeeded, ...props },
    global: { stubs: { 'b-badge': BBadgeStub } },
  });
}

const day = (iso) => wrapper.get(`[data-testid="calendar-day-${iso}"]`);
const titlesOn = (iso) => day(iso).findAll('[data-testid="calendar-item"]').map((item) => item.find('[title]').text());
const allTitles = () => wrapper.findAll('[data-testid="calendar-item"]').map((item) => item.find('[title]').text());
const monthLabel = () => wrapper.get('[data-testid="calendar-month"]').text();
const weekCount = () => wrapper.findAll('tbody tr').length;
const dayIds = () => wrapper.findAll('tbody td').map((cell) => cell.attributes('data-testid'));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-13T16:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  wrapper = undefined;
});

describe('ComplianceDeadlinesCalendar.vue', () => {
  it('opens on the current Eastern Time month as Sunday-to-Saturday weeks', () => {
    mountCalendar();
    expect(monthLabel()).toBe('October 2026');
    expect(weekCount()).toBe(5);
    expect(dayIds()[0]).toBe('calendar-day-2026-09-27');
    expect(dayIds()[dayIds().length - 1]).toBe('calendar-day-2026-10-31');
  });

  it('places the month controls before the month label so they do not move when the label changes width', () => {
    mountCalendar();
    const order = wrapper.findAll('[data-testid^="calendar-"]')
      .map((element) => element.attributes('data-testid'))
      .filter((id) => ['calendar-previous', 'calendar-next', 'calendar-today', 'calendar-month'].includes(id));
    expect(order).toEqual(['calendar-previous', 'calendar-next', 'calendar-today', 'calendar-month']);
  });

  it('highlights today in Eastern Time', () => {
    mountCalendar();
    expect(day('2026-10-13').classes()).toContain('deadline-calendar-today');
    expect(day('2026-10-12').classes()).not.toContain('deadline-calendar-today');
  });

  it('places verified deadlines on their due dates with the server status label', () => {
    mountCalendar();
    expect(titlesOn('2026-10-20')).toEqual(['Quarterly report']);
    expect(titlesOn('2026-10-05')).toEqual(['Audit filing']);
    expect(day('2026-10-05').text()).toContain('Overdue');
  });

  it('hides unverified and closed deadlines by default', () => {
    mountCalendar();
    expect(allTitles()).toEqual(['Audit filing', 'Quarterly report']);
  });

  it('shows open unverified deadlines with distinct styling when Show unverified is checked', async () => {
    mountCalendar();
    await wrapper.get('[data-testid="calendar-show-unverified"]').setValue(true);

    expect(titlesOn('2026-10-15')).toEqual(['Unverified plan']);
    const item = day('2026-10-15').get('[data-testid="calendar-item"]');
    expect(item.classes()).toContain('deadline-calendar-item-unverified');
    expect(item.text()).toContain('Due Soon Unverified');
    expect(titlesOn('2026-10-09')).toEqual([]);
  });

  it('shows closed deadlines only when Show closed is checked', async () => {
    mountCalendar();
    await wrapper.get('[data-testid="calendar-show-closed"]').setValue(true);
    expect(titlesOn('2026-10-02')).toEqual(['Closed report']);
    expect(titlesOn('2026-10-09')).toEqual([]);

    await wrapper.get('[data-testid="calendar-show-unverified"]').setValue(true);
    expect(titlesOn('2026-10-09')).toEqual(['Closed unverified']);
  });

  it('moves between months and returns to the current month', async () => {
    mountCalendar();
    await wrapper.get('[data-testid="calendar-next"]').trigger('click');
    expect(monthLabel()).toBe('November 2026');
    expect(titlesOn('2026-11-04')).toEqual(['November report']);

    await wrapper.get('[data-testid="calendar-previous"]').trigger('click');
    await wrapper.get('[data-testid="calendar-previous"]').trigger('click');
    expect(monthLabel()).toBe('September 2026');

    await wrapper.get('[data-testid="calendar-today"]').trigger('click');
    expect(monthLabel()).toBe('October 2026');
  });

  it('keeps whole weeks across the daylight saving change', async () => {
    mountCalendar();
    await wrapper.get('[data-testid="calendar-next"]').trigger('click');
    expect(weekCount()).toBe(5);
    expect(dayIds()[0]).toBe('calendar-day-2026-11-01');
    expect(dayIds()[dayIds().length - 1]).toBe('calendar-day-2026-12-05');
  });

  it('notes how many undated deadlines are listed under Review Needed', () => {
    mountCalendar();
    expect(wrapper.get('[data-testid="calendar-undated-note"]').text())
      .toBe('1 deadline has no due date and is listed under Review Needed in the List view.');
  });

  it('omits the undated note when every deadline has a date', () => {
    mountCalendar({ reviewNeeded: reviewNeeded.filter((item) => item.dueDate) });
    expect(wrapper.find('[data-testid="calendar-undated-note"]').exists()).toBe(false);
  });

  describe('selecting a deadline', () => {
    const sourcedPortfolio = [
      makeItem({
        checklistItemId: 21,
        title: 'Quarterly report',
        dueDate: '2026-10-20',
        verifiedAt: '2026-10-01T15:00:00.000Z',
        source: { pageNumber: 14, excerpt: 'Quarterly reports are due within 30 days.' },
      }),
    ];

    it('shows no details panel until a deadline is clicked', () => {
      mountCalendar({ portfolio: sourcedPortfolio });
      expect(wrapper.find('[data-testid="calendar-details"]').exists()).toBe(false);
    });

    it('shows the source and verification state of the clicked deadline', async () => {
      mountCalendar({ portfolio: sourcedPortfolio });
      await day('2026-10-20').get('[data-testid="calendar-item"]').trigger('click');

      const details = wrapper.get('[data-testid="calendar-details"]');
      expect(details.text()).toContain('Quarterly report');
      expect(details.get('[data-testid="deadline-source"]').text())
        .toBe('Page 14: "Quarterly reports are due within 30 days."');
      expect(details.get('[data-testid="deadline-verification"]').text()).toBe('Verified on Oct 1, 2026');
      expect(day('2026-10-20').get('[data-testid="calendar-item"]').attributes('aria-pressed')).toBe('true');
    });

    it('shows Source not found and Not yet verified for an unverified deadline without a source', async () => {
      mountCalendar();
      await wrapper.get('[data-testid="calendar-show-unverified"]').setValue(true);
      await day('2026-10-15').get('[data-testid="calendar-item"]').trigger('click');

      const details = wrapper.get('[data-testid="calendar-details"]');
      expect(details.get('[data-testid="deadline-source"]').text()).toBe('Source not found');
      expect(details.get('[data-testid="deadline-verification"]').text()).toBe('Not yet verified');
    });

    it('closes the panel with Close or by clicking the deadline again', async () => {
      mountCalendar({ portfolio: sourcedPortfolio });
      const item = day('2026-10-20').get('[data-testid="calendar-item"]');

      await item.trigger('click');
      await wrapper.get('[data-testid="calendar-details-close"]').trigger('click');
      expect(wrapper.find('[data-testid="calendar-details"]').exists()).toBe(false);

      await item.trigger('click');
      await item.trigger('click');
      expect(wrapper.find('[data-testid="calendar-details"]').exists()).toBe(false);
    });

    it('hides the panel when the selected deadline is filtered out', async () => {
      mountCalendar();
      await wrapper.get('[data-testid="calendar-show-unverified"]').setValue(true);
      await day('2026-10-15').get('[data-testid="calendar-item"]').trigger('click');
      await wrapper.get('[data-testid="calendar-show-unverified"]').setValue(false);

      expect(wrapper.find('[data-testid="calendar-details"]').exists()).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('renders a month that fits in exactly four weeks', () => {
      vi.setSystemTime(new Date('2026-02-10T16:00:00Z'));
      mountCalendar();
      expect(monthLabel()).toBe('February 2026');
      expect(weekCount()).toBe(4);
      expect(dayIds()[0]).toBe('calendar-day-2026-02-01');
      expect(dayIds()[dayIds().length - 1]).toBe('calendar-day-2026-02-28');
    });

    it('renders a month that needs six weeks', () => {
      vi.setSystemTime(new Date('2027-01-10T16:00:00Z'));
      mountCalendar();
      expect(monthLabel()).toBe('January 2027');
      expect(weekCount()).toBe(6);
      expect(dayIds()[0]).toBe('calendar-day-2026-12-27');
      expect(dayIds()[dayIds().length - 1]).toBe('calendar-day-2027-02-06');
    });

    it('uses the Eastern Time date for today when UTC has already moved to the next day', () => {
      vi.setSystemTime(new Date('2026-10-14T02:30:00Z'));
      mountCalendar();
      expect(day('2026-10-13').classes()).toContain('deadline-calendar-today');
      expect(day('2026-10-14').classes()).not.toContain('deadline-calendar-today');
    });

    it('opens on the Eastern Time month when UTC has already moved to the next month', () => {
      vi.setSystemTime(new Date('2026-11-01T03:30:00Z'));
      mountCalendar();
      expect(monthLabel()).toBe('October 2026');
      expect(day('2026-10-31').classes()).toContain('deadline-calendar-today');
    });

    it('crosses the year boundary when moving forward from December', async () => {
      vi.setSystemTime(new Date('2026-12-15T16:00:00Z'));
      mountCalendar();
      expect(monthLabel()).toBe('December 2026');
      await wrapper.get('[data-testid="calendar-next"]').trigger('click');
      expect(monthLabel()).toBe('January 2027');
    });

    it('lists every deadline that shares a due date', () => {
      mountCalendar({
        portfolio: [
          makeItem({ checklistItemId: 11, title: 'First filing', dueDate: '2026-10-22' }),
          makeItem({ checklistItemId: 12, title: 'Second filing', dueDate: '2026-10-22' }),
        ],
      });
      expect(titlesOn('2026-10-22')).toEqual(['First filing', 'Second filing']);
    });

    it('shows deadlines that fall on the neighboring-month days in the grid', () => {
      mountCalendar({
        portfolio: [makeItem({ checklistItemId: 13, title: 'Late September filing', dueDate: '2026-09-28' })],
      });
      expect(day('2026-09-28').classes()).toContain('deadline-calendar-outside');
      expect(titlesOn('2026-09-28')).toEqual(['Late September filing']);
    });

    it('renders an empty grid when there are no deadlines', () => {
      mountCalendar({ portfolio: [], reviewNeeded: [] });
      expect(weekCount()).toBe(5);
      expect(wrapper.findAll('[data-testid="calendar-item"]')).toHaveLength(0);
      expect(wrapper.find('[data-testid="calendar-undated-note"]').exists()).toBe(false);
    });

    it('uses the plural note for more than one undated deadline', () => {
      mountCalendar({
        reviewNeeded: [
          makeItem({
            checklistItemId: 14, dueDate: null, status: 'reviewNeeded', verificationStatus: 'unverified',
          }),
          makeItem({
            checklistItemId: 15, dueDate: null, status: 'reviewNeeded', verificationStatus: 'unverified',
          }),
        ],
      });
      expect(wrapper.get('[data-testid="calendar-undated-note"]').text())
        .toBe('2 deadlines have no due date and are listed under Review Needed in the List view.');
    });
  });
});
