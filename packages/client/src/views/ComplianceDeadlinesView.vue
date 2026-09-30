<template>
  <section class="container">
    <b-card class="border-0">
      <h2 class="card-title h4 mb-3">
        Compliance Deadlines
      </h2>

      <div
        v-if="loading"
        class="text-center my-4"
      >
        <b-spinner label="Loading deadlines" />
      </div>

      <b-alert
        v-else-if="loadError"
        show
        variant="danger"
        class="d-flex align-items-center justify-content-between"
      >
        <span>Deadlines could not be loaded. Please try again.</span>
        <b-button
          size="sm"
          variant="outline-danger"
          @click="loadDeadlines"
        >
          Retry
        </b-button>
      </b-alert>

      <template v-else>
        <b-alert
          v-if="isTruncated"
          show
          variant="warning"
        >
          Not every deadline is shown. This organization has more deadlines than the dashboard can display at once.
        </b-alert>

        <div
          v-for="section in sections"
          :key="section.key"
          class="mb-4"
          :data-testid="`deadline-section-${section.key}`"
        >
          <h3 class="h5">
            {{ section.title }}
            <b-badge
              pill
              variant="light"
            >
              {{ section.items.length }}
            </b-badge>
          </h3>
          <p
            v-if="section.description"
            class="text-muted small mb-2"
          >
            {{ section.description }}
          </p>
          <b-table
            :items="section.items"
            :fields="fields"
            primary-key="checklistItemId"
            show-empty
            empty-text="No deadlines in this section."
            small
            striped
          >
            <template #cell(dueDate)="{ item }">
              {{ item.dueDate ? formatDate(item.dueDate) : 'No due date' }}
            </template>
            <template #cell(status)="{ item }">
              <b-badge :variant="statusVariant(item.status)">
                {{ statusLabel(item.status) }}
              </b-badge>
            </template>
            <template #cell(verification)="{ item }">
              <b-badge :variant="item.verificationStatus === 'verified' ? 'success' : 'warning'">
                {{ item.verificationStatus === 'verified' ? 'Verified' : 'Unverified' }}
              </b-badge>
              <div
                v-if="item.verificationStatus === 'verified' && item.verifiedAt"
                class="text-muted small"
              >
                {{ formatDateTime(item.verifiedAt) }}
              </div>
            </template>
          </b-table>
        </div>

        <div data-testid="deadline-section-completed">
          <b-button
            variant="outline-secondary"
            size="sm"
            @click="showCompleted = !showCompleted"
          >
            {{ showCompleted ? 'Hide' : 'Show' }} completed ({{ completedItems.length }})
          </b-button>
          <b-table
            v-if="showCompleted"
            class="mt-2"
            :items="completedItems"
            :fields="completedFields"
            primary-key="checklistItemId"
            show-empty
            empty-text="No completed deadlines."
            small
            striped
          >
            <template #cell(dueDate)="{ item }">
              {{ formatDate(item.dueDate) }}
            </template>
            <template #cell(completedAt)="{ item }">
              {{ item.completedAt ? formatDateTime(item.completedAt) : 'Not recorded' }}
            </template>
            <template #cell(status)="{ item }">
              <b-badge :variant="statusVariant(item.status)">
                {{ statusLabel(item.status) }}
              </b-badge>
            </template>
          </b-table>
        </div>
      </template>
    </b-card>
  </section>
</template>

<script>
import { mapActions, mapGetters } from 'vuex';
import { formatDate, formatDateTime } from '@/helpers/dates';

const STATUS_DISPLAY = {
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
  reviewNeeded: { label: 'Review Needed', variant: 'secondary' },
};

const PORTFOLIO_SECTIONS = [
  { key: 'overdue', title: 'Overdue' },
  { key: 'dueToday', title: 'Due Today' },
  { key: 'dueSoon', title: 'Due Soon' },
  { key: 'upcoming', title: 'Upcoming' },
];

export default {
  data() {
    return {
      loading: true,
      loadError: false,
      showCompleted: false,
      fields: [
        { key: 'title', label: 'Obligation' },
        { key: 'dueDate', label: 'Due date' },
        { key: 'status', label: 'Status' },
        { key: 'verification', label: 'Verification' },
      ],
      completedFields: [
        { key: 'title', label: 'Obligation' },
        { key: 'dueDate', label: 'Due date' },
        { key: 'completedAt', label: 'Completed' },
        { key: 'status', label: 'Status' },
      ],
    };
  },
  computed: {
    ...mapGetters({
      portfolio: 'deadlines/portfolio',
      reviewNeeded: 'deadlines/reviewNeeded',
      pagination: 'deadlines/pagination',
      selectedAgency: 'users/selectedAgency',
    }),
    sections() {
      return [
        ...PORTFOLIO_SECTIONS.map((section) => ({
          ...section,
          items: this.portfolio.filter((item) => item.status === section.key),
        })),
        {
          key: 'reviewNeeded',
          title: 'Review Needed',
          description: 'Unverified or undated deadlines. These are not counted as confirmed deadlines until someone verifies them.',
          items: this.reviewNeeded,
        },
      ];
    },
    completedItems() {
      return this.portfolio.filter((item) => item.status === 'completed' || item.status === 'completedLate');
    },
    isTruncated() {
      if (!this.pagination) {
        return false;
      }
      return this.pagination.portfolio.total > this.portfolio.length
        || this.pagination.reviewNeeded.total > this.reviewNeeded.length;
    },
  },
  watch: {
    selectedAgency() {
      this.loadDeadlines();
    },
  },
  mounted() {
    this.loadDeadlines();
  },
  methods: {
    ...mapActions({
      fetchDeadlines: 'deadlines/fetchDeadlines',
    }),
    async loadDeadlines() {
      this.loading = true;
      this.loadError = false;
      try {
        await this.fetchDeadlines();
      } catch (e) {
        this.loadError = true;
      } finally {
        this.loading = false;
      }
    },
    statusLabel(status) {
      return (STATUS_DISPLAY[status] || { label: status }).label;
    },
    statusVariant(status) {
      return (STATUS_DISPLAY[status] || { variant: 'secondary' }).variant;
    },
    formatDate,
    formatDateTime,
  },
};
</script>
