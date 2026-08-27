export function formatNumber(value, options = {}) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return '';
  }

  const { maximumFractionDigits = 1, minimumFractionDigits = 0 } = options;
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits,
    minimumFractionDigits,
  }).format(numericValue);
}

export function formatMl(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return '';
  }

  if (numericValue > 0 && numericValue < 0.01) {
    return '<0.01';
  }

  if (numericValue < 1) {
    return formatNumber(numericValue, { maximumFractionDigits: 3 });
  }

  if (numericValue < 10) {
    return formatNumber(numericValue, { maximumFractionDigits: 2 });
  }

  return formatNumber(numericValue, { maximumFractionDigits: 1 });
}

export function displayUnit(unit) {
  return String(unit || '').replace('ug', 'µg');
}

export function formatConcentration(value, unit) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || !unit) {
    return '';
  }

  return `${formatNumber(numericValue, { maximumFractionDigits: 3 })} ${displayUnit(unit)}`;
}

export function formatDateForFilename(date) {
  return date || new Date().toISOString().slice(0, 10);
}

export function formatDisplayDate(date) {
  if (!date) {
    return '';
  }

  const parsedDate = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsedDate.getTime())) {
    return date;
  }

  return parsedDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function safeFilenamePart(value) {
  return String(value || 'Patient')
    .trim()
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '');
}
