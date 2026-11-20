<template>
  <section class="container deadlines-page">
    <header class="dl-header">
      <div class="dl-header__text">
        <h2 class="dl-title">
          Compliance Deadlines
        </h2>
        <p class="dl-summary">
          Sorted by when it is due and whether someone has checked it against the source
        </p>
      </div>
      <div
        v-if="ready"
        class="dl-range"
        role="group"
        aria-label="Deadline view"
        :style="{ '--index': viewMode === 'list' ? 0 : 1 }"
      >
        <span
          class="dl-range__thumb"
          aria-hidden="true"
        />
        <button
          type="button"
          class="dl-range__option"
          :aria-pressed="viewMode === 'list'"
          data-testid="view-list"
          @click="viewMode = 'list'"
        >
          List
        </button>
        <button
          type="button"
          class="dl-range__option"
          :aria-pressed="viewMode === 'calendar'"
          data-testid="view-calendar"
          @click="viewMode = 'calendar'"
        >
          Calendar
        </button>
      </div>
    </header>

    <div
      v-if="hasDocumentScope"
      class="dl-scope"
    >
      <span class="dl-label">One document</span>
      <span
        v-if="documentScope"
        class="dl-scope__ids"
      >
        Grant {{ documentScope.grantId }} · Document {{ documentScope.documentId }}
      </span>
      <span class="dl-scope__links">
        <router-link
          v-if="returnToDocument"
          :to="returnToDocument"
          class="dl-link"
        >
          Return to document analysis
        </router-link>
        <router-link
          :to="{ name: 'complianceDeadlines' }"
          class="dl-link"
        >
          View all deadlines
        </router-link>
      </span>
    </div>

    <p
      v-if="selectionError"
      class="dl-card dl-empty"
      role="alert"
    >
      {{ selectionError }}
    </p>
    <div
      v-else-if="loading"
      class="dl-card dl-empty"
    >
      <b-spinner label="Loading deadlines" />
    </div>

    <div
      v-else-if="loadError"
      class="dl-strip dl-strip--bad"
      role="alert"
    >
      <span>Deadlines could not be loaded. Please try again.</span>
      <button
        type="button"
        class="dl-btn dl-btn--sm"
        @click="loadDeadlines"
      >
        Retry
      </button>
    </div>

    <template v-else>
      <p
        v-if="documentScope && !portfolio.length && !reviewNeeded.length"
        class="dl-card dl-empty"
        role="status"
      >
        No checklist deadlines are available for this document.
      </p>
      <div
        v-if="isTruncated"
        class="dl-strip"
        role="status"
      >
        Not every deadline is shown. This organization has more deadlines than the dashboard can display at once.
      </div>

      <div
        class="dl-stats"
        role="group"
        aria-label="Deadline summary"
      >
        <div
          v-for="section in sections"
          :key="section.key"
          class="dl-card dl-stat"
          :class="{ 'dl-stat--bad': section.key === 'overdue' && section.items.length }"
          :data-testid="`summary-${section.key}`"
        >
          <span class="dl-label">{{ section.title }}</span>
          <span class="dl-figure">{{ section.items.length }}</span>
        </div>
      </div>

      <div
        v-if="viewMode === 'calendar'"
        class="dl-card"
      >
        <compliance-deadlines-calendar
          :portfolio="portfolio"
          :review-needed="reviewNeeded"
        />
      </div>

      <template v-else>
        <div
          v-for="card in cards"
          :key="card.key"
          class="dl-card dl-section"
          :class="{ 'dl-section--empty': !isTableShown(card) }"
          :data-testid="`deadline-section-${card.key}`"
        >
          <div class="dl-section__head">
            <div class="dl-section__heading">
              <h3 class="dl-label dl-section__title">
                {{ card.title }}
                <span class="dl-count">{{ card.items.length }}</span>
              </h3>
              <p
                v-if="card.description"
                class="dl-section__sub"
              >
                {{ card.description }}
              </p>
            </div>
            <button
              v-if="card.collapsible"
              type="button"
              class="dl-btn dl-btn--sm"
              :aria-expanded="showCompleted ? 'true' : 'false'"
              @click="showCompleted = !showCompleted"
            >
              {{ showCompleted ? 'Hide' : 'Show' }} closed ({{ card.items.length }})
            </button>
            <span
              v-else-if="!card.items.length"
              class="dl-section__sub"
            >
              No deadlines in this section.
            </span>
          </div>

          <p
            v-if="card.collapsible && showCompleted && !card.items.length"
            class="dl-empty"
          >
            No closed deadlines.
          </p>

          <div
            v-if="isTableShown(card)"
            class="dl-table-wrap"
            :class="{ 'dl-table-wrap--scroll': card.items.length > 5 }"
            :role="card.items.length > 5 ? 'region' : undefined"
            :tabindex="card.items.length > 5 ? 0 : undefined"
            :aria-label="card.items.length > 5 ? `${card.title} deadlines` : undefined"
          >
            <table class="dl-table">
              <thead>
                <tr>
                  <th
                    v-for="column in card.columns"
                    :key="column.key"
                    scope="col"
                    :class="`dl-col-${column.key}`"
                  >
                    {{ column.label }}
                  </th>
                  <th
                    scope="col"
                    class="dl-col-action"
                  >
                    <span class="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody
                v-for="item in card.items"
                :key="item.checklistItemId"
              >
                <tr
                  class="dl-row"
                  :class="{ 'is-open': isExpanded(item) }"
                  data-testid="deadline-row"
                >
                  <td
                    v-for="column in card.columns"
                    :key="column.key"
                    :class="`dl-col-${column.key}`"
                  >
                    <template v-if="column.key === 'title'">
                      <span
                        class="dl-obligation"
                        data-testid="deadline-title"
                      >{{ item.title }}</span>
                      <span class="dl-cell-sub">{{ sourceText(item) }}</span>
                      <span
                        class="dl-row-meta"
                        data-testid="deadline-row-meta"
                      >
                        <span class="dl-cell-sub dl-row-meta__date">{{ item.dueDate ? `Due ${formatDate(item.dueDate)}` : 'No due date' }}</span>
                        <span
                          v-if="hasColumn(card, 'status')"
                          class="dl-chip"
                          :class="chipClass(item.status)"
                        >{{ statusLabel(item.status) }}</span>
                        <span
                          v-if="hasColumn(card, 'verification')"
                          class="dl-chip"
                          :class="verificationChipClass(item)"
                        >{{ verificationLabel(item) }}</span>
                        <span
                          v-if="hasColumn(card, 'completedAt') && item.completionStatus !== 'notApplicable'"
                          class="dl-cell-sub"
                        >{{ item.completedAt ? `Completed ${formatDateTime(item.completedAt)}` : 'Completion time not recorded' }}</span>
                      </span>
                    </template>
                    <template v-else-if="column.key === 'dueDate'">
                      <span
                        v-if="item.dueDate"
                        class="dl-date"
                      >{{ formatDate(item.dueDate) }}</span>
                      <span
                        v-else
                        class="dl-cell-sub"
                      >No due date</span>
                    </template>
                    <template v-else-if="column.key === 'status'">
                      <span
                        class="dl-chip"
                        :class="chipClass(item.status)"
                      >{{ statusLabel(item.status) }}</span>
                    </template>
                    <template v-else-if="column.key === 'verification'">
                      <span
                        class="dl-chip"
                        :class="verificationChipClass(item)"
                      >
                        {{ verificationLabel(item) }}
                      </span>
                      <span
                        v-if="item.verificationStatus === 'verified' && item.verifiedAt"
                        class="dl-cell-sub"
                      >{{ formatDate(item.verifiedAt) }}</span>
                    </template>
                    <template v-else-if="column.key === 'completedAt'">
                      <span
                        v-if="item.completionStatus === 'notApplicable'"
                        class="dl-cell-sub"
                      >N/A</span>
                      <span
                        v-else
                        class="dl-date"
                      >{{ item.completedAt ? formatDateTime(item.completedAt) : 'Not recorded' }}</span>
                    </template>
                  </td>
                  <td class="dl-col-action">
                    <button
                      type="button"
                      class="dl-toggle"
                      :class="{ 'is-open': isExpanded(item) }"
                      :aria-expanded="isExpanded(item) ? 'true' : 'false'"
                      data-testid="toggle-details"
                      @click="toggleDetails(item)"
                    >
                      {{ isExpanded(item) ? 'Hide details' : 'Details' }}
                    </button>
                  </td>
                </tr>
                <tr
                  v-if="isExpanded(item)"
                  class="dl-details-row"
                >
                  <td :colspan="card.columns.length + 1">
                    <deadline-details
                      :item="item"
                      :can-verify="!card.collapsible && canVerify"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
    </template>
  </section>
</template>

<script>
import { mapActions, mapGetters } from 'vuex';
import { formatDate, formatDateTime } from '@/helpers/dates';
import { CLOSED_STATUSES, statusLabel } from '@/helpers/deadlineStatus';
import ComplianceDeadlinesCalendar from '@/components/ComplianceDeadlinesCalendar.vue';
import DeadlineDetails from '@/components/DeadlineDetails.vue';
import { organizationId } from '@/helpers/matchRunApi';
import { documentContext, grantDocumentLocation, recordId } from '@/helpers/grantDocumentHandoff';

const PORTFOLIO_SECTIONS = [
  { key: 'overdue', title: 'Overdue' },
  { key: 'dueToday', title: 'Due Today' },
  { key: 'dueSoon', title: 'Due Soon' },
  { key: 'upcoming', title: 'Upcoming' },
];

const COLUMN = {
  title: { key: 'title', label: 'Obligation' },
  dueDate: { key: 'dueDate', label: 'Due date' },
  status: { key: 'status', label: 'Status' },
  verification: { key: 'verification', label: 'Verification' },
  completedAt: { key: 'completedAt', label: 'Completed' },
};

const PORTFOLIO_COLUMNS = [COLUMN.title, COLUMN.dueDate, COLUMN.verification];
const REVIEW_COLUMNS = [COLUMN.title, COLUMN.dueDate, COLUMN.status, COLUMN.verification];
const CLOSED_COLUMNS = [COLUMN.title, COLUMN.dueDate, COLUMN.completedAt, COLUMN.status];

const CHIP_BY_STATUS = {
  overdue: 'dl-chip--overdue',
  dueToday: 'dl-chip--today',
  dueSoon: 'dl-chip--soon',
  upcoming: 'dl-chip--upcoming',
  completed: 'dl-chip--done',
  completedLate: 'dl-chip--done',
  notApplicable: 'dl-chip--muted',
  reviewNeeded: 'dl-chip--review',
};

export default {
  components: {
    ComplianceDeadlinesCalendar,
    DeadlineDetails,
  },
  data() {
    return {
      loading: true,
      loadError: false,
      requestId: 0,
      showCompleted: false,
      viewMode: 'list',
      expandedIds: [],
    };
  },
  computed: {
    ...mapGetters({
      portfolio: 'deadlines/portfolio',
      reviewNeeded: 'deadlines/reviewNeeded',
      pagination: 'deadlines/pagination',
      selectedAgencyId: 'users/selectedAgencyId',
      userRole: 'users/userRole',
    }),
    canVerify() { return ['admin', 'staff'].includes(this.userRole); },
    query() { return this.$route?.query ?? {}; },
    hasDocumentScope() { return this.query.documentId !== undefined; },
    documentScope() {
      const context = documentContext({ query: this.query }, this.selectedAgencyId);
      const documentId = recordId(this.query.documentId);
      return context && documentId !== null ? { grantId: context.grantId, documentId } : null;
    },
    selectionError() {
      if (organizationId(this.selectedAgencyId) === null) return 'Select a team to view its deadlines.';
      if (this.hasDocumentScope && !this.documentScope) return 'Open the document for the selected team to view its deadlines.';
      return '';
    },
    ready() {
      return !this.selectionError && !this.loading && !this.loadError;
    },
    requestKey() {
      return JSON.stringify([this.selectedAgencyId, this.hasDocumentScope, this.documentScope]);
    },
    returnToDocument() {
      if (!this.documentScope) return null;
      const location = grantDocumentLocation(this.documentScope.grantId, this.selectedAgencyId, this.query.matchRunId);
      location.query.documentId = String(this.documentScope.documentId);
      return location;
    },
    sections() {
      return [
        ...PORTFOLIO_SECTIONS.map((section) => ({
          ...section,
          columns: PORTFOLIO_COLUMNS,
          items: this.portfolio.filter((item) => item.status === section.key),
        })),
        {
          key: 'reviewNeeded',
          title: 'Review Needed',
          description: 'Unverified or undated deadlines.',
          columns: REVIEW_COLUMNS,
          items: this.reviewNeeded,
        },
      ];
    },
    cards() {
      return [
        ...this.sections,
        {
          key: 'completed',
          title: 'Closed',
          description: 'Completed or marked not applicable.',
          columns: CLOSED_COLUMNS,
          items: this.completedItems,
          collapsible: true,
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
    requestKey() {
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
      this.requestId += 1;
      const { requestId } = this;
      this.expandedIds = [];
      this.loading = !this.selectionError;
      this.loadError = false;
      if (this.selectionError) return;
      try {
        await this.fetchDeadlines(this.documentScope);
      } catch (e) {
        if (this.requestId === requestId) this.loadError = true;
      } finally {
        if (this.requestId === requestId) this.loading = false;
      }
    },
    isTableShown(card) {
      return card.items.length > 0 && (!card.collapsible || this.showCompleted);
    },
    isExpanded(item) {
      return this.expandedIds.includes(item.checklistItemId);
    },
    toggleDetails(item) {
      this.expandedIds = this.isExpanded(item)
        ? this.expandedIds.filter((id) => id !== item.checklistItemId)
        : [...this.expandedIds, item.checklistItemId];
    },
    sourceText(item) {
      const page = item.sources?.[0]?.pageNumber ?? item.source?.pageNumber;
      return page ? `Source · page ${page}` : 'No source found';
    },
    chipClass(status) {
      return CHIP_BY_STATUS[status.replace(/Unverified$/, '')] || 'dl-chip--muted';
    },
    hasColumn(card, key) {
      return card.columns.some((column) => column.key === key);
    },
    verificationLabel(item) {
      return item.verificationStatus === 'verified' ? 'Verified' : 'Unverified';
    },
    verificationChipClass(item) {
      return item.verificationStatus === 'verified' ? 'dl-chip--done' : 'dl-chip--review';
    },
    statusLabel,
    formatDate,
    formatDateTime,
  },
};
</script>

<style lang="scss" scoped>
@import '@/scss/colors-semantic-tokens.scss';

.deadlines-page {
  --brand: #{$brand-primary};
  --brand-deep: #{$brand-active};
  --link: #{$brand-primary};
  --blue-400: #{$raw-blue-400};
  --blue-300: #{$raw-blue-300};
  --blue-200: #{$raw-blue-200};
  --blue-100: #{$raw-blue-100};
  --blue-50: #{$interactive-active};
  --canvas-deep: #{$raw-gray-100};
  --surface: #{$surface-background};
  --text: #{$text-primary};
  --text-muted: #{$text-secondary};
  --text-faint: #{$text-placeholder};
  --border: #{$raw-gray-200};
  --border-strong: #{$border};
  --bad: #{$negative-default};
  --bad-tint: #{$negative-accent};
  --on-brand: #{$brand-content};
  --text-xs: 0.6875rem;
  --text-sm: 0.8125rem;
  --radius-pill: 999px;
  --focus-ring: 0 0 0 3px #{rgba($brand-primary, 0.35)};
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --dur-fast: 150ms;
  --dur-base: 220ms;

  margin-top: 1rem;
  margin-bottom: 2rem;
  padding-top: 0.5rem;
  color: var(--text);
}

.deadlines-page :focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.dl-label {
  margin: 0;
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.dl-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.dl-header__text {
  min-width: 0;
}
.dl-title {
  margin: 0 0 0.25rem;
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--text);
}
.dl-summary {
  margin: 0;
  color: var(--text-muted);
}

.dl-range {
  position: relative;
  display: inline-grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  padding: 0.1875rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface);
}
.dl-range__thumb {
  position: absolute;
  top: 0.1875rem;
  bottom: 0.1875rem;
  left: 0.1875rem;
  width: calc((100% - 0.375rem) / 2);
  border-radius: var(--radius-pill);
  background: var(--brand);
  transform: translateX(calc(100% * var(--index)));
}
.dl-range__option {
  position: relative;
  z-index: 1;
  min-width: 5.5rem;
  height: 1.875rem;
  padding: 0 0.75rem;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  font-size: var(--text-xs);
  font-weight: 700;
  color: var(--text-muted);
  cursor: pointer;
}
.dl-range__option[aria-pressed="true"] {
  color: var(--on-brand);
}

.dl-scope {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1rem;
  margin-bottom: 1rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border);
  background: var(--surface);
  font-size: var(--text-sm);
}
.dl-scope__ids {
  color: var(--text);
  font-weight: 700;
}
.dl-scope__links {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-left: auto;
}
.dl-link {
  color: var(--link);
  text-decoration: underline;
}

.dl-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 1rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--blue-200);
  background: var(--blue-50);
  color: var(--text);
  font-size: var(--text-sm);
}
.dl-strip--bad {
  border-color: var(--bad);
  background: var(--bad-tint);
  color: var(--bad);
}

.dl-card {
  border: 1px solid var(--border);
  background: var(--surface);
  padding: 1.25rem 1.5rem;
}
.dl-empty {
  margin: 0;
  padding: 1.5rem 1rem;
  text-align: center;
  color: var(--text-muted);
}
.dl-card.dl-empty {
  margin-bottom: 1rem;
}

.dl-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 2.5rem;
  padding: 0 1.5rem;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--brand);
  font-size: var(--text-sm);
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
}
.dl-btn--sm {
  height: 2rem;
  padding: 0 1rem;
  font-size: var(--text-xs);
}

.dl-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}
.dl-stat {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
  min-width: 0;
  padding: 1rem;
}
.dl-figure {
  font-size: 1.75rem;
  font-weight: 700;
  line-height: 1.05;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}
.dl-stat--bad .dl-figure {
  color: var(--bad);
}

.dl-section {
  margin-bottom: 0.75rem;
}
.dl-section--empty {
  padding-top: 0.875rem;
  padding-bottom: 0.875rem;
}
.dl-section__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1rem;
}
.dl-section:not(.dl-section--empty) .dl-section__head {
  margin-bottom: 0.75rem;
}
.dl-section__heading {
  min-width: 0;
}
.dl-section__title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.dl-count {
  font-variant-numeric: tabular-nums;
  color: var(--text-faint);
}
.dl-section__sub {
  margin: 0.25rem 0 0;
  font-size: var(--text-sm);
  color: var(--text-muted);
}
.dl-section__head > .dl-section__sub {
  margin: 0;
}

.dl-table-wrap {
  overflow-x: auto;
}
.dl-table-wrap--scroll {
  max-height: 21rem;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.dl-table-wrap--scroll .dl-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  border-bottom: 0;
  background: var(--surface);
  box-shadow: inset 0 -1px 0 var(--border);
}
.dl-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: var(--text-sm);
}
.dl-table th {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border);
  text-align: left;
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.dl-table td {
  padding: 0.65rem 0.75rem;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
  overflow-wrap: anywhere;
}
.dl-table tbody:last-child tr:last-child td {
  border-bottom: 0;
}
.dl-col-dueDate { width: 9rem; }
.dl-col-status { width: 12rem; }
.dl-col-verification { width: 9rem; }
.dl-col-completedAt { width: 11rem; }
.dl-col-action {
  width: 7.5rem;
  text-align: right;
}

.dl-row.is-open {
  background: var(--blue-50);
}
.dl-row.is-open td {
  border-bottom-color: transparent;
}
.dl-obligation {
  display: block;
  font-weight: 700;
  color: var(--text);
}
.dl-cell-sub {
  display: block;
  font-size: var(--text-xs);
  color: var(--text-muted);
}
.dl-date {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.dl-row-meta {
  display: none;
}

.dl-toggle {
  padding: 0;
  border: 0;
  background: none;
  color: var(--link);
  font-size: var(--text-xs);
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
}
.dl-toggle::after {
  content: "";
  display: inline-block;
  width: 0.35rem;
  height: 0.35rem;
  margin-left: 0.4rem;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: translateY(-0.15rem) rotate(45deg);
  transition: transform var(--dur-base) var(--ease-spring);
}
.dl-toggle.is-open::after {
  transform: translateY(0.05rem) rotate(-135deg);
}

.dl-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  height: 1.5rem;
  padding: 0 0.625rem;
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  font-size: var(--text-xs);
  font-weight: 700;
  white-space: nowrap;
}
.dl-chip--overdue {
  background: var(--bad-tint);
  color: var(--bad);
}
.dl-chip--today {
  background: $raw-yellow-200;
  color: $raw-yellow-800;
}
.dl-chip--soon {
  background: $raw-yellow-50;
  color: $raw-yellow-700;
}
.dl-chip--upcoming {
  background: $raw-blue-100;
  color: $raw-blue-800;
}
.dl-chip--done {
  background: $raw-green-100;
  color: $raw-green-700;
}
.dl-chip--review {
  background: $raw-gray-200;
  color: $raw-gray-700;
}
.dl-chip--muted {
  background: $raw-gray-100;
  color: $raw-gray-600;
}

.dl-details-row td {
  padding: 0 0.75rem 0.75rem;
  background: var(--blue-50);
}
.dl-details-row :deep(.deadline-details) {
  display: grid;
  grid-template-columns: 8rem minmax(0, 1fr);
  gap: 0.6rem 1rem;
  padding: 1rem;
  border: 1px solid var(--border);
  background: var(--surface);
  font-size: var(--text-sm);
}
.dl-details-row :deep(.deadline-details dt) {
  padding-top: 0.15rem;
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.dl-details-row :deep(.deadline-details dd) {
  margin: 0;
}
.dl-details-row :deep(.deadline-details .btn) {
  height: 2rem;
  padding: 0 1rem;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--brand);
  font-size: var(--text-xs);
  font-weight: 700;
}
.dl-details-row :deep(.deadline-details .btn:hover:not(:disabled)) {
  border-color: var(--border-strong);
  background: var(--surface);
  color: var(--brand);
}
.dl-details-row :deep(.deadline-details .btn-primary) {
  border-color: var(--brand);
  background: var(--brand);
  color: var(--on-brand);
}
.dl-details-row :deep(.deadline-details .btn-primary:hover:not(:disabled)) {
  border-color: var(--brand);
  background: var(--brand);
  color: var(--on-brand);
}
.dl-details-row :deep(.deadline-details .form-control) {
  max-width: 14rem;
  border-color: var(--border-strong);
}

@media (prefers-reduced-motion: reduce) {
  .deadlines-page *,
  .deadlines-page *::before,
  .deadlines-page *::after {
    animation-duration: 1ms !important;
    transition-duration: 1ms !important;
  }
}

@media (max-width: 767px) {
  .dl-card {
    padding: 1rem;
  }
  .dl-table .dl-col-dueDate,
  .dl-table .dl-col-verification,
  .dl-table .dl-col-status,
  .dl-table .dl-col-completedAt {
    width: 0;
    padding: 0;
    overflow: hidden;
    visibility: hidden;
    font-size: 0;
    line-height: 0;
  }
  .dl-table .dl-col-dueDate > *,
  .dl-table .dl-col-verification > *,
  .dl-table .dl-col-status > *,
  .dl-table .dl-col-completedAt > * {
    display: none;
  }
  .dl-row-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
    margin-top: 0.4rem;
  }
  .dl-row-meta__date {
    flex-basis: 100%;
  }
  .dl-col-action { width: 6.5rem; }
  .dl-details-row :deep(.deadline-details) {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
