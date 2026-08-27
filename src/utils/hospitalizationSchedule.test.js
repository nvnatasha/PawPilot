import { describe, expect, it } from 'vitest';
import {
  generateOccurrencesForSchedule,
  generateOccurrencesForScheduleWindow,
  generateSheetHours,
  getCellStatus,
  getOccurrenceKey,
  getSheetDateForTimestamp,
  buildSchedule,
  sheetWindow,
} from './hospitalizationSchedule.js';

describe('hospitalization schedule utilities', () => {
  it('generates exactly 24 hourly columns from 8 AM through 7 AM', () => {
    const hours = generateSheetHours('2026-08-26');

    expect(hours).toHaveLength(24);
    expect(hours[0]).toMatchObject({ time: '08:00', label: '8a', shift: 'Day' });
    expect(hours[11]).toMatchObject({ time: '19:00', label: '7p', shift: 'Day' });
    expect(hours[12]).toMatchObject({ time: '20:00', label: '8p', shift: 'Night' });
    expect(hours[23]).toMatchObject({ time: '07:00', label: '7a', shift: 'Night' });
  });

  it.each([
    [1, 24],
    [2, 12],
    [4, 6],
    [6, 4],
    [8, 3],
    [12, 2],
  ])('generates q%ih scheduling', (intervalHours, count) => {
    const occurrences = generateOccurrencesForSchedule(
      { type: 'interval', firstDueTime: '08:00', intervalHours },
      '2026-08-26',
      'row-1',
    );

    expect(occurrences).toHaveLength(count);
  });

  it('supports once and specific-time schedules with midnight rollover', () => {
    expect(
      generateOccurrencesForSchedule(
        { type: 'once', firstDueTime: '23:00' },
        '2026-08-26',
        'row-1',
      ),
    ).toHaveLength(1);

    const specific = generateOccurrencesForSchedule(
      { type: 'specificTimes', times: ['08:00', '14:00', '00:00', '04:00'] },
      '2026-08-26',
      'row-1',
    );

    expect(specific.map((item) => item.hourIndex)).toEqual([0, 6, 16, 20]);
  });

  it('assigns early morning timestamps to the prior 8 AM sheet', () => {
    expect(getSheetDateForTimestamp('2026-08-27T03:00:00')).toBe('2026-08-26');
    expect(getSheetDateForTimestamp('2026-08-27T07:59:00')).toBe('2026-08-26');
    expect(getSheetDateForTimestamp('2026-08-27T08:00:00')).toBe('2026-08-27');
    expect(getSheetDateForTimestamp('2026-08-27T09:00:00')).toBe('2026-08-27');
  });

  it('continues interval schedules across sheet boundaries', () => {
    const { start, end } = sheetWindow('2026-08-27');
    const occurrences = generateOccurrencesForScheduleWindow(
      { type: 'interval', firstDueAt: '2026-08-26T23:00:00', intervalHours: 8 },
      start,
      end,
      'row-1',
    );

    expect(occurrences.map((item) => item.hourIndex)).toEqual([7, 15, 23]);
  });

  it('repeats specific daily times on each sheet day', () => {
    const occurrences = generateOccurrencesForSchedule(
      { type: 'specificTimes', times: ['09:00', '21:00'] },
      '2026-08-27',
      'row-1',
    );

    expect(occurrences.map((item) => item.hourIndex)).toEqual([1, 13]);
  });

  it('does not repeat one-time or PRN schedules automatically', () => {
    expect(
      generateOccurrencesForSchedule(
        { type: 'once', firstDueAt: '2026-08-26T10:00:00', firstDueTime: '10:00' },
        '2026-08-27',
        'row-1',
      ),
    ).toHaveLength(0);

    expect(buildSchedule({ scheduleMode: 'prn' })).toEqual({ type: 'prn' });
    expect(generateOccurrencesForSchedule({ type: 'prn' }, '2026-08-27', 'row-1')).toHaveLength(0);
  });

  it('resolves completed, held, and discontinued status from historical entries', () => {
    const occurrence = generateOccurrencesForSchedule(
      { type: 'once', firstDueTime: '08:00' },
      '2026-08-26',
      'row-1',
    )[0];

    expect(
      getCellStatus({
        occurrence,
        entries: [{ occurrenceKey: occurrence.key, status: 'completed' }],
        row: { id: 'row-1' },
      }),
    ).toBe('completed');

    expect(
      getCellStatus({
        occurrence,
        entries: [{ occurrenceKey: occurrence.key, status: 'held' }],
        row: { id: 'row-1' },
      }),
    ).toBe('held');

    expect(
      getCellStatus({
        occurrence,
        entries: [],
        row: { id: 'row-1', discontinuedAt: '2026-08-26T09:00:00.000Z' },
      }),
    ).toBe('discontinued');

    expect(getOccurrenceKey('row-1', occurrence.scheduledAt)).toBe(occurrence.key);
  });

  it('resolves skipped status from occurrence overrides', () => {
    const occurrence = generateOccurrencesForSchedule(
      { type: 'once', firstDueTime: '08:00' },
      '2026-08-26',
      'row-1',
    )[0];

    expect(
      getCellStatus({
        occurrence: { ...occurrence, statusOverride: 'skipped' },
        entries: [],
        row: { id: 'row-1' },
      }),
    ).toBe('skipped');
  });
});
