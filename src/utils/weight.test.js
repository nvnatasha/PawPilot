import { describe, expect, it } from 'vitest';
import { formatWeight, kgToLb, lbToKg, normalizeWeight } from './weight.js';

describe('weight utilities', () => {
  it('converts kg to lb without internal display rounding', () => {
    expect(kgToLb(18.4)).toBeCloseTo(40.565, 3);
  });

  it('converts lb to kg', () => {
    expect(lbToKg(40.6)).toBeCloseTo(18.416, 3);
  });

  it('normalizes entered weight into both units', () => {
    expect(normalizeWeight('10', 'kg')).toEqual({
      weightKg: 10,
      weightLb: 22.0462,
    });
  });

  it('formats weight to one decimal for display', () => {
    expect(formatWeight(40.565008)).toBe('40.6');
  });
});
