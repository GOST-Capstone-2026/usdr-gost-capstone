export const STATUS_DISPLAY = {
  overdue: { label: 'Overdue', variant: 'danger' },
  overdueUnverified: { label: 'Overdue Unverified', variant: 'danger' },
  dueToday: { label: 'Due Today', variant: 'warning' },
  dueTodayUnverified: { label: 'Due Today Unverified', variant: 'warning' },
  dueSoon: { label: 'Due Soon', variant: 'warning' },
  dueSoonUnverified: { label: 'Due Soon Unverified', variant: 'warning' },
  upcoming: { label: 'Upcoming', variant: 'info' },
  upcomingUnverified: { label: 'Upcoming Unverified', variant: 'info' },
  completed: { label: 'Complete', variant: 'success' },
  completedUnverified: { label: 'Complete Unverified', variant: 'success' },
  completedLate: { label: 'Complete (Was Overdue)', variant: 'success' },
  completedLateUnverified: { label: 'Complete Unverified (Was Overdue)', variant: 'success' },
  notApplicable: { label: 'Not Applicable', variant: 'secondary' },
  notApplicableUnverified: { label: 'Not Applicable Unverified', variant: 'secondary' },
  reviewNeeded: { label: 'Review Needed', variant: 'secondary' },
};

export const CLOSED_STATUSES = ['completed', 'completedLate', 'notApplicable'];

export function statusLabel(status) {
  return (STATUS_DISPLAY[status] || { label: status }).label;
}

export function statusVariant(status) {
  return (STATUS_DISPLAY[status] || { variant: 'secondary' }).variant;
}

export function isClosedStatus(status) {
  return CLOSED_STATUSES.includes(status.replace(/Unverified$/, ''));
}
