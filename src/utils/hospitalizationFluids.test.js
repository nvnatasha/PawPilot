import { describe, expect, it } from 'vitest';
import {
  addFluidCheck,
  calculateFluidCheck,
  calculateRateFromMlHr,
  calculateRateFromMlKgHr,
  resetPumpBaseline,
  startNewBag,
} from './hospitalizationFluids.js';

function baseRecord() {
  return {
    fluids: {
      activeBagId: 'bag-1',
      hospitalizationTotalMl: 0,
      checks: [],
      bags: [{ id: 'bag-1', bagSizeMl: 1000, baselineMl: 0, fluidType: 'LRS' }],
      events: [],
    },
  };
}

describe('hospitalization fluid utilities', () => {
  it('calculates mL/hr and mL/kg/hr conversions', () => {
    expect(calculateRateFromMlHr(20, 80).mlKgHr).toBe(4);
    expect(calculateRateFromMlKgHr(20, 4).mlHr).toBe(80);
  });

  it('derives interval volumes and running totals from cumulative readings', () => {
    let record = baseRecord();
    const check1 = addFluidCheck(record, {
      id: 'check-1',
      actualAt: '2026-08-26T10:00:00.000Z',
      currentCumulativeMl: 150,
      weightKg: 20,
    });
    record = { ...record, fluids: { ...record.fluids, checks: [check1], hospitalizationTotalMl: check1.hospitalizationTotalMl } };

    const check2 = addFluidCheck(record, {
      id: 'check-2',
      actualAt: '2026-08-26T12:00:00.000Z',
      currentCumulativeMl: 300,
      weightKg: 20,
    });
    record = { ...record, fluids: { ...record.fluids, checks: [...record.fluids.checks, check2], hospitalizationTotalMl: check2.hospitalizationTotalMl } };

    const check3 = addFluidCheck(record, {
      id: 'check-3',
      actualAt: '2026-08-26T14:00:00.000Z',
      currentCumulativeMl: 455,
      weightKg: 20,
    });

    expect([check1.intervalMl, check2.intervalMl, check3.intervalMl]).toEqual([150, 150, 155]);
    expect(check3.hospitalizationTotalMl).toBe(455);
    expect(check3.remainingBagMl).toBe(545);
  });

  it('keeps hospitalization total across new bags', () => {
    let record = baseRecord();
    const check = addFluidCheck(record, {
      id: 'check-1',
      actualAt: '2026-08-26T18:00:00.000Z',
      currentCumulativeMl: 900,
      weightKg: 20,
    });
    record = { ...record, fluids: { ...record.fluids, checks: [check], hospitalizationTotalMl: 900 } };
    record = startNewBag(record, {
      id: 'bag-2',
      eventId: 'event-1',
      actualAt: '2026-08-26T19:00:00.000Z',
      previousBagFinalMl: 900,
      fluidType: 'LRS',
      bagSizeMl: 1000,
      baselineMl: 0,
    });

    const newBagCheck = addFluidCheck(record, {
      id: 'check-2',
      actualAt: '2026-08-26T21:00:00.000Z',
      currentCumulativeMl: 120,
      weightKg: 20,
    });

    expect(newBagCheck.intervalMl).toBe(120);
    expect(newBagCheck.hospitalizationTotalMl).toBe(1020);
  });

  it('handles pump baseline reset without corrupting totals', () => {
    const record = resetPumpBaseline(baseRecord(), {
      id: 'reset-1',
      actualAt: '2026-08-26T11:00:00.000Z',
      baselineMl: 10,
    });

    expect(record.fluids.bags[0].baselineMl).toBe(10);
    expect(record.fluids.hospitalizationTotalMl).toBe(0);
  });

  it('rejects impossible lower cumulative readings', () => {
    expect(
      calculateFluidCheck({
        currentCumulativeMl: 100,
        previousCumulativeMl: 150,
      }),
    ).toBeNull();
  });
});
