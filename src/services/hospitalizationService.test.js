import { beforeEach, describe, expect, it } from 'vitest';
import {
  addCustomEvent,
  addOccurrenceOverride,
  buildDefaultHospitalization,
  buildTimeline,
  changeTreatmentSchedule,
  createMedication,
  createTreatmentRow,
  documentTreatment,
  hospitalizationService,
  normalizeHospitalizationRecord,
  occurrencesForRecord,
  occurrencesForRowInWindow,
  outstandingOccurrencesForRecord,
  setTreatmentStatus,
  timelineToCsv,
} from './hospitalizationService.js';
import { getCellStatus, sheetWindow } from '../utils/hospitalizationSchedule.js';

const patient = {
  id: 'patient-1',
  name: 'Bella',
  species: 'Canine',
  weightKg: 22,
  weightLb: 48.5,
  reason: 'Pancreatitis',
};

describe('hospitalizationService', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('persists active and ended hospitalizations separately from patients', () => {
    const record = hospitalizationService.getOrCreateActive(patient);
    hospitalizationService.end(record, '2026-08-27T12:00:00.000Z');

    expect(hospitalizationService.getActiveByPatientId(patient.id)).toBeNull();
    expect(hospitalizationService.listByPatientId(patient.id)[0]).toMatchObject({
      status: 'ended',
      endedAt: '2026-08-27T12:00:00.000Z',
    });
  });

  it('creates scheduled medication occurrences and immutable administration history', () => {
    const record = buildDefaultHospitalization(patient);
    const created = createMedication(
      {
        drugName: 'Cefazolin',
        dose: 22,
        doseUnit: 'mg/kg',
        concentration: 100,
        concentrationUnit: 'mg/mL',
        route: 'IV',
        scheduleMode: '8',
        firstDueTime: '08:00',
        intervalHours: 8,
      },
      patient,
    );
    const withMedication = {
      ...record,
      medications: [created.medication],
      treatmentSheet: { ...record.treatmentSheet, rows: [created.row] },
    };
    const occurrence = occurrencesForRecord(withMedication)[0];
    const documented = documentTreatment(withMedication, {
      rowId: created.row.id,
      scheduledAt: occurrence.scheduledAt,
      actualAt: '2026-08-26T14:06:00.000Z',
      status: 'given',
      technician: 'Jane',
    });

    const editedSchedule = {
      ...documented,
      treatmentSheet: {
        ...documented.treatmentSheet,
        rows: [{ ...created.row, schedule: { type: 'interval', firstDueTime: '10:00', intervalHours: 12 } }],
      },
    };

    expect(documented.medicationAdministrations[0]).toMatchObject({
      scheduledAt: occurrence.scheduledAt,
      actualAt: '2026-08-26T14:06:00.000Z',
      medication: 'Cefazolin',
      status: 'given',
    });
    expect(editedSchedule.medicationAdministrations[0]).toEqual(documented.medicationAdministrations[0]);
  });

  it('documents TPR with optional blank fields and actual timestamp', () => {
    const record = buildDefaultHospitalization(patient);
    const row = createTreatmentRow({
      type: 'TPR',
      name: 'TPR',
      scheduleMode: '4',
      firstDueTime: '08:00',
      intervalHours: 4,
    });
    const withRow = { ...record, treatmentSheet: { ...record.treatmentSheet, rows: [row] } };
    const occurrence = occurrencesForRecord(withRow)[0];
    const documented = documentTreatment(withRow, {
      rowId: row.id,
      scheduledAt: occurrence.scheduledAt,
      actualAt: '2026-08-26T08:07:00.000Z',
      status: 'completed',
      values: { temperature: '101.2', hr: '92', rr: '24' },
    });

    expect(documented.monitoringEntries[0]).toMatchObject({
      scheduledAt: occurrence.scheduledAt,
      actualAt: '2026-08-26T08:07:00.000Z',
      values: { temperature: '101.2', hr: '92', rr: '24' },
    });
  });

  it('adds custom events to the derived timeline and escapes CSV', () => {
    const record = addCustomEvent(buildDefaultHospitalization(patient), {
      actualAt: '2026-08-26T15:17:00.000Z',
      category: 'Vomiting',
      item: 'Vomiting',
      value: 'Vomited x1',
      notes: 'Cleaned kennel, patient bright',
    });

    expect(buildTimeline(record)[0]).toMatchObject({
      category: 'Vomiting',
      value: 'Vomited x1',
    });
    expect(timelineToCsv(record)).toContain('"Cleaned kennel, patient bright"');
  });

  it('migrates old treatment rows into schedule periods on load', () => {
    const oldRecord = {
      ...buildDefaultHospitalization(patient),
      treatmentSheet: {
        rows: [
          {
            id: 'row-old',
            type: 'TPR',
            name: 'TPR',
            schedule: { type: 'interval', firstDueTime: '08:00', intervalHours: 4 },
            createdAt: '2026-08-26T08:00:00',
          },
        ],
      },
    };
    window.localStorage.setItem('pawpilot.hospitalizations.v1', JSON.stringify([oldRecord]));

    const migrated = hospitalizationService.list()[0];

    expect(migrated.treatmentSheet.rows[0].schedulePeriods).toHaveLength(1);
    expect(migrated.treatmentSheet.rows[0].occurrenceOverrides).toEqual([]);
  });

  it('changes schedules from an effective timestamp without rewriting prior occurrences', () => {
    const record = {
      ...buildDefaultHospitalization(patient),
      sheetDate: '2026-08-26',
      startedAt: '2026-08-26T08:00:00',
    };
    const row = createTreatmentRow({
      type: 'TPR',
      name: 'TPR',
      scheduleMode: '4',
      firstDueTime: '08:00',
      intervalHours: 4,
      firstDueAt: '2026-08-26T08:00:00',
      effectiveFrom: '2026-08-26T08:00:00',
    });
    const withRow = { ...record, treatmentSheet: { ...record.treatmentSheet, rows: [row] } };
    const changed = changeTreatmentSchedule(withRow, row.id, {
      scheduleMode: '6',
      firstDueTime: '14:00',
      intervalHours: 6,
      effectiveFrom: '2026-08-26T14:00:00',
    });

    expect(occurrencesForRecord(changed).map((item) => item.hourIndex)).toEqual([0, 4, 6, 12, 18]);
    expect(changed.treatmentSheet.rows[0].schedulePeriods).toHaveLength(2);
  });

  it('stores occurrence skips, holds, and reschedules separately from documentation', () => {
    const record = { ...buildDefaultHospitalization(patient), sheetDate: '2026-08-26' };
    const row = createTreatmentRow({
      type: 'TPR',
      name: 'TPR',
      scheduleMode: '4',
      firstDueTime: '08:00',
      intervalHours: 4,
      firstDueAt: '2026-08-26T08:00:00',
      effectiveFrom: '2026-08-26T08:00:00',
    });
    const withRow = { ...record, treatmentSheet: { ...record.treatmentSheet, rows: [row] } };
    const first = occurrencesForRecord(withRow)[0];
    const skipped = addOccurrenceOverride(withRow, row.id, {
      type: 'skip',
      scheduledAt: first.scheduledAt,
      actualAt: '2026-08-26T08:05:00',
      notes: 'Patient in imaging',
    });
    const skippedOccurrence = occurrencesForRecord(skipped)[0];

    expect(getCellStatus({ occurrence: skippedOccurrence, row, entries: [] })).toBe('skipped');
    expect(buildTimeline(skipped).find((item) => item.status === 'skip')).toMatchObject({
      category: 'Treatment',
      item: 'TPR',
    });

    const second = occurrencesForRecord(withRow)[1];
    const rescheduled = addOccurrenceOverride(withRow, row.id, {
      type: 'reschedule',
      scheduledAt: second.scheduledAt,
      rescheduledTo: '2026-08-26T13:00:00',
      actualAt: '2026-08-26T11:45:00',
    });

    expect(occurrencesForRecord(rescheduled).find((item) => item.originalScheduledAt)).toMatchObject({
      hourIndex: 5,
      originalScheduledAt: second.scheduledAt,
    });
  });

  it('supports treatment hold, resume, and discontinue lifecycles', () => {
    const row = createTreatmentRow({
      type: 'Walk',
      name: 'Walk',
      scheduleMode: '4',
      firstDueTime: '08:00',
      intervalHours: 4,
      firstDueAt: '2026-08-26T08:00:00',
      effectiveFrom: '2026-08-26T08:00:00',
    });
    const record = {
      ...buildDefaultHospitalization(patient),
      sheetDate: '2026-08-26',
      treatmentSheet: { rows: [row] },
    };
    const held = setTreatmentStatus(record, row.id, 'hold', '2026-08-26T10:00:00');
    expect(occurrencesForRecord(held).map((item) => item.hourIndex)).toEqual([0]);

    const resumed = setTreatmentStatus(held, row.id, 'resume', '2026-08-26T14:00:00');
    expect(occurrencesForRecord(resumed).map((item) => item.hourIndex)).toEqual([0, 6, 10, 14, 18, 22]);

    const discontinued = setTreatmentStatus(resumed, row.id, 'discontinued', '2026-08-26T18:30:00');
    expect(occurrencesForRecord(discontinued).map((item) => item.hourIndex)).toEqual([0, 6, 10]);
  });

  it('keeps PRN medications off the automatic schedule while allowing documentation', () => {
    const created = createMedication(
      {
        drugName: 'Buprenorphine',
        dose: 0.02,
        doseUnit: 'mg/kg',
        concentration: 0.3,
        concentrationUnit: 'mg/mL',
        route: 'IV',
        scheduleMode: 'prn',
      },
      patient,
    );
    const record = {
      ...buildDefaultHospitalization(patient),
      medications: [created.medication],
      treatmentSheet: { rows: [created.row] },
    };

    expect(created.row.type).toBe('PRN');
    expect(occurrencesForRecord(record)).toEqual([]);

    const documented = documentTreatment(record, {
      rowId: created.row.id,
      actualAt: '2026-08-26T16:00:00',
      status: 'given',
      technician: 'Jane',
    });
    expect(documented.medicationAdministrations[0]).toMatchObject({
      scheduledAt: '',
      medication: 'Buprenorphine',
      status: 'given',
    });
    expect(
      buildTimeline(documented).find((item) => item.category === 'Medication' && item.item === 'Buprenorphine')
        .value,
    ).toBe('0.3 mg/mL · 1.47 mL · IV');
  });

  it('carries unresolved treatments from the previous sheet and preserves full CSV timestamps', () => {
    const row = createTreatmentRow({
      type: 'TPR',
      name: 'TPR',
      scheduleMode: '8',
      firstDueTime: '07:00',
      intervalHours: 8,
      firstDueAt: '2026-08-27T07:00:00',
      effectiveFrom: '2026-08-27T07:00:00',
    });
    const record = {
      ...buildDefaultHospitalization(patient),
      sheetDate: '2026-08-27',
      treatmentSheet: { rows: [row] },
    };

    expect(outstandingOccurrencesForRecord(record)).toHaveLength(1);

    const documented = documentTreatment(record, {
      rowId: row.id,
      scheduledAt: '2026-08-27T15:00:00',
      actualAt: '2026-08-27T15:08:00',
      status: 'completed',
      values: { hr: '90' },
    });
    expect(timelineToCsv(documented)).toContain('2026-08-27T15:08:00');
  });

  it('generates fluid check schedules across days from schedule periods', () => {
    const row = createTreatmentRow({
      type: 'Fluid volume check',
      name: 'LRS volume check',
      scheduleMode: '6',
      firstDueTime: '20:00',
      intervalHours: 6,
      firstDueAt: '2026-08-26T20:00:00',
      effectiveFrom: '2026-08-26T20:00:00',
    });
    const window = sheetWindow('2026-08-27');

    expect(occurrencesForRowInWindow(row, window.start, window.end).map((item) => item.hourIndex)).toEqual([0, 6, 12, 18]);
  });
});
