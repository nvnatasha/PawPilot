import {
  BREATHING_CIRCUIT_WEIGHT_THRESHOLD_KG,
  CIRCUIT_TYPES,
  COMMON_BAG_SIZES_L,
} from '../config/anesthesiaConfig.js';

const ML_PER_L = 1000;
const MG_TO_UG = 1000;

function toPositiveNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
}

export function suggestBreathingCircuit(weightKg) {
  const normalizedWeight = toPositiveNumber(weightKg);
  if (!normalizedWeight) {
    return null;
  }

  return normalizedWeight < BREATHING_CIRCUIT_WEIGHT_THRESHOLD_KG
    ? CIRCUIT_TYPES.NON_REBREATHING
    : CIRCUIT_TYPES.REBREATHING;
}

export function calculateReservoirBag(weightKg) {
  const normalizedWeight = toPositiveNumber(weightKg);
  if (!normalizedWeight) {
    return null;
  }

  const tidalVolumeLowMl = normalizedWeight * 10;
  const tidalVolumeHighMl = normalizedWeight * 15;
  const reservoirLowMl = tidalVolumeLowMl * 6;
  const reservoirHighMl = tidalVolumeHighMl * 6;

  return {
    tidalVolumeLowMl,
    tidalVolumeHighMl,
    reservoirLowMl,
    reservoirHighMl,
    suggestedBagSizeL: suggestCommonBagSize(reservoirHighMl),
  };
}

export function suggestCommonBagSize(requiredHighMl) {
  const normalizedVolume = toPositiveNumber(requiredHighMl);
  if (!normalizedVolume) {
    return null;
  }

  const requiredL = normalizedVolume / ML_PER_L;
  return COMMON_BAG_SIZES_L.find((size) => size >= requiredL) || COMMON_BAG_SIZES_L.at(-1);
}

export function calculateOxygenFlow(weightKg, rateMlKgMin) {
  const normalizedWeight = toPositiveNumber(weightKg);
  const normalizedRate = toPositiveNumber(rateMlKgMin);
  if (!normalizedWeight || !normalizedRate) {
    return null;
  }

  const mlMin = normalizedWeight * normalizedRate;
  return {
    mlMin,
    lMin: mlMin / ML_PER_L,
  };
}

export function calculateFluidRate(weightKg, rateMlKgHr) {
  const normalizedWeight = toPositiveNumber(weightKg);
  const normalizedRate = toPositiveNumber(rateMlKgHr);
  if (!normalizedWeight || !normalizedRate) {
    return null;
  }

  return {
    mlHr: normalizedWeight * normalizedRate,
  };
}

export function calculateFluidBolus(weightKg, amountMlKg, minutes) {
  const normalizedWeight = toPositiveNumber(weightKg);
  const normalizedAmount = toPositiveNumber(amountMlKg);
  const normalizedMinutes = toPositiveNumber(minutes);
  if (!normalizedWeight || !normalizedAmount || !normalizedMinutes) {
    return null;
  }

  const totalMl = normalizedWeight * normalizedAmount;
  return {
    totalMl,
    pumpRateMlHr: totalMl / (normalizedMinutes / 60),
  };
}

function doseToMicrograms(totalDose, unit) {
  return unit === 'mg/kg' ? totalDose * MG_TO_UG : totalDose;
}

function concentrationToMicrogramsPerMl(concentration, unit) {
  return unit === 'mg/mL' ? concentration * MG_TO_UG : concentration;
}

function microgramsToDisplayUnit(totalMicrograms, doseUnit) {
  return doseUnit === 'mg/kg' ? totalMicrograms / MG_TO_UG : totalMicrograms;
}

export function calculateDrugDose({
  weightKg,
  dose,
  doseUnit,
  concentration,
  concentrationUnit,
}) {
  const normalizedWeight = toPositiveNumber(weightKg);
  const normalizedDose = toPositiveNumber(dose);
  const normalizedConcentration = toPositiveNumber(concentration);

  if (!normalizedWeight || !normalizedDose || !normalizedConcentration) {
    return null;
  }

  const dosePerKgMicrograms = doseToMicrograms(normalizedDose, doseUnit);
  const totalDoseMicrograms = normalizedWeight * dosePerKgMicrograms;
  const concentrationMicrogramsMl = concentrationToMicrogramsPerMl(
    normalizedConcentration,
    concentrationUnit,
  );

  return {
    totalDose: microgramsToDisplayUnit(totalDoseMicrograms, doseUnit),
    totalDoseUnit: doseUnit === 'mg/kg' ? 'mg' : 'ug',
    totalDoseMicrograms,
    volumeMl: totalDoseMicrograms / concentrationMicrogramsMl,
  };
}
