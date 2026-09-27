<template>
  <!-- Native labels below use matching for/id pairs; the legacy rule requires nested controls. -->
  <!-- eslint-disable vuejs-accessibility/label-has-for -->
  <main class="container py-4">
    <div class="mb-4">
      <h2 class="h3 mb-2">
        Organization Profile
      </h2>
      <p class="text-muted mb-0">
        Describe your organization so future grant matching can use accurate information.
        This is separate from your personal profile.
      </p>
    </div>

    <p
      v-if="!selectedAgencyId"
      role="alert"
    >
      Select a team before editing its organization profile.
    </p>
    <p
      v-else-if="loading"
      role="status"
    >
      Loading profile…
    </p>
    <template v-else>
      <p class="mb-3">
        Team: <strong>{{ selectedTeam ? selectedTeam.name : selectedAgencyId }}</strong>
      </p>
      <div
        v-if="loadError"
        class="alert alert-danger"
        role="alert"
      >
        {{ loadError }}
        <button
          class="btn btn-link p-0 ml-2"
          type="button"
          @click="loadProfile"
        >
          Try again
        </button>
      </div>
      <form
        v-else
        novalidate
        @submit.prevent="saveProfile"
      >
        <p
          v-if="profileVersion === 0"
          class="alert alert-info"
        >
          No profile exists for this team yet. Complete the fields below to create one.
        </p>
        <div
          v-if="saveError"
          class="alert alert-danger"
          role="alert"
        >
          {{ saveError }}
          <ul
            v-if="validationErrors.length"
            class="mb-0 mt-2"
          >
            <li
              v-for="issue in validationErrors"
              :key="issue"
            >
              {{ issue }}
            </li>
          </ul>
          <button
            v-if="versionConflict"
            class="btn btn-link p-0 mt-2"
            type="button"
            @click="loadProfile"
          >
            Reload latest profile
          </button>
        </div>
        <p
          v-if="saved"
          class="alert alert-success"
          role="status"
        >
          Organization profile saved.
        </p>

        <section
          class="mb-4"
          aria-labelledby="jurisdiction-heading"
        >
          <h3
            id="jurisdiction-heading"
            class="h5"
          >
            Jurisdiction
          </h3>
          <div class="form-row">
            <div class="form-group col-md-4">
              <label for="jurisdiction-type">Type</label>
              <select
                id="jurisdiction-type"
                v-model="form.jurisdictionType"
                class="form-control"
              >
                <option value="city">
                  City
                </option>
                <option value="county">
                  County
                </option>
                <option value="town">
                  Town
                </option>
                <option value="village">
                  Village
                </option>
                <option value="tribalGovernment">
                  Tribal government
                </option>
                <option value="specialDistrict">
                  Special district
                </option>
                <option value="other">
                  Other
                </option>
              </select>
            </div>
            <div class="form-group col-md-8">
              <label for="jurisdiction-name">Name</label>
              <input
                id="jurisdiction-name"
                v-model="form.jurisdictionName"
                class="form-control"
                type="text"
                maxlength="200"
                required
              >
            </div>
          </div>
          <div class="form-row">
            <div class="form-group col-md-3">
              <label for="state-code">State code</label>
              <input
                id="state-code"
                v-model="form.stateCode"
                class="form-control"
                type="text"
                maxlength="2"
                placeholder="FL"
                required
              >
            </div>
            <div class="form-group col-md-6">
              <label for="county-name">County name (optional)</label>
              <input
                id="county-name"
                v-model="form.countyName"
                class="form-control"
                type="text"
                maxlength="200"
              >
            </div>
            <div class="form-group col-md-3">
              <label for="population">Population</label>
              <input
                id="population"
                v-model="form.population"
                class="form-control"
                type="number"
                min="0"
                max="2147483647"
                step="1"
                required
              >
            </div>
          </div>
        </section>

        <section
          class="mb-4"
          aria-labelledby="focus-heading"
        >
          <h3
            id="focus-heading"
            class="h5"
          >
            Focus areas
          </h3>
          <label for="focus-areas">One focus area per line</label>
          <textarea
            id="focus-areas"
            v-model="form.focusAreasText"
            class="form-control"
            rows="4"
            aria-describedby="focus-help"
          />
          <small
            id="focus-help"
            class="form-text text-muted"
          >
            Up to 30 areas, each no more than 100 characters.
          </small>
        </section>

        <section
          class="mb-4"
          aria-labelledby="staffing-heading"
        >
          <h3
            id="staffing-heading"
            class="h5"
          >
            Staffing capacity
          </h3>
          <div class="form-row">
            <div class="form-group col-md-6">
              <label for="staffing-level">Capacity level</label>
              <select
                id="staffing-level"
                v-model="form.staffingLevel"
                class="form-control"
              >
                <option value="limited">
                  Limited
                </option>
                <option value="moderate">
                  Moderate
                </option>
                <option value="substantial">
                  Substantial
                </option>
              </select>
            </div>
            <div class="form-group col-md-6">
              <label for="staffing-fte">Full-time equivalent staff</label>
              <input
                id="staffing-fte"
                v-model="form.fullTimeEquivalent"
                class="form-control"
                type="number"
                min="0"
                max="100000"
                step="any"
                required
              >
            </div>
          </div>
          <div class="form-group">
            <label for="staffing-notes">Staffing notes (optional)</label>
            <textarea
              id="staffing-notes"
              v-model="form.staffingNotes"
              class="form-control"
              maxlength="2000"
              rows="2"
            />
          </div>
        </section>

        <section
          class="mb-4"
          aria-labelledby="matching-heading"
        >
          <h3
            id="matching-heading"
            class="h5"
          >
            Matching funds
          </h3>
          <div class="form-group form-check">
            <input
              id="matching-available"
              v-model="form.matchingFundsAvailable"
              class="form-check-input"
              type="checkbox"
            >
            <label
              class="form-check-label"
              for="matching-available"
            >
              Matching funds are available
            </label>
          </div>
          <div class="form-group">
            <label for="matching-maximum">Maximum available (USD, optional)</label>
            <input
              id="matching-maximum"
              v-model="form.maximumAmountDollars"
              class="form-control"
              type="text"
              inputmode="decimal"
              placeholder="0.00"
            >
          </div>
          <div class="form-group">
            <label for="matching-notes">Matching-funds notes (optional)</label>
            <textarea
              id="matching-notes"
              v-model="form.matchingFundsNotes"
              class="form-control"
              maxlength="2000"
              rows="2"
            />
          </div>
        </section>

        <button
          class="btn btn-primary"
          type="submit"
          :disabled="saving || versionConflict"
        >
          {{ saving ? 'Saving…' : 'Save profile' }}
        </button>
      </form>
    </template>
  </main>
</template>

<script>
import { mapGetters } from 'vuex';
import * as fetchApi from '@/helpers/fetchApi';
import {
  emptyProfileForm, profileToForm, buildProfilePayload, parseProfileError,
} from '@/helpers/complianceProfileForm';

export default {
  name: 'OrganizationProfileView',
  data() {
    return {
      form: emptyProfileForm(),
      profileVersion: 0,
      loading: false,
      saving: false,
      loadError: '',
      saveError: '',
      validationErrors: [],
      versionConflict: false,
      saved: false,
      requestToken: 0,
    };
  },
  computed: {
    ...mapGetters({
      selectedAgencyId: 'users/selectedAgencyId',
      selectedTeam: 'users/selectedAgency',
    }),
  },
  watch: {
    selectedAgencyId() {
      this.loadProfile();
    },
  },
  mounted() {
    this.loadProfile();
  },
  methods: {
    async loadProfile() {
      this.requestToken += 1;
      const token = this.requestToken;
      this.form = emptyProfileForm();
      this.profileVersion = 0;
      this.loadError = '';
      this.saveError = '';
      this.validationErrors = [];
      this.versionConflict = false;
      this.saved = false;
      if (!this.selectedAgencyId) {
        this.loading = false;
        return;
      }
      this.loading = true;
      try {
        const { profile } = await fetchApi.get(`/api/organizations/${this.selectedAgencyId}/compliance/profile`);
        if (token !== this.requestToken) return;
        this.form = profileToForm(profile);
        this.profileVersion = profile.version;
      } catch (error) {
        if (token !== this.requestToken) return;
        const apiError = parseProfileError(error);
        if (error.response?.status !== 404 || apiError?.code !== 'NOT_FOUND'
          || apiError?.message !== 'The organization profile was not found.') {
          this.loadError = apiError?.message || 'Could not load the organization profile.';
        }
      } finally {
        if (token === this.requestToken) this.loading = false;
      }
    },
    async saveProfile() {
      const { errors, payload } = buildProfilePayload(this.form, this.profileVersion);
      this.validationErrors = errors;
      this.saveError = errors.length ? 'Correct the fields below before saving.' : '';
      this.saved = false;
      if (errors.length || this.saving) return;
      const token = this.requestToken;
      const organizationId = this.selectedAgencyId;
      this.saving = true;
      try {
        const { profile } = await fetchApi.put(`/api/organizations/${organizationId}/compliance/profile`, payload);
        if (token !== this.requestToken) return;
        this.form = profileToForm(profile);
        this.profileVersion = profile.version;
        this.saved = true;
      } catch (error) {
        if (token !== this.requestToken) return;
        const apiError = parseProfileError(error);
        this.saveError = apiError?.message || 'Could not save the organization profile.';
        this.validationErrors = (apiError?.details || []).map((detail) => `${detail.field}: ${detail.issue}`);
        this.versionConflict = apiError?.code === 'VERSION_CONFLICT';
      } finally {
        this.saving = false;
      }
    },
  },
};
</script>
