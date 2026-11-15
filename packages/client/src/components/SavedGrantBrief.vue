<template>
  <section
    class="mt-4 border rounded p-3"
    aria-labelledby="saved-grant-brief-heading"
  >
    <h2
      id="saved-grant-brief-heading"
      class="h5"
    >
      Saved grant brief
    </h2>
    <p class="small text-muted">
      Analysis run {{ brief.runId }} · {{ brief.verificationStatus === 'verified' ? 'Verified' : 'Unverified' }}
    </p>
    <p v-if="brief.verificationStatus !== 'verified'">
      Review the notice before relying on these findings.
    </p>
    <details
      v-for="section in sections"
      :key="section.label"
      class="mb-2"
      :open="section.label === 'Key dates'"
    >
      <summary class="font-weight-bold">
        {{ section.label }}
      </summary>
      <ul v-if="section.items.length">
        <li
          v-for="(item, index) in section.items"
          :key="index"
          class="mb-2"
        >
          {{ item.text }}
          <details v-if="item.sources.length">
            <summary class="small">
              Source citations
            </summary>
            <blockquote
              v-for="(source, sourceIndex) in item.sources"
              :key="sourceIndex"
              class="mb-2 pl-3 border-left"
            >
              <span class="font-weight-bold">Page {{ source.pageNumber }}</span>
              <p class="mb-0">
                {{ source.excerpt }}
              </p>
            </blockquote>
          </details>
        </li>
      </ul>
      <p
        v-else
        class="text-muted mb-2"
      >
        No findings in the saved brief.
      </p>
    </details>
  </section>
</template>

<script>
import { formatCurrency } from '@/helpers/currency';
import { formatDate } from '@/helpers/dates';

function findings(entries, renderText = (entry) => entry.value) {
  return (Array.isArray(entries) ? entries : []).flatMap((entry) => {
    if (!entry?.found) return [];
    const text = renderText(entry);
    if (typeof text !== 'string' || !text.trim()) return [];
    const sources = Array.isArray(entry.sources) ? entry.sources.filter((source) => (
      Number.isInteger(source?.pageNumber) && source.pageNumber > 0 && typeof source.excerpt === 'string'
    )) : [];
    return [{ text, sources }];
  });
}

function fundingText({ minimumAmountCents, maximumAmountCents }) {
  const minimum = Number.isSafeInteger(minimumAmountCents) ? formatCurrency(minimumAmountCents / 100) : '';
  const maximum = Number.isSafeInteger(maximumAmountCents) ? formatCurrency(maximumAmountCents / 100) : '';
  if (minimum && maximum) return `${minimum} to ${maximum}`;
  if (minimum) return `At least ${minimum}`;
  return maximum ? `Up to ${maximum}` : '';
}

function dateText({ label, date }) {
  if (typeof label !== 'string' || typeof date !== 'string' || !date) return '';
  return `${label} · ${formatDate(date)}`;
}

export default {
  props: {
    brief: { type: Object, required: true },
  },
  computed: {
    sections() {
      const {
        purpose, eligibility, fundingRange, costShare, keyDates, keyRequirements,
      } = this.brief;
      return [
        { label: 'Key dates', items: findings(keyDates, dateText) },
        { label: 'Purpose', items: findings([purpose]) },
        { label: 'Eligibility', items: findings(eligibility) },
        { label: 'Funding', items: findings([fundingRange], fundingText) },
        { label: 'Cost share', items: findings([costShare], (entry) => entry.description) },
        { label: 'Key requirements', items: findings(keyRequirements) },
      ];
    },
  },
};
</script>
