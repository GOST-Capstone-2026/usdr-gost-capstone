<template>
  <dl class="deadline-details small mb-0">
    <dt>Source</dt>
    <dd data-testid="deadline-source">
      <template v-if="sources.length">
        <div
          v-for="(source, index) in sources"
          :key="index"
        >
          Page {{ source.pageNumber }}: "{{ source.excerpt }}"
        </div>
      </template>
      <span
        v-else
        class="text-muted"
      >Source not found</span>
    </dd>
    <dt>Verification</dt>
    <dd data-testid="deadline-verification">
      {{ verificationText }}
    </dd>
    <dt>Actions</dt>
    <dd
      class="mb-0"
      data-testid="deadline-actions"
    >
      <div
        v-if="!editingDate"
        class="deadline-actions"
      >
        <button
          v-if="canVerify && item.verificationStatus === 'unverified' && item.sources?.length && item.version"
          type="button"
          class="btn btn-sm btn-outline-primary"
          :disabled="saving"
          data-testid="action-verify"
          @click="verifyItem"
        >
          Verify against source
        </button>
        <button
          v-if="item.completionStatus !== 'completed'"
          type="button"
          class="btn btn-sm btn-outline-success"
          :disabled="saving"
          data-testid="action-complete"
          @click="setCompletion('completed')"
        >
          Mark complete
        </button>
        <button
          v-if="item.completionStatus !== 'notApplicable'"
          type="button"
          class="btn btn-sm btn-outline-secondary"
          :disabled="saving"
          data-testid="action-not-applicable"
          @click="setCompletion('notApplicable')"
        >
          Not applicable
        </button>
        <button
          v-if="isClosed"
          type="button"
          class="btn btn-sm btn-outline-primary"
          :disabled="saving"
          data-testid="action-reopen"
          @click="setCompletion('notStarted')"
        >
          Reopen
        </button>
        <button
          type="button"
          class="btn btn-sm btn-outline-primary"
          :disabled="saving"
          data-testid="action-change-date"
          @click="startDateEdit"
        >
          Change due date
        </button>
      </div>
      <div
        v-else
        data-testid="due-date-editor"
      >
        <label
          :for="dateInputId"
          class="d-block mb-1"
        >
          New due date
          <input
            :id="dateInputId"
            v-model="newDueDate"
            type="date"
            class="form-control form-control-sm"
            data-testid="due-date-input"
          >
        </label>
        <p class="text-muted mb-1">
          Changing the date marks this deadline unverified until someone confirms it again.
        </p>
        <div class="deadline-actions">
          <button
            type="button"
            class="btn btn-sm btn-primary"
            :disabled="saving || !canSaveDate"
            data-testid="due-date-save"
            @click="saveDueDate"
          >
            Save date
          </button>
          <button
            type="button"
            class="btn btn-sm btn-outline-secondary"
            :disabled="saving"
            data-testid="due-date-cancel"
            @click="cancelDateEdit"
          >
            Cancel
          </button>
        </div>
      </div>
      <p
        v-if="errorMessage"
        role="alert"
        class="text-danger mb-0 mt-1"
        data-testid="deadline-action-error"
      >
        {{ errorMessage }}
      </p>
    </dd>
  </dl>
</template>

<script>
import { mapActions } from 'vuex';
import { formatDate } from '@/helpers/dates';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const COMPLETION_MESSAGES = {
  completed: (title) => `Marked "${title}" complete.`,
  notApplicable: (title) => `Marked "${title}" not applicable.`,
  notStarted: (title) => `Reopened "${title}".`,
};

export default {
  props: {
    item: {
      type: Object,
      required: true,
    },
    canVerify: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      saving: false,
      editingDate: false,
      newDueDate: '',
      errorMessage: null,
    };
  },
  computed: {
    sources() {
      if (this.item.sources?.length) return this.item.sources;
      return this.item.source ? [this.item.source] : [];
    },
    verificationText() {
      if (this.item.verificationStatus !== 'verified') {
        return 'Not yet verified';
      }
      return this.item.verifiedAt ? `Verified on ${formatDate(this.item.verifiedAt)}` : 'Verified';
    },
    isClosed() {
      return this.item.completionStatus === 'completed' || this.item.completionStatus === 'notApplicable';
    },
    dateInputId() {
      return `deadline-due-date-${this.item.checklistItemId}`;
    },
    canSaveDate() {
      return ISO_DATE_PATTERN.test(this.newDueDate) && this.newDueDate !== this.item.dueDate;
    },
  },
  methods: {
    ...mapActions({
      updateDeadline: 'deadlines/updateDeadline',
    }),
    async save(changes, successMessage, verify = false) {
      this.saving = true;
      this.errorMessage = null;
      try {
        await this.updateDeadline({
          checklistItemId: this.item.checklistItemId, changes, successMessage, ...(verify && { verify }),
        });
        this.editingDate = false;
      } catch (error) {
        const messages = {
          404: 'This deadline is no longer available.',
          409: 'This item changed. Review the latest version before verifying.',
          422: 'The cited text could not be verified against the document.',
        };
        this.errorMessage = messages[error.response?.status] || 'The change could not be saved. Please try again.';
      } finally {
        this.saving = false;
      }
    },
    setCompletion(completionStatus) {
      return this.save({ completionStatus }, COMPLETION_MESSAGES[completionStatus](this.item.title));
    },
    verifyItem() {
      return this.save(
        { expectedVersion: this.item.version },
        `Verified "${this.item.title}" against its source.`,
        true,
      );
    },
    startDateEdit() {
      this.newDueDate = this.item.dueDate || '';
      this.errorMessage = null;
      this.editingDate = true;
    },
    cancelDateEdit() {
      this.editingDate = false;
      this.errorMessage = null;
    },
    saveDueDate() {
      return this.save(
        { dueDate: this.newDueDate },
        `Changed the due date of "${this.item.title}" to ${formatDate(this.newDueDate)}. It needs to be verified again.`,
      );
    },
  },
};
</script>

<style scoped>
.deadline-details dt {
  font-weight: 600;
}
.deadline-details dd {
  white-space: normal;
}
.deadline-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
</style>
