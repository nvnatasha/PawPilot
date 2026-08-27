export const BREATHING_CIRCUIT_WEIGHT_THRESHOLD_KG = 7;

export const CIRCUIT_TYPES = {
  NON_REBREATHING: 'Non-Rebreathing',
  REBREATHING: 'Rebreathing',
};

export const COMMON_BAG_SIZES_L = [0.5, 1, 2, 3, 5];

export const OXYGEN_REFERENCE_RATES_ML_KG_MIN = {
  [CIRCUIT_TYPES.NON_REBREATHING]: 200,
  [CIRCUIT_TYPES.REBREATHING]: 30,
};

export const FLUID_TYPES = ['LRS', 'Normosol-R', 'Plasma-Lyte', '0.9% NaCl', 'Other'];

export const ROUTES = ['IV', 'IM', 'SQ', 'PO', 'CRI', 'Other'];
