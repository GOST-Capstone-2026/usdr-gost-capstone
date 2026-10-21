<template>
  <div class="deadline-calendar">
    <div class="d-flex flex-wrap align-items-center justify-content-between mb-2">
      <div class="d-flex align-items-center mb-2">
        <div
          class="btn-group btn-group-sm"
          role="group"
          aria-label="Change month"
        >
          <button
            type="button"
            class="btn btn-outline-secondary"
            aria-label="Previous month"
            data-testid="calendar-previous"
            @click="previousMonth"
          >
            &lsaquo;
          </button>
          <button
            type="button"
            class="btn btn-outline-secondary"
            aria-label="Next month"
            data-testid="calendar-next"
            @click="nextMonth"
          >
            &rsaquo;
          </button>
        </div>
        <button
          type="button"
          class="btn btn-sm btn-outline-secondary ml-2"
          data-testid="calendar-today"
          @click="goToToday"
        >
          Today
        </button>
        <h3
          class="h5 mb-0 ml-3"
          data-testid="calendar-month"
        >
          {{ monthLabel }}
        </h3>
      </div>
      <div class="mb-2">
        <label
          for="deadline-calendar-show-unverified"
          class="mb-0 mr-3"
        >
          <input
            id="deadline-calendar-show-unverified"
            v-model="showUnverified"
            type="checkbox"
            class="mr-1"
            data-testid="calendar-show-unverified"
          >
          Show unverified
        </label>
        <label
          for="deadline-calendar-show-closed"
          class="mb-0"
        >
          <input
            id="deadline-calendar-show-closed"
            v-model="showClosed"
            type="checkbox"
            class="mr-1"
            data-testid="calendar-show-closed"
          >
          Show closed
        </label>
      </div>
    </div>

    <table class="table table-bordered table-sm deadline-calendar-grid">
      <thead>
        <tr>
          <th
            v-for="weekday in weekdays"
            :key="weekday"
            scope="col"
            class="text-center small"
          >
            {{ weekday }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="week in weeks"
          :key="week[0].iso"
        >
          <td
            v-for="day in week"
            :key="day.iso"
            :class="{
              'deadline-calendar-outside': !day.inMonth,
              'deadline-calendar-today': day.iso === today,
            }"
            :data-testid="`calendar-day-${day.iso}`"
          >
            <div class="small font-weight-bold">
              {{ day.day }}
            </div>
            <div
              v-for="item in itemsByDate[day.iso] || []"
              :key="item.checklistItemId"
              class="deadline-calendar-item"
              :class="{ 'deadline-calendar-item-unverified': item.verificationStatus !== 'verified' }"
              data-testid="calendar-item"
            >
              <b-badge :variant="statusVariant(item.status)">
                {{ statusLabel(item.status) }}
              </b-badge>
              <div
                class="small text-truncate"
                :title="item.title"
              >
                {{ item.title }}
              </div>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <p
      v-if="undatedCount > 0"
      class="text-muted small mb-0"
      data-testid="calendar-undated-note"
    >
      {{ undatedMessage }}
    </p>
  </div>
</template>

<script>
import { DateTime } from 'luxon';
import { statusLabel, statusVariant, isClosedStatus } from '@/helpers/deadlineStatus';

const TIME_ZONE = 'America/New_York';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function currentMonthStart() {
  return DateTime.now().setZone(TIME_ZONE).startOf('month');
}

export default {
  props: {
    portfolio: {
      type: Array,
      required: true,
    },
    reviewNeeded: {
      type: Array,
      required: true,
    },
  },
  data() {
    return {
      monthStart: currentMonthStart(),
      showUnverified: false,
      showClosed: false,
      weekdays: WEEKDAYS,
    };
  },
  computed: {
    today() {
      return DateTime.now().setZone(TIME_ZONE).toISODate();
    },
    monthLabel() {
      return this.monthStart.toFormat('LLLL yyyy');
    },
    weeks() {
      const monthEnd = this.monthStart.endOf('month').startOf('day');
      const gridStart = this.monthStart.minus({ days: this.monthStart.weekday % 7 });
      const gridEnd = monthEnd.plus({ days: 6 - (monthEnd.weekday % 7) });
      const dayCount = Math.round(gridEnd.diff(gridStart, 'days').days) + 1;
      const days = Array.from({ length: dayCount }, (_, offset) => {
        const day = gridStart.plus({ days: offset });
        return { iso: day.toISODate(), day: day.day, inMonth: day.month === this.monthStart.month };
      });
      return Array.from({ length: dayCount / 7 }, (_, week) => days.slice(week * 7, week * 7 + 7));
    },
    visibleItems() {
      const candidates = this.showUnverified ? [...this.portfolio, ...this.reviewNeeded] : this.portfolio;
      return candidates.filter((item) => item.dueDate && (this.showClosed || !isClosedStatus(item.status)));
    },
    itemsByDate() {
      const byDate = {};
      this.visibleItems.forEach((item) => {
        byDate[item.dueDate] = [...(byDate[item.dueDate] || []), item];
      });
      return byDate;
    },
    undatedCount() {
      return this.reviewNeeded.filter((item) => !item.dueDate).length;
    },
    undatedMessage() {
      return this.undatedCount === 1
        ? '1 deadline has no due date and is listed under Review Needed in the List view.'
        : `${this.undatedCount} deadlines have no due date and are listed under Review Needed in the List view.`;
    },
  },
  methods: {
    previousMonth() {
      this.monthStart = this.monthStart.minus({ months: 1 });
    },
    nextMonth() {
      this.monthStart = this.monthStart.plus({ months: 1 });
    },
    goToToday() {
      this.monthStart = currentMonthStart();
    },
    statusLabel,
    statusVariant,
  },
};
</script>

<style scoped>
.deadline-calendar-grid {
  table-layout: fixed;
}
.deadline-calendar-grid td {
  height: 6rem;
  vertical-align: top;
}
.deadline-calendar-outside {
  background-color: #f8f9fa;
  color: #6c757d;
}
.deadline-calendar-today {
  box-shadow: inset 0 0 0 2px #007bff;
}
.deadline-calendar-item {
  margin-top: 0.25rem;
}
.deadline-calendar-item-unverified {
  border-left: 3px dashed #6c757d;
  padding-left: 0.25rem;
  opacity: 0.8;
}
</style>
