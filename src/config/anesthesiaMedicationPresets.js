export const MEDICATION_STAGES = [
  'Premedication',
  'Induction',
  'Intraoperative',
  'Emergency / Additional',
  'Other',
];

export const CUSTOM_MEDICATION_PRESET_ID = 'custom';

export const ANESTHESIA_MEDICATION_PRESETS = [
  {
    id: 'buprenorphine',
    displayName: 'Buprenorphine',
    concentration: 0.6,
    concentrationUnit: 'mg/mL',
    aliases: ['Buprenex'],
  },
  {
    id: 'dexmedetomidine',
    displayName: 'Dexmedetomidine',
    concentration: '',
    concentrationUnit: 'ug/mL',
    aliases: ['Dexdomitor'],
    requiresConcentrationConfirmation: true,
  },
  {
    id: 'butorphanol',
    displayName: 'Butorphanol (Torbugesic)',
    concentration: '',
    concentrationUnit: 'mg/mL',
    aliases: ['Torbugesic'],
    requiresConcentrationConfirmation: true,
  },
  {
    id: 'propofol',
    displayName: 'Propofol',
    concentration: 10,
    concentrationUnit: 'mg/mL',
    aliases: [],
  },
];

export function findMedicationPreset(presetId) {
  return ANESTHESIA_MEDICATION_PRESETS.find((preset) => preset.id === presetId) || null;
}

export function filterMedicationPresets(searchTerm) {
  const normalizedSearch = String(searchTerm || '').trim().toLowerCase();

  if (!normalizedSearch) {
    return ANESTHESIA_MEDICATION_PRESETS;
  }

  return ANESTHESIA_MEDICATION_PRESETS.filter((preset) => {
    const searchableText = [preset.displayName, ...(preset.aliases || [])].join(' ').toLowerCase();
    return searchableText.includes(normalizedSearch);
  });
}
