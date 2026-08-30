import {
  HANDOFF_DUE_SOON_MINUTES,
  HANDOFF_RECENT_EVENT_HOURS,
  HANDOFF_RECENT_VALUES_LIMIT,
  HANDOFF_UPCOMING_HOURS,
} from '../config/handoffConfig.js';
import { buildTimeline, occurrencesForRowInWindow, outstandingOccurrencesForRecord } from '../services/hospitalizationService.js';
import { formatBloodPressure, formatMonitoringValue, formatTemperature, hasMeaningfulValue } from './clinicalDisplay.js';
import { formatConcentration, formatMl, formatNumber } from './formatters.js';
import { getCellStatus, formatTime, sheetWindow } from './hospitalizationSchedule.js';
import { buildTrendSeries, getTrendMetricOptions } from './trends.js';
import { formatWeight } from './weight.js';

const HOUR_MS = 60 * 60 * 1000;

const RECENT_LAB_METRICS = ['bg', 'pcv', 'ts', 'lactate'];
const SNAPSHOT_METRICS = ['bg', 'pcv', 'ts', 'lactate'];
const EVENT_CATEGORIES = new Set([
  'Medication',
  'Fluids',
  'BG',
  'PCV/TS',
  'Lactate',
  'Blood pressure',
  'Urine output',
  'Drain output',
  'Feed',
  'Water',
  'Walk',
  'Vomiting',
  'Stool',
  'Urination',
  'Incision check',
  'Neuro check',
  'Oxygen setting',
  'Bloodwork',
  'Other',
  'Note',
]);
const IO_CATEGORIES = new Set(['Urine output', 'Drain output', 'Feed', 'Water', 'Vomiting', 'Stool', 'Urination']);

export function buildHandoffSnapshot({ patient, hospitalization, anesthesiaRecord = null, at = new Date() }) {
  if (!patient || !hospitalization) return null;
  const referenceTime = coerceDate(at);

  return {
    generatedAt: referenceTime.toISOString(),
    patient: buildPatientHeader(patient, hospitalization, referenceTime),
    currentSnapshot: buildCurrentSnapshot(hospitalization),
    activeFluids: buildActiveFluids(hospitalization),
    activeMedications: buildActiveMedications(hospitalization, referenceTime),
    upcomingCare: buildUpcomingCare(hospitalization, referenceTime),
    outstandingCare: buildOutstandingCare(hospitalization, referenceTime),
    recentEvents: buildRecentEvents(hospitalization, referenceTime),
    recentLabs: buildRecentLabs(hospitalization),
    intakeOutput: buildIntakeOutput(hospitalization, referenceTime),
    anesthesiaSummary: buildAnesthesiaSummary(anesthesiaRecord),
  };
}

export function buildPatientHeader(patient, hospitalization, at = new Date()) {
  return {
    name: patient.name,
    species: patient.species,
    weight: `${formatWeight(patient.weightKg)} kg / ${formatWeight(patient.weightLb)} lb`,
    age: patient.age || '',
    sexStatus: patient.sexStatus || '',
    reason: patient.reason || hospitalization.notes || '',
    startedAt: hospitalization.startedAt || '',
    hospitalDay: hospitalDay(hospitalization, at),
    location: hospitalization.location === 'Other' ? hospitalization.customLocation || 'Other' : hospitalization.location || '',
    veterinarian: hospitalization.veterinarian || '',
  };
}

export function buildCurrentSnapshot(hospitalization) {
  const latestTpr = latestEntry((hospitalization.monitoringEntries || []).filter((entry) => entry.category === 'TPR' || entry.item === 'TPR'));
  const tprValues = latestTpr?.values || {};
  const tprItems = latestTpr
    ? [
        labelValue('T', formatTemperature(tprValues)),
        labelValue('HR', tprValues.hr),
        labelValue('RR', tprValues.rr),
        labelValue('BP', formatBloodPressure(tprValues)),
        labelValue('SpO₂', tprValues.spo2 ? `${tprValues.spo2}%` : ''),
        labelValue('Pain', tprValues.painScore),
        labelValue('Mentation', tprValues.mentation),
        labelValue('Weight', tprValues.bodyWeight ? `${tprValues.bodyWeight} kg` : ''),
      ].filter(Boolean)
    : [];

  const metrics = SNAPSHOT_METRICS
    .map((metricId) => {
      const series = buildTrendSeries({ hospitalization, metricId });
      const point = series.points.at(-1);
      if (!point) return null;
      return {
        id: metricId,
        label: series.metric.shortLabel,
        timestamp: point.timestamp,
        value: formatPoint(point),
      };
    })
    .filter(Boolean);

  const customMetrics = getTrendMetricOptions(hospitalization)
    .filter((metric) => metric.category === 'custom')
    .map((metric) => {
      const point = buildTrendSeries({ hospitalization, metricId: metric.id }).points.at(-1);
      return point ? { id: metric.id, label: metric.shortLabel, timestamp: point.timestamp, value: formatPoint(point) } : null;
    })
    .filter(Boolean)
    .slice(0, 3);

  return {
    latestTpr: latestTpr ? { timestamp: latestTpr.actualAt, values: tprItems } : null,
    metrics: [...metrics, ...customMetrics],
  };
}

export function buildActiveFluids(hospitalization) {
  const plans = hospitalization.fluids?.plans || [];
  const activePlan = plans.find((plan) => plan.id === hospitalization.fluids?.activePlanId && plan.status === 'active')
    || [...plans].reverse().find((plan) => plan.status === 'active');
  if (!activePlan) return null;

  const latestCheck = latestEntry(hospitalization.fluids?.checks || []);
  return {
    fluid: fluidName(activePlan),
    rateMlHr: numberWithUnit(activePlan.rateMlHr, 'mL/hr'),
    rateMlKgHr: numberWithUnit(activePlan.rateMlKgHr, 'mL/kg/hr'),
    additives: (activePlan.additives || []).filter(Boolean),
    latestCheck: latestCheck
      ? {
          timestamp: latestCheck.actualAt,
          cumulativeMl: numberWithUnit(latestCheck.currentCumulativeMl, 'mL'),
          intervalMl: numberWithUnit(latestCheck.intervalMl, 'mL since prior'),
        }
      : null,
    hospitalizationTotalMl: numberWithUnit(hospitalization.fluids?.hospitalizationTotalMl, 'mL'),
  };
}

export function buildActiveMedications(hospitalization, now = new Date()) {
  return (hospitalization.treatmentSheet?.rows || [])
    .filter((row) => row.medicationId && !isDiscontinued(row, now))
    .map((row) => {
      const medication = (hospitalization.medications || []).find((item) => item.id === row.medicationId);
      if (!medication) return null;
      return {
        id: medication.id,
        rowId: row.id,
        drug: medication.drugName,
        dose: `${formatNumber(medication.dose, { maximumFractionDigits: 3 })} ${displayUnit(medication.doseUnit)}`,
        concentration: formatConcentration(medication.concentration, medication.concentrationUnit),
        volume: medication.volumeMl ? `${formatMl(medication.volumeMl)} mL` : '',
        route: medication.route === 'Other' ? medication.customRoute || 'Other' : medication.route,
        schedule: scheduleLabel(row.schedule),
        nextDue: row.type === 'PRN' ? '' : nextDueForRow(hospitalization, row, now),
        prn: row.type === 'PRN',
      };
    })
    .filter(Boolean);
}

export function buildUpcomingCare(hospitalization, now = new Date(), hours = HANDOFF_UPCOMING_HOURS) {
  const start = coerceDate(now);
  const end = new Date(start.getTime() + hours * HOUR_MS);
  const documented = documentedEntries(hospitalization);
  return (hospitalization.treatmentSheet?.rows || [])
    .flatMap((row) => occurrencesForRowInWindow(row, start, end).map((occurrence) => ({ ...occurrence, row })))
    .filter((occurrence) => !documented.some((entry) => entry.occurrenceKey === occurrence.key))
    .filter((occurrence) => !['skipped', 'held'].includes(occurrence.statusOverride))
    .filter((occurrence) => !isDiscontinued(occurrence.row, occurrence.scheduledAt))
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
    .map((occurrence) => occurrenceSummary(occurrence, start));
}

export function buildOutstandingCare(hospitalization, now = new Date()) {
  const reference = coerceDate(now);
  const documented = documentedEntries(hospitalization);
  const { start } = sheetWindow(hospitalization.sheetDate);
  const currentDue = (hospitalization.treatmentSheet?.rows || [])
    .flatMap((row) => occurrencesForRowInWindow(row, start, reference).map((occurrence) => ({ ...occurrence, row })))
    .filter((occurrence) => !documented.some((entry) => entry.occurrenceKey === occurrence.key))
    .filter((occurrence) => !['skipped'].includes(occurrence.statusOverride))
    .filter((occurrence) => !isDiscontinued(occurrence.row, occurrence.scheduledAt))
    .map((occurrence) => {
      const status = getCellStatus({ occurrence, entries: documented, row: occurrence.row, now: reference });
      return { ...occurrence, status };
    })
    .filter((occurrence) => ['overdue', 'due', 'held'].includes(occurrence.status));

  return [...outstandingOccurrencesForRecord(hospitalization), ...currentDue]
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
    .map((occurrence) => ({
      time: occurrence.scheduledAt,
      label: occurrence.row?.name || 'Treatment',
      status: occurrence.status || occurrence.statusOverride || 'overdue',
      detail: `${formatTime(occurrence.scheduledAt)} ${occurrence.row?.name || 'Treatment'} not documented`,
    }));
}

export function buildRecentEvents(hospitalization, now = new Date(), hours = HANDOFF_RECENT_EVENT_HOURS) {
  const start = new Date(coerceDate(now).getTime() - hours * HOUR_MS);
  return buildTimeline(hospitalization)
    .filter((event) => {
      const time = new Date(event.timestamp);
      return time >= start && time <= coerceDate(now);
    })
    .filter((event) => EVENT_CATEGORIES.has(event.category))
    .filter((event) => event.status !== 'ordered')
    .slice(-12);
}

export function buildRecentLabs(hospitalization, limit = HANDOFF_RECENT_VALUES_LIMIT) {
  const metrics = getTrendMetricOptions(hospitalization)
    .filter((metric) => RECENT_LAB_METRICS.includes(metric.id) || metric.category === 'custom')
    .map((metric) => {
      const points = buildTrendSeries({ hospitalization, metricId: metric.id }).points.slice(-limit).reverse();
      return points.length ? { id: metric.id, label: metric.shortLabel, points: points.map((point) => ({ ...point, formatted: formatPoint(point) })) } : null;
    })
    .filter(Boolean);

  return metrics;
}

export function buildIntakeOutput(hospitalization, now = new Date(), hours = HANDOFF_RECENT_EVENT_HOURS) {
  const start = new Date(coerceDate(now).getTime() - hours * HOUR_MS);
  const rows = [
    ...(hospitalization.monitoringEntries || []),
    ...(hospitalization.customEvents || []).map((event) => ({ ...event, values: { value: event.value, unit: event.unit } })),
  ]
    .filter((entry) => IO_CATEGORIES.has(entry.category) || IO_CATEGORIES.has(entry.item))
    .filter((entry) => {
      const time = new Date(entry.actualAt);
      return time >= start && time <= coerceDate(now);
    })
    .map((entry) => ({
      id: entry.id,
      time: entry.actualAt,
      label: entry.item || entry.category,
      value: formatMonitoringValue(entry) || [entry.value, entry.unit].filter(Boolean).join(' '),
      notes: entry.notes || '',
    }));

  return rows.sort((a, b) => new Date(a.time) - new Date(b.time));
}

export function buildAnesthesiaSummary(record) {
  if (!record) return null;
  const monitoring = record.monitoring || {};
  const recoveryStatus = monitoring.recoveryStatus === 'Other' ? monitoring.recoveryCustomStatus : monitoring.recoveryStatus;
  const items = [
    labelValue('Procedure', record.procedure),
    labelValue('Anesthesia completed', record.completedAt ? formatTime(record.completedAt) : ''),
    labelValue('Procedure end', monitoring.procedureEndAt ? formatTime(monitoring.procedureEndAt) : ''),
    labelValue('Extubated', monitoring.extubationAt ? formatTime(monitoring.extubationAt) : ''),
    labelValue('Recovery', recoveryStatus),
  ].filter(Boolean);
  return items.length ? { items, recordId: record.id } : null;
}

export function buildHandoffText({ patient, handoff, snapshot }) {
  if (!snapshot) return '';
  const lines = [
    `${snapshot.patient.name?.toUpperCase()} — ${snapshot.patient.species} — ${snapshot.patient.weight}`,
    [`Hospital Day ${snapshot.patient.hospitalDay}`, snapshot.patient.reason].filter(Boolean).join(' — '),
    '',
  ];

  addTextSection(lines, 'LATEST', [
    snapshot.currentSnapshot.latestTpr?.values.map((item) => `${item.label} ${item.value}`).join(' | '),
    ...snapshot.currentSnapshot.metrics.map((item) => `${item.label} ${item.value} at ${formatTime(item.timestamp)}`),
  ]);

  addTextSection(lines, 'FLUIDS', snapshot.activeFluids ? [
    `${[snapshot.activeFluids.fluid, ...snapshot.activeFluids.additives].filter(Boolean).join(' + ')}${snapshot.activeFluids.rateMlHr ? ` @ ${snapshot.activeFluids.rateMlHr}` : ''}`,
    snapshot.activeFluids.latestCheck ? `Last check ${formatTime(snapshot.activeFluids.latestCheck.timestamp)} — ${snapshot.activeFluids.latestCheck.cumulativeMl}` : '',
  ] : []);

  addTextSection(lines, 'MEDICATIONS', snapshot.activeMedications.map((med) =>
    `${med.drug}${med.concentration ? ` · ${med.concentration}` : ''}${med.volume ? ` · ${med.volume}` : ''}${med.route ? ` ${med.route}` : ''}${med.schedule ? ` ${med.schedule}` : ''}${med.nextDue ? ` — next ${formatTime(med.nextDue)}` : ''}`,
  ));

  addTextSection(lines, 'UPCOMING', snapshot.upcomingCare.slice(0, 8).map((item) => `${formatTime(item.time)} — ${item.label}`));
  addTextSection(lines, 'OUTSTANDING', snapshot.outstandingCare.slice(0, 8).map((item) => item.detail));
  addTextSection(lines, 'RECENT LABS', snapshot.recentLabs.flatMap((metric) => metric.points.map((point) => `${metric.label} ${point.formatted} at ${formatTime(point.timestamp)}`)));
  addTextSection(lines, 'NOTES', handoff.notes ? handoff.notes.split('\n') : []);
  addTextSection(lines, 'FOLLOW-UP', (handoff.followUpItems || []).filter((item) => !item.completed).map((item) => item.text));

  return lines.filter((line, index, source) => line !== '' || source[index - 1] !== '').join('\n').trim();
}

function addTextSection(lines, title, values) {
  const content = values.filter(hasMeaningfulValue);
  if (!content.length) return;
  lines.push(title, ...content, '');
}

function buildTreatmentOccurrenceLabel(row) {
  return row?.name || 'Treatment';
}

function occurrenceSummary(occurrence, now) {
  const diffMinutes = (new Date(occurrence.scheduledAt).getTime() - now.getTime()) / 60000;
  return {
    time: occurrence.scheduledAt,
    label: buildTreatmentOccurrenceLabel(occurrence.row),
    status: diffMinutes <= HANDOFF_DUE_SOON_MINUTES ? 'due soon' : 'upcoming',
  };
}

function nextDueForRow(hospitalization, row, now) {
  return buildUpcomingCare({ ...hospitalization, treatmentSheet: { rows: [row] } }, now, HANDOFF_UPCOMING_HOURS * 2)[0]?.time || '';
}

function documentedEntries(hospitalization) {
  return [
    ...(hospitalization.medicationAdministrations || []),
    ...(hospitalization.monitoringEntries || []),
    ...(hospitalization.fluids?.checks || []),
  ];
}

function latestEntry(entries) {
  return [...entries].filter((entry) => entry.actualAt).sort((a, b) => new Date(a.actualAt) - new Date(b.actualAt)).at(-1) || null;
}

function labelValue(label, value) {
  return hasMeaningfulValue(value) ? { label, value } : null;
}

function formatPoint(point) {
  return `${formatNumber(point.value, { maximumFractionDigits: 2 })}${point.unit ? ` ${point.unit}` : ''}`;
}

function numberWithUnit(value, unit) {
  return hasMeaningfulValue(value) ? `${formatNumber(value, { maximumFractionDigits: 2 })} ${unit}` : '';
}

function fluidName(plan) {
  return plan.fluidType === 'Other' ? plan.customType || 'Other fluids' : plan.fluidType || 'Fluids';
}

function scheduleLabel(schedule) {
  if (!schedule) return '';
  if (schedule.type === 'prn') return 'PRN';
  if (schedule.type === 'specificTimes') return `Specific: ${(schedule.times || []).join(', ')}`;
  if (schedule.type === 'once') return 'Once';
  return schedule.intervalHours ? `q${schedule.intervalHours}h` : '';
}

function isDiscontinued(row, at = new Date()) {
  return row.discontinuedAt && new Date(row.discontinuedAt) <= coerceDate(at);
}

function coerceDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function hospitalDay(hospitalization, at) {
  const started = coerceDate(hospitalization.startedAt);
  const end = coerceDate(at);
  return Math.max(1, Math.floor((end - started) / (24 * HOUR_MS)) + 1);
}

function displayUnit(unit) {
  return String(unit || '').replace('ug', 'µg');
}
