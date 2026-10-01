import {
  describe, beforeEach, it, expect, vi,
} from 'vitest';
import { getFeatureFlags } from '@/helpers/featureFlags/utils';
import {
  grantComplianceEnabled,
  grantDocumentAnalysisEnabled,
  complianceChecklistsEnabled,
  complianceDeadlinesEnabled,
} from '@/helpers/featureFlags';

describe('featureFlags', () => {
  describe('helpers', () => {
    describe('getFeatureFlags()', () => {
      describe('Defaults to empty object', () => {
        beforeEach(() => {
          if (window.APP_CONFIG !== undefined) {
            delete window.APP_CONFIG;
          }
          window.sessionStorage.removeItem('featureFlags');
        });

        it('when window.APP_CONFIG does not exist', () => {
          expect(getFeatureFlags()).toEqual({});
        });

        it('when window.APP_CONFIG.featureFlags does not exist', () => {
          window.APP_CONFIG = {};
          expect(getFeatureFlags()).toEqual({});
        });

        it('when window.APP_CONFIG.featureFlags is actually an empty object', () => {
          window.APP_CONFIG = { featureFlags: {} };
          expect(getFeatureFlags()).toEqual({});
        });
      });

      describe('When featureFlags are defined', () => {
        it('Returns the featureFlags object', () => {
          const expectedFeatureFlags = { useFoo: true, numberFlag: 1234 };
          window.APP_CONFIG = { featureFlags: expectedFeatureFlags };
          const actualFeatureFlags = getFeatureFlags();
          expect(actualFeatureFlags.useFoo).toBe(true);
          expect(actualFeatureFlags.numberFlag).toBe(1234);
          expect(actualFeatureFlags).toEqual(expectedFeatureFlags);
        });
        it('Ignores session storage overrides when JSON is malformed', () => {
          const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementationOnce(vi.fn());
          window.sessionStorage.setItem('featureFlags', 'i}am]not,JS;ON>{');
          const expectedFeatureFlags = { useFoo: true, numberFlag: 1234 };
          window.APP_CONFIG = { featureFlags: expectedFeatureFlags };
          const actualFeatureFlags = getFeatureFlags();
          expect(actualFeatureFlags.useFoo).toBe(true);
          expect(actualFeatureFlags.numberFlag).toBe(1234);
          expect(actualFeatureFlags).toEqual(expectedFeatureFlags);
          expect(consoleErrorSpy).toHaveBeenCalledOnce();
          consoleErrorSpy.mockRestore();
        });
        it('Overrides feature flag values from session storage', () => {
          const defaultFeatureFlags = { useFoo: true, numberFlag: 1234 };
          window.APP_CONFIG = { featureFlags: defaultFeatureFlags };
          const overriddenFeatureFlags = { useFoo: false, stringFlag: 'hi!' };
          window.sessionStorage.setItem('featureFlags', JSON.stringify(overriddenFeatureFlags));
          const actualFeatureFlags = getFeatureFlags();
          expect(actualFeatureFlags.useFoo).toBe(false);
          expect(actualFeatureFlags.numberFlag).toBe(1234);
          expect(actualFeatureFlags.stringFlag).toBe('hi!');
          expect(actualFeatureFlags).not.toEqual(defaultFeatureFlags);
          expect(actualFeatureFlags).toEqual({ useFoo: false, numberFlag: 1234, stringFlag: 'hi!' });
        });
      });
    });
  });

  describe('Grant Compliance Assistant flags', () => {
    const allOn = {
      grantComplianceEnabled: true,
      grantDocumentAnalysisEnabled: true,
      complianceChecklistsEnabled: true,
      complianceDeadlinesEnabled: true,
    };
    const chain = [
      { name: 'grantComplianceEnabled', getter: grantComplianceEnabled, dependencies: [] },
      { name: 'grantDocumentAnalysisEnabled', getter: grantDocumentAnalysisEnabled, dependencies: ['grantComplianceEnabled'] },
      { name: 'complianceChecklistsEnabled', getter: complianceChecklistsEnabled, dependencies: ['grantComplianceEnabled', 'grantDocumentAnalysisEnabled'] },
      { name: 'complianceDeadlinesEnabled', getter: complianceDeadlinesEnabled, dependencies: ['grantComplianceEnabled', 'grantDocumentAnalysisEnabled', 'complianceChecklistsEnabled'] },
    ];

    beforeEach(() => {
      window.sessionStorage.removeItem('featureFlags');
    });

    describe.each(chain)('$name()', ({ name, getter, dependencies }) => {
      it('is true when it and every dependency are true', () => {
        window.APP_CONFIG = { featureFlags: { ...allOn } };
        expect(getter()).toBe(true);
      });

      it.each([
        ['false', false],
        ['null', null],
        ['the string "true"', 'true'],
      ])('is false when its own flag is %s', (_, value) => {
        window.APP_CONFIG = { featureFlags: { ...allOn, [name]: value } };
        expect(getter()).toBe(false);
      });

      it('is false when its own flag is missing', () => {
        const featureFlags = { ...allOn };
        delete featureFlags[name];
        window.APP_CONFIG = { featureFlags };
        expect(getter()).toBe(false);
      });

      it.each(dependencies)('is false when dependency %s is off', (dependency) => {
        window.APP_CONFIG = { featureFlags: { ...allOn, [dependency]: false } };
        expect(getter()).toBe(false);
      });
    });
  });
});
