import { describe, it, expect } from 'vitest';
import {
  emptyProfileForm, profileToForm, buildProfilePayload, parseProfileError,
} from '@/helpers/complianceProfileForm';

describe('organization profile form', () => {
  it('converts API values into editable fields', () => {
    const form = profileToForm({
      jurisdiction: {
        type: 'city', name: 'Example City', stateCode: 'FL', countyName: null,
      },
      population: 42000,
      focusAreas: ['stormwater', 'public safety'],
      staffingCapacity: { level: 'limited', fullTimeEquivalent: 1.5, notes: null },
      matchingFunds: { available: true, maximumAmountCents: 250050, notes: null },
    });
    expect(form.focusAreasText).toBe('stormwater\npublic safety');
    expect(form.maximumAmountDollars).toBe('2500.50');
    expect(form.population).toBe('42000');
  });

  it('builds a versioned payload with uppercase state and exact cents', () => {
    const form = {
      ...emptyProfileForm(),
      jurisdictionName: ' Example City ',
      stateCode: 'fl',
      population: '42000',
      focusAreasText: ' stormwater \n\n public safety ',
      fullTimeEquivalent: '1.5',
      matchingFundsAvailable: true,
      maximumAmountDollars: '2500.05',
    };
    const { errors, payload } = buildProfilePayload(form, 2);
    expect(errors).toEqual([]);
    expect(payload.expectedVersion).toBe(2);
    expect(payload.jurisdiction.stateCode).toBe('FL');
    expect(payload.focusAreas).toEqual(['stormwater', 'public safety']);
    expect(payload.matchingFunds.maximumAmountCents).toBe(250005);
  });

  it('rejects missing numeric values and excess decimal places', () => {
    const form = {
      ...emptyProfileForm(),
      jurisdictionName: 'Example City',
      stateCode: 'FL',
      maximumAmountDollars: '100.001',
    };
    const { errors } = buildProfilePayload(form, 0);
    expect(errors).toHaveLength(3);
  });

  it('recognizes the controlled API error shape', () => {
    const error = new Error(JSON.stringify({ error: { code: 'VERSION_CONFLICT', message: 'Reload.' } }));
    expect(parseProfileError(error).code).toBe('VERSION_CONFLICT');
    expect(parseProfileError(new Error('network error'))).toBeNull();
  });
});
