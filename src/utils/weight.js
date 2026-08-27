export const KG_TO_LB = 2.20462;

export function kgToLb(kg) {
  return Number(kg) * KG_TO_LB;
}

export function lbToKg(lb) {
  return Number(lb) / KG_TO_LB;
}

export function normalizeWeight(value, unit) {
  const numericWeight = Number(value);

  if (!Number.isFinite(numericWeight) || numericWeight <= 0) {
    return { weightKg: null, weightLb: null };
  }

  if (unit === 'lb') {
    return {
      weightKg: lbToKg(numericWeight),
      weightLb: numericWeight,
    };
  }

  return {
    weightKg: numericWeight,
    weightLb: kgToLb(numericWeight),
  };
}

export function formatWeight(value) {
  if (!Number.isFinite(Number(value))) {
    return '';
  }

  return Number(value).toFixed(1);
}
