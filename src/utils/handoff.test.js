import { describe, expect, it } from 'vitest';
import { createMedication, createTreatmentRow, documentTreatment } from '../services/hospitalizationService.js';
import {
  buildActiveFluids,
  buildActiveMedications,
  buildCurrentSnapshot,
  buildHandoffSnapshot,
  buildHandoffText,
  buildOutstandingCare,
  buildRecentEvents,
  buildRecentLabs,
  buildUpcomingCare,
} from './handoff.js';

function patient() {
  return {
    id: 'patient-1',
    name: 'Bella',
    species: 'Canine',
    weightKg: 22.4,
    weightLb: 49.4,
    age: '7y',
    sexStatus: 'FS',
    reason: 'Pancreatitis',
  };
}

function hospitalization(overrides = {}) {
  return {
    id: 'hosp-1',
    patientId: 'patient-1',
    status: 'active',
    sheetDate: '2026-08-26',
    startedAt: '2026-08-26T13:00:00.000Z',
    endedAt: '',
    veterinarian: 'Dr. Smith',
    location: 'ICU',
    customLocation: '',
    treatmentSheet: { rows: [] },
    medications: [],
    medicationAdministrations: [],
    monitoringEntries: [],
    fluids: {
      plans: [],
      checks: [],
      events: [],
      boluses: [],
      activePlanId: '',
      hospitalizationTotalMl: 0,
    },
    customEvents: [],
    ...overrides,
  };
}

function monitoring(id, item, actualAt, values = {}, notes = '') {
  return {
    id,
    item,
    category: item,
    scheduledAt: '2026-08-26T20:00:00.000Z',
    actualAt,
    values,
    notes,
    status: 'completed',
  };
}

describe('handoff utilities', () => {
  it('selects latest TPR, BG, and PCV/TS values using actual timestamps', () => {
    const record = hospitalization({
      monitoringEntries: [
        monitoring('tpr-1', 'TPR', '2026-08-26T18:00:00.000Z', { temperature: '100.1', temperatureUnit: 'F', hr: 100 }),
        monitoring('tpr-2', 'TPR', '2026-08-26T22:00:00.000Z', { temperature: '100.4', temperatureUnit: 'F', hr: 104, rr: 22, meanBp: 76, spo2: 99 }),
        monitoring('bg-1', 'BG', '2026-08-26T20:07:00.000Z', { bg: '91', bgUnit: 'mg/dL' }),
        monitoring('bg-2', 'BG', '2026-08-26T23:07:00.000Z', { bg: '82', bgUnit: 'mg/dL' }),
        monitoring('pcv-1', 'PCV/TS', '2026-08-26T21:07:00.000Z', { value: '34', secondaryValue: '6.2' }),
      ],
    });

    const snapshot = buildCurrentSnapshot(record);

    expect(snapshot.latestTpr.values.map((item) => `${item.label} ${item.value}`)).toContain('T 100.4°F');
    expect(snapshot.metrics.find((item) => item.label === 'BG')).toMatchObject({ value: '82 mg/dL' });
    expect(snapshot.metrics.find((item) => item.label === 'PCV')).toMatchObject({ value: '34 %' });
    expect(snapshot.metrics.find((item) => item.label === 'TS')).toMatchObject({ value: '6.2 g/dL' });
  });

  it('builds active fluids from the active plan and most recent fluid check', () => {
    const record = hospitalization({
      fluids: {
        activePlanId: 'plan-1',
        plans: [
          { id: 'old-plan', fluidType: 'LRS', rateMlHr: 20, rateMlKgHr: 1, status: 'discontinued', additives: [] },
          { id: 'plan-1', fluidType: 'Normosol-R', rateMlHr: 60, rateMlKgHr: 2.68, status: 'active', additives: ['20 mEq KCl/L'] },
        ],
        checks: [
          { id: 'check-1', actualAt: '2026-08-26T18:00:00.000Z', currentCumulativeMl: 500, intervalMl: 100 },
          { id: 'check-2', actualAt: '2026-08-26T23:00:00.000Z', currentCumulativeMl: 842, intervalMl: 120 },
        ],
        events: [],
        boluses: [],
        hospitalizationTotalMl: 842,
      },
    });

    expect(buildActiveFluids(record)).toMatchObject({
      fluid: 'Normosol-R',
      rateMlHr: '60 mL/hr',
      rateMlKgHr: '2.68 mL/kg/hr',
      hospitalizationTotalMl: '842 mL',
    });
    expect(buildActiveFluids(record).latestCheck.cumulativeMl).toBe('842 mL');
  });

  it('filters active medications, includes concentration, and omits discontinued meds', () => {
    const medA = createMedication({
      drugName: 'Cefazolin',
      dose: '22',
      doseUnit: 'mg/kg',
      concentration: '100',
      concentrationUnit: 'mg/mL',
      route: 'IV',
      scheduleMode: '8',
      firstDueTime: '08:00',
      intervalHours: 8,
    }, patient());
    const medB = createMedication({
      drugName: 'Old med',
      dose: '1',
      doseUnit: 'mg/kg',
      concentration: '10',
      concentrationUnit: 'mg/mL',
      route: 'IV',
      scheduleMode: '12',
      firstDueTime: '08:00',
      intervalHours: 12,
    }, patient());
    const record = hospitalization({
      treatmentSheet: { rows: [medA.row, { ...medB.row, discontinuedAt: '2026-08-26T19:00:00.000Z' }] },
      medications: [medA.medication, medB.medication],
    });

    const meds = buildActiveMedications(record, new Date('2026-08-26T20:00:00.000Z'));

    expect(meds).toHaveLength(1);
    expect(meds[0]).toMatchObject({ drug: 'Cefazolin', concentration: '100 mg/mL', schedule: 'q8h' });
  });

  it('limits upcoming care to the next six hours and orders it chronologically', () => {
    const tpr = createTreatmentRow({ type: 'TPR', name: 'TPR', scheduleMode: '4', firstDueTime: '18:00', intervalHours: 4, effectiveFrom: '2026-08-26T13:00:00.000Z' });
    const bg = createTreatmentRow({ type: 'BG', name: 'BG', scheduleMode: '6', firstDueTime: '20:00', intervalHours: 6, effectiveFrom: '2026-08-26T13:00:00.000Z' });
    const record = hospitalization({ treatmentSheet: { rows: [tpr, bg] } });

    const upcoming = buildUpcomingCare(record, new Date('2026-08-26T19:00:00.000Z'), 6);

    expect(upcoming.map((item) => item.label)).toEqual(['BG', 'TPR']);
    expect(upcoming.every((item) => new Date(item.time) <= new Date('2026-08-27T01:00:00.000Z'))).toBe(true);
  });

  it('includes unresolved overdue care and excludes documented completed occurrences', () => {
    const row = createTreatmentRow({ type: 'BG', name: 'BG', scheduleMode: '2', firstDueTime: '18:00', intervalHours: 2, effectiveFrom: '2026-08-26T13:00:00.000Z' });
    let record = hospitalization({ treatmentSheet: { rows: [row] } });
    record = documentTreatment(record, {
      rowId: row.id,
      scheduledAt: '2026-08-26T20:00:00.000Z',
      actualAt: '2026-08-26T20:07:00.000Z',
      values: { bg: '91', bgUnit: 'mg/dL' },
    });

    const outstanding = buildOutstandingCare(record, new Date('2026-08-26T21:00:00.000Z'));

    expect(outstanding.map((item) => item.detail).join(' ')).toContain('BG not documented');
    expect(outstanding.some((item) => item.time === '2026-08-26T20:00:00.000Z')).toBe(false);
  });

  it('returns last three recent values across midnight and preserves order newest first', () => {
    const record = hospitalization({
      monitoringEntries: [
        monitoring('bg-1', 'BG', '2026-08-26T23:00:00.000Z', { bg: '96', bgUnit: 'mg/dL' }),
        monitoring('bg-2', 'BG', '2026-08-27T01:00:00.000Z', { bg: '91', bgUnit: 'mg/dL' }),
        monitoring('bg-3', 'BG', '2026-08-27T03:00:00.000Z', { bg: '82', bgUnit: 'mg/dL' }),
        monitoring('bg-4', 'BG', '2026-08-27T05:00:00.000Z', { bg: '76', bgUnit: 'mg/dL' }),
      ],
    });

    const bg = buildRecentLabs(record).find((metric) => metric.id === 'bg');

    expect(bg.points.map((point) => point.value)).toEqual([76, 82, 91]);
  });

  it('filters recent events by window without interpretation language', () => {
    const record = hospitalization({
      customEvents: [
        { id: 'old', actualAt: '2026-08-26T10:00:00.000Z', category: 'Vomiting', item: 'Vomiting', value: '1', unit: '', notes: '' },
        { id: 'recent', actualAt: '2026-08-26T20:30:00.000Z', category: 'Vomiting', item: 'Vomiting', value: '1', unit: '', notes: 'small amount' },
      ],
    });

    const events = buildRecentEvents(record, new Date('2026-08-26T21:00:00.000Z'), 8);

    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toMatch(/stable|improving|concerning|hypotensive/i);
  });

  it('builds concise copy text with medication concentration and omits empty sections', () => {
    const med = createMedication({
      drugName: 'Cefazolin',
      dose: '22',
      doseUnit: 'mg/kg',
      concentration: '100',
      concentrationUnit: 'mg/mL',
      route: 'IV',
      scheduleMode: '8',
      firstDueTime: '08:00',
      intervalHours: 8,
    }, patient());
    const record = hospitalization({
      treatmentSheet: { rows: [med.row] },
      medications: [med.medication],
      monitoringEntries: [monitoring('bg-1', 'BG', '2026-08-26T20:07:00.000Z', { bg: '91', bgUnit: 'mg/dL' })],
    });
    const snapshot = buildHandoffSnapshot({ patient: patient(), hospitalization: record, at: '2026-08-26T21:00:00.000Z' });
    const text = buildHandoffText({
      patient: patient(),
      handoff: { notes: 'Walk with sling.\nOwner update at 10 PM.', followUpItems: [{ id: '1', text: 'Recheck IV site', completed: false }] },
      snapshot,
    });

    expect(text).toContain('Cefazolin · 100 mg/mL');
    expect(text).toContain('BG 91 mg/dL');
    expect(text).toContain('Walk with sling.');
    expect(text).not.toMatch(/stable|improving|concerning|hypotensive/i);
  });
});
