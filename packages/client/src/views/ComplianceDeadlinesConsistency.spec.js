import {
  describe, beforeEach, afterEach, it, expect, vi,
} from 'vitest';
import { h } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import ComplianceDeadlinesView from '@/views/ComplianceDeadlinesView.vue';
import deadlines from '@/store/modules/deadlines';

const PassThroughStub = {
  setup(props, { slots }) {
    return () => h('div', slots.default && slots.default());
  },
};

const deadline = (checklistItemId, title, status, dueDate, overrides = {}) => ({
  checklistItemId,
  grantId: '335255',
  documentId: 6,
  title,
  dueDate,
  status,
  completionStatus: 'notStarted',
  completedAt: null,
  verificationStatus: 'verified',
  verifiedBy: 1,
  verifiedByName: 'Alex Allain',
  verifiedAt: '2026-10-01T15:00:00.000Z',
  version: 1,
  source: { pageNumber: 12, excerpt: 'Quoted requirement.' },
  sources: [{ pageNumber: 12, excerpt: 'Quoted requirement.' }],
  ...overrides,
});

const unverified = {
  verificationStatus: 'unverified', verifiedBy: null, verifiedByName: null, verifiedAt: null,
};

const PORTFOLIO = [
  deadline(1, 'Audit filing', 'overdue', '2026-10-05'),
  deadline(2, 'Board certification', 'dueToday', '2026-10-13'),
  deadline(3, 'Quarterly report', 'dueSoon', '2026-10-16'),
  deadline(4, 'Equipment inventory', 'dueSoon', '2026-10-16'),
  deadline(5, 'Annual report', 'upcoming', '2026-10-28'),
  deadline(6, 'Close-out report', 'completedLate', '2026-10-02', { completionStatus: 'completed', completedAt: '2026-10-03T15:00:00.000Z' }),
  deadline(7, 'Kickoff memo', 'completed', '2026-10-01', { completionStatus: 'completed', completedAt: '2026-10-01T15:00:00.000Z' }),
  deadline(8, 'Match waiver', 'notApplicable', '2026-10-09', { completionStatus: 'notApplicable' }),
];

const REVIEW_NEEDED = [
  deadline(9, 'Civil rights self-assessment', 'overdueUnverified', '2026-10-07', unverified),
  deadline(10, 'Monitoring plan', 'dueSoonUnverified', '2026-10-15', unverified),
  deadline(11, 'Records retention', 'reviewNeeded', null, unverified),
];

const OPEN_SECTIONS = {
  overdue: [1], dueToday: [2], dueSoon: [3, 4], upcoming: [5],
};
const SECTION_LABELS = {
  overdue: 'Overdue', dueToday: 'Due Today', dueSoon: 'Due Soon', upcoming: 'Upcoming',
};

const ALL = [...PORTFOLIO, ...REVIEW_NEEDED];
const byId = (id) => ALL.find((item) => item.checklistItemId === id);

const pageFor = (count) => ({
  currentPage: 1, perPage: 500, total: count, lastPage: 1,
});
const responseFor = (portfolio, reviewNeeded) => ({
  ok: true,
  json: async () => ({
    data: { portfolio, reviewNeeded },
    pagination: { portfolio: pageFor(portfolio.length), reviewNeeded: pageFor(reviewNeeded.length) },
  }),
});

let wrapper;
let fetch;

async function mountPage(responses) {
  fetch = vi.fn();
  responses.forEach((response) => fetch.mockResolvedValueOnce(response));
  vi.stubGlobal('fetch', fetch);
  const store = createStore({
    modules: { deadlines },
    state: { agencyId: 0 },
    getters: {
      'users/selectedAgencyId': (state) => state.agencyId,
      'users/userRole': () => 'admin',
    },
    mutations: { 'alerts/addAlert': () => {} },
  });
  wrapper = mount(ComplianceDeadlinesView, {
    global: {
      plugins: [store],
      stubs: { 'b-badge': PassThroughStub, 'b-spinner': PassThroughStub },
      mocks: { $route: { query: {} } },
    },
  });
  await flushPromises();
}

const section = (key) => wrapper.get(`[data-testid="deadline-section-${key}"]`);
const listTitles = (key) => section(key).findAll('[data-testid="deadline-title"]').map((title) => title.text());
const summaryCount = (key) => Number(wrapper.get(`[data-testid="summary-${key}"] .dl-figure`).text());
const showClosedList = () => section('completed').get('button').trigger('click');

const switchToCalendar = async () => {
  await wrapper.get('[data-testid="view-calendar"]').trigger('click');
  await flushPromises();
};
const calendarEntries = () => wrapper.findAll('[data-testid^="calendar-day-"]').flatMap((day) => {
  const iso = day.attributes('data-testid').replace('calendar-day-', '');
  return day.findAll('[data-testid="calendar-item"]').map((entry) => ({
    iso,
    title: entry.get('[title]').text(),
    text: entry.text(),
  }));
});
const calendarTitles = () => calendarEntries().map(({ title }) => title).sort();
const titlesOf = (ids) => ids.map((id) => byId(id).title).sort();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-13T16:00:00Z'));
});

afterEach(() => {
  wrapper?.unmount();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('T-08 / M-12 deadline list, summary and calendar consistency', () => {
  beforeEach(async () => {
    await mountPage([responseFor(PORTFOLIO, REVIEW_NEEDED)]);
  });

  it('gives every summary card the same count as its list section', () => {
    Object.entries(OPEN_SECTIONS).forEach(([key, ids]) => {
      expect(summaryCount(key)).toBe(ids.length);
      expect(listTitles(key)).toHaveLength(ids.length);
    });
    expect(summaryCount('reviewNeeded')).toBe(REVIEW_NEEDED.length);
    expect(listTitles('reviewNeeded')).toHaveLength(REVIEW_NEEDED.length);
  });

  it('lists every deadline exactly once, in the section its server status belongs to', async () => {
    await showClosedList();
    Object.entries(OPEN_SECTIONS).forEach(([key, ids]) => {
      expect(listTitles(key).sort()).toEqual(titlesOf(ids));
    });
    expect(listTitles('reviewNeeded').sort()).toEqual(titlesOf([9, 10, 11]));
    expect(listTitles('completed').sort()).toEqual(titlesOf([6, 7, 8]));
    const everyRow = ['overdue', 'dueToday', 'dueSoon', 'upcoming', 'reviewNeeded', 'completed'].flatMap(listTitles);
    expect(everyRow.sort()).toEqual(ALL.map(({ title }) => title).sort());
  });

  it('keeps unverified and undated deadlines out of every portfolio count', () => {
    const portfolioCount = ['overdue', 'dueToday', 'dueSoon', 'upcoming'].reduce((sum, key) => sum + summaryCount(key), 0);
    expect(portfolioCount).toBe(5);
    ['overdue', 'dueSoon'].forEach((key) => {
      expect(listTitles(key)).not.toContain('Civil rights self-assessment');
      expect(listTitles(key)).not.toContain('Monitoring plan');
    });
  });

  it('shows by default exactly the open verified deadlines on the calendar, each on its due date', async () => {
    await switchToCalendar();
    const open = [1, 2, 3, 4, 5].map(byId);
    expect(calendarTitles()).toEqual(open.map(({ title }) => title).sort());
    open.forEach((item) => {
      expect(calendarEntries().filter(({ title }) => title === item.title).map(({ iso }) => iso)).toEqual([item.dueDate]);
    });
    expect(wrapper.get('[data-testid="calendar-undated-note"]').text()).toContain('1 deadline has no due date');
  });

  it('places every dated deadline on its due date once unverified and closed items are shown, and never an undated one', async () => {
    await switchToCalendar();
    await wrapper.get('[data-testid="calendar-show-unverified"]').setValue(true);
    await wrapper.get('[data-testid="calendar-show-closed"]').setValue(true);
    const dated = ALL.filter(({ dueDate }) => dueDate);
    expect(calendarTitles()).toEqual(dated.map(({ title }) => title).sort());
    dated.forEach((item) => {
      expect(calendarEntries().filter(({ title }) => title === item.title).map(({ iso }) => iso)).toEqual([item.dueDate]);
    });
    expect(calendarTitles()).not.toContain('Records retention');
  });

  it('shows the same status label for a deadline in the list and on the calendar', async () => {
    await showClosedList();
    const listLabels = {};
    Object.entries(SECTION_LABELS).forEach(([key, label]) => {
      listTitles(key).forEach((title) => { listLabels[title] = label; });
    });
    ['reviewNeeded', 'completed'].forEach((key) => {
      section(key).findAll('[data-testid="deadline-row"]').forEach((row) => {
        listLabels[row.get('[data-testid="deadline-title"]').text()] = row.get('.dl-col-status .dl-chip').text();
      });
    });
    expect(Object.keys(listLabels)).toHaveLength(ALL.length);

    await switchToCalendar();
    await wrapper.get('[data-testid="calendar-show-unverified"]').setValue(true);
    await wrapper.get('[data-testid="calendar-show-closed"]').setValue(true);
    expect(calendarEntries()).toHaveLength(ALL.length - 1);
    calendarEntries().forEach(({ title, text }) => {
      expect(text).toContain(listLabels[title]);
    });
  });
});

describe('T-08 / M-12 consistency after a change', () => {
  it('updates the summary, list and calendar together when a deadline is marked complete, without a reload', async () => {
    const afterComplete = PORTFOLIO.map((item) => (item.checklistItemId === 3
      ? {
        ...item, status: 'completed', completionStatus: 'completed', completedAt: '2026-10-13T16:00:00.000Z',
      }
      : item));
    await mountPage([
      responseFor(PORTFOLIO, REVIEW_NEEDED),
      { ok: true, json: async () => ({ deadline: afterComplete[2] }) },
      responseFor(afterComplete, REVIEW_NEEDED),
    ]);
    const row = section('dueSoon').findAll('[data-testid="deadline-row"]')
      .find((candidate) => candidate.text().includes('Quarterly report'));
    await row.get('[data-testid="toggle-details"]').trigger('click');
    await section('dueSoon').get('[data-testid="action-complete"]').trigger('click');
    await flushPromises();

    expect(fetch.mock.calls[1][1].method).toBe('PATCH');
    expect(summaryCount('dueSoon')).toBe(1);
    expect(listTitles('dueSoon')).toEqual(['Equipment inventory']);
    await showClosedList();
    expect(listTitles('completed')).toContain('Quarterly report');
    await switchToCalendar();
    expect(calendarTitles()).not.toContain('Quarterly report');
    expect(calendarTitles()).toContain('Equipment inventory');
  });
});
