import { toCsv } from './csv.js';
import { sheetWindow } from './hospitalizationSchedule.js';

export const TIME_RANGES = [
  { id: 'currentSheet', label: 'Current 24-hour sheet' },
  { id: 'last12', label: 'Last 12 hours' },
  { id: 'last24', label: 'Last 24 hours' },
  { id: 'entire', label: 'Entire hospitalization' },
  { id: 'custom', label: 'Custom range' },
];

export const TREND_METRICS = [
  { id: 'temperature', label: 'Temperature', shortLabel: 'Temp', category: 'vitals', keys: [{ key: 'temperature', unitKey: 'temperatureUnit', unitPrefix: '°', defaultUnit: '°F' }] },
  { id: 'hr', label: 'Heart Rate', shortLabel: 'HR', category: 'vitals', keys: [{ key: 'hr', unit: 'bpm' }] },
  { id: 'rr', label: 'Respiratory Rate', shortLabel: 'RR', category: 'vitals', keys: [{ key: 'rr', unit: 'br/min' }] },
  { id: 'spo2', label: 'SpO₂', shortLabel: 'SpO₂', category: 'vitals', keys: [{ key: 'spo2', unit: '%' }] },
  { id: 'sap', label: 'Systolic Blood Pressure', shortLabel: 'SAP', category: 'bp', keys: [{ key: 'systolicBp', unit: 'mmHg' }] },
  { id: 'map', label: 'Mean Blood Pressure', shortLabel: 'MAP', category: 'bp', keys: [{ key: 'meanBp', unit: 'mmHg' }] },
  { id: 'dap', label: 'Diastolic Blood Pressure', shortLabel: 'DAP', category: 'bp', keys: [{ key: 'diastolicBp', unit: 'mmHg' }] },
  { id: 'weight', label: 'Body Weight', shortLabel: 'Weight', category: 'weight', keys: [{ key: 'bodyWeight', unit: 'kg' }] },
  { id: 'bg', label: 'Blood Glucose', shortLabel: 'BG', category: 'lab', keys: [{ key: 'bg', unitKey: 'bgUnit', defaultUnit: 'mg/dL' }] },
  { id: 'pcv', label: 'Packed Cell Volume', shortLabel: 'PCV', category: 'lab', keys: [{ key: 'pcv', unit: '%' }] },
  { id: 'ts', label: 'Total Solids', shortLabel: 'TS', category: 'lab', keys: [{ key: 'ts', unit: 'g/dL' }] },
  { id: 'lactate', label: 'Lactate', shortLabel: 'Lactate', category: 'lab', itemNames: ['lactate'], unitDefault: 'mmol/L' },
  { id: 'urineOutput', label: 'Urine Output', shortLabel: 'Urine', category: 'output', itemNames: ['urine output'], unitDefault: 'mL' },
  { id: 'drainOutput', label: 'Drain Output', shortLabel: 'Drain', category: 'output', itemNames: ['drain output'], unitDefault: 'mL' },
  { id: 'fluidCumulative', label: 'Fluid Cumulative Volume', shortLabel: 'Fluids', category: 'output', unitDefault: 'mL', fluidCheckKey: 'currentCumulativeMl' },
];

const STANDARD_IDS = new Set(TREND_METRICS.map((metric) => metric.id));
const STANDARD_ITEM_NAMES = new Set([
  'bg',
  'blood glucose',
  'blood pressure',
  'bp',
  'drain output',
  'fluid volume check',
  'lactate',
  'pcv/ts',
  'tpr',
  'urine output',
  'weight',
]);

export function buildTrendSeries({ hospitalization, metricId, rangeId = 'entire', customStart = '', customEnd = '' }) {
  const metrics = getTrendMetricOptions(hospitalization);
  const metric = metrics.find((item) => item.id === metricId) || metrics[0] || null;
  if (!hospitalization || !metric) return emptySeries(metric);

  const range = getTimeRangeWindow(hospitalization, rangeId, customStart, customEnd);
  const allPoints = extractMetricPoints(hospitalization, metric)
    .filter((point) => inRange(point.timestamp, range))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  if (allPoints.length === 0) return { ...emptySeries(metric), range };

  const selectedUnit = allPoints[0].unit || '';
  const points = allPoints.filter((point) => (point.unit || '') === selectedUnit);
  return {
    metric,
    points,
    range,
    unit: selectedUnit,
    incompatibleUnits: allPoints.length - points.length,
    allPointCount: allPoints.length,
  };
}

export function getTrendMetricOptions(hospitalization) {
  if (!hospitalization) return TREND_METRICS;
  const options = [...TREND_METRICS];
  const seen = new Set(options.map((metric) => metric.id));
  for (const metric of getCustomNumericMetrics(hospitalization)) {
    if (!seen.has(metric.id)) {
      options.push(metric);
      seen.add(metric.id);
    }
  }
  return options.filter((metric) => extractMetricPoints(hospitalization, metric).length > 0 || STANDARD_IDS.has(metric.id));
}

export function summarizeSeries(series) {
  const points = series?.points || [];
  const latest = points.at(-1) || null;
  const previous = points.length > 1 ? points.at(-2) : null;
  return {
    latest,
    previous,
    count: points.length,
  };
}

export function trendSeriesToCsv(series) {
  return toCsv((series.points || []).map((point) => ({
    timestamp: point.timestamp,
    metric: series.metric?.shortLabel || series.metric?.label || '',
    value: point.value,
    unit: point.unit,
    notes: point.notes || '',
  })), [
    { key: 'timestamp', header: 'Timestamp' },
    { key: 'metric', header: 'Metric' },
    { key: 'value', header: 'Value' },
    { key: 'unit', header: 'Unit' },
    { key: 'notes', header: 'Notes' },
  ]);
}

export function getTimeRangeWindow(hospitalization, rangeId, customStart = '', customEnd = '') {
  if (!hospitalization) return { start: null, end: null };
  if (rangeId === 'currentSheet') {
    return sheetWindow(hospitalization.sheetDate);
  }
  if (rangeId === 'custom') {
    return {
      start: customStart ? new Date(customStart) : null,
      end: customEnd ? new Date(customEnd) : null,
    };
  }
  if (rangeId === 'last12' || rangeId === 'last24') {
    const hours = rangeId === 'last12' ? 12 : 24;
    const end = trendReferenceEnd(hospitalization);
    return { start: new Date(end.getTime() - hours * 60 * 60 * 1000), end };
  }
  return {
    start: hospitalization.startedAt ? new Date(hospitalization.startedAt) : null,
    end: hospitalization.endedAt ? new Date(hospitalization.endedAt) : null,
  };
}

function extractMetricPoints(hospitalization, metric) {
  if (metric.customName) {
    return sourceEvents(hospitalization)
      .filter((event) => normalizeName(event.item) === metric.customName)
      .flatMap((event) => pointFromValue(event, event.values?.value ?? event.value, event.values?.unit ?? event.unit, metric));
  }

  if (metric.fluidCheckKey) {
    return (hospitalization.fluids?.checks || []).flatMap((check) =>
      pointFromValue({ ...check, item: metric.shortLabel }, check[metric.fluidCheckKey], metric.unitDefault, metric),
    );
  }

  if (metric.id === 'pcv' || metric.id === 'ts') {
    return sourceEvents(hospitalization)
      .filter((event) => normalizeName(event.item) === 'pcv/ts' || normalizeName(event.category) === 'pcv/ts')
      .flatMap((event) => {
        const value = metric.id === 'pcv' ? event.values?.pcv ?? event.values?.value : event.values?.ts ?? event.values?.secondaryValue;
        const unit = metric.id === 'pcv' ? '%' : 'g/dL';
        return pointFromValue(event, value, unit, metric);
      });
  }

  if (metric.id === 'weight') {
    const tprWeights = (hospitalization.monitoringEntries || []).flatMap((entry) =>
      pointFromKey(entry, { key: 'bodyWeight', unit: 'kg' }, metric),
    );
    const rowWeights = sourceEvents(hospitalization)
      .filter((event) => normalizeName(event.item) === 'weight' || normalizeName(event.category) === 'weight')
      .flatMap((event) => pointFromValue(event, event.values?.value ?? event.value, event.values?.unit ?? event.unit ?? 'kg', metric));
    return [...tprWeights, ...rowWeights];
  }

  if (metric.itemNames) {
    const itemNames = new Set(metric.itemNames.map(normalizeName));
    return sourceEvents(hospitalization)
      .filter((event) => itemNames.has(normalizeName(event.item)) || itemNames.has(normalizeName(event.category)))
      .flatMap((event) => pointFromValue(event, event.values?.value ?? event.value, event.values?.unit ?? event.unit ?? metric.unitDefault, metric));
  }

  return (hospitalization.monitoringEntries || []).flatMap((entry) =>
    metric.keys.flatMap((keyDef) => pointFromKey(entry, keyDef, metric)),
  );
}

function pointFromKey(entry, keyDef, metric) {
  const value = entry.values?.[keyDef.key];
  const unit = keyDef.unit || unitFromEntry(entry, keyDef);
  return pointFromValue(entry, value, unit, metric);
}

function pointFromValue(source, value, unit, metric) {
  const numeric = numericValue(value);
  if (numeric === null || !source.actualAt) return [];
  return [{
    id: `${source.id || source.actualAt}-${metric.id}`,
    timestamp: source.actualAt,
    value: numeric,
    displayValue: String(value),
    unit: unit || '',
    notes: source.notes || '',
    sourceId: source.id || '',
    sourceType: source.category || source.item || '',
  }];
}

function getCustomNumericMetrics(hospitalization) {
  const groups = new Map();
  for (const event of sourceEvents(hospitalization)) {
    if (standardItemName(event.item) || standardItemName(event.category)) continue;
    const value = event.values?.value ?? event.value;
    const unit = event.values?.unit ?? event.unit ?? '';
    if (numericValue(value) === null) continue;
    const name = normalizeName(event.item);
    if (!name) continue;
    const key = `${name}|${unit}`;
    const existing = groups.get(key) || { count: 0, label: event.item, unit };
    groups.set(key, { ...existing, count: existing.count + 1 });
  }

  return [...groups.entries()].map(([key, group]) => {
    const [name] = key.split('|');
    return {
      id: `custom:${name}:${group.unit || 'unitless'}`,
      label: group.label,
      shortLabel: group.label,
      category: 'custom',
      customName: name,
      unitDefault: group.unit,
    };
  });
}

function sourceEvents(hospitalization) {
  return [
    ...(hospitalization.monitoringEntries || []),
    ...(hospitalization.customEvents || []).map((event) => ({
      ...event,
      values: { value: event.value, unit: event.unit },
    })),
  ];
}

function unitFromEntry(entry, keyDef) {
  if (keyDef.unitKey) {
    const unit = entry.values?.[keyDef.unitKey];
    if (unit && keyDef.unitPrefix && !String(unit).startsWith(keyDef.unitPrefix)) {
      return `${keyDef.unitPrefix}${unit}`;
    }
    return unit || keyDef.defaultUnit || '';
  }
  return keyDef.defaultUnit || '';
}

function numericValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function inRange(timestamp, range) {
  const time = new Date(timestamp);
  if (Number.isNaN(time.getTime())) return false;
  if (range?.start && time < range.start) return false;
  if (range?.end && time > range.end) return false;
  return true;
}

function trendReferenceEnd(hospitalization) {
  const candidates = [
    hospitalization.endedAt,
    ...(hospitalization.monitoringEntries || []).map((entry) => entry.actualAt),
    ...(hospitalization.customEvents || []).map((event) => event.actualAt),
    ...(hospitalization.fluids?.checks || []).map((check) => check.actualAt),
  ]
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => b - a);
  return candidates[0] || new Date();
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function standardItemName(value) {
  const normalized = normalizeName(value);
  return STANDARD_ITEM_NAMES.has(normalized) || TREND_METRICS.some((metric) => metric.itemNames?.map(normalizeName).includes(normalized));
}

function emptySeries(metric) {
  return { metric, points: [], range: { start: null, end: null }, unit: '', incompatibleUnits: 0, allPointCount: 0 };
}
