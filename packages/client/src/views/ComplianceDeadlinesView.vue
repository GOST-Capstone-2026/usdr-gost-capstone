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
          class="btn-group btn-group-sm mb-3"
          role="group"
          aria-label="Deadline view"
        >
          <button
            type="button"
            class="btn"
            :class="viewMode === 'list' ? 'btn-primary' : 'btn-outline-primary'"
            :aria-pressed="viewMode === 'list'"
            data-testid="view-list"
            @click="viewMode = 'list'"
          >
            List
          </button>
          <button
            type="button"
            class="btn"
            :class="viewMode === 'calendar' ? 'btn-primary' : 'btn-outline-primary'"
            :aria-pressed="viewMode === 'calendar'"
            data-testid="view-calendar"
            @click="viewMode = 'calendar'"
          >
            Calendar
          </button>
        </div>

        <compliance-deadlines-calendar
          v-if="viewMode === 'calendar'"
          :portfolio="portfolio"
          :review-needed="reviewNeeded"
        />

        <template v-else>
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
              fixed
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
              {{ showCompleted ? 'Hide' : 'Show' }} closed ({{ completedItems.length }})
            </b-button>
            <span class="text-muted small ml-2">Completed or marked not applicable.</span>
            <b-table
              v-if="showCompleted"
              class="mt-2"
              :items="completedItems"
              :fields="completedFields"
              primary-key="checklistItemId"
              show-empty
              empty-text="No closed deadlines."
              small
              striped
              fixed
            >
              <template #cell(dueDate)="{ item }">
                {{ formatDate(item.dueDate) }}
              </template>
              <template #cell(completedAt)="{ item }">
                <span
                  v-if="item.completionStatus === 'notApplicable'"
                  class="text-muted"
                >N/A</span>
                <template v-else>
                  {{ item.completedAt ? formatDateTime(item.completedAt) : 'Not recorded' }}
                </template>
              </template>
              <template #cell(status)="{ item }">
                <b-badge :variant="statusVariant(item.status)">
                  {{ statusLabel(item.status) }}
                </b-badge>
              </template>
            </b-table>
          </div>
        </template>
      </template>
    </b-card>
  </section>
</template>

<script>
import { mapActions, mapGetters } from 'vuex';
import { formatDate, formatDateTime } from '@/helpers/dates';
import { CLOSED_STATUSES, statusLabel, statusVariant } from '@/helpers/deadlineStatus';
import ComplianceDeadlinesCalendar from '@/components/ComplianceDeadlinesCalendar.vue';

const PORTFOLIO_SECTIONS = [
  { key: 'overdue', title: 'Overdue' },
  { key: 'dueToday', title: 'Due Today' },
  { key: 'dueSoon', title: 'Due Soon' },
  { key: 'upcoming', title: 'Upcoming' },
];

export default {
  components: {
    ComplianceDeadlinesCalendar,
  },
  data() {
    return {
      loading: true,
      loadError: false,
      showCompleted: false,
      viewMode: 'list',
      fields: [
        { key: 'title', label: 'Obligation', thStyle: { width: '45%' } },
        { key: 'dueDate', label: 'Due date', thStyle: { width: '18%' } },
        { key: 'status', label: 'Status', thStyle: { width: '20%' } },
        { key: 'verification', label: 'Verification', thStyle: { width: '17%' } },
      ],
      completedFields: [
        { key: 'title', label: 'Obligation', thStyle: { width: '45%' } },
        { key: 'dueDate', label: 'Due date', thStyle: { width: '18%' } },
        { key: 'completedAt', label: 'Completed', thStyle: { width: '20%' } },
        { key: 'status', label: 'Status', thStyle: { width: '17%' } },
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
      return this.portfolio.filter((item) => CLOSED_STATUSES.includes(item.status));
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
    statusLabel,
    statusVariant,
    formatDate,
    formatDateTime,
  },
};
</script>
