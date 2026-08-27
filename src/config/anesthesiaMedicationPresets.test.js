import { describe, expect, it } from 'vitest';
import {
  ANESTHESIA_MEDICATION_PRESETS,
  filterMedicationPresets,
  findMedicationPreset,
} from './anesthesiaMedicationPresets.js';

describe('anesthesiaMedicationPresets', () => {
  it('stores preset concentrations without medication doses', () => {
    expect(findMedicationPreset('buprenorphine')).toMatchObject({
      displayName: 'Buprenorphine',
      concentration: 0.6,
      concentrationUnit: 'mg/mL',
    });
    expect(findMedicationPreset('propofol')).toMatchObject({
      displayName: 'Propofol',
      concentration: 10,
      concentrationUnit: 'mg/mL',
    });
    expect(ANESTHESIA_MEDICATION_PRESETS.some((preset) => 'dose' in preset)).toBe(false);
  });

  it('does not invent starter concentrations when none are established', () => {
    expect(findMedicationPreset('dexmedetomidine')).toMatchObject({
      displayName: 'Dexmedetomidine',
      concentration: '',
      requiresConcentrationConfirmation: true,
    });
    expect(findMedicationPreset('butorphanol')).toMatchObject({
      displayName: 'Butorphanol (Torbugesic)',
      concentration: '',
      requiresConcentrationConfirmation: true,
    });
  });

  it('filters common medications by name and alias', () => {
    expect(filterMedicationPresets('bup').map((preset) => preset.id)).toContain('buprenorphine');
    expect(filterMedicationPresets('torb').map((preset) => preset.id)).toContain('butorphanol');
  });
});
