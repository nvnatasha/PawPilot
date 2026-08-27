export function hasMeaningfulValue(value) {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  return true;
}

export function hasMeaningfulObjectData(object = {}) {
  return Object.values(object).some(hasMeaningfulValue);
}

export function getUsedColumns(rows, columns) {
  return columns.filter((column) => {
    if (column.required) {
      return true;
    }

    return rows.some((row) => hasMeaningfulValue(column.value(row)));
  });
}

export function getTprEntries(entries = []) {
  return entries
    .filter((entry) => entry.category === 'TPR' || entry.item === 'TPR')
    .sort((a, b) => new Date(a.actualAt) - new Date(b.actualAt));
}

export function getOtherMonitoringEntries(entries = []) {
  return entries
    .filter((entry) => entry.category !== 'TPR' && entry.item !== 'TPR')
    .sort((a, b) => new Date(a.actualAt) - new Date(b.actualAt));
}

export function formatTemperature(values = {}) {
  if (!hasMeaningfulValue(values.temperature)) {
    return '';
  }

  return `${values.temperature}${values.temperatureUnit ? `°${values.temperatureUnit}` : ''}`;
}

export function formatBloodPressure(values = {}) {
  const systolic = values.systolicBp;
  const diastolic = values.diastolicBp;
  const mean = values.meanBp;
  const hasSystolic = hasMeaningfulValue(systolic);
  const hasDiastolic = hasMeaningfulValue(diastolic);
  const hasMean = hasMeaningfulValue(mean);

  if (hasSystolic && hasDiastolic) {
    return `${systolic}/${diastolic}${hasMean ? ` (MAP ${mean})` : ''}`;
  }

  if (hasSystolic) {
    return `Systolic ${systolic}${hasMean ? ` (MAP ${mean})` : ''}`;
  }

  if (hasDiastolic) {
    return `Diastolic ${diastolic}${hasMean ? ` (MAP ${mean})` : ''}`;
  }

  if (hasMean) {
    return `MAP ${mean}`;
  }

  return '';
}

export function formatMonitoringValue(entry) {
  const values = entry.values || {};

  if (entry.category === 'PCV/TS' || entry.item === 'PCV/TS') {
    const pcv = hasMeaningfulValue(values.pcv) ? `PCV ${values.pcv}%` : '';
    const ts = hasMeaningfulValue(values.ts) ? `TS ${values.ts} g/dL` : '';
    return [pcv, ts].filter(Boolean).join(' / ');
  }

  if (hasMeaningfulValue(values.bg)) {
    return `${values.bg}${values.bgUnit ? ` ${values.bgUnit}` : ''}`;
  }

  if (hasMeaningfulValue(values.value)) {
    return values.value;
  }

  return Object.entries(values)
    .filter(([, value]) => hasMeaningfulValue(value))
    .map(([key, value]) => `${humanizeKey(key)} ${value}`)
    .join('; ');
}

export function getTprColumns(entries) {
  return getUsedColumns(entries, [
    { key: 'actualAt', label: 'Time', required: true, value: (entry) => entry.actualAt },
    { key: 'temperature', label: 'Temp', value: (entry) => formatTemperature(entry.values) },
    { key: 'hr', label: 'HR', value: (entry) => entry.values?.hr },
    { key: 'rr', label: 'RR', value: (entry) => entry.values?.rr },
    { key: 'bp', label: 'BP', value: (entry) => formatBloodPressure(entry.values) },
    { key: 'spo2', label: 'SpO₂', value: (entry) => entry.values?.spo2 },
    { key: 'painScore', label: 'Pain', value: (entry) => entry.values?.painScore },
    { key: 'mm', label: 'MM', value: (entry) => entry.values?.mm },
    { key: 'crt', label: 'CRT', value: (entry) => entry.values?.crt },
    { key: 'mentation', label: 'Mentation', value: (entry) => entry.values?.mentation },
    { key: 'bodyWeight', label: 'Weight', value: (entry) => entry.values?.bodyWeight },
    { key: 'notes', label: 'Notes', value: (entry) => entry.notes },
  ]);
}

export function getMarColumns(admins) {
  return getUsedColumns(admins, [
    { key: 'actualAt', label: 'Actual time', required: true, value: (admin) => admin.actualAt },
    { key: 'medication', label: 'Medication', required: true, value: (admin) => admin.medication },
    { key: 'dose', label: 'Dose', required: true, value: (admin) => admin.dose },
    { key: 'concentration', label: 'Concentration', value: (admin) => admin.concentration },
    { key: 'volumeMl', label: 'Volume', required: true, value: (admin) => admin.volumeMl },
    { key: 'route', label: 'Route', required: true, value: (admin) => admin.route },
    { key: 'status', label: 'Status', required: true, value: (admin) => admin.status },
    { key: 'technician', label: 'Technician', value: (admin) => admin.technician },
    { key: 'notes', label: 'Notes', value: (admin) => admin.notes },
  ]);
}

export function getOtherMonitoringColumns(entries) {
  return getUsedColumns(entries, [
    { key: 'actualAt', label: 'Time', required: true, value: (entry) => entry.actualAt },
    { key: 'item', label: 'Type', required: true, value: (entry) => entry.item },
    { key: 'value', label: 'Value', value: formatMonitoringValue },
    { key: 'unit', label: 'Unit', value: (entry) => entry.values?.unit },
    { key: 'secondaryValue', label: 'Secondary', value: (entry) => entry.values?.secondaryValue },
    { key: 'technician', label: 'Technician', value: (entry) => entry.technician },
    { key: 'notes', label: 'Notes', value: (entry) => entry.notes },
  ]);
}

function humanizeKey(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase());
}
