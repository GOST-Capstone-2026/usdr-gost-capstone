<template>
  <main class="container py-4">
    <h1 class="h3">
      Find grant matches
    </h1>
    <p>Match stored opportunities to your saved organization profile. Every explanation still requires human review.</p>
    <p
      v-if="!canUseMatching"
      role="alert"
    >
      Grant matching is not available for this account or configuration.
    </p>
    <p
      v-else-if="selectedOrganizationId === null"
      role="alert"
    >
      Select a team before matching.
    </p>
    <p
      v-else-if="profileLoading"
      role="status"
    >
      Loading the selected team's saved profile…
    </p>
    <template v-else>
      <div
        v-if="profileError"
        role="alert"
        class="alert alert-warning"
      >
        <p>{{ profileMissing ? 'No saved organization profile was found. Create one before matching.' : errorMessage(profileError) }}</p>
        <button
          type="button"
          class="btn btn-outline-primary"
          @click="loadSelection"
        >
          Reload profile
        </button>
      </div>
      <template v-if="profile">
        <p>Team {{ selectedOrganizationId }} · Profile {{ profile.id }}, version {{ profile.version }}</p>
        <p>Saved focus areas: {{ profile.focusAreas.join('; ') || 'None — add a focus area before matching.' }}</p>
        <p v-if="$router.hasRoute('complianceProfile')">
          <router-link :to="{ name: 'complianceProfile' }">
            Edit organization profile
          </router-link>
        </p>
        <form
          class="mb-4"
          @submit.prevent="startMatch"
        >
          <label
            class="d-block mb-3"
            for="grant-match-limit"
          >
            Candidate limit (1–50)
            <input
              id="grant-match-limit"
              v-model.number="limit"
              class="form-control"
              type="number"
              min="1"
              max="50"
              step="1"
              required
              :disabled="pending"
            >
          </label>
          <label
            class="d-block mb-3"
            for="grant-match-candidates"
          >
            Optional stored grant IDs, separated by commas or spaces
            <textarea
              id="grant-match-candidates"
              v-model="candidateText"
              class="form-control"
              rows="2"
              maxlength="1200"
              :disabled="pending"
            />
          </label>
          <p class="text-muted">
            Without IDs, this uses a bounded sample of stored posted/forecasted opportunities in grant-ID order.
            It is not an exhaustive search or a ranking of every available grant. Explicit IDs can include blocked controls.
          </p>
          <button
            class="btn btn-primary"
            type="submit"
            :disabled="pending || !profile.focusAreas.length"
          >
            {{ pending ? 'Matching and saving…' : 'Match and save results' }}
          </button>
          <button
            class="btn btn-link"
            type="button"
            :disabled="pending"
            @click="loadSelection"
          >
            Reload profile and saved run
          </button>
        </form>
        <p
          v-if="savedRun"
          role="status"
        >
          Saved run {{ savedRun.id }} · {{ savedRun.status === 'reviewRequired' ? 'Human review required' : 'Processing completed' }}.
          This page's URL can reopen this run while its profile version remains current.
        </p>
        <p v-if="savedRun && savedRun.result.candidateSelection">
          Candidate pool: {{ savedRun.result.candidateSelection.selectedCount }} selected from
          {{ savedRun.result.candidateSelection.totalAvailable }} stored candidates;
          limit {{ savedRun.result.candidateSelection.limit }}.
          {{ savedRun.result.candidateSelection.limited ? 'The pool was limited; other stored opportunities were not ranked.' : '' }}
        </p>
        <RankedMatchResults
          :state="resultState"
          :run="savedRun ? savedRun.result : null"
          :context="context"
          :error-code="resultError.code || ''"
          :retryable="resultError.retryable === true"
          @retry="loadSelection"
        />
      </template>
    </template>
  </main>
</template>

<script>
import { mapGetters } from 'vuex';
import RankedMatchResults from '@/components/RankedMatchResults.vue';
import { grantMatchingEnabled } from '@/helpers/featureFlags';
import { matchDisplayError } from '@/helpers/rankedMatchResults';
import {
  organizationId, loadMatchProfile, loadSavedMatch, startSavedMatch, matchApiError,
} from '@/helpers/matchRunApi';

export default {
  name: 'GrantMatchesView',
  components: { RankedMatchResults },
  data() {
    return {
      profile: null,
      profileLoading: false,
      profileError: '',
      profileMissing: false,
      resultState: 'idle',
      resultError: {},
      savedRun: null,
      pending: false,
      limit: 25,
      candidateText: '',
      sequence: 0,
    };
  },
  computed: {
    ...mapGetters({ selectedAgencyId: 'users/selectedAgencyId', userRole: 'users/userRole' }),
    selectedOrganizationId() { return organizationId(this.selectedAgencyId); },
    canUseMatching() { return grantMatchingEnabled() && ['admin', 'staff'].includes(this.userRole); },
    context() {
      return this.profile ? { organizationId: this.selectedOrganizationId, profileId: this.profile.id, profileVersion: this.profile.version } : null;
    },
  },
  watch: {
    selectedOrganizationId: { immediate: true, handler: 'loadSelection' },
    canUseMatching: 'loadSelection',
    '$route.query.runId': function (value) {
      if (String(this.savedRun?.id) !== String(value)) this.loadSelection();
    },
  },
  beforeUnmount() { this.sequence += 1; },
  methods: {
    errorMessage: matchDisplayError,
    async loadSelection() {
      this.sequence += 1;
      const { sequence } = this;
      const agencyId = this.selectedOrganizationId;
      this.profile = null;
      this.savedRun = null;
      this.pending = false;
      this.profileError = '';
      this.profileMissing = false;
      this.resultError = {};
      this.resultState = 'idle';
      this.profileLoading = this.canUseMatching && agencyId !== null;
      if (!this.profileLoading) return;
      let loadingProfile = true;
      try {
        const profile = await loadMatchProfile(agencyId);
        if (sequence !== this.sequence) return;
        this.profile = profile;
        this.profileLoading = false;
        loadingProfile = false;
        const { runId } = this.$route.query;
        if (runId !== undefined) {
          this.resultState = 'loading';
          const run = await loadSavedMatch(agencyId, profile, runId);
          if (sequence !== this.sequence) return;
          this.savedRun = run;
          this.resultState = 'ready';
        }
      } catch (error) {
        if (sequence !== this.sequence) return;
        const failure = matchApiError(error);
        if (loadingProfile) {
          this.profileError = failure.code;
          this.profileMissing = failure.code === 'NOT_FOUND';
        } else {
          this.resultError = failure;
          this.resultState = 'error';
        }
      } finally {
        if (sequence === this.sequence) this.profileLoading = false;
      }
    },
    async startMatch() {
      if (!this.canUseMatching || !this.profile || this.pending || !this.profile.focusAreas.length) return;
      this.sequence += 1;
      const { sequence } = this;
      this.pending = true;
      this.savedRun = null;
      this.resultState = 'loading';
      this.resultError = {};
      try {
        const run = await startSavedMatch(this.selectedOrganizationId, this.profile, { limit: this.limit, candidateText: this.candidateText });
        if (sequence !== this.sequence) return;
        this.savedRun = run;
        this.resultState = 'ready';
        await this.$router.replace({ name: 'grantMatches', query: { runId: String(run.id) } });
      } catch (error) {
        if (sequence !== this.sequence) return;
        this.savedRun = null;
        this.resultError = matchApiError(error);
        this.resultState = 'error';
      } finally {
        if (sequence === this.sequence) this.pending = false;
      }
    },
  },
};
</script>
