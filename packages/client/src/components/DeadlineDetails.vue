<template>
  <dl class="deadline-details small mb-0">
    <dt>Source</dt>
    <dd data-testid="deadline-source">
      <template v-if="item.source">
        Page {{ item.source.pageNumber }}: "{{ item.source.excerpt }}"
      </template>
      <span
        v-else
        class="text-muted"
      >Source not found</span>
    </dd>
    <dt>Verification</dt>
    <dd
      class="mb-0"
      data-testid="deadline-verification"
    >
      {{ verificationText }}
    </dd>
  </dl>
</template>

<script>
import { formatDate } from '@/helpers/dates';

export default {
  props: {
    item: {
      type: Object,
      required: true,
    },
  },
  computed: {
    verificationText() {
      if (this.item.verificationStatus !== 'verified') {
        return 'Not yet verified';
      }
      return this.item.verifiedAt ? `Verified on ${formatDate(this.item.verifiedAt)}` : 'Verified';
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
</style>
