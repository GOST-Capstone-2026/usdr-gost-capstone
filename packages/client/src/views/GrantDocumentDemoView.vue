<template>
  <main class="container py-4 document-analysis">
    <h1 class="h3">
      Grant document analysis
    </h1>
    <p v-if="returnToMatches">
      <router-link :to="returnToMatches">
        Return to saved grant matches
      </router-link>
    </p>
    <p
      v-if="!canAnalyze"
      role="alert"
    >
      Document analysis is not available for this account or configuration.
    </p>
    <p
      v-else-if="!context"
      role="alert"
    >
      Open a grant from the matching results for the currently selected team. No sample grant is selected automatically.
    </p>
    <template v-else>
      <p>Selected grant {{ context.grantId }} · Team {{ context.organizationId }}</p>
      <p>Upload the notice for this grant, then explicitly start its analysis. Reviewing a document does not change a match's eligibility or verification status.</p>
      <section>
        <h2 class="h5">
          1. Upload a notice PDF
        </h2>
        <form @submit.prevent="uploadDocument">
          <label for="pdf-file-input">PDF file
            <input
              id="pdf-file-input"
              :key="contextKey"
              type="file"
              accept="application/pdf"
              required
              class="form-control-file mb-3"
              :disabled="busy || isRunActive"
              @change="onFileChange"
            >
          </label>
          <button
            type="submit"
            class="btn btn-primary"
            :disabled="busy || isRunActive || !selectedFile"
          >
            {{ uploading ? 'Uploading…' : 'Upload PDF' }}
          </button>
        </form>
        <form
          class="mt-3"
          @submit.prevent="openExistingDocument"
        >
          <label for="existing-document-id">Or reopen an existing document ID for this grant and team
            <input
              id="existing-document-id"
              v-model="existingDocumentId"
              type="text"
              inputmode="numeric"
              class="form-control mb-2"
              :disabled="busy || isRunActive"
            >
          </label>
          <button
            type="submit"
            class="btn btn-outline-primary"
            :disabled="busy || isRunActive || !existingDocumentId"
          >
            Open existing document
          </button>
        </form>
      </section>
      <p
        v-if="loadingDocument"
        role="status"
      >
        Loading the saved document…
      </p>
      <p
        v-if="errorMessage"
        role="alert"
        class="alert alert-danger mt-3"
      >
        {{ errorMessage }}
      </p>
      <section
        v-if="document"
        class="mt-4"
      >
        <h2 class="h5">
          2. Selected document
        </h2>
        <p>{{ document.filename }} · Document {{ document.id }} · Grant {{ document.grantId }}</p>
        <p>Page count: {{ document.pageCount ?? 'Not analyzed yet' }}</p>
        <p>Extraction quality: {{ document.extractionQuality || 'Not analyzed yet' }}</p>
        <button
          class="btn btn-primary"
          :disabled="busy || isRunActive"
          @click="startAnalysis"
        >
          {{ startingAnalysis ? 'Starting…' : 'Start Analysis' }}
        </button>
        <p class="mt-2">
          Keep this page's URL to reopen the uploaded document without uploading it again.
        </p>
      </section>
      <section
        v-if="analysisRun"
        class="mt-4"
      >
        <h2 class="h5">
          3. Analysis run status
        </h2>
        <p role="status">
          Run {{ analysisRun.id }}: {{ analysisRun.status }}
        </p>
        <p
          v-if="analysisRun.status === 'failed'"
          role="alert"
        >
          Analysis failed. Review the document and try again.
        </p>
        <template v-if="analysisRun.status === 'completed'">
          <p>Processing completed. Page count: {{ document.pageCount ?? 'Unknown' }}. Chunk count: {{ analysisRun.chunkCount ?? 'Unknown' }}.</p>
          <p>Processing completion does not verify the extracted content. Review its source before relying on it.</p>
        </template>
        <button
          v-if="analysisRun.status !== 'failed' && errorMessage"
          class="btn btn-outline-primary"
          :disabled="busy"
          @click="refreshAnalysis"
        >
          Refresh analysis status
        </button>
      </section>
    </template>
  </main>
</template>

<script>
import { mapGetters } from 'vuex';
import * as fetchApi from '@/helpers/fetchApi';
import { grantDocumentAnalysisEnabled, grantMatchingEnabled } from '@/helpers/featureFlags';
import {
  documentContext, checkedDocument, checkedAnalysisRun, documentAnalysisError, recordId,
} from '@/helpers/grantDocumentHandoff';

const POLL_INTERVAL_MS = 1500;

export default {
  data() {
    return {
      selectedFile: null,
      document: null,
      analysisRun: null,
      existingDocumentId: '',
      uploading: false,
      startingAnalysis: false,
      loadingDocument: false,
      polling: false,
      errorMessage: '',
      pollHandle: null,
      sequence: 0,
    };
  },
  computed: {
    ...mapGetters({ selectedAgencyId: 'users/selectedAgencyId', userRole: 'users/userRole' }),
    canAnalyze() { return grantDocumentAnalysisEnabled() && ['admin', 'staff'].includes(this.userRole); },
    context() { return documentContext(this.$route, this.selectedAgencyId); },
    contextKey() { return JSON.stringify([this.canAnalyze, this.context, this.$route.query.documentId]); },
    busy() { return this.uploading || this.startingAnalysis || this.loadingDocument || this.polling; },
    isRunActive() { return ['queued', 'processing'].includes(this.analysisRun?.status); },
    returnToMatches() {
      const id = recordId(this.$route.query.matchRunId);
      return this.context && grantMatchingEnabled() && id !== null
        ? { name: 'grantMatches', query: { runId: String(id) } } : null;
    },
  },
  watch: { contextKey: { immediate: true, handler: 'resetSelection' } },
  beforeUnmount() { this.sequence += 1; this.stopPolling(); },
  methods: {
    base(context) { return `/api/organizations/${context.organizationId}/compliance`; },
    stopPolling() { clearTimeout(this.pollHandle); this.pollHandle = null; },
    async resetSelection() {
      this.sequence += 1;
      this.stopPolling();
      this.selectedFile = null;
      this.document = null;
      this.analysisRun = null;
      this.existingDocumentId = '';
      this.errorMessage = '';
      this.uploading = false;
      this.startingAnalysis = false;
      this.loadingDocument = false;
      this.polling = false;
      if (!this.canAnalyze || !this.context || this.$route.query.documentId === undefined) return;
      const id = recordId(this.$route.query.documentId);
      if (id === null) { this.errorMessage = 'Enter a valid saved document ID.'; return; }
      const { sequence, context } = this;
      this.loadingDocument = true;
      try {
        const response = await fetchApi.get(`${this.base(context)}/documents/${id}`);
        if (sequence !== this.sequence) return;
        this.document = checkedDocument(response.document, context, id);
      } catch (error) {
        if (sequence === this.sequence) this.errorMessage = documentAnalysisError(error);
      } finally {
        if (sequence === this.sequence) this.loadingDocument = false;
      }
    },
    onFileChange(event) { [this.selectedFile] = event.target.files; },
    async openExistingDocument() {
      if (!this.canAnalyze || !this.context || this.busy || this.isRunActive) return;
      const id = recordId(this.existingDocumentId);
      if (id === null) { this.errorMessage = 'Enter a valid saved document ID.'; return; }
      try { await this.saveDocumentLocation(id); } catch (error) { this.errorMessage = documentAnalysisError(error); }
    },
    saveDocumentLocation(id) {
      return this.$router.replace({
        name: this.$route.name,
        params: this.$route.params,
        query: { ...this.$route.query, documentId: String(id) },
      });
    },
    async uploadDocument() {
      if (!this.canAnalyze || !this.context || !this.selectedFile || this.busy || this.isRunActive) return;
      const { sequence, context } = this;
      this.errorMessage = '';
      this.document = null;
      this.analysisRun = null;
      this.uploading = true;
      try {
        const body = new FormData();
        body.append('file', this.selectedFile);
        body.append('grantId', context.grantId);
        const response = await fetchApi.postFormData(`${this.base(context)}/documents`, body);
        if (sequence !== this.sequence) return;
        this.document = checkedDocument(response.document, context);
        this.selectedFile = null;
        await this.saveDocumentLocation(this.document.id);
      } catch (error) {
        if (sequence === this.sequence) this.errorMessage = documentAnalysisError(error);
      } finally {
        if (sequence === this.sequence) this.uploading = false;
      }
    },
    async startAnalysis() {
      if (!this.canAnalyze || !this.context || !this.document || this.busy || this.isRunActive) return;
      const { sequence, context, document } = this;
      this.startingAnalysis = true;
      this.errorMessage = '';
      try {
        const response = await fetchApi.post(`${this.base(context)}/documents/${document.id}/analysis-runs`);
        if (sequence !== this.sequence) return;
        this.analysisRun = checkedAnalysisRun(response.analysisRun, document.id);
        this.schedulePoll();
      } catch (error) {
        if (sequence === this.sequence) this.errorMessage = documentAnalysisError(error);
      } finally {
        if (sequence === this.sequence) this.startingAnalysis = false;
      }
    },
    schedulePoll() {
      this.stopPolling();
      if (this.isRunActive) this.pollHandle = setTimeout(() => this.refreshAnalysis(), POLL_INTERVAL_MS);
    },
    async refreshAnalysis() {
      if (!this.canAnalyze || !this.context || !this.document || !this.analysisRun || this.busy) return;
      this.stopPolling();
      const {
        sequence, context, document, analysisRun,
      } = this;
      this.polling = true;
      this.errorMessage = '';
      try {
        const response = await fetchApi.get(`${this.base(context)}/analysis-runs/${analysisRun.id}`);
        if (sequence !== this.sequence) return;
        this.analysisRun = checkedAnalysisRun(response.analysisRun, document.id, analysisRun.id);
        if (this.analysisRun.status === 'completed') {
          const saved = await fetchApi.get(`${this.base(context)}/documents/${document.id}`);
          if (sequence !== this.sequence) return;
          this.document = checkedDocument(saved.document, context, document.id);
        }
        this.schedulePoll();
      } catch (error) {
        if (sequence === this.sequence) this.errorMessage = documentAnalysisError(error);
      } finally {
        if (sequence === this.sequence) this.polling = false;
      }
    },
  },
};
</script>

<style scoped>
.document-analysis { max-width: 48rem; }
</style>
