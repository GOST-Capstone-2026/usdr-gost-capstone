import { describe, it, expect } from 'vitest';
import {
  grantDocumentLocation, documentContext, checkedDocument, checkedAnalysisRun, documentAnalysisError,
} from '@/helpers/grantDocumentHandoff';

const context = { grantId: '364009', organizationId: 0 };
const document = {
  id: 7, grantId: '364009', organizationId: 0, filename: 'notice.pdf',
};

describe('C-12 selected-grant handoff', () => {
  it('builds a named route with the selected grant, team zero and saved matching run', () => {
    expect(grantDocumentLocation(364009, 0, 9)).toEqual({
      name: 'grantDocumentAnalysis',
      params: { grantId: '364009' },
      query: { organizationId: '0', matchRunId: '9' },
    });
  });
  it.each(['../335255', '1e3', '', ['7'], true, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid grant ID %j', (id) => {
    expect(grantDocumentLocation(id, 0, 9)).toBeNull();
  });
  it('refuses invalid organizations and omits an invalid return-run ID', () => {
    expect(grantDocumentLocation(1, '', 9)).toBeNull();
    expect(grantDocumentLocation(1, 0, ['9']).query).toEqual({ organizationId: '0' });
  });
  it('binds both new and retained demo routes to explicit grant/team context', () => {
    expect(documentContext({ params: { grantId: '364009' }, query: { organizationId: '0' } }, '0')).toEqual(context);
    expect(documentContext({ query: { grantId: '364009', organizationId: '0' } }, 0)).toEqual(context);
  });
  it('never falls back to the old sample grant or silently switches organizations', () => {
    expect(documentContext({ params: {}, query: {} }, 0)).toBeNull();
    expect(documentContext({ params: { grantId: '364009' }, query: { organizationId: '0' } }, 3)).toBeNull();
    expect(documentContext({ params: { grantId: '364009' }, query: {} }, 0)).toBeNull();
  });
  it.each([
    { grantId: '335255' }, { organizationId: 3 }, { id: 8 }, { filename: null },
  ])('rejects a mismatched saved-document response %j', (change) => {
    expect(() => checkedDocument({ ...document, ...change }, context, 7)).toThrow();
  });
  it('checks analysis-run identity, document and status before displaying it', () => {
    const run = { id: 12, documentId: 7, status: 'completed' };
    expect(checkedDocument(document, context, 7)).toBe(document);
    expect(checkedAnalysisRun(run, 7, 12)).toBe(run);
    expect(() => checkedAnalysisRun({ ...run, documentId: 8 }, 7, 12)).toThrow();
    expect(() => checkedAnalysisRun({ ...run, id: 13 }, 7, 12)).toThrow();
    expect(() => checkedAnalysisRun({ ...run, status: 'verified' }, 7, 12)).toThrow();
  });
  it('offers duplicate recovery without disclosing raw provider/server errors', () => {
    expect(documentAnalysisError(new Error('{"error":{"code":"DUPLICATE_DOCUMENT"}}'))).toContain('already uploaded');
    expect(documentAnalysisError(new Error('secret SQL and provider key'))).not.toContain('secret');
  });
});
