export const SHEET_START_HOUR = 8;
export const DAY_SHIFT_HOURS = 12;

export const TREATMENT_TYPES = [
  'Medication',
  'TPR',
  'BG',
  'PCV/TS',
  'Lactate',
  'BP',
  'Fluid volume check',
  'Walk',
  'Feed',
  'Urine output',
  'Drain output',
  'Neuro check',
  'Incision check',
  'Oxygen check',
  'Weight',
  'PRN',
  'Custom',
];

export const EVENT_TYPES = [
  'BG',
  'PCV/TS',
  'Lactate',
  'Blood pressure',
  'Urine output',
  'Drain output',
  'Weight',
  'Feed',
  'Water',
  'Walk',
  'Vomiting',
  'Stool',
  'Urination',
  'Incision check',
  'Neuro check',
  'Oxygen setting',
  'ECG',
  'Bloodwork',
  'Note',
  'Other',
];

export const WARD_LOCATIONS = ['ICU', 'Treatment', 'Isolation', 'Oxygen', 'Recovery', 'Other'];

export const SCHEDULE_OPTIONS = [
  { label: 'q1h', value: '1' },
  { label: 'q2h', value: '2' },
  { label: 'q4h', value: '4' },
  { label: 'q6h', value: '6' },
  { label: 'q8h', value: '8' },
  { label: 'q12h', value: '12' },
  { label: 'q24h', value: '24' },
  { label: 'Once', value: 'once' },
  { label: 'Custom interval', value: 'custom' },
  { label: 'Specific times', value: 'specificTimes' },
  { label: 'PRN', value: 'prn' },
];

export const FLUID_TYPES = ['LRS', 'Normosol-R', 'Plasma-Lyte', '0.9% NaCl', 'D5W', 'Other'];

export const ENTRY_STATUSES = {
  COMPLETED: 'completed',
  GIVEN: 'given',
  HELD: 'held',
  DISCONTINUED: 'discontinued',
};
