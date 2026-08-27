const STORAGE_KEY = 'pawpilot.patients.v1';

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

function writeToStorage(patients) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(patients));
}

function createId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `patient-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const patientService = {
  list() {
    return readFromStorage().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  getById(id) {
    return readFromStorage().find((patient) => patient.id === id) || null;
  },

  create(patient) {
    const patients = readFromStorage();
    const newPatient = {
      ...patient,
      id: createId(),
      createdAt: new Date().toISOString(),
    };

    writeToStorage([newPatient, ...patients]);
    return newPatient;
  },

  update(id, updates) {
    const patients = readFromStorage();
    const nextPatients = patients.map((patient) =>
      patient.id === id ? { ...patient, ...updates } : patient,
    );

    writeToStorage(nextPatients);
    return nextPatients.find((patient) => patient.id === id) || null;
  },

  remove(id) {
    const patients = readFromStorage().filter((patient) => patient.id !== id);
    writeToStorage(patients);
  },

  clear() {
    window.localStorage.removeItem(STORAGE_KEY);
  },
};
