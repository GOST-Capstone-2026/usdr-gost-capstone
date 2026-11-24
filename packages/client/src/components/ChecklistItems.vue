<template>
  <section
    class="mt-4"
    aria-labelledby="checklist-items-heading"
  >
    <h2
      id="checklist-items-heading"
      class="h5"
    >
      Compliance checklist
    </h2>
    <p
      v-if="loading"
      role="status"
      data-testid="checklist-loading"
    >
      Loading the checklist…
    </p>
    <p
      v-else-if="loadError"
      role="alert"
      class="text-danger"
      data-testid="checklist-load-error"
    >
      {{ loadError }}
    </p>
    <p
      v-else-if="!items.length"
      class="text-muted"
      data-testid="checklist-empty"
    >
      No checklist items are saved for this document yet.
    </p>
    <ul
      v-else
      class="list-unstyled"
    >
      <li
        v-for="item in items"
        :id="`checklist-item-${item.id}`"
        :key="item.id"
        class="border rounded p-3 mb-3"
        :class="{ 'border-primary': item.id === focusItemId }"
        data-testid="checklist-item"
      >
        <p class="small text-muted mb-1">
          {{ categoryLabel(item.category) }}<span v-if="item.isUserEdited"> · Edited</span>
        </p>

        <template v-if="editingId === item.id">
          <div class="form-group">
            <label
              class="d-block"
              :for="`checklist-description-${item.id}`"
            >
              Description
              <textarea
                :id="`checklist-description-${item.id}`"
                v-model="draft.description"
                class="form-control"
                rows="2"
                data-testid="checklist-description-input"
              />
            </label>
          </div>
          <div class="form-group">
            <label
              class="d-block"
              :for="`checklist-due-date-${item.id}`"
            >
              Due date
              <input
                :id="`checklist-due-date-${item.id}`"
                v-model="draft.dueDate"
                type="date"
                class="form-control"
                data-testid="checklist-due-date-input"
              >
            </label>
          </div>
          <div class="form-group">
            <label
              class="d-block"
              :for="`checklist-notes-${item.id}`"
            >
              Your notes
              <textarea
                :id="`checklist-notes-${item.id}`"
                v-model="draft.userNotes"
                class="form-control"
                rows="2"
                data-testid="checklist-notes-input"
              />
            </label>
          </div>
          <p
            v-if="itemError(item.id)"
            role="alert"
            class="text-danger"
            data-testid="checklist-item-error"
          >
            {{ itemError(item.id) }}
          </p>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="savingId === item.id"
            data-testid="action-save"
            @click="saveEdit(item)"
          >
            {{ savingId === item.id ? 'Saving…' : 'Save' }}
          </button>
          <button
            type="button"
            class="btn btn-outline-secondary btn-sm ml-2"
            :disabled="savingId === item.id"
            data-testid="action-cancel"
            @click="cancelEdit"
          >
            Cancel
          </button>
        </template>
        <template v-else>
          <p data-testid="checklist-description">
            {{ item.description }}
          </p>
          <p
            v-if="item.dueDate"
            data-testid="checklist-due-date"
          >
            Due {{ formatDate(item.dueDate) }}
          </p>
          <p
            v-if="item.userNotes"
            class="font-italic"
            data-testid="checklist-notes"
          >
            Notes: {{ item.userNotes }}
          </p>
          <details
            v-if="item.sources && item.sources.length"
            :open="item.id === focusItemId"
          >
            <summary class="small">
              Source citations
            </summary>
            <blockquote
              v-for="(source, index) in item.sources"
              :key="index"
              class="mb-2 pl-3 border-left"
              data-testid="checklist-source"
            >
              <span class="font-weight-bold">Page {{ source.pageNumber }}</span>
              <p class="mb-0">
                {{ source.excerpt }}
              </p>
            </blockquote>
          </details>
          <p class="small">
            <span
              :class="verificationBadgeClass(item.verificationStatus)"
              data-testid="checklist-verification"
            >{{ verificationLabel(item.verificationStatus) }}</span>
            · <span data-testid="checklist-completion">{{ completionLabel(item.completionStatus) }}</span>
          </p>
          <p
            v-if="itemError(item.id)"
            role="alert"
            class="text-danger"
            data-testid="checklist-item-error"
          >
            {{ itemError(item.id) }}
          </p>

          <button
            type="button"
            class="btn btn-outline-primary btn-sm"
            :disabled="savingId === item.id"
            data-testid="action-edit"
            @click="startEdit(item)"
          >
            Edit
          </button>
          <label
            class="d-inline-block ml-2 mb-0"
            :for="`checklist-completion-${item.id}`"
          >
            <span class="sr-only">Completion status</span>
            <select
              :id="`checklist-completion-${item.id}`"
              class="form-control form-control-sm d-inline-block w-auto"
              :value="item.completionStatus"
              :disabled="savingId === item.id"
              data-testid="completion-select"
              @change="changeCompletion(item, $event.target.value)"
            >
              <option
                v-for="status in completionStatuses"
                :key="status"
                :value="status"
              >
                {{ completionLabel(status) }}
              </option>
            </select>
          </label>
          <template v-if="canVerify">
            <button
              v-if="item.verificationStatus !== 'verified'"
              type="button"
              class="btn btn-success btn-sm ml-2"
              :disabled="savingId === item.id"
              data-testid="action-verify"
              @click="verify(item)"
            >
              Verify
            </button>
            <button
              v-if="item.verificationStatus !== 'rejected'"
              type="button"
              class="btn btn-outline-danger btn-sm ml-2"
              :disabled="savingId === item.id"
              data-testid="action-reject"
              @click="reject(item)"
            >
              Reject
            </button>
          </template>
        </template>
      </li>
    </ul>
  </section>
</template>

<script>
import * as fetchApi from '@/helpers/fetchApi';
import { formatDate } from '@/helpers/dates';

const CATEGORY_LABELS = {
  eligibility: 'Eligibility',
  applicationMaterial: 'Application material',
  submission: 'Submission',
  costShare: 'Cost share',
  reporting: 'Reporting',
  recordRetention: 'Record retention',
  deadline: 'Deadline',
  other: 'Other',
};

const COMPLETION_LABELS = {
  notStarted: 'Not started',
  inProgress: 'In progress',
  completed: 'Completed',
  notApplicable: 'Not applicable',
};

const VERIFICATION_LABELS = {
  unverified: 'Unverified',
  verified: 'Verified',
  rejected: 'Rejected',
};

// Mirrors parseProfileError (complianceProfileForm.js) and documentAnalysisError
// (grantDocumentHandoff.js): the server's controlled error envelope is JSON inside a fetch
// error's message, not a parsed body, since fetchApi only reads the response as text on failure.
function checklistItemError(error) {
  let code = error?.code;
  if (!code) {
    try { code = JSON.parse(error.message)?.error?.code; } catch { /* do not display a raw server error */ }
  }
  return {
    NOT_FOUND: 'This checklist item is no longer available.',
    FORBIDDEN: 'Only administrators and staff can verify or reject a checklist item.',
    VALIDATION_ERROR: 'Check the values entered before saving.',
    VERSION_CONFLICT: 'Someone else changed this item. The latest version is now shown below; review it before trying again.',
    SOURCE_NOT_VERIFIABLE: 'The cited text could not be confirmed against the document, so this item cannot be verified.',
  }[code] || 'The request could not be completed. Check the connection and try again.';
}

export default {
  props: {
    organizationId: { type: [String, Number], required: true },
    documentId: { type: Number, required: true },
    // Passed in by the parent rather than read from Vuex here, the same way DeadlineDetails.vue
    // takes canVerify as a prop: this component stays agnostic about where the role check lives.
    canVerify: { type: Boolean, default: false },
    focusItemId: { type: Number, default: null },
  },
  data() {
    return {
      items: [],
      loading: false,
      loadError: '',
      sequence: 0,
      editingId: null,
      draft: { description: '', dueDate: '', userNotes: '' },
      savingId: null,
      itemErrors: {},
    };
  },
  computed: {
    completionStatuses() { return Object.keys(COMPLETION_LABELS); },
  },
  watch: {
    documentId: { immediate: true, handler: 'load' },
    loading: {
      flush: 'post',
      handler(isLoading) {
        if (!isLoading) this.scrollToFocusedItem();
      },
    },
  },
  methods: {
    base() { return `/api/organizations/${this.organizationId}/compliance`; },
    categoryLabel(category) { return CATEGORY_LABELS[category] || category; },
    completionLabel(status) { return COMPLETION_LABELS[status] || status; },
    verificationLabel(status) { return VERIFICATION_LABELS[status] || status; },
    verificationBadgeClass(status) {
      return {
        badge: true,
        'badge-success': status === 'verified',
        'badge-danger': status === 'rejected',
        'badge-secondary': status === 'unverified',
      };
    },
    formatDate,
    itemError(id) { return this.itemErrors[id] || ''; },
    setItemError(id, message) { this.itemErrors = { ...this.itemErrors, [id]: message }; },
    clearItemError(id) {
      if (!(id in this.itemErrors)) return;
      const rest = { ...this.itemErrors };
      delete rest[id];
      this.itemErrors = rest;
    },
    scrollToFocusedItem() {
      if (this.focusItemId === null) return;
      this.$el?.querySelector?.(`#checklist-item-${this.focusItemId}`)?.scrollIntoView?.({ block: 'center' });
    },
    // Called after any analysis run completes (AN-17 follow-up), including a retry on a document
    // that already had items: reloads so items a retry recovered actually show up, without first
    // requiring a manual page reload. Skipped while someone is mid-edit, so a reload never
    // clobbers an edit in progress.
    refreshAfterAnalysis() {
      if (!this.editingId) this.load();
    },
    async load() {
      if (!Number.isInteger(this.documentId)) { this.items = []; return; }
      this.sequence += 1;
      const { sequence } = this;
      this.loading = true;
      this.loadError = '';
      try {
        const response = await fetchApi.get(`${this.base()}/documents/${this.documentId}/checklist-items`);
        if (sequence !== this.sequence) return;
        this.items = response.data;
      } catch (error) {
        if (sequence !== this.sequence) return;
        this.items = [];
        this.loadError = checklistItemError(error);
      } finally {
        if (sequence === this.sequence) this.loading = false;
      }
    },
    startEdit(item) {
      this.editingId = item.id;
      this.clearItemError(item.id);
      this.draft = {
        description: item.description,
        dueDate: item.dueDate || '',
        userNotes: item.userNotes || '',
      };
    },
    cancelEdit() { this.editingId = null; },
    replaceItem(updated) {
      this.items = this.items.map((item) => (item.id === updated.id ? updated : item));
    },
    async patchItem(item, changes) {
      this.savingId = item.id;
      this.clearItemError(item.id);
      try {
        const response = await fetchApi.patch(`${this.base()}/checklist-items/${item.id}`, {
          expectedVersion: item.version,
          ...changes,
        });
        this.replaceItem(response.checklistItem);
        return response.checklistItem;
      } catch (error) {
        let code;
        try { code = JSON.parse(error.message)?.error?.code; } catch { /* fall through to the generic message */ }
        this.setItemError(item.id, checklistItemError(error));
        // A stale version means this item already moved on; refresh so the next attempt starts
        // from what is actually saved, instead of retrying against a version that can only fail.
        if (code === 'VERSION_CONFLICT') await this.load();
        return null;
      } finally {
        this.savingId = null;
      }
    },
    async saveEdit(item) {
      const changes = {};
      if (this.draft.description !== item.description) changes.description = this.draft.description;
      const draftDueDate = this.draft.dueDate || null;
      if (draftDueDate !== (item.dueDate || null)) changes.dueDate = draftDueDate;
      const draftNotes = this.draft.userNotes || null;
      if (draftNotes !== (item.userNotes || null)) changes.userNotes = draftNotes;
      if (Object.keys(changes).length === 0) { this.editingId = null; return; }
      const updated = await this.patchItem(item, changes);
      if (updated) this.editingId = null;
    },
    changeCompletion(item, completionStatus) {
      if (completionStatus === item.completionStatus) return;
      this.patchItem(item, { completionStatus });
    },
    verify(item) { this.patchItem(item, { verificationStatus: 'verified' }); },
    reject(item) { this.patchItem(item, { verificationStatus: 'rejected' }); },
  },
};
</script>
