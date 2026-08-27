import { calculateDrugDose, calculateFluidBolus } from '../utils/anesthesiaCalculations.js';
import { toCsv } from '../utils/csv.js';
import { formatConcentration, formatMl } from '../utils/formatters.js';
import { addFluidCheck } from '../utils/hospitalizationFluids.js';
import {
  addSheetDays,
  buildSchedule,
  formatTime,
  generateOccurrencesForScheduleWindow,
  getSheetDateForTimestamp,
  getOccurrenceKey,
  sheetWindow,
  toSheetDate,
} from '../utils/hospitalizationSchedule.js';

const STORAGE_KEY = 'pawpilot.hospitalizations.v1';

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

export function createId(prefix = 'id') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function localTime() {
  return new Date().toTimeString().slice(0, 5);
}

function startedAt(date, time) {
  return new Date(`${date}T${time || '08:00'}:00`).toISOString();
}

function firstDueAtFor(values, fallbackDate) {
  if (values.firstDueAt) return values.firstDueAt;
  const sheetDate = fallbackDate || toSheetDate(new Date());
  return new Date(`${sheetDate}T${values.firstDueTime || '08:00'}:00`).toISOString();
}

function createSchedulePeriod(values, fallbackDate) {
  const schedule = ['interval', 'specificTimes', 'once', 'prn'].includes(values.type)
    ? values
    : buildSchedule(values);
  return {
    id: createId('schedule-period'),
    effectiveFrom: values.effectiveFrom || firstDueAtFor(values, fallbackDate),
    effectiveUntil: values.effectiveUntil || '',
    schedule,
    timingMode: values.timingMode || 'fixed',
    status: values.status || 'active',
  };
}

export function normalizeHospitalizationRecord(record) {
  if (!record) return record;
  const sheetDate = record.sheetDate || getSheetDateForTimestamp(record.startedAt || new Date());
  const rows = (record.treatmentSheet?.rows || []).map((row) => {
    const schedulePeriods =
      row.schedulePeriods?.length > 0
        ? row.schedulePeriods
        : [
            createSchedulePeriod(
              {
                ...(row.schedule || {}),
                effectiveFrom: row.createdAt || record.startedAt,
                firstDueTime: row.schedule?.firstDueTime || '08:00',
                intervalHours: row.schedule?.intervalHours,
              },
              sheetDate,
            ),
          ];
    return {
      ...row,
      schedulePeriods,
      occurrenceOverrides: row.occurrenceOverrides || [],
      lifecycleEvents: row.lifecycleEvents || [],
    };
  });

  return {
    ...record,
    sheetDate,
    treatmentSheet: {
      sheetStart: record.treatmentSheet?.sheetStart || startedAt(sheetDate, '08:00'),
      rows,
    },
    medicationAdministrations: record.medicationAdministrations || [],
    monitoringEntries: record.monitoringEntries || [],
    fluids: {
      plans: [],
      bags: [],
      checks: [],
      events: [],
      boluses: [],
      activePlanId: '',
      activeBagId: '',
      hospitalizationTotalMl: 0,
      ...(record.fluids || {}),
    },
    customEvents: record.customEvents || [],
  };
}

export function buildDefaultHospitalization(patient) {
  const today = toSheetDate(new Date());
  const started = startedAt(today, '08:00');

  return {
    id: createId('hospitalization'),
    patientId: patient.id,
    status: 'active',
    sheetDate: today,
    startedAt: started,
    endedAt: '',
    veterinarian: '',
    technician: '',
    location: 'ICU',
    customLocation: '',
    notes: '',
    treatmentSheet: {
      sheetStart: started,
      rows: [],
    },
    medications: [],
    medicationAdministrations: [],
    monitoringEntries: [],
    fluids: {
      plans: [],
      bags: [],
      checks: [],
      events: [],
      boluses: [],
      activePlanId: '',
      activeBagId: '',
      hospitalizationTotalMl: 0,
    },
    customEvents: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

export const hospitalizationService = {
  list() {
    return readFromStorage().map(normalizeHospitalizationRecord);
  },

  listByPatientId(patientId) {
    return readFromStorage().map(normalizeHospitalizationRecord)
      .filter((record) => record.patientId === patientId)
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  },

  getActiveByPatientId(patientId) {
    return (
      readFromStorage()
        .map(normalizeHospitalizationRecord)
        .find((record) => record.patientId === patientId && record.status === 'active') || null
    );
  },

  getOrCreateActive(patient) {
    const active = this.getActiveByPatientId(patient.id);
    if (active) {
      return active;
    }

    const record = buildDefaultHospitalization(patient);
    writeToStorage([record, ...readFromStorage()]);
    return record;
  },

  save(record) {
    const records = readFromStorage();
    const nextRecord = { ...record, updatedAt: nowIso() };
    const exists = records.some((item) => item.id === nextRecord.id);
    writeToStorage(
      exists
        ? records.map((item) => (item.id === nextRecord.id ? nextRecord : item))
        : [nextRecord, ...records],
    );
    return nextRecord;
  },

  end(record, endedAt = nowIso()) {
    return this.save({
      ...record,
      status: 'ended',
      endedAt,
    });
  },

  clear() {
    window.localStorage.removeItem(STORAGE_KEY);
  },
};

export function createTreatmentRow(values) {
  const schedule = buildSchedule(values);
  return {
    id: createId('row'),
    type: values.type,
    name: values.name || values.type,
    schedule,
    schedulePeriods: [createSchedulePeriod(values)],
    occurrenceOverrides: [],
    lifecycleEvents: [
      {
        id: createId('lifecycle'),
        type: 'ordered',
        actualAt: nowIso(),
        summary: scheduleSummary(schedule),
      },
    ],
    instructions: values.instructions || '',
    notes: values.notes || '',
    discontinuedAt: '',
    createdAt: nowIso(),
  };
}

export function createMedication(values, patient) {
  const calculated = calculateDrugDose({
    weightKg: patient.weightKg,
    dose: values.dose,
    doseUnit: values.doseUnit,
    concentration: values.concentration,
    concentrationUnit: values.concentrationUnit,
  });

  if (!calculated) {
    return null;
  }

  const schedule = buildSchedule(values);
  const medication = {
    id: createId('med'),
    rowId: createId('row'),
    drugName: values.drugName.trim(),
    dose: Number(values.dose),
    doseUnit: values.doseUnit,
    concentration: Number(values.concentration),
    concentrationUnit: values.concentrationUnit,
    route: values.route,
    customRoute: values.customRoute || '',
    totalDose: calculated.totalDose,
    totalDoseUnit: calculated.totalDoseUnit,
    volumeMl: calculated.volumeMl,
    instructions: values.instructions || '',
    notes: values.notes || '',
    createdAt: nowIso(),
  };

  const row = {
    id: medication.rowId,
    type: schedule.type === 'prn' ? 'PRN' : 'Medication',
    name: medication.drugName,
    medicationId: medication.id,
    schedule,
    schedulePeriods: [createSchedulePeriod(values)],
    occurrenceOverrides: [],
    lifecycleEvents: [
      {
        id: createId('lifecycle'),
        type: 'ordered',
        actualAt: nowIso(),
        summary: scheduleSummary(schedule),
      },
    ],
    instructions: values.instructions || '',
    notes: values.notes || '',
    discontinuedAt: '',
    createdAt: medication.createdAt,
  };

  return { medication, row };
}

export function occurrencesForRecord(record) {
  const normalizedRecord = normalizeHospitalizationRecord(record);
  const { start, end } = sheetWindow(normalizedRecord.sheetDate);
  return normalizedRecord.treatmentSheet.rows.flatMap((row) => occurrencesForRowInWindow(row, start, end));
}

export function occurrencesForRowInWindow(row, windowStart, windowEnd) {
  if (row.type === 'PRN') return [];
  return (row.schedulePeriods || [])
    .flatMap((period) => {
      const periodStart = new Date(period.effectiveFrom || windowStart);
      const periodEnd = period.effectiveUntil ? new Date(period.effectiveUntil) : windowEnd;
      const start = periodStart > windowStart ? periodStart : windowStart;
      const end = periodEnd < windowEnd ? periodEnd : windowEnd;
      if (period.status !== 'active' || start >= end) return [];
      return generateOccurrencesForScheduleWindow(
        {
          ...period.schedule,
          firstDueAt: period.schedule?.firstDueAt || period.effectiveFrom,
        },
        start,
        end,
        row.id,
        windowStart,
      );
    })
    .map((occurrence) => applyOccurrenceOverride(row, occurrence, windowStart))
    .filter(Boolean)
    .map((occurrence) => ({ ...occurrence, row }));
}

export function outstandingOccurrencesForRecord(record) {
  const normalizedRecord = normalizeHospitalizationRecord(record);
  const { start } = sheetWindow(normalizedRecord.sheetDate);
  const lookback = sheetWindow(addSheetDays(normalizedRecord.sheetDate, -1));
  const documented = [
    ...normalizedRecord.medicationAdministrations,
    ...normalizedRecord.monitoringEntries,
    ...normalizedRecord.fluids.checks,
  ];

  return normalizedRecord.treatmentSheet.rows
    .flatMap((row) => occurrencesForRowInWindow(row, lookback.start, start))
    .filter((occurrence) => !documented.some((entry) => entry.occurrenceKey === occurrence.key))
    .filter((occurrence) => !['skipped', 'held'].includes(occurrence.statusOverride))
    .filter(
      (occurrence) =>
        !occurrence.row.discontinuedAt ||
        new Date(occurrence.scheduledAt) <= new Date(occurrence.row.discontinuedAt),
    );
}

export function changeTreatmentSchedule(record, rowId, values) {
  const effectiveFrom = values.effectiveFrom || nowIso();
  return {
    ...record,
    treatmentSheet: {
      ...record.treatmentSheet,
      rows: record.treatmentSheet.rows.map((row) => {
        if (row.id !== rowId) return row;
        return {
          ...row,
          schedulePeriods: [
            ...(row.schedulePeriods || []).map((period) =>
              !period.effectiveUntil && period.status === 'active'
                ? { ...period, effectiveUntil: effectiveFrom }
                : period,
            ),
            createSchedulePeriod({ ...values, effectiveFrom }),
          ],
          lifecycleEvents: [
            ...(row.lifecycleEvents || []),
            {
              id: createId('lifecycle'),
              type: 'scheduleChanged',
              actualAt: effectiveFrom,
              summary: scheduleSummary(buildSchedule(values)),
            },
          ],
        };
      }),
    },
  };
}

export function addOccurrenceOverride(record, rowId, override) {
  return {
    ...record,
    treatmentSheet: {
      ...record.treatmentSheet,
      rows: record.treatmentSheet.rows.map((row) =>
        row.id === rowId
          ? {
              ...row,
              occurrenceOverrides: [
                ...(row.occurrenceOverrides || []),
                {
                  id: createId('override'),
                  actualAt: override.actualAt || nowIso(),
                  ...override,
                },
              ],
            }
          : row,
      ),
    },
  };
}

export function setTreatmentStatus(record, rowId, status, actualAt = nowIso()) {
  return {
    ...record,
    treatmentSheet: {
      ...record.treatmentSheet,
      rows: record.treatmentSheet.rows.map((row) => {
        if (row.id !== rowId) return row;
        const updates = {
          lifecycleEvents: [
            ...(row.lifecycleEvents || []),
            { id: createId('lifecycle'), type: status, actualAt },
          ],
        };
        if (status === 'hold') {
          updates.schedulePeriods = [
            ...(row.schedulePeriods || []).map((period) =>
              !period.effectiveUntil && period.status === 'active' ? { ...period, effectiveUntil: actualAt } : period,
            ),
            { id: createId('schedule-period'), effectiveFrom: actualAt, effectiveUntil: '', schedule: null, timingMode: 'fixed', status: 'held' },
          ];
        }
        if (status === 'resume') {
          const lastActivePeriod = [...(row.schedulePeriods || [])]
            .reverse()
            .find((period) => period.status === 'active' && period.schedule);
          const resumedSchedule =
            lastActivePeriod?.schedule ||
            row.schedule ||
            buildSchedule({ scheduleMode: '4', firstDueTime: localTime(), intervalHours: 4 });
          updates.schedulePeriods = [
            ...(row.schedulePeriods || []).map((period) =>
              !period.effectiveUntil && period.status === 'held' ? { ...period, effectiveUntil: actualAt } : period,
            ),
            createSchedulePeriod({ ...resumedSchedule, firstDueAt: actualAt, effectiveFrom: actualAt }),
          ];
        }
        if (status === 'discontinued') {
          updates.discontinuedAt = actualAt;
          updates.schedulePeriods = (row.schedulePeriods || []).map((period) =>
            !period.effectiveUntil ? { ...period, effectiveUntil: actualAt } : period,
          );
        }
        return { ...row, ...updates };
      }),
    },
  };
}

export function documentTreatment(record, payload) {
  const row = record.treatmentSheet.rows.find((item) => item.id === payload.rowId);
  const occurrenceKey = payload.scheduledAt ? getOccurrenceKey(payload.rowId, payload.scheduledAt) : '';
  const actualAt = payload.actualAt || nowIso();

  if (row?.type === 'Medication') {
    const medication = record.medications.find((item) => item.id === row.medicationId);
    const administration = {
      id: createId('admin'),
      occurrenceKey,
      rowId: row.id,
      scheduledAt: payload.scheduledAt,
      actualAt,
      medicationId: medication?.id,
      medication: medication?.drugName || row.name,
      dose: medication?.dose,
      doseUnit: medication?.doseUnit,
      concentration: medication?.concentration,
      concentrationUnit: medication?.concentrationUnit,
      volumeMl: medication?.volumeMl,
      route: medication?.route === 'Other' ? medication.customRoute : medication?.route,
      status: payload.status,
      technician: payload.technician || '',
      notes: payload.notes || '',
    };

    return {
      ...record,
      medicationAdministrations: [...record.medicationAdministrations, administration],
      treatmentSheet: maybeDiscontinueRow(record.treatmentSheet, row.id, payload, actualAt),
    };
  }

  if (row?.type === 'PRN' && row.medicationId) {
    const medication = record.medications.find((item) => item.id === row.medicationId);
    const administration = {
      id: createId('admin'),
      occurrenceKey: payload.scheduledAt ? occurrenceKey : '',
      rowId: row.id,
      scheduledAt: payload.scheduledAt || '',
      actualAt,
      medicationId: medication?.id,
      medication: medication?.drugName || row.name,
      dose: medication?.dose,
      doseUnit: medication?.doseUnit,
      concentration: medication?.concentration,
      concentrationUnit: medication?.concentrationUnit,
      volumeMl: medication?.volumeMl,
      route: medication?.route === 'Other' ? medication.customRoute : medication?.route,
      status: payload.status || 'given',
      technician: payload.technician || '',
      notes: payload.notes || '',
    };

    return {
      ...record,
      medicationAdministrations: [...record.medicationAdministrations, administration],
    };
  }

  const entry = {
    id: createId('monitoring'),
    occurrenceKey,
    rowId: row?.id,
    category: row?.type || payload.type,
    item: row?.name || payload.type,
    scheduledAt: payload.scheduledAt,
    actualAt,
    status: payload.status || 'completed',
    technician: payload.technician || '',
    values: payload.values || {},
    notes: payload.notes || '',
  };

  return {
    ...record,
    monitoringEntries: [...record.monitoringEntries, entry],
    treatmentSheet: maybeDiscontinueRow(record.treatmentSheet, row?.id, payload, actualAt),
  };
}

export function addCustomEvent(record, event) {
  return {
    ...record,
    customEvents: [
      ...record.customEvents,
      {
        id: createId('event'),
        actualAt: event.actualAt || nowIso(),
        scheduledHour: event.scheduledHour || '',
        category: event.category,
        item: event.item || event.category,
        value: event.value || '',
        unit: event.unit || '',
        technician: event.technician || '',
        notes: event.notes || '',
      },
    ],
  };
}

export function addHospitalFluidCheck(record, check, patient) {
  const calculated = addFluidCheck(record, { ...check, weightKg: patient.weightKg });
  if (!calculated) {
    return null;
  }

  return {
    ...record,
    fluids: {
      ...record.fluids,
      checks: [...record.fluids.checks, calculated],
      hospitalizationTotalMl: calculated.hospitalizationTotalMl,
    },
  };
}

export function addFluidPlan(record, plan, patient) {
  const planId = createId('fluid-plan');
  const bagId = createId('fluid-bag');
  const eventId = createId('fluid-event');
  const started = plan.startedAt || nowIso();
  const rateMlHr =
    plan.entryMode === 'mlKgHr' ? Number(plan.rateMlKgHr) * Number(patient.weightKg) : Number(plan.rateMlHr);
  const rateMlKgHr =
    plan.entryMode === 'mlHr' ? Number(plan.rateMlHr) / Number(patient.weightKg) : Number(plan.rateMlKgHr);

  const row = createTreatmentRow({
    type: 'Fluid volume check',
    name: `${plan.fluidType === 'Other' ? plan.customType || 'Fluids' : plan.fluidType} volume check`,
    scheduleMode: plan.scheduleMode,
    firstDueTime: plan.firstDueTime,
    intervalHours: plan.intervalHours,
    specificTimes: plan.specificTimes,
  });

  return {
    ...record,
    treatmentSheet: {
      ...record.treatmentSheet,
      rows: [...record.treatmentSheet.rows, row],
    },
    fluids: {
      ...record.fluids,
      activePlanId: planId,
      activeBagId: bagId,
      plans: [
        ...record.fluids.plans,
        {
          id: planId,
          rowId: row.id,
          fluidType: plan.fluidType,
          customType: plan.customType || '',
          bagSizeMl: Number(plan.bagSizeMl) || 0,
          rateMlHr,
          rateMlKgHr,
          additives: plan.additives || [],
          startedAt: started,
          status: 'active',
          notes: plan.notes || '',
        },
      ],
      bags: [
        ...record.fluids.bags,
        {
          id: bagId,
          planId,
          fluidType: plan.fluidType,
          customType: plan.customType || '',
          bagSizeMl: Number(plan.bagSizeMl) || 0,
          baselineMl: Number(plan.baselineMl) || 0,
          additives: plan.additives || [],
          startedAt: started,
        },
      ],
      events: [
        ...record.fluids.events,
        {
          id: eventId,
          type: 'start',
          actualAt: started,
          item: 'Start Fluids',
          value: `${rateMlHr.toFixed(1)} mL/hr`,
          notes: plan.notes || '',
        },
      ],
    },
  };
}

export function addFluidEvent(record, event) {
  return {
    ...record,
    fluids: {
      ...record.fluids,
      plans: event.type === 'rateChange'
        ? record.fluids.plans.map((plan) =>
            plan.id === record.fluids.activePlanId
              ? { ...plan, rateMlHr: Number(event.newRateMlHr), rateMlKgHr: Number(event.newRateMlHr) / Number(event.weightKg) }
              : plan,
          )
        : record.fluids.plans,
      events: [
        ...record.fluids.events,
        {
          id: createId('fluid-event'),
          type: event.type,
          actualAt: event.actualAt || nowIso(),
          item: fluidEventLabel(event.type),
          value: event.value || '',
          notes: event.notes || '',
        },
      ],
    },
  };
}

export function addFluidBolus(record, bolus, patient) {
  const calculated = calculateFluidBolus(patient.weightKg, bolus.amountMlKg, bolus.minutes);
  if (!calculated) {
    return null;
  }

  return {
    ...record,
    fluids: {
      ...record.fluids,
      boluses: [
        ...record.fluids.boluses,
        {
          id: createId('bolus'),
          actualAt: bolus.actualAt || nowIso(),
          scheduledAt: bolus.scheduledAt || '',
          amountMlKg: Number(bolus.amountMlKg),
          totalMl: calculated.totalMl,
          minutes: Number(bolus.minutes),
          pumpRateMlHr: calculated.pumpRateMlHr,
          fluidType: bolus.fluidType,
          status: bolus.status || 'planned',
          notes: bolus.notes || '',
        },
      ],
    },
  };
}

export function buildTimeline(record) {
  const rows = [
    ...record.treatmentSheet.rows.flatMap((row) => [
      ...(row.lifecycleEvents || []).map((event) => ({
        timestamp: event.actualAt,
        scheduledTime: '',
        category: 'Treatment',
        item: row.name,
        value: event.summary || '',
        unit: '',
        status: event.type,
        technician: '',
        notes: event.notes || '',
      })),
      ...(row.occurrenceOverrides || []).map((override) => ({
        timestamp: override.actualAt,
        scheduledTime: override.scheduledAt || '',
        category: 'Treatment',
        item: row.name,
        value: override.type === 'reschedule' ? `Rescheduled to ${formatTime(override.rescheduledTo)}` : '',
        unit: '',
        status: override.type,
        technician: override.technician || '',
        notes: override.notes || '',
      })),
    ]),
    ...record.medicationAdministrations.map((item) => ({
      timestamp: item.actualAt,
      scheduledTime: item.scheduledAt,
      category: 'Medication',
      item: item.medication,
      value: [
        formatConcentration(item.concentration, item.concentrationUnit),
        item.volumeMl ? `${formatMl(item.volumeMl)} mL` : '',
        item.route || '',
      ].filter(Boolean).join(' · '),
      unit: '',
      status: item.status,
      technician: item.technician,
      notes: item.notes,
    })),
    ...record.monitoringEntries.map((item) => ({
      timestamp: item.actualAt,
      scheduledTime: item.scheduledAt,
      category: item.category,
      item: item.item,
      value: valuesToText(item.values),
      unit: '',
      status: item.status,
      technician: item.technician,
      notes: item.notes,
    })),
    ...record.fluids.checks.map((item) => ({
      timestamp: item.actualAt,
      scheduledTime: item.scheduledAt,
      category: 'Fluids',
      item: 'Fluid volume check',
      value: `${item.currentCumulativeMl} mL cumulative; ${item.intervalMl} mL since prior`,
      unit: 'mL',
      status: 'documented',
      technician: item.technician,
      notes: item.notes,
    })),
    ...record.fluids.events.map((item) => ({
      timestamp: item.actualAt,
      scheduledTime: '',
      category: 'Fluids',
      item: item.item,
      value: item.value,
      unit: '',
      status: item.type,
      technician: item.technician || '',
      notes: item.notes,
    })),
    ...record.fluids.boluses.map((item) => ({
      timestamp: item.actualAt,
      scheduledTime: item.scheduledAt,
      category: 'Fluids',
      item: 'Fluid bolus',
      value: `${item.totalMl} mL over ${item.minutes} min`,
      unit: 'mL',
      status: item.status,
      technician: '',
      notes: item.notes,
    })),
    ...record.customEvents.map((item) => ({
      timestamp: item.actualAt,
      scheduledTime: item.scheduledHour,
      category: item.category,
      item: item.item,
      value: item.value,
      unit: item.unit,
      status: 'documented',
      technician: item.technician,
      notes: item.notes,
    })),
  ];

  return rows.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

export function timelineToCsv(record) {
  return toCsv(buildTimeline(record), [
    { key: 'timestamp', header: 'Timestamp' },
    { key: 'scheduledTime', header: 'Scheduled Time' },
    { key: 'category', header: 'Category' },
    { key: 'item', header: 'Item' },
    { key: 'value', header: 'Value' },
    { key: 'unit', header: 'Unit' },
    { key: 'status', header: 'Status' },
    { key: 'technician', header: 'Technician' },
    { key: 'notes', header: 'Notes' },
  ]);
}

export function getNextTreatment(record, now = new Date()) {
  const entries = [
    ...record.medicationAdministrations,
    ...record.monitoringEntries,
    ...record.fluids.checks,
  ];
  const next = occurrencesForRecord(record)
    .filter((occurrence) => !entries.some((entry) => entry.occurrenceKey === occurrence.key))
    .filter((occurrence) => !['skipped', 'held'].includes(occurrence.statusOverride))
    .filter((occurrence) => !occurrence.row.discontinuedAt || new Date(occurrence.scheduledAt) <= new Date(occurrence.row.discontinuedAt))
    .filter((occurrence) => new Date(occurrence.scheduledAt) >= now)
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))[0];

  return next ? `${next.row.name} at ${formatTime(next.scheduledAt)}` : 'No upcoming treatments';
}

export function duplicateTreatmentRow(record, rowId) {
  const row = record.treatmentSheet.rows.find((item) => item.id === rowId);
  if (!row) return record;

  const medication = row.medicationId ? record.medications.find((item) => item.id === row.medicationId) : null;
  const nextRowId = createId('row');
  const nextMedication = medication
    ? {
        ...medication,
        id: createId('med'),
        rowId: nextRowId,
        drugName: `${medication.drugName} copy`,
        createdAt: nowIso(),
      }
    : null;
  const nextRow = {
    ...row,
    id: nextRowId,
    name: `${row.name} copy`,
    medicationId: nextMedication?.id || '',
    occurrenceOverrides: [],
    lifecycleEvents: [
      {
        id: createId('lifecycle'),
        type: 'duplicated',
        actualAt: nowIso(),
        summary: `Copied from ${row.name}`,
      },
    ],
    schedulePeriods: (row.schedulePeriods || []).map((period) => ({
      ...period,
      id: createId('schedule-period'),
    })),
    discontinuedAt: '',
    createdAt: nowIso(),
  };

  return {
    ...record,
    medications: nextMedication ? [...record.medications, nextMedication] : record.medications,
    treatmentSheet: {
      ...record.treatmentSheet,
      rows: [...record.treatmentSheet.rows, nextRow],
    },
  };
}

function maybeDiscontinueRow(treatmentSheet, rowId, payload, actualAt) {
  if (!rowId || payload.status !== 'discontinued') {
    return treatmentSheet;
  }

  return {
    ...treatmentSheet,
    rows: treatmentSheet.rows.map((row) =>
      row.id === rowId ? { ...row, discontinuedAt: actualAt } : row,
    ),
  };
}

function valuesToText(values = {}) {
  return Object.entries(values)
    .filter(([, value]) => value !== '' && value !== null && value !== undefined)
    .map(([key, value]) => `${key}: ${value}`)
    .join('; ');
}

function fluidEventLabel(type) {
  return {
    rateChange: 'Fluid Rate Change',
    pause: 'Pause Fluids',
    restart: 'Restart Fluids',
    discontinue: 'Discontinue Fluids',
  }[type] || 'Fluid Event';
}

function applyOccurrenceOverride(row, occurrence, windowStart) {
  const override = (row.occurrenceOverrides || []).find(
    (item) => item.scheduledAt === occurrence.scheduledAt,
  );
  if (!override) return occurrence;
  if (override.type === 'skip' || override.type === 'hold') {
    return {
      ...occurrence,
      override,
      statusOverride: override.type === 'skip' ? 'skipped' : 'held',
    };
  }
  if (override.type === 'reschedule') {
    const rescheduledDate = new Date(override.rescheduledTo);
    const hourIndex = Math.round((rescheduledDate.getTime() - windowStart.getTime()) / (60 * 60 * 1000));
    if (hourIndex < 0 || hourIndex > 23) return null;
    return {
      ...occurrence,
      originalScheduledAt: occurrence.scheduledAt,
      scheduledAt: rescheduledDate.toISOString(),
      key: getOccurrenceKey(row.id, rescheduledDate.toISOString()),
      hourIndex,
      override,
      rescheduledTo: rescheduledDate.toISOString(),
    };
  }
  return occurrence;
}

function scheduleSummary(schedule) {
  if (!schedule) return 'No active schedule';
  if (schedule.type === 'specificTimes') return `Specific times: ${(schedule.times || []).join(', ')}`;
  if (schedule.type === 'once') return `Once at ${schedule.firstDueTime || schedule.firstDueAt || ''}`;
  if (schedule.type === 'prn') return 'PRN';
  return `q${schedule.intervalHours}h`;
}
