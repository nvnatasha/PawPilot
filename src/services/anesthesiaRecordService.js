import {
  CIRCUIT_TYPES,
  OXYGEN_REFERENCE_RATES_ML_KG_MIN,
} from '../config/anesthesiaConfig.js';
import {
  calculateFluidBolus,
  calculateFluidRate,
  calculateDrugDose,
  calculateOxygenFlow,
  calculateReservoirBag,
  suggestBreathingCircuit,
} from '../utils/anesthesiaCalculations.js';
import { cleanMonitoringEntry, monitoringEntryHasData, sortByTimestamp } from '../utils/anesthesiaMonitoring.js';

const STORAGE_KEY = 'pawpilot.anesthesiaRecords.v1';

function readFromStorage() {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function writeToStorage(records) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function createId(patientId) {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `anesthesia-${patientId}-${Date.now()}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function defaultMonitoring() {
  return {
    intervalMinutes: 5,
    customIntervalMinutes: '',
    startedAt: '',
    endedAt: '',
    enabledFields: [],
    entries: [],
    extraPoints: [],
    events: [],
    medicationAdministrations: [],
    fluidEvents: [],
    documentedFluidTotalMl: '',
    estimatedFluidTotalMl: '',
    recoveryEntries: [],
    recoveryStatus: '',
    recoveryCustomStatus: '',
  };
}

export function normalizeAnesthesiaRecord(record) {
  if (!record) return record;
  return {
    status: 'Setup',
    ...record,
    monitoring: {
      ...defaultMonitoring(),
      ...(record.monitoring || {}),
      entries: sortByTimestamp(record.monitoring?.entries || []),
      events: sortByTimestamp(record.monitoring?.events || [], 'actualAt'),
      medicationAdministrations: sortByTimestamp(record.monitoring?.medicationAdministrations || [], 'actualAt'),
      fluidEvents: sortByTimestamp(record.monitoring?.fluidEvents || [], 'actualAt'),
      recoveryEntries: sortByTimestamp(record.monitoring?.recoveryEntries || [], 'actualAt'),
    },
  };
}

export function buildDefaultAnesthesiaRecord(patient) {
  const suggestedType = suggestBreathingCircuit(patient.weightKg);
  const selectedType = suggestedType || CIRCUIT_TYPES.REBREATHING;
  const reservoirBag = calculateReservoirBag(patient.weightKg);
  const oxygenRate = OXYGEN_REFERENCE_RATES_ML_KG_MIN[selectedType];
  const oxygen = calculateOxygenFlow(patient.weightKg, oxygenRate);

  return {
    id: createId(patient.id),
    patientId: patient.id,
    procedure: patient.reason || '',
    date: today(),
    technician: '',
    veterinarian: '',
    startTime: '',
    circuit: {
      suggestedType,
      selectedType,
    },
    reservoirBag: {
      tidalVolumeLowMl: reservoirBag?.tidalVolumeLowMl || null,
      tidalVolumeHighMl: reservoirBag?.tidalVolumeHighMl || null,
      reservoirLowMl: reservoirBag?.reservoirLowMl || null,
      reservoirHighMl: reservoirBag?.reservoirHighMl || null,
      suggestedBagSizeL: reservoirBag?.suggestedBagSizeL || null,
      selectedBagSizeL: reservoirBag?.suggestedBagSizeL || '',
    },
    oxygen: {
      selectedRatePerKg: oxygenRate,
      calculatedMlMin: oxygen?.mlMin || null,
      calculatedLMin: oxygen?.lMin || null,
    },
    fluids: {
      type: 'LRS',
      customType: '',
      ratePerKg: '',
      calculatedMlHr: null,
    },
    bolus: {
      amountPerKg: '',
      minutes: '',
      totalMl: null,
      pumpRateMlHr: null,
    },
    drugs: [],
    status: 'Setup',
    monitoring: defaultMonitoring(),
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export const anesthesiaRecordService = {
  list() {
    return readFromStorage().map(normalizeAnesthesiaRecord);
  },

  getByPatientId(patientId) {
    return readFromStorage().map(normalizeAnesthesiaRecord).find((record) => record.patientId === patientId) || null;
  },

  getOrCreateForPatient(patient) {
    const existingRecord = this.getByPatientId(patient.id);
    if (existingRecord) {
      return existingRecord;
    }

    const record = buildDefaultAnesthesiaRecord(patient);
    writeToStorage([record, ...readFromStorage()]);
    return record;
  },

  save(record) {
    const records = readFromStorage();
    const nextRecord = {
      ...record,
      updatedAt: new Date().toISOString(),
    };

    const exists = records.some((item) => item.id === record.id);
    const nextRecords = exists
      ? records.map((item) => (item.id === record.id ? nextRecord : item))
      : [nextRecord, ...records];

    writeToStorage(nextRecords);
    return nextRecord;
  },

  clear() {
    window.localStorage.removeItem(STORAGE_KEY);
  },
};

export function recalculateRecordForPatient(record, patient) {
  const normalizedRecord = normalizeAnesthesiaRecord(record);
  const reservoirBag = calculateReservoirBag(patient.weightKg);
  const oxygen = calculateOxygenFlow(patient.weightKg, normalizedRecord.oxygen.selectedRatePerKg);
  const fluids = calculateFluidRate(patient.weightKg, normalizedRecord.fluids.ratePerKg);
  const bolus = calculateFluidBolus(patient.weightKg, normalizedRecord.bolus.amountPerKg, normalizedRecord.bolus.minutes);

  return {
    ...normalizedRecord,
    circuit: {
      ...record.circuit,
      suggestedType: suggestBreathingCircuit(patient.weightKg),
    },
    reservoirBag: {
      ...record.reservoirBag,
      tidalVolumeLowMl: reservoirBag?.tidalVolumeLowMl || null,
      tidalVolumeHighMl: reservoirBag?.tidalVolumeHighMl || null,
      reservoirLowMl: reservoirBag?.reservoirLowMl || null,
      reservoirHighMl: reservoirBag?.reservoirHighMl || null,
      suggestedBagSizeL: reservoirBag?.suggestedBagSizeL || null,
    },
    oxygen: {
      ...record.oxygen,
      calculatedMlMin: oxygen?.mlMin || null,
      calculatedLMin: oxygen?.lMin || null,
    },
    fluids: {
      ...record.fluids,
      calculatedMlHr: fluids?.mlHr || null,
    },
    bolus: {
      ...record.bolus,
      totalMl: bolus?.totalMl || null,
      pumpRateMlHr: bolus?.pumpRateMlHr || null,
    },
  };
}

export function upsertMonitoringEntry(record, values) {
  const id = values.id || createId(record.patientId);
  const timestamp = values.timestamp || values.actualAt || nowIso();
  const entry = {
    id,
    scheduledAt: values.scheduledAt || timestamp,
    timestamp,
    actualAt: timestamp,
    ...cleanMonitoringEntry(values),
  };

  if (!monitoringEntryHasData(entry)) {
    return record;
  }

  const entries = (record.monitoring.entries || []).filter((item) => item.id !== id);
  return {
    ...record,
    monitoring: {
      ...record.monitoring,
      entries: sortByTimestamp([...entries, entry]),
    },
    status: record.status === 'Setup' ? 'In progress' : record.status,
  };
}

export function addMonitoringEvent(record, event) {
  if (!event.type && !event.description) return record;
  return {
    ...record,
    monitoring: {
      ...record.monitoring,
      events: sortByTimestamp(
        [
          ...(record.monitoring.events || []),
          {
            id: createId(record.patientId),
            actualAt: event.actualAt || nowIso(),
            type: event.type || 'Custom event',
            description: event.description || '',
            technician: event.technician || '',
            notes: event.notes || '',
          },
        ],
        'actualAt',
      ),
    },
  };
}

export function addAnesthesiaMedicationAdministration(record, values, patient) {
  const calculated = values.volumeMl && values.totalDose
    ? {
        totalDose: Number(values.totalDose),
        totalDoseUnit: values.totalDoseUnit || values.doseUnit?.replace('/kg', '') || '',
        volumeMl: Number(values.volumeMl),
      }
    : calculateDrugDose({
        weightKg: patient.weightKg,
        dose: values.dose,
        doseUnit: values.doseUnit,
        concentration: values.concentration,
        concentrationUnit: values.concentrationUnit,
      });

  if (!values.name?.trim() || !calculated) return record;

  return {
    ...record,
    monitoring: {
      ...record.monitoring,
      medicationAdministrations: sortByTimestamp(
        [
          ...(record.monitoring.medicationAdministrations || []),
          {
            id: createId(record.patientId),
            sourceDrugId: values.sourceDrugId || '',
            presetId: values.presetId || '',
            stage: values.stage || 'Other',
            actualAt: values.actualAt || nowIso(),
            name: values.name.trim(),
            dose: Number(values.dose),
            doseUnit: values.doseUnit,
            concentration: Number(values.concentration),
            concentrationUnit: values.concentrationUnit,
            totalDose: calculated.totalDose,
            totalDoseUnit: calculated.totalDoseUnit,
            volumeMl: calculated.volumeMl,
            route: values.route || '',
            customRoute: values.customRoute || '',
            technician: values.technician || '',
            notes: values.notes || '',
          },
        ],
        'actualAt',
      ),
    },
  };
}

export function addAnesthesiaFluidEvent(record, event) {
  if (!event.type) return record;
  return {
    ...record,
    monitoring: {
      ...record.monitoring,
      fluidEvents: sortByTimestamp(
        [
          ...(record.monitoring.fluidEvents || []),
          {
            id: createId(record.patientId),
            actualAt: event.actualAt || nowIso(),
            type: event.type,
            fluidType: event.fluidType || record.fluids.type,
            rateMlHr: event.rateMlHr || '',
            rateMlKgHr: event.rateMlKgHr || '',
            bolusMl: event.bolusMl || '',
            notes: event.notes || '',
          },
        ],
        'actualAt',
      ),
    },
  };
}

export function addRecoveryEntry(record, entry) {
  const cleaned = cleanMonitoringEntry(entry);
  if (
    !monitoringEntryHasData(cleaned) &&
    !entry.recoveryPosition &&
    !entry.painScore &&
    !entry.mentation &&
    !record.monitoring.recoveryStatus
  ) return record;
  return {
    ...record,
    status: 'Recovery',
    monitoring: {
      ...record.monitoring,
      recoveryEntries: sortByTimestamp(
        [
          ...(record.monitoring.recoveryEntries || []),
          {
            id: createId(record.patientId),
            actualAt: entry.actualAt || nowIso(),
            ...cleaned,
            recoveryPosition: entry.recoveryPosition || '',
            painScore: entry.painScore ?? '',
            mentation: entry.mentation ?? '',
          },
        ],
        'actualAt',
      ),
    },
  };
}

export function completeAnesthesiaRecord(record) {
  return {
    ...record,
    status: 'Completed',
    completedAt: nowIso(),
  };
}
