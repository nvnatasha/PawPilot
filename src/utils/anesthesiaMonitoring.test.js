import { describe, expect, it } from 'vitest';
import {
  cleanMonitoringEntry,
  entryForPoint,
  generateMonitoringTimes,
  getMonitoringDisplayPoints,
  getUsedMonitoringFields,
  hasMeaningfulMonitoringValue,
  latestMonitoringSummary,
  monitoringEntryHasData,
} from './anesthesiaMonitoring.js';

describe('anesthesia monitoring utilities', () => {
  it.each([
    [5, ['10:00 AM', '10:05 AM', '10:10 AM']],
    [10, ['10:00 AM', '10:10 AM', '10:20 AM']],
    [15, ['10:00 AM', '10:15 AM', '10:30 AM']],
    [7, ['10:00 AM', '10:07 AM', '10:14 AM']],
  ])('generates q%i minute monitoring intervals from the start time', (intervalMinutes, labels) => {
    const points = generateMonitoringTimes({
      startedAt: '2026-08-26T10:00:00',
      intervalMinutes,
      minPoints: 3,
    });

    expect(points.slice(0, 3).map((point) => new Date(point.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))).toEqual(labels);
  });

  it('includes additional monitoring points without snapping them to the interval', () => {
    const points = generateMonitoringTimes({
      startedAt: '2026-08-26T10:00:00',
      intervalMinutes: 5,
      minPoints: 3,
      extraPoints: ['2026-08-26T10:17:00'],
    });

    expect(points.map((point) => new Date(point.timestamp).getMinutes())).toContain(17);
    expect(points.find((point) => new Date(point.timestamp).getMinutes() === 17)).toMatchObject({
      scheduled: false,
    });
  });

  it('handles midnight crossover', () => {
    const points = generateMonitoringTimes({
      startedAt: '2026-08-26T23:50:00',
      intervalMinutes: 10,
      minPoints: 3,
    });

    expect(points.map((point) => new Date(point.timestamp).getDate())).toEqual([26, 27, 27]);
  });

  it('maps entries to scheduled monitoring columns while preserving actual time', () => {
    const points = generateMonitoringTimes({
      startedAt: '2026-08-26T10:00:00',
      intervalMinutes: 5,
      minPoints: 4,
    });
    const entry = {
      scheduledAt: points[3].timestamp,
      timestamp: '2026-08-26T10:17:00',
      hr: '98',
    };

    expect(entryForPoint([entry], points[3])).toBe(entry);
  });

  it.each([
    [5, [0, 5, 10, 15]],
    [10, [0, 10, 20, 30]],
    [15, [0, 15, 30, 45]],
    [7, [0, 7, 14, 21]],
  ])('generates upcoming q%i scheduled display slots for active monitoring', (intervalMinutes, minuteOffsets) => {
    const start = new Date('2026-08-26T10:00:00');
    const points = getMonitoringDisplayPoints({
      monitoringStart: start.toISOString(),
      intervalMinutes,
      minimumVisibleScheduledPoints: 12,
    });

    expect(points).toHaveLength(12);
    expect(points.slice(0, 4).map((point) => (new Date(point.timestamp) - start) / 60000)).toEqual(minuteOffsets);
    expect(points.every((point) => point.scheduled)).toBe(true);
  });

  it('extends active display slots beyond the latest documented scheduled point', () => {
    const start = new Date('2026-08-26T10:00:00');
    const entries = [0, 5, 10, 15, 20, 25].map((minutes) => ({
      scheduledAt: new Date(start.getTime() + minutes * 60000).toISOString(),
      timestamp: new Date(start.getTime() + minutes * 60000).toISOString(),
      hr: '100',
    }));
    const points = getMonitoringDisplayPoints({
      monitoringStart: start.toISOString(),
      intervalMinutes: 5,
      documentedEntries: entries,
    });

    expect(points).toHaveLength(12);
    expect(points.at(-1).timestamp).toBe(new Date(start.getTime() + 55 * 60000).toISOString());
    expect(points.filter((point) => point.upcoming)).toHaveLength(6);
  });

  it('merges documented, upcoming, and extra monitoring points chronologically', () => {
    const start = new Date('2026-08-26T10:00:00');
    const extra = new Date(start.getTime() + 19 * 60000).toISOString();
    const points = getMonitoringDisplayPoints({
      monitoringStart: start.toISOString(),
      intervalMinutes: 5,
      documentedEntries: [{ scheduledAt: new Date(start.getTime() + 10 * 60000).toISOString(), timestamp: new Date(start.getTime() + 12 * 60000).toISOString(), hr: '98' }],
      extraPoints: [extra],
      minimumVisibleScheduledPoints: 6,
    });

    expect(points.map((point) => (new Date(point.timestamp) - start) / 60000)).toEqual([0, 5, 10, 15, 19, 20, 25]);
    expect(points.find((point) => point.timestamp === extra)).toMatchObject({ scheduled: false });
  });

  it('stops future placeholders when monitoring is ended or completed', () => {
    const start = new Date('2026-08-26T10:00:00');
    const end = new Date(start.getTime() + 20 * 60000).toISOString();

    expect(getMonitoringDisplayPoints({
      monitoringStart: start.toISOString(),
      monitoringEnd: end,
      intervalMinutes: 5,
    })).toHaveLength(5);

    expect(getMonitoringDisplayPoints({
      monitoringStart: start.toISOString(),
      intervalMinutes: 5,
      documentedEntries: [{ scheduledAt: new Date(start.getTime() + 10 * 60000).toISOString(), timestamp: new Date(start.getTime() + 10 * 60000).toISOString(), hr: '100' }],
      completed: true,
    })).toEqual([
      { timestamp: start.toISOString(), scheduled: true },
      { timestamp: new Date(start.getTime() + 5 * 60000).toISOString(), scheduled: true },
      { timestamp: new Date(start.getTime() + 10 * 60000).toISOString(), scheduled: true },
    ]);
  });

  it('cleans partial entries and preserves numeric zero', () => {
    const cleaned = cleanMonitoringEntry({ hr: '110', rr: '', map: 0, notes: '  stable  ' });

    expect(cleaned).toEqual({ hr: '110', map: 0, notes: 'stable' });
    expect(monitoringEntryHasData(cleaned)).toBe(true);
    expect(hasMeaningfulMonitoringValue(0)).toBe(true);
  });

  it('omits unused optional rows unless enabled or documented', () => {
    expect(getUsedMonitoringFields([{ hr: '100' }], []).map((field) => field.key)).not.toContain('peep');
    expect(getUsedMonitoringFields([{ hr: '100', peep: 0 }], []).map((field) => field.key)).toContain('peep');
    expect(getUsedMonitoringFields([], ['tidalVolume']).map((field) => field.key)).toContain('tidalVolume');
  });

  it('builds latest summary from documented values only', () => {
    const summary = latestMonitoringSummary([
      { timestamp: '2026-08-26T10:00:00', hr: '110' },
      { timestamp: '2026-08-26T10:05:00', spo2: '99', etco2: '' },
    ]);

    expect(summary.values).toEqual([{ label: 'SpO₂', value: '99', key: 'spo2' }]);
  });
});
