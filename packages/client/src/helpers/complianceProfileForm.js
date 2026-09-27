export function emptyProfileForm() {
  return {
    jurisdictionType: 'city',
    jurisdictionName: '',
    stateCode: '',
    countyName: '',
    population: '',
    focusAreasText: '',
    staffingLevel: 'limited',
    fullTimeEquivalent: '',
    staffingNotes: '',
    matchingFundsAvailable: false,
    maximumAmountDollars: '',
    matchingFundsNotes: '',
  };
}

export function profileToForm(profile) {
  return {
    jurisdictionType: profile.jurisdiction.type,
    jurisdictionName: profile.jurisdiction.name,
    stateCode: profile.jurisdiction.stateCode,
    countyName: profile.jurisdiction.countyName || '',
    population: String(profile.population),
    focusAreasText: profile.focusAreas.join('\n'),
    staffingLevel: profile.staffingCapacity.level,
    fullTimeEquivalent: String(profile.staffingCapacity.fullTimeEquivalent),
    staffingNotes: profile.staffingCapacity.notes || '',
    matchingFundsAvailable: profile.matchingFunds.available,
    maximumAmountDollars: profile.matchingFunds.maximumAmountCents == null
      ? '' : `${Math.floor(profile.matchingFunds.maximumAmountCents / 100)}.${String(profile.matchingFunds.maximumAmountCents % 100).padStart(2, '0')}`,
    matchingFundsNotes: profile.matchingFunds.notes || '',
  };
}

function centsFromDollars(value) {
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return undefined;
  const [dollars, cents = ''] = trimmed.split('.');
  const result = Number(dollars) * 100 + Number(cents.padEnd(2, '0'));
  return Number.isSafeInteger(result) ? result : undefined;
}

export function buildProfilePayload(form, expectedVersion) {
  const errors = [];
  const name = form.jurisdictionName.trim();
  const stateCode = form.stateCode.trim().toUpperCase();
  const countyName = form.countyName.trim();
  const population = Number(form.population);
  const fullTimeEquivalent = Number(form.fullTimeEquivalent);
  const focusAreas = form.focusAreasText.split('\n').map((area) => area.trim()).filter(Boolean);
  const maximumAmountCents = centsFromDollars(form.maximumAmountDollars);

  if (!name || name.length > 200) errors.push('Jurisdiction name must be 1–200 characters.');
  if (!/^[A-Z]{2}$/.test(stateCode)) errors.push('State code must be two letters.');
  if (countyName.length > 200) errors.push('County name must be at most 200 characters.');
  if (form.population === '' || !Number.isInteger(population) || population < 0 || population > 2147483647) {
    errors.push('Population must be a whole number from 0 to 2,147,483,647.');
  }
  if (focusAreas.length > 30 || focusAreas.some((area) => area.length > 100)) {
    errors.push('Enter at most 30 focus areas, each no more than 100 characters.');
  }
  if (form.fullTimeEquivalent === '' || !Number.isFinite(fullTimeEquivalent)
    || fullTimeEquivalent < 0 || fullTimeEquivalent > 100000) {
    errors.push('Staffing must be a number from 0 to 100,000 full-time equivalents.');
  }
  if (form.staffingNotes.length > 2000 || form.matchingFundsNotes.length > 2000) {
    errors.push('Notes must be at most 2,000 characters.');
  }
  if (maximumAmountCents === undefined) {
    errors.push('Maximum matching funds must be a nonnegative dollar amount with at most two decimal places.');
  }

  return {
    errors,
    payload: {
      expectedVersion,
      jurisdiction: {
        type: form.jurisdictionType,
        name,
        stateCode,
        countyName: countyName || null,
      },
      population,
      focusAreas,
      staffingCapacity: {
        level: form.staffingLevel,
        fullTimeEquivalent,
        notes: form.staffingNotes.trim() || null,
      },
      matchingFunds: {
        available: form.matchingFundsAvailable,
        maximumAmountCents,
        notes: form.matchingFundsNotes.trim() || null,
      },
    },
  };
}

export function parseProfileError(error) {
  try {
    return JSON.parse(error.message).error || null;
  } catch {
    return null;
  }
}
