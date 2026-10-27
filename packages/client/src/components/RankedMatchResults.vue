<template>
  <section
    class="match-results"
    :aria-labelledby="`${instanceId}-heading`"
    :aria-busy="state === 'loading'"
  >
    <h2 :id="`${instanceId}-heading`">
      Grant match results
    </h2>
    <p class="match-results__notice">
      Relevance is not eligibility, confidence, or funding probability. Close scores may
      change with wording. Review the full notice, project location, and all warnings.
    </p>
    <p
      v-if="state === 'idle'"
      role="status"
    >
      No match run loaded. Results will use a saved organization profile.
    </p>
    <p
      v-else-if="state === 'loading'"
      role="status"
    >
      Loading match results. Previous results are hidden while loading.
    </p>
    <div
      v-else-if="displayError"
      role="alert"
      class="alert alert-danger"
    >
      <p>{{ displayError }}</p>
      <button
        v-if="state === 'error' && retryable"
        type="button"
        class="btn btn-outline-primary"
        @click="$emit('retry')"
      >
        Retry loading results
      </button>
    </div>
    <div
      v-else-if="presentation"
      :key="runKey"
    >
      <dl class="match-results__summary">
        <div><dt>Candidates</dt><dd>{{ presentation.rows.length }}</dd></div>
        <div><dt>Ranked</dt><dd>{{ presentation.ranked }}</dd></div>
        <div><dt>Review required</dt><dd>{{ presentation.reviewRequired }}</dd></div>
        <div><dt>Blocked</dt><dd>{{ presentation.blocked }}</dd></div>
        <div><dt>Unranked, including blocked</dt><dd>{{ presentation.unranked }}</dd></div>
      </dl>
      <p>
        Organization {{ run.organizationId }} · Profile {{ run.profileId }}, version
        {{ run.profileVersion }} · Screening date {{ run.screenedOn }}
      </p>
      <p
        v-if="!presentation.rows.length"
        role="status"
      >
        This run contains no candidates. It does not establish that no suitable grants exist.
      </p>
      <article
        v-for="row in presentation.rows"
        :key="row.grantId"
        class="match-results__card"
        :data-grant-id="row.grantId"
        :aria-labelledby="`${instanceId}-grant-${row.grantId}`"
      >
        <header class="match-results__card-header">
          <div>
            <p class="match-results__eyebrow">
              {{ row.rank === null ? 'Unranked' : `Rank ${row.rank}` }} · Grant {{ row.grantId }}
            </p>
            <h3 :id="`${instanceId}-grant-${row.grantId}`">
              {{ row.displayTitle }}
              <small v-if="row.titleIsPartial">(partial title)</small>
            </h3>
          </div>
          <div class="match-results__score">
            <span>Semantic relevance</span>
            <strong>{{ row.displayScore }}</strong>
          </div>
        </header>
        <p :class="row.disposition === 'blocked' ? 'text-danger' : 'text-dark'">
          <strong>{{ row.displayDisposition }}</strong> · Explanation: unverified
        </p>
        <div v-if="row.blockers.length">
          <h4>Hard blockers</h4>
          <ul>
            <li
              v-for="(blocker, index) in row.blockers"
              :key="index"
            >
              <strong>{{ blocker.code }}:</strong> {{ blocker.message }}
            </li>
          </ul>
        </div>
        <div v-if="row.uncertainties.length">
          <h4>Review warnings</h4>
          <ul>
            <li
              v-for="(warning, index) in row.uncertainties"
              :key="index"
            >
              {{ warning }}
            </li>
          </ul>
        </div>
        <details class="match-results__details">
          <summary>Explanation and listing evidence for grant {{ row.grantId }}</summary>
          <p>{{ row.explanation }}</p>
          <p>
            Extractive source-linked explanation, not LLM-generated prose. Listing-field
            excerpts are not verified PDF/page citations or an explanation of individual model weights.
          </p>
          <h4>Claims and references</h4>
          <ol>
            <li
              v-for="(claim, index) in row.explanationDetails.claims"
              :key="index"
            >
              <p>{{ claim.text }}</p>
              <ul>
                <li
                  v-for="reference in claim.evidenceIds"
                  :key="reference"
                >
                  <a :href="`#${evidenceAnchor(row, reference)}`">Evidence: {{ reference }}</a>
                </li>
              </ul>
            </li>
          </ol>
          <h4>Evidence records</h4>
          <ol>
            <li
              v-for="evidence in row.explanationDetails.evidence"
              :id="evidenceAnchor(row, evidence.id)"
              :key="evidence.id"
              tabindex="-1"
            >
              <strong>{{ evidence.id }} · {{ evidence.kind }}</strong>
              <blockquote v-if="evidence.kind === 'listingText'">
                {{ evidence.excerpt }}
              </blockquote>
              <p v-if="evidence.kind === 'listingText'">
                Field: {{ evidence.field }} · Revision: {{ evidence.sourceRevision ?? 'Unavailable' }}
                · Normalized UTF-16 offsets: {{ evidence.startOffset }}–{{ evidence.endOffset }}
                (end exclusive) · {{ evidence.truncated ? 'Partial excerpt' : 'Complete field' }}
              </p>
              <details>
                <summary>Record metadata for {{ evidence.id }}</summary>
                <pre>{{ pretty(evidence) }}</pre>
              </details>
            </li>
          </ol>
          <h4>Limitations</h4>
          <ul>
            <li
              v-for="(limitation, index) in row.explanationDetails.limitations"
              :key="index"
            >
              {{ limitation }}
            </li>
          </ul>
          <details>
            <summary>Explanation provenance for grant {{ row.grantId }}</summary>
            <pre>{{ pretty(row.explanationDetails.provenance) }}</pre>
          </details>
        </details>
      </article>
      <details class="match-results__details">
        <summary>Run method and reproducibility metadata</summary>
        <dl>
          <dt>Ranking method</dt><dd>{{ run.methodVersion }}</dd>
          <dt>Embedding model</dt><dd>{{ run.model }}</dd>
          <dt>Explanation method</dt><dd>{{ run.explanationMethod }} · {{ run.explanationVersion }}</dd>
          <dt>Ranking input hash</dt><dd><code>{{ run.inputHash }}</code></dd>
          <dt>Explanation hash</dt><dd><code>{{ run.explanationHash }}</code></dd>
        </dl>
      </details>
    </div>
  </section>
</template>

<script>
import { presentMatchRun, matchDisplayError } from '@/helpers/rankedMatchResults';

let instanceCount = 0;

export default {
  name: 'RankedMatchResults',
  props: {
    state: { type: String, default: 'idle', validator: (value) => ['idle', 'loading', 'ready', 'error'].includes(value) },
    run: { type: Object, default: null },
    context: { type: Object, default: null },
    errorCode: { type: String, default: '' },
    retryable: { type: Boolean, default: false },
  },
  emits: ['retry'],
  data() {
    instanceCount += 1;
    return { instanceId: `match-results-${instanceCount}` };
  },
  computed: {
    checkedRun() {
      if (this.state !== 'ready') return {};
      try {
        return { presentation: presentMatchRun(this.run, this.context) };
      } catch (error) {
        return { error: matchDisplayError(error.code) };
      }
    },
    presentation() { return this.checkedRun.presentation; },
    displayError() {
      return this.state === 'error' ? matchDisplayError(this.errorCode) : this.checkedRun.error;
    },
    runKey() { return `${this.run.inputHash}-${this.run.explanationHash}`; },
  },
  methods: {
    pretty(value) { return JSON.stringify(value, null, 2); },
    evidenceAnchor(row, reference) {
      const index = row.explanationDetails.evidence.findIndex((item) => item.id === reference);
      return `${this.instanceId}-grant-${row.grantId}-evidence-${index}`;
    },
  },
};
</script>

<style scoped>
.match-results { max-width: 70rem; margin: 0 auto; padding: 1.5rem; color: #172f46; }
.match-results__notice { padding: 1rem; background: #edf3f8; border-left: 4px solid #355c7d; }
.match-results__summary { display: flex; flex-wrap: wrap; gap: 1.5rem; margin: 1.5rem 0; }
.match-results__summary dd { font-size: 1.4rem; margin: 0; }
.match-results__card { border: 1px solid #ccd7e0; border-radius: 0.4rem; padding: 1.25rem; margin: 1rem 0; }
.match-results__card-header { display: flex; flex-wrap: wrap; gap: 1rem; justify-content: space-between; }
.match-results__card-header h3 { font-size: 1.2rem; }
.match-results__eyebrow { font-size: 0.9rem; margin-bottom: 0.35rem; }
.match-results__score { display: flex; flex-direction: column; font-variant-numeric: tabular-nums; }
.match-results__score strong { font-size: 1.25rem; }
.match-results h4 { font-size: 1rem; margin-top: 1rem; }
.match-results__details { margin-top: 1rem; }
.match-results summary { cursor: pointer; font-weight: 600; padding: 0.5rem 0; }
.match-results blockquote { border-left: 3px solid #ccd7e0; padding: 0.5rem 1rem; margin: 0.75rem 0; }
.match-results pre { max-height: 22rem; overflow: auto; white-space: pre-wrap; background: #f4f6f8; padding: 0.75rem; }
.match-results pre, .match-results code, .match-results dd, .match-results h3, .match-results p, .match-results li { overflow-wrap: anywhere; }
.match-results a:focus-visible, .match-results summary:focus-visible, .match-results button:focus-visible { outline: 3px solid #1565c0; outline-offset: 3px; }
</style>
