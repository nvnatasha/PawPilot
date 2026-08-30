import { createId } from './hospitalizationService.js';

const STORAGE_KEY = 'pawpilot.shiftHandoffs.v1';

function readFromStorage() {
  if (typeof window === 'undefined') return [];

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

function nowIso() {
  return new Date().toISOString();
}

function defaultHandoff(values = {}) {
  const createdAt = nowIso();
  return {
    id: values.id || createId('handoff'),
    patientId: values.patientId,
    hospitalizationId: values.hospitalizationId,
    status: values.status || 'draft',
    handoffAt: values.handoffAt || createdAt,
    outgoingTechnician: values.outgoingTechnician || '',
    incomingTechnician: values.incomingTechnician || '',
    shiftLabel: values.shiftLabel || 'Day',
    customShiftLabel: values.customShiftLabel || '',
    notes: values.notes || '',
    followUpItems: values.followUpItems || [],
    snapshot: values.snapshot || null,
    createdAt: values.createdAt || createdAt,
    updatedAt: values.updatedAt || createdAt,
  };
}

export function normalizeHandoff(record) {
  if (!record) return record;
  return defaultHandoff(record);
}

export const handoffService = {
  list() {
    return readFromStorage().map(normalizeHandoff);
  },

  listByHospitalizationId(hospitalizationId) {
    return this.list()
      .filter((handoff) => handoff.hospitalizationId === hospitalizationId)
      .sort((a, b) => new Date(b.handoffAt) - new Date(a.handoffAt));
  },

  getById(id) {
    return this.list().find((handoff) => handoff.id === id) || null;
  },

  getOrCreateDraft({ patientId, hospitalizationId }) {
    const existingDraft = this.list()
      .find((handoff) => handoff.patientId === patientId && handoff.hospitalizationId === hospitalizationId && handoff.status === 'draft');
    if (existingDraft) return existingDraft;

    const draft = defaultHandoff({ patientId, hospitalizationId });
    writeToStorage([draft, ...readFromStorage()]);
    return draft;
  },

  save(record) {
    const records = readFromStorage();
    const nextRecord = normalizeHandoff({ ...record, updatedAt: nowIso() });
    const exists = records.some((item) => item.id === nextRecord.id);
    writeToStorage(
      exists
        ? records.map((item) => (item.id === nextRecord.id ? nextRecord : item))
        : [nextRecord, ...records],
    );
    return nextRecord;
  },

  finalize(record, snapshot) {
    return this.save({
      ...record,
      status: 'finalized',
      handoffAt: record.handoffAt || nowIso(),
      snapshot,
    });
  },

  createNewDraft({ patientId, hospitalizationId }) {
    const draft = defaultHandoff({ patientId, hospitalizationId });
    writeToStorage([draft, ...readFromStorage()]);
    return draft;
  },

  clear() {
    window.localStorage.removeItem(STORAGE_KEY);
  },
};
