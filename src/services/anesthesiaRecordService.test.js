import { beforeEach, describe, expect, it } from 'vitest';
import {
  addAnesthesiaMedicationAdministration,
  addMonitoringEvent,
  addRecoveryEntry,
  anesthesiaRecordService,
  buildDefaultAnesthesiaRecord,
  completeAnesthesiaRecord,
  normalizeAnesthesiaRecord,
  upsertMonitoringEntry,
} from './anesthesiaRecordService.js';

const patient = {
  id: 'patient-1',
  name: 'Bella',
  species: 'Canine',
  weightKg: 22.4,
  weightLb: 49.383488,
  age: '6 years',
  sexStatus: 'FS',
  reason: 'Splenectomy',
};

describe('anesthesiaRecordService', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('builds a serializable default record from patient context', () => {
    const record = buildDefaultAnesthesiaRecord(patient);

    expect(record.patientId).toBe('patient-1');
    expect(record.procedure).toBe('Splenectomy');
    expect(record.circuit.suggestedType).toBe('Rebreathing');
    expect(record.reservoirBag.suggestedBagSizeL).toBe(3);
    expect(record.monitoring.intervalMinutes).toBe(5);
    expect(() => JSON.stringify(record)).not.toThrow();
  });

  it('persists and reloads an anesthesia record for a patient', () => {
    const record = anesthesiaRecordService.getOrCreateForPatient(patient);
    const saved = anesthesiaRecordService.save({
      ...record,
      technician: 'Jane Doe',
      fluids: {
        ...record.fluids,
        ratePerKg: 5,
        calculatedMlHr: 112,
      },
    });

    expect(anesthesiaRecordService.getByPatientId(patient.id)).toMatchObject({
      id: saved.id,
      patientId: patient.id,
      technician: 'Jane Doe',
      fluids: {
        ratePerKg: 5,
        calculatedMlHr: 112,
      },
    });
  });

  it('normalizes existing records with monitoring defaults', () => {
    const normalized = normalizeAnesthesiaRecord({
      id: 'record-1',
      patientId: patient.id,
      oxygen: { selectedRatePerKg: 30 },
      fluids: { ratePerKg: '' },
      bolus: {},
      circuit: {},
      reservoirBag: {},
      drugs: [],
    });

    expect(normalized.status).toBe('Setup');
    expect(normalized.monitoring.entries).toEqual([]);
    expect(normalized.monitoring.events).toEqual([]);
  });

  it('adds and updates monitoring entries with scheduled and actual timestamps', () => {
    const record = buildDefaultAnesthesiaRecord(patient);
    const documented = upsertMonitoringEntry(record, {
      scheduledAt: '2026-08-26T10:15:00.000Z',
      timestamp: '2026-08-26T10:17:00.000Z',
      hr: '98',
      rr: '',
      map: 0,
      technician: 'Jane',
    });

    expect(documented.status).toBe('In progress');
    expect(documented.monitoring.entries[0]).toMatchObject({
      scheduledAt: '2026-08-26T10:15:00.000Z',
      timestamp: '2026-08-26T10:17:00.000Z',
      hr: '98',
      map: 0,
    });

    const updated = upsertMonitoringEntry(documented, {
      ...documented.monitoring.entries[0],
      hr: '100',
    });

    expect(updated.monitoring.entries).toHaveLength(1);
    expect(updated.monitoring.entries[0].hr).toBe('100');
  });

  it('documents anesthesia events without automatic interpretation', () => {
    const record = buildDefaultAnesthesiaRecord(patient);
    const withEvent = addMonitoringEvent(record, {
      actualAt: '2026-08-26T10:18:00.000Z',
      type: 'Hypotension noted',
      description: 'Technician documented event',
    });

    expect(withEvent.monitoring.events[0]).toMatchObject({
      type: 'Hypotension noted',
      description: 'Technician documented event',
    });
  });

  it('documents administered anesthesia medications separately from calculated setup drugs', () => {
    const record = buildDefaultAnesthesiaRecord(patient);
    const withCalculatedDrug = {
      ...record,
      drugs: [{ id: 'drug-1', name: 'Propofol', stage: 'Induction', dose: 4, doseUnit: 'mg/kg', concentration: 10, concentrationUnit: 'mg/mL', volumeMl: 8.96 }],
    };

    expect(withCalculatedDrug.monitoring.medicationAdministrations).toHaveLength(0);

    const administered = addAnesthesiaMedicationAdministration(
      withCalculatedDrug,
      {
        name: 'Propofol',
        stage: 'Induction',
        dose: 2,
        doseUnit: 'mg/kg',
        concentration: 10,
        concentrationUnit: 'mg/mL',
        route: 'IV',
        actualAt: '2026-08-26T10:02:00.000Z',
      },
      patient,
    );

    expect(administered.drugs).toHaveLength(1);
    expect(administered.monitoring.medicationAdministrations[0]).toMatchObject({
      name: 'Propofol',
      stage: 'Induction',
      dose: 2,
      concentration: 10,
      concentrationUnit: 'mg/mL',
      volumeMl: 4.48,
    });
  });

  it('saves partial recovery entries and completion status', () => {
    const record = buildDefaultAnesthesiaRecord(patient);
    const recovered = addRecoveryEntry(
      { ...record, monitoring: { ...record.monitoring, recoveryStatus: 'Smooth' } },
      { actualAt: '2026-08-26T11:20:00.000Z', painScore: 0 },
    );

    expect(recovered.status).toBe('Recovery');
    expect(recovered.monitoring.recoveryEntries[0].painScore).toBe(0);
    expect(completeAnesthesiaRecord(recovered).status).toBe('Completed');
  });

  it('persists monitoring data separately per patient', () => {
    const bella = anesthesiaRecordService.getOrCreateForPatient(patient);
    anesthesiaRecordService.save(upsertMonitoringEntry(bella, {
      scheduledAt: '2026-08-26T10:00:00.000Z',
      timestamp: '2026-08-26T10:00:00.000Z',
      hr: '110',
    }));
    const other = anesthesiaRecordService.getOrCreateForPatient({ ...patient, id: 'patient-2', name: 'Milo' });

    expect(anesthesiaRecordService.getByPatientId(patient.id).monitoring.entries).toHaveLength(1);
    expect(anesthesiaRecordService.getByPatientId(other.patientId)?.monitoring?.entries || []).toHaveLength(0);
    expect(anesthesiaRecordService.getByPatientId('patient-2').monitoring.entries).toHaveLength(0);
  });
});
