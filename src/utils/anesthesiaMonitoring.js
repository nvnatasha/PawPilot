export const CORE_MONITORING_FIELDS = [
  { key: 'hr', label: 'HR', type: 'number' },
  { key: 'rr', label: 'RR', type: 'number' },
  { key: 'spo2', label: 'SpO₂', type: 'number', suffix: '%' },
  { key: 'etco2', label: 'ETCO₂', type: 'number', suffix: 'mmHg' },
  { key: 'temperature', label: 'Temp', type: 'number' },
  { key: 'sap', label: 'SAP', type: 'number', suffix: 'mmHg' },
  { key: 'map', label: 'MAP', type: 'number', suffix: 'mmHg' },
  { key: 'dap', label: 'DAP', type: 'number', suffix: 'mmHg' },
  { key: 'vaporizerPercent', label: 'Vaporizer %', type: 'number', suffix: '%' },
  { key: 'oxygenLMin', label: 'O₂ L/min', type: 'number', suffix: 'L/min' },
];

export const OPTIONAL_MONITORING_FIELDS = [
  { key: 'ecgRhythm', label: 'ECG/rhythm note', type: 'text' },
  { key: 'pulseQuality', label: 'Pulse quality', type: 'text' },
  { key: 'mm', label: 'MM', type: 'text' },
  { key: 'crt', label: 'CRT', type: 'text' },
  { key: 'anestheticDepth', label: 'Anesthetic depth', type: 'text' },
  { key: 'jawTone', label: 'Jaw tone', type: 'text' },
  { key: 'eyePosition', label: 'Eye position', type: 'text' },
  { key: 'painResponse', label: 'Pain response', type: 'text' },
  { key: 'ventilatorRate', label: 'Vent rate', type: 'number' },
  { key: 'peakAirwayPressure', label: 'PIP', type: 'number', suffix: 'cmH₂O' },
  { key: 'peep', label: 'PEEP', type: 'number', suffix: 'cmH₂O' },
  { key: 'tidalVolume', label: 'Tidal volume', type: 'number', suffix: 'mL' },
];

export const MONITORING_FIELD_MAP = [...CORE_MONITORING_FIELDS, ...OPTIONAL_MONITORING_FIELDS].reduce(
  (map, field) => ({ ...map, [field.key]: field }),
  {},
);

const DEFAULT_POINT_COUNT = 12;
const MAX_POINT_COUNT = 48;

export function hasMeaningfulMonitoringValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

export function toIsoFromDateAndTime(date, time) {
  if (!date || !time) return '';
  const parsed = new Date(`${date}T${time}:00`);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

export function localDateTimeInput(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

export function displayTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function sortByTimestamp(items = [], key = 'timestamp') {
  return [...items].sort((a, b) => new Date(a[key]) - new Date(b[key]));
}

export function generateMonitoringTimes({
  startedAt,
  endedAt = '',
  intervalMinutes = 5,
  entries = [],
  extraPoints = [],
  minPoints = DEFAULT_POINT_COUNT,
} = {}) {
  if (!startedAt) return [];
  const interval = Number(intervalMinutes);
  if (!Number.isFinite(interval) || interval <= 0) return [];

  const start = new Date(startedAt);
  if (Number.isNaN(start.getTime())) return [];

  const latestKnownTime = [endedAt, ...entries.map((entry) => entry.scheduledAt || entry.timestamp), ...extraPoints]
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => b - a)[0];

  const end = latestKnownTime && latestKnownTime > start
    ? latestKnownTime
    : new Date(start.getTime() + (minPoints - 1) * interval * 60000);
  const points = [];
  let cursor = new Date(start);
  while (cursor <= end && points.length < MAX_POINT_COUNT) {
    points.push({ timestamp: cursor.toISOString(), scheduled: true });
    cursor = new Date(cursor.getTime() + interval * 60000);
  }

  for (const point of extraPoints) {
    if (!point) continue;
    const timestamp = new Date(point).toISOString();
    if (!points.some((item) => item.timestamp === timestamp)) {
      points.push({ timestamp, scheduled: false });
    }
  }

  return points.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

export function getMonitoringDisplayPoints({
  monitoringStart,
  intervalMinutes = 5,
  documentedEntries = [],
  extraPoints = [],
  monitoringEnd = '',
  completed = false,
  minimumVisibleScheduledPoints = DEFAULT_POINT_COUNT,
} = {}) {
  if (!monitoringStart) return [];

  if (monitoringEnd || completed) {
    return generateMonitoringTimes({
      startedAt: monitoringStart,
      endedAt: monitoringEnd,
      intervalMinutes,
      entries: documentedEntries,
      extraPoints,
      minPoints: 1,
    });
  }

  const interval = Number(intervalMinutes);
  if (!Number.isFinite(interval) || interval <= 0) return [];

  const start = new Date(monitoringStart);
  if (Number.isNaN(start.getTime())) return [];

  const documentedTimes = documentedEntries
    .map((entry) => entry.scheduledAt || entry.timestamp)
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()));
  const latestDocumented = documentedTimes.sort((a, b) => b - a)[0] || start;
  const minimumScheduledEnd = new Date(start.getTime() + (minimumVisibleScheduledPoints - 1) * interval * 60000);
  const rollingScheduledEnd = new Date(latestDocumented.getTime() + Math.floor(minimumVisibleScheduledPoints / 2) * interval * 60000);
  const displayEnd = rollingScheduledEnd > minimumScheduledEnd ? rollingScheduledEnd : minimumScheduledEnd;

  const points = generateMonitoringTimes({
    startedAt: monitoringStart,
    endedAt: displayEnd.toISOString(),
    intervalMinutes,
    entries: documentedEntries,
    extraPoints,
    minPoints: minimumVisibleScheduledPoints,
  });
  const latestDocumentedTime = latestDocumented.getTime();
  const hasDocumentedEntries = documentedTimes.length > 0;

  return points.map((point) => ({
    ...point,
    upcoming:
      point.scheduled &&
      !entryForPoint(documentedEntries, point) &&
      (!hasDocumentedEntries || new Date(point.timestamp).getTime() > latestDocumentedTime),
  }));
}

export function entryForPoint(entries = [], point) {
  const pointTime = new Date(point.timestamp).getTime();
  return entries.find((entry) => new Date(entry.scheduledAt || entry.timestamp).getTime() === pointTime) || null;
}

export function getUsedMonitoringFields(entries = [], enabledFields = []) {
  const enabled = new Set(enabledFields);
  const usedOptional = OPTIONAL_MONITORING_FIELDS.filter((field) =>
    entries.some((entry) => hasMeaningfulMonitoringValue(entry[field.key])),
  );

  return [
    ...CORE_MONITORING_FIELDS,
    ...OPTIONAL_MONITORING_FIELDS.filter(
      (field) => enabled.has(field.key) || usedOptional.some((used) => used.key === field.key),
    ),
  ];
}

export function monitoringEntryHasData(entry = {}) {
  return [...CORE_MONITORING_FIELDS, ...OPTIONAL_MONITORING_FIELDS].some((field) =>
    hasMeaningfulMonitoringValue(entry[field.key]),
  ) || hasMeaningfulMonitoringValue(entry.notes);
}

export function cleanMonitoringEntry(values = {}) {
  const cleaned = {};
  for (const field of [...CORE_MONITORING_FIELDS, ...OPTIONAL_MONITORING_FIELDS]) {
    if (hasMeaningfulMonitoringValue(values[field.key])) {
      cleaned[field.key] = values[field.key];
    }
  }
  if (hasMeaningfulMonitoringValue(values.temperatureUnit)) cleaned.temperatureUnit = values.temperatureUnit;
  if (hasMeaningfulMonitoringValue(values.notes)) cleaned.notes = values.notes.trim?.() || values.notes;
  if (hasMeaningfulMonitoringValue(values.technician)) cleaned.technician = values.technician;
  return cleaned;
}

export function formatMonitoringValue(fieldKey, entry = {}) {
  const value = entry[fieldKey];
  if (!hasMeaningfulMonitoringValue(value)) return '';
  if (fieldKey === 'temperature') {
    return `${value}${entry.temperatureUnit ? `°${entry.temperatureUnit}` : ''}`;
  }
  return String(value);
}

export function latestMonitoringSummary(entries = []) {
  const latest = sortByTimestamp(entries).filter(monitoringEntryHasData).at(-1);
  if (!latest) return null;

  return {
    timestamp: latest.timestamp,
    values: CORE_MONITORING_FIELDS
      .map((field) => ({ label: field.label, value: formatMonitoringValue(field.key, latest), key: field.key }))
      .filter((item) => hasMeaningfulMonitoringValue(item.value)),
  };
}
