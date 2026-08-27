import { describe, expect, it } from 'vitest';
import {
  buildTrendSeries,
  getTrendMetricOptions,
  summarizeSeries,
  trendSeriesToCsv,
} from './trends.js';

function record(overrides = {}) {
  return {
    id: 'hosp-1',
    patientId: 'patient-1',
    sheetDate: '2026-08-26',
    startedAt: '2026-08-26T12:00:00.000Z',
    endedAt: '',
    monitoringEntries: [],
    customEvents: [],
    fluids: { checks: [], events: [], boluses: [] },
    ...overrides,
  };
}

function monitoring(id, item, actualAt, values, notes = '') {
  return {
    id,
    item,
    category: item,
    scheduledAt: '2026-08-26T20:00:00.000Z',
    actualAt,
    values,
    notes,
  };
}

describe('trend utilities', () => {
  it('extracts BG chronologically using actual timestamps instead of scheduled timestamps', () => {
    const series = buildTrendSeries({
      hospitalization: record({
        monitoringEntries: [
          monitoring('bg-2', 'BG', '2026-08-27T03:02:00.000Z', { bg: '82', bgUnit: 'mg/dL' }),
          monitoring('bg-1', 'BG', '2026-08-27T01:04:00.000Z', { bg: '91', bgUnit: 'mg/dL' }),
        ],
      }),
      metricId: 'bg',
    });

    expect(series.points.map((point) => point.value)).toEqual([91, 82]);
    expect(series.points[0].timestamp).toBe('2026-08-27T01:04:00.000Z');
  });

  it('extracts vitals and blood pressure values', () => {
    const hospitalization = record({
      monitoringEntries: [
        monitoring('tpr-1', 'TPR', '2026-08-26T18:00:00.000Z', {
          temperature: '101.2',
          temperatureUnit: 'F',
          hr: 104,
          rr: '28',
          meanBp: 76,
          spo2: 99,
        }),
      ],
    });

    expect(buildTrendSeries({ hospitalization, metricId: 'temperature' }).points[0]).toMatchObject({ value: 101.2, unit: '°F' });
    expect(buildTrendSeries({ hospitalization, metricId: 'hr' }).points[0].value).toBe(104);
    expect(buildTrendSeries({ hospitalization, metricId: 'rr' }).points[0].value).toBe(28);
    expect(buildTrendSeries({ hospitalization, metricId: 'map' }).points[0].value).toBe(76);
    expect(buildTrendSeries({ hospitalization, metricId: 'spo2' }).points[0].value).toBe(99);
  });

  it('extracts PCV, TS, lactate, weight, and output values', () => {
    const hospitalization = record({
      monitoringEntries: [
        monitoring('pcv-1', 'PCV/TS', '2026-08-26T18:10:00.000Z', { value: '34', secondaryValue: '6.2' }),
        monitoring('lac-1', 'Lactate', '2026-08-26T18:20:00.000Z', { value: '2.4', unit: 'mmol/L' }),
        monitoring('weight-1', 'Weight', '2026-08-26T18:30:00.000Z', { value: '22.1', unit: 'kg' }),
        monitoring('urine-1', 'Urine output', '2026-08-26T18:40:00.000Z', { value: '12', unit: 'mL' }),
        monitoring('drain-1', 'Drain output', '2026-08-26T18:50:00.000Z', { value: '5', unit: 'mL' }),
      ],
    });

    expect(buildTrendSeries({ hospitalization, metricId: 'pcv' }).points[0]).toMatchObject({ value: 34, unit: '%' });
    expect(buildTrendSeries({ hospitalization, metricId: 'ts' }).points[0]).toMatchObject({ value: 6.2, unit: 'g/dL' });
    expect(buildTrendSeries({ hospitalization, metricId: 'lactate' }).points[0].value).toBe(2.4);
    expect(buildTrendSeries({ hospitalization, metricId: 'weight' }).points[0].value).toBe(22.1);
    expect(buildTrendSeries({ hospitalization, metricId: 'urineOutput' }).points[0].value).toBe(12);
    expect(buildTrendSeries({ hospitalization, metricId: 'drainOutput' }).points[0].value).toBe(5);
  });

  it('keeps values continuous across midnight and 8 AM sheet boundaries', () => {
    const series = buildTrendSeries({
      hospitalization: record({
        sheetDate: '2026-08-27',
        monitoringEntries: [
          monitoring('bg-1', 'BG', '2026-08-26T23:55:00.000Z', { bg: '91', bgUnit: 'mg/dL' }),
          monitoring('bg-2', 'BG', '2026-08-27T08:10:00.000Z', { bg: '82', bgUnit: 'mg/dL' }),
        ],
      }),
      metricId: 'bg',
      rangeId: 'entire',
    });

    expect(series.points.map((point) => point.value)).toEqual([91, 82]);
  });

  it('applies current sheet, last 12, last 24, entire, and custom filters', () => {
    const hospitalization = record({
      sheetDate: '2026-08-27',
      startedAt: '2026-08-26T12:00:00.000Z',
      endedAt: '2026-08-27T20:00:00.000Z',
      monitoringEntries: [
        monitoring('bg-1', 'BG', '2026-08-26T16:00:00.000Z', { bg: '101', bgUnit: 'mg/dL' }),
        monitoring('bg-2', 'BG', '2026-08-27T14:00:00.000Z', { bg: '91', bgUnit: 'mg/dL' }),
        monitoring('bg-3', 'BG', '2026-08-27T19:00:00.000Z', { bg: '82', bgUnit: 'mg/dL' }),
      ],
    });

    expect(buildTrendSeries({ hospitalization, metricId: 'bg', rangeId: 'currentSheet' }).points.map((point) => point.value)).toEqual([91, 82]);
    expect(buildTrendSeries({ hospitalization, metricId: 'bg', rangeId: 'last12' }).points.map((point) => point.value)).toEqual([91, 82]);
    expect(buildTrendSeries({ hospitalization, metricId: 'bg', rangeId: 'last24' }).points.map((point) => point.value)).toEqual([91, 82]);
    expect(buildTrendSeries({ hospitalization, metricId: 'bg', rangeId: 'entire' }).points.map((point) => point.value)).toEqual([101, 91, 82]);
    expect(buildTrendSeries({
      hospitalization,
      metricId: 'bg',
      rangeId: 'custom',
      customStart: '2026-08-27T18:00:00.000Z',
      customEnd: '2026-08-27T20:00:00.000Z',
    }).points.map((point) => point.value)).toEqual([82]);
  });

  it('handles empty, one-point, several-point summaries, mixed units, and zero values', () => {
    const hospitalization = record({
      monitoringEntries: [
        monitoring('temp-1', 'TPR', '2026-08-26T18:00:00.000Z', { temperature: 0, temperatureUnit: 'F' }),
        monitoring('temp-2', 'TPR', '2026-08-26T19:00:00.000Z', { temperature: 38.1, temperatureUnit: 'C' }),
      ],
    });
    const empty = buildTrendSeries({ hospitalization, metricId: 'bg' });
    const mixed = buildTrendSeries({ hospitalization, metricId: 'temperature' });

    expect(summarizeSeries(empty)).toMatchObject({ latest: null, previous: null, count: 0 });
    expect(mixed.points).toHaveLength(1);
    expect(mixed.points[0].value).toBe(0);
    expect(mixed.incompatibleUnits).toBe(1);
  });

  it('creates separate custom numeric metrics and ignores text-only custom values', () => {
    const hospitalization = record({
      monitoringEntries: [
        monitoring('girth-1', 'Abdominal girth', '2026-08-26T18:00:00.000Z', { value: '64', unit: 'cm' }),
        monitoring('girth-2', 'Abdominal girth', '2026-08-26T19:00:00.000Z', { value: '66', unit: 'cm' }),
        monitoring('mentation-1', 'Mentation note', '2026-08-26T20:00:00.000Z', { value: 'quiet', unit: '' }),
        monitoring('wound-1', 'Wound size', '2026-08-26T21:00:00.000Z', { value: '2', unit: 'cm' }),
      ],
    });
    const options = getTrendMetricOptions(hospitalization);
    const girthMetric = options.find((metric) => metric.label === 'Abdominal girth');

    expect(girthMetric).toBeTruthy();
    expect(options.find((metric) => metric.label === 'Mentation note')).toBeFalsy();
    expect(buildTrendSeries({ hospitalization, metricId: girthMetric.id }).points.map((point) => point.value)).toEqual([64, 66]);
    expect(options.find((metric) => metric.label === 'Wound size')).toBeTruthy();
  });

  it('derives trends from source records without separate persistence and reflects edits', () => {
    const hospitalization = record({
      monitoringEntries: [monitoring('bg-1', 'BG', '2026-08-26T18:00:00.000Z', { bg: '91', bgUnit: 'mg/dL' })],
    });
    const edited = {
      ...hospitalization,
      monitoringEntries: hospitalization.monitoringEntries.map((entry) => ({ ...entry, values: { ...entry.values, bg: '82' } })),
    };

    expect(buildTrendSeries({ hospitalization, metricId: 'bg' }).points[0].value).toBe(91);
    expect(buildTrendSeries({ hospitalization: edited, metricId: 'bg' }).points[0].value).toBe(82);
    expect(hospitalization.trends).toBeUndefined();
  });

  it('exports trend CSV with escaped notes', () => {
    const series = buildTrendSeries({
      hospitalization: record({
        monitoringEntries: [monitoring('bg-1', 'BG', '2026-08-26T18:00:00.000Z', { bg: '91', bgUnit: 'mg/dL' }, 'Ate, small meal')],
      }),
      metricId: 'bg',
    });

    expect(trendSeriesToCsv(series)).toContain('Timestamp,Metric,Value,Unit,Notes');
    expect(trendSeriesToCsv(series)).toContain('2026-08-26T18:00:00.000Z,BG,91,mg/dL,"Ate, small meal"');
  });
});
