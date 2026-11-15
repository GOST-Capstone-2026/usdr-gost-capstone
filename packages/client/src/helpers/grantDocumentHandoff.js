import { organizationId } from '@/helpers/matchRunApi';

export function grantId(value) {
  if (!['string', 'number'].includes(typeof value) || !/^\d+$/.test(String(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id >= 0 ? String(id) : null;
}

export function recordId(value) {
  const id = organizationId(value);
  return id !== null && id > 0 ? id : null;
}

export function grantDocumentLocation(id, agencyId, matchRunId) {
  const selectedGrant = grantId(id);
  const organization = organizationId(agencyId);
  if (selectedGrant === null || organization === null) return null;
  return {
    name: 'grantDocumentAnalysis',
    params: { grantId: selectedGrant },
    query: {
      organizationId: String(organization),
      ...(recordId(matchRunId) === null ? {} : { matchRunId: String(matchRunId) }),
    },
  };
}

export function documentContext(route, selectedAgencyId) {
  const selectedGrant = grantId(route.params?.grantId ?? route.query?.grantId);
  const organization = organizationId(selectedAgencyId);
  const requestedOrganization = organizationId(route.query?.organizationId);
  if (selectedGrant === null || organization === null || requestedOrganization !== organization) return null;
  return { grantId: selectedGrant, organizationId: organization };
}

const invalid = () => Object.assign(new Error('INVALID_DOCUMENT_RESPONSE'), { code: 'INVALID_DOCUMENT_RESPONSE' });

export function checkedDocument(value, context, expectedId) {
  if (!context || !value || recordId(value.id) === null
    || value.organizationId !== context.organizationId || grantId(value.grantId) !== context.grantId
    || (expectedId !== undefined && value.id !== expectedId)
    || typeof value.filename !== 'string') throw invalid();
  return value;
}

export function checkedAnalysisRun(value, documentId, expectedId) {
  if (!value || recordId(value.id) === null || value.documentId !== documentId
    || (expectedId !== undefined && value.id !== expectedId)
    || !['queued', 'processing', 'completed', 'failed'].includes(value.status)) throw invalid();
  return value;
}

export function documentAnalysisError(error) {
  let code = error?.code;
  if (!code) {
    try { code = JSON.parse(error.message)?.error?.code; } catch (ignored) { /* Do not display raw server errors. */ }
  }
  return {
    INVALID_DOCUMENT_RESPONSE: 'The response does not match the selected grant, team, or document. Reload before continuing.',
    NOT_FOUND: 'The document or analysis run was not found for this team.',
    FORBIDDEN: 'This account cannot access that document for the selected team.',
    UNAUTHORIZED: 'Sign in again before continuing.',
    VALIDATION_ERROR: 'Check the selected PDF and document information.',
    UNSUPPORTED_MEDIA_TYPE: 'Select a valid PDF document.',
    PAYLOAD_TOO_LARGE: 'The PDF exceeds the server upload limit.',
    DUPLICATE_DOCUMENT: 'This team has already uploaded this PDF. Reopen its document URL, or enter its existing ID if it belongs to this grant. Otherwise open the grant it belongs to.',
    STORAGE_UNAVAILABLE: 'Document storage is unavailable. Try uploading again later.',
  }[code] || 'The request could not be completed. Check the connection and try again.';
}
