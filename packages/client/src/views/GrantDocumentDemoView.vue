<template>
  <main>
    <b-breadcrumb :items="breadcrumbItems" />
    <section
      style="max-width: 640px;"
      class="mx-auto my-5 px-2"
    >
      <h2>Grant Document Analysis (Demo)</h2>
      <p class="text-muted">
        Upload a grant notice PDF, then start an analysis run and watch it complete.
      </p>

      <section style="margin-top: 2rem;">
        <h4>1. Upload a document</h4>
        <!--
          No grant picker here: in the real app, this page would already be reached from a
          specific grant's own page, so the grant it belongs to travels along automatically. This
          demo page always attaches to one fixed sample grant (see grantId below) since it is not
          wired into that navigation yet.
        -->
        <b-form @submit.prevent="uploadDocument">
          <b-form-group
            label="PDF file"
            label-for="pdf-file-input"
          >
            <input
              id="pdf-file-input"
              type="file"
              accept="application/pdf"
              required
              @change="onFileChange"
            >
          </b-form-group>
          <b-button
            type="submit"
            variant="primary"
            :disabled="uploading || !selectedFile"
          >
            <b-spinner
              v-if="uploading"
              small
            />
            <span v-else>Upload</span>
          </b-button>
        </b-form>
      </section>

      <b-alert
        :model-value="Boolean(errorMessage)"
        variant="danger"
        class="mt-3"
      >
        {{ errorMessage }}
      </b-alert>

      <section
        v-if="document"
        style="margin-top: 2.5rem;"
      >
        <h4>2. Document</h4>
        <p class="mb-1">
          <b>{{ document.filename }}</b> (id {{ document.id }})
        </p>
        <p class="mb-1">
          Page count: {{ document.pageCount ?? 'not analyzed yet' }}
        </p>
        <p class="mb-3">
          Extraction quality: {{ document.extractionQuality }}
        </p>

        <b-button
          variant="primary"
          :disabled="startingAnalysis || isRunActive"
          @click="startAnalysis"
        >
          <b-spinner
            v-if="startingAnalysis"
            small
          />
          <span v-else>Start Analysis</span>
        </b-button>
      </section>

      <section
        v-if="analysisRun"
        style="margin-top: 2.5rem;"
      >
        <h4>3. Analysis run status</h4>
        <p class="mb-1">
          Run id {{ analysisRun.id }}:
          <b-badge :variant="statusVariant">
            {{ analysisRun.status }}
          </b-badge>
          <b-spinner
            v-if="isRunActive"
            small
            class="ms-2"
          />
        </p>
        <p
          v-if="analysisRun.status === 'failed'"
          class="text-danger mb-1"
        >
          {{ analysisRun.errorMessage }}
        </p>
        <template v-if="analysisRun.status === 'completed'">
          <p class="text-success mb-1">
            Done. Page count: {{ document.pageCount }}.
          </p>
          <p class="text-success mb-1">
            Rated "{{ document.extractionQuality }}."
          </p>
          <p class="text-success mb-1">
            Split into {{ analysisRun.chunkCount }} chunks, ready for future AI processing.
          </p>
        </template>
      </section>
    </section>
  </main>
</template>

<script>
import { mapGetters } from 'vuex';
import * as fetchApi from '@/helpers/fetchApi';

const POLL_INTERVAL_MS = 1500;

export default {
  data() {
    return {
      breadcrumbItems: [
        { text: 'Home', to: 'grants' },
        { text: 'Grant Document Analysis (Demo)', href: '#' },
      ],
      // Fixed to the HUD PRO Housing FOA used throughout this project's testing. The real app
      // would set this automatically from whichever grant's page the upload happened on.
      grantId: '335255',
      selectedFile: null,
      uploading: false,
      startingAnalysis: false,
      document: null,
      analysisRun: null,
      errorMessage: null,
      pollHandle: null,
    };
  },
  computed: {
    ...mapGetters({
      selectedAgencyId: 'users/selectedAgencyId',
    }),
    isRunActive() {
      return this.analysisRun
        && ['queued', 'processing'].includes(this.analysisRun.status);
    },
    statusVariant() {
      return {
        queued: 'secondary',
        processing: 'info',
        completed: 'success',
        failed: 'danger',
      }[this.analysisRun?.status] || 'secondary';
    },
  },
  beforeUnmount() {
    this.stopPolling();
  },
  methods: {
    onFileChange(event) {
      [this.selectedFile] = event.target.files;
    },
    async uploadDocument() {
      this.errorMessage = null;
      this.document = null;
      this.analysisRun = null;
      this.stopPolling();
      this.uploading = true;
      try {
        const formData = new FormData();
        formData.append('file', this.selectedFile);
        formData.append('grantId', this.grantId);
        const { document } = await fetchApi.postFormData(
          `/api/organizations/${this.selectedAgencyId}/compliance/documents`,
          formData,
        );
        this.document = document;
      } catch (err) {
        this.errorMessage = err.message;
      } finally {
        this.uploading = false;
      }
    },
    async startAnalysis() {
      this.errorMessage = null;
      this.startingAnalysis = true;
      try {
        const { analysisRun } = await fetchApi.post(
          `/api/organizations/${this.selectedAgencyId}/compliance/documents/${this.document.id}/analysis-runs`,
        );
        this.analysisRun = analysisRun;
        this.startPolling();
      } catch (err) {
        this.errorMessage = err.message;
      } finally {
        this.startingAnalysis = false;
      }
    },
    startPolling() {
      this.stopPolling();
      this.pollHandle = setInterval(async () => {
        const { analysisRun } = await fetchApi.get(
          `/api/organizations/${this.selectedAgencyId}/compliance/analysis-runs/${this.analysisRun.id}`,
        );
        this.analysisRun = analysisRun;
        if (!this.isRunActive) {
          this.stopPolling();
          if (analysisRun.status === 'completed') {
            const { document } = await fetchApi.get(
              `/api/organizations/${this.selectedAgencyId}/compliance/documents/${this.document.id}`,
            );
            this.document = document;
          }
        }
      }, POLL_INTERVAL_MS);
    },
    stopPolling() {
      if (this.pollHandle) {
        clearInterval(this.pollHandle);
        this.pollHandle = null;
      }
    },
  },
};
</script>
