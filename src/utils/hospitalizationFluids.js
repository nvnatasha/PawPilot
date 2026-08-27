export function calculateRateFromMlHr(weightKg, mlHr) {
  const weight = positive(weightKg);
  const rate = positive(mlHr);
  if (!weight || !rate) return null;
  return { mlKgHr: rate / weight };
}

export function calculateRateFromMlKgHr(weightKg, mlKgHr) {
  const weight = positive(weightKg);
  const rate = positive(mlKgHr);
  if (!weight || !rate) return null;
  return { mlHr: rate * weight };
}

export function calculateFluidCheck({
  currentCumulativeMl,
  previousCumulativeMl = 0,
  baselineMl = 0,
  bagSizeMl,
  priorHospitalizationTotalMl = 0,
  weightKg,
}) {
  const current = positiveOrZero(currentCumulativeMl);
  const previous = positiveOrZero(previousCumulativeMl);
  const baseline = positiveOrZero(baselineMl);
  const priorTotal = positiveOrZero(priorHospitalizationTotalMl);

  if (current === null || previous === null || baseline === null || priorTotal === null) {
    return null;
  }

  const effectivePrevious = previous || baseline;
  const intervalMl = current - effectivePrevious;
  if (intervalMl < 0) {
    return null;
  }

  const hospitalizationTotalMl = priorTotal + intervalMl;
  const bagSize = positive(bagSizeMl);

  return {
    intervalMl,
    currentBagTotalMl: Math.max(0, current - baseline),
    hospitalizationTotalMl,
    hospitalizationMlKg: positive(weightKg) ? hospitalizationTotalMl / Number(weightKg) : null,
    remainingBagMl: bagSize ? Math.max(0, bagSize - current) : null,
  };
}

export function addFluidCheck(record, check) {
  const activeBag = record.fluids.bags.find((bag) => bag.id === record.fluids.activeBagId);
  const checks = [...record.fluids.checks]
    .filter((item) => item.bagId === activeBag?.id)
    .sort(
    (a, b) => new Date(a.actualAt) - new Date(b.actualAt),
  );
  const lastCheck = checks.at(-1);
  const derived = calculateFluidCheck({
    currentCumulativeMl: check.currentCumulativeMl,
    previousCumulativeMl: lastCheck?.currentCumulativeMl ?? activeBag?.baselineMl ?? 0,
    baselineMl: activeBag?.baselineMl ?? 0,
    bagSizeMl: activeBag?.bagSizeMl,
    priorHospitalizationTotalMl: record.fluids.hospitalizationTotalMl,
    weightKg: check.weightKg,
  });

  if (!derived) {
    return null;
  }

  return {
    ...check,
    bagId: activeBag?.id || '',
    ...derived,
  };
}

export function startNewBag(record, bag) {
  const previousBag = record.fluids.bags.find((item) => item.id === record.fluids.activeBagId);
  const finalAmount = Number(bag.previousBagFinalMl || 0);
  const lastCheck = [...record.fluids.checks]
    .sort((a, b) => new Date(a.actualAt) - new Date(b.actualAt))
    .at(-1);
  const priorCumulative = Number(lastCheck?.currentCumulativeMl ?? previousBag?.baselineMl ?? 0);
  const additionalMl = Math.max(0, finalAmount - priorCumulative);
  const event = {
    id: bag.eventId,
    type: 'newBag',
    actualAt: bag.actualAt,
    item: 'Hang New Bag',
    value: previousBag ? `${previousBag.fluidType} final ${finalAmount} mL` : '',
    notes: bag.notes || '',
  };

  return {
    ...record,
    fluids: {
      ...record.fluids,
      activeBagId: bag.id,
      hospitalizationTotalMl: record.fluids.hospitalizationTotalMl + additionalMl,
      bags: [
        ...record.fluids.bags.map((item) =>
          item.id === previousBag?.id ? { ...item, completedAt: bag.actualAt, finalMl: finalAmount } : item,
        ),
        {
          id: bag.id,
          fluidType: bag.fluidType,
          customType: bag.customType || '',
          bagSizeMl: Number(bag.bagSizeMl) || 0,
          baselineMl: Number(bag.baselineMl) || 0,
          additives: bag.additives || [],
          startedAt: bag.actualAt,
        },
      ],
      events: [...record.fluids.events, event],
    },
  };
}

export function resetPumpBaseline(record, event) {
  return {
    ...record,
    fluids: {
      ...record.fluids,
      bags: record.fluids.bags.map((bag) =>
        bag.id === record.fluids.activeBagId ? { ...bag, baselineMl: Number(event.baselineMl) || 0 } : bag,
      ),
      events: [
        ...record.fluids.events,
        {
          id: event.id,
          type: 'baselineReset',
          actualAt: event.actualAt,
          item: 'Reset Pump Baseline',
          value: `${Number(event.baselineMl) || 0} mL baseline`,
          notes: event.notes || '',
        },
      ],
    },
  };
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function positiveOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
