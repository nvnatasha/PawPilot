import { beforeEach, describe, expect, it } from 'vitest';
import { patientService } from './patientService.js';

describe('patientService', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('creates and persists a patient in localStorage', () => {
    const patient = patientService.create({
      name: 'Milo',
      species: 'Canine',
      weightKg: 18.4,
      weightLb: 40.565008,
      age: '',
      sexStatus: '',
      reason: 'Splenectomy',
      workflow: 'both',
    });

    expect(patient.id).toBeTruthy();
    expect(patient.createdAt).toBeTruthy();
    expect(patientService.getById(patient.id)).toMatchObject({
      name: 'Milo',
      workflow: 'both',
    });
    expect(patientService.list()).toHaveLength(1);
  });
});
