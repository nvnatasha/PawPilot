import { describe, expect, it } from 'vitest';
import {
  calculateDrugDose,
  calculateFluidBolus,
  calculateFluidRate,
  calculateOxygenFlow,
  calculateReservoirBag,
  suggestCommonBagSize,
} from './anesthesiaCalculations.js';

describe('anesthesia calculations', () => {
  it('calculates reservoir bag tidal and capacity ranges', () => {
    expect(calculateReservoirBag(20)).toMatchObject({
      tidalVolumeLowMl: 200,
      tidalVolumeHighMl: 300,
      reservoirLowMl: 1200,
      reservoirHighMl: 1800,
    });
  });

  it('rounds up to a common bag size that covers the high range', () => {
    expect(suggestCommonBagSize(1800)).toBe(2);
    expect(suggestCommonBagSize(2200)).toBe(3);
  });

  it('calculates oxygen flow in mL/min and L/min', () => {
    expect(calculateOxygenFlow(22.4, 30)).toEqual({
      mlMin: 672,
      lMin: 0.672,
    });
  });

  it('calculates surgical fluid rate', () => {
    expect(calculateFluidRate(22.4, 5)).toEqual({
      mlHr: 112,
    });
  });

  it('calculates fluid bolus total volume and pump rate', () => {
    expect(calculateFluidBolus(22.4, 10, 15)).toEqual({
      totalMl: 224,
      pumpRateMlHr: 896,
    });
  });

  it('calculates mg/kg dose with mg/mL concentration', () => {
    expect(
      calculateDrugDose({
        weightKg: 22,
        dose: 4,
        doseUnit: 'mg/kg',
        concentration: 10,
        concentrationUnit: 'mg/mL',
      }),
    ).toMatchObject({
      totalDose: 88,
      totalDoseUnit: 'mg',
      volumeMl: 8.8,
    });
  });

  it('calculates ug/kg dose with ug/mL concentration', () => {
    expect(
      calculateDrugDose({
        weightKg: 10,
        dose: 5,
        doseUnit: 'ug/kg',
        concentration: 500,
        concentrationUnit: 'ug/mL',
      }),
    ).toMatchObject({
      totalDose: 50,
      totalDoseUnit: 'ug',
      volumeMl: 0.1,
    });
  });

  it('handles mg to ug concentration conversions', () => {
    const result = calculateDrugDose({
      weightKg: 5,
      dose: 0.02,
      doseUnit: 'mg/kg',
      concentration: 100,
      concentrationUnit: 'ug/mL',
    });

    expect(result.totalDose).toBeCloseTo(0.1);
    expect(result.volumeMl).toBeCloseTo(1);
  });

  it('handles ug to mg concentration conversions', () => {
    const result = calculateDrugDose({
      weightKg: 4,
      dose: 25,
      doseUnit: 'ug/kg',
      concentration: 0.5,
      concentrationUnit: 'mg/mL',
    });

    expect(result.totalDose).toBe(100);
    expect(result.volumeMl).toBeCloseTo(0.2);
  });

  it('returns null for invalid numeric inputs', () => {
    expect(calculateOxygenFlow(10, 0)).toBeNull();
    expect(calculateFluidRate(-1, 5)).toBeNull();
    expect(calculateFluidBolus(10, 5, '')).toBeNull();
    expect(
      calculateDrugDose({
        weightKg: 10,
        dose: 1,
        doseUnit: 'mg/kg',
        concentration: 0,
        concentrationUnit: 'mg/mL',
      }),
    ).toBeNull();
  });

  it('retains very small drug volumes instead of rounding them to zero', () => {
    const result = calculateDrugDose({
      weightKg: 1,
      dose: 1,
      doseUnit: 'ug/kg',
      concentration: 1000,
      concentrationUnit: 'ug/mL',
    });

    expect(result.volumeMl).toBe(0.001);
  });
});
