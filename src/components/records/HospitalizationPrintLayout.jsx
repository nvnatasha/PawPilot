import { buildTimeline, occurrencesForRecord } from '../../services/hospitalizationService.js';
import {
  formatBloodPressure,
  formatMonitoringValue,
  formatTemperature,
  getMarColumns,
  getOtherMonitoringColumns,
  getOtherMonitoringEntries,
  getTprColumns,
  getTprEntries,
  hasMeaningfulValue,
} from '../../utils/clinicalDisplay.js';
import { formatConcentration, formatMl, formatNumber } from '../../utils/formatters.js';
import { formatTime, generateSheetHours, getOccurrenceKey } from '../../utils/hospitalizationSchedule.js';
import { formatWeight } from '../../utils/weight.js';

function entryFor(record, rowId, scheduledAt) {
  const key = getOccurrenceKey(rowId, scheduledAt);
  return (
    record.medicationAdministrations.find((item) => item.occurrenceKey === key) ||
    record.monitoringEntries.find((item) => item.occurrenceKey === key) ||
    record.fluids.checks.find((item) => item.occurrenceKey === key)
  );
}

function cellText(record, row, hour) {
  const occurrence = occurrencesForRecord(record).find(
    (item) => item.rowId === row.id && item.hourIndex === hour.index,
  );
  if (!occurrence) return row.type === 'PRN' ? 'PRN' : '';
  if (occurrence.statusOverride === 'skipped') return 'Skipped';
  if (occurrence.statusOverride === 'held') return 'Held';
  const entry = entryFor(record, row.id, occurrence.scheduledAt);
  if (entry?.status === 'held') return 'Held';
  if (entry?.status === 'discontinued') return 'D/C';
  if (entry) return 'Done';
  if (row.discontinuedAt && new Date(occurrence.scheduledAt) > new Date(row.discontinuedAt)) return 'D/C';
  return 'Due';
}

function tprValue(column, entry) {
  const values = entry.values || {};
  if (column.key === 'actualAt') return formatTime(entry.actualAt);
  if (column.key === 'temperature') return formatTemperature(values);
  if (column.key === 'bp') return formatBloodPressure(values);
  if (column.key === 'notes') return entry.notes;
  return values[column.key] ?? '';
}

function marValue(column, admin) {
  if (column.key === 'actualAt') return formatTime(admin.actualAt);
  if (column.key === 'dose') return `${admin.dose} ${admin.doseUnit}`;
  if (column.key === 'concentration') return formatConcentration(admin.concentration, admin.concentrationUnit);
  if (column.key === 'volumeMl') return `${formatMl(admin.volumeMl)} mL`;
  return admin[column.key] ?? '';
}

function rowMedication(record, row) {
  return row.medicationId ? record.medications.find((item) => item.id === row.medicationId) : null;
}

function rowConcentration(record, row) {
  const medication = rowMedication(record, row);
  return formatConcentration(medication?.concentration, medication?.concentrationUnit);
}

function otherValue(column, entry) {
  if (column.key === 'actualAt') return formatTime(entry.actualAt);
  if (column.key === 'value') return formatMonitoringValue(entry);
  if (column.key === 'unit' || column.key === 'secondaryValue') return entry.values?.[column.key] ?? '';
  return entry[column.key] ?? '';
}

function hasFluidData(record) {
  return (
    record.fluids.plans.length > 0 ||
    record.fluids.checks.length > 0 ||
    record.fluids.events.length > 0 ||
    record.fluids.boluses.length > 0 ||
    record.fluids.hospitalizationTotalMl > 0
  );
}

function detail(label, value) {
  if (!hasMeaningfulValue(value)) return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export default function HospitalizationPrintLayout({ patient, record }) {
  const hours = generateSheetHours(record.sheetDate);
  const timeline = buildTimeline(record).filter((item) => item.category !== 'TPR');
  const tprEntries = getTprEntries(record.monitoringEntries);
  const tprColumns = getTprColumns(tprEntries);
  const otherMonitoringEntries = getOtherMonitoringEntries(record.monitoringEntries);
  const otherColumns = getOtherMonitoringColumns(otherMonitoringEntries);
  const marColumns = getMarColumns(record.medicationAdministrations);
  const location = record.location === 'Other' ? record.customLocation : record.location;

  return (
    <article className="print-record hospitalization-print" aria-label="Printable hospitalization record">
      <header className="print-header">
        <div>
          <h1>PawPilot — Hospitalization Treatment Record</h1>
          <p>24-hour treatment sheet and patient-care history</p>
        </div>
        <div>
          <strong>{record.status === 'ended' ? 'Ended' : 'Active'}</strong>
          {record.startedAt && <span>{formatTime(record.startedAt)} start</span>}
          {record.endedAt && <span>{formatTime(record.endedAt)} end</span>}
        </div>
      </header>

      <section className="print-section">
        <h2>Patient</h2>
        <dl className="print-details">
          {detail('Patient', patient.name)}
          {detail('Species', patient.species)}
          {detail('Weight', `${formatWeight(patient.weightKg)} kg / ${formatWeight(patient.weightLb)} lb`)}
          {detail('Started', record.startedAt ? formatTime(record.startedAt) : '')}
          {detail('Ended', record.endedAt ? formatTime(record.endedAt) : '')}
          {detail('Current sheet', record.sheetDate)}
          {detail('Reason', patient.reason)}
          {detail('Veterinarian', record.veterinarian)}
          {detail('Technician', record.technician)}
          {detail('Location', location)}
        </dl>
      </section>

      {record.treatmentSheet.rows.length > 0 && (
        <section className="print-section">
          <h2>24-Hour Treatment Sheet</h2>
          <table className="print-grid-table">
            <thead>
              <tr>
                <th>Treatment</th>
                {hours.map((hour) => (
                  <th className={hour.shift.toLowerCase()} key={hour.iso}>
                    {hour.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {record.treatmentSheet.rows.map((row) => (
                <tr key={row.id}>
                  <th>
                    {row.name}
                    {rowConcentration(record, row) && <span className="print-subline">{rowConcentration(record, row)}</span>}
                  </th>
                  {hours.map((hour) => (
                    <td key={hour.iso}>{cellText(record, row, hour)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {record.medicationAdministrations.length > 0 && (
        <section className="print-section">
          <h2>Medication Administration Record</h2>
          <table>
            <thead>
              <tr>
                {marColumns.map((column) => (
                  <th key={column.key}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {record.medicationAdministrations.map((admin) => (
                <tr key={admin.id}>
                  {marColumns.map((column) => (
                    <td key={column.key}>{marValue(column, admin)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tprEntries.length > 0 && (
        <section className="print-section">
          <h2>TPR / Monitoring</h2>
          <table>
            <thead>
              <tr>
                {tprColumns.map((column) => (
                  <th key={column.key}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tprEntries.map((entry) => (
                <tr key={entry.id}>
                  {tprColumns.map((column) => (
                    <td key={column.key}>{tprValue(column, entry)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {otherMonitoringEntries.length > 0 && (
        <section className="print-section">
          <h2>Labs / Other Monitoring</h2>
          <table>
            <thead>
              <tr>
                {otherColumns.map((column) => (
                  <th key={column.key}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {otherMonitoringEntries.map((entry) => (
                <tr key={entry.id}>
                  {otherColumns.map((column) => (
                    <td key={column.key}>{otherValue(column, entry)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {hasFluidData(record) && (
        <section className="print-section">
          <h2>Fluid Therapy</h2>

          {record.fluids.plans.length > 0 && (
            <>
              <h3>Plans</h3>
              <ul>
                {record.fluids.plans.map((plan) => (
                  <li key={plan.id}>
                    {[plan.fluidType === 'Other' ? plan.customType : plan.fluidType, `${formatNumber(plan.rateMlHr)} mL/hr`, `${formatNumber(plan.rateMlKgHr, { maximumFractionDigits: 2 })} mL/kg/hr`, plan.notes]
                      .filter(hasMeaningfulValue)
                      .join(' · ')}
                  </li>
                ))}
              </ul>
            </>
          )}

          {record.fluids.checks.length > 0 && (
            <>
              <h3>Volume Checks</h3>
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Running Total</th>
                    <th>Since Previous</th>
                    <th>Rate</th>
                    <th>Hospital Total</th>
                  </tr>
                </thead>
                <tbody>
                  {record.fluids.checks.map((check) => (
                    <tr key={check.id}>
                      <td>{formatTime(check.actualAt)}</td>
                      <td>{formatNumber(check.currentCumulativeMl)} mL</td>
                      <td>{formatNumber(check.intervalMl)} mL</td>
                      <td>{formatNumber(check.currentRateMlHr)} mL/hr</td>
                      <td>{formatNumber(check.hospitalizationTotalMl)} mL</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {record.fluids.events.length > 0 && (
            <>
              <h3>Fluid Events</h3>
              <ul>
                {record.fluids.events.map((event) => (
                  <li key={event.id}>
                    {[formatTime(event.actualAt), event.item, event.value, event.notes]
                      .filter(hasMeaningfulValue)
                      .join(' · ')}
                  </li>
                ))}
              </ul>
            </>
          )}

          {record.fluids.boluses.length > 0 && (
            <>
              <h3>Boluses</h3>
              <ul>
                {record.fluids.boluses.map((bolus) => (
                  <li key={bolus.id}>
                    {[formatTime(bolus.actualAt), bolus.fluidType, `${formatNumber(bolus.totalMl)} mL`, `${formatNumber(bolus.pumpRateMlHr)} mL/hr`, bolus.status, bolus.notes]
                      .filter(hasMeaningfulValue)
                      .join(' · ')}
                  </li>
                ))}
              </ul>
            </>
          )}

          <h3>Fluid Summary</h3>
          <p>
            Total documented continuous fluids: {formatNumber(record.fluids.hospitalizationTotalMl)} mL /{' '}
            {formatNumber(record.fluids.hospitalizationTotalMl / patient.weightKg)} mL/kg
          </p>
        </section>
      )}

      {timeline.length > 0 && (
        <section className="print-section">
          <h2>Timeline</h2>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Category</th>
                <th>Item</th>
                <th>Value</th>
                <th>Status</th>
                {timeline.some((item) => hasMeaningfulValue(item.notes)) && <th>Notes</th>}
              </tr>
            </thead>
            <tbody>
              {timeline.map((item) => (
                <tr key={`${item.timestamp}-${item.category}-${item.item}`}>
                  <td>{formatTime(item.timestamp)}</td>
                  <td>{item.category}</td>
                  <td>{item.item}</td>
                  <td>{item.value}</td>
                  <td>{item.status}</td>
                  {timeline.some((row) => hasMeaningfulValue(row.notes)) && <td>{item.notes}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {hasMeaningfulValue(record.notes) && (
        <section className="print-section">
          <h2>Notes</h2>
          <p className="print-notes">{record.notes}</p>
        </section>
      )}

      <footer className="print-disclaimer">
        Generated by PawPilot. Verify calculations, drug doses, treatment plans, and documentation
        according to hospital protocols and supervising veterinarian.
      </footer>
    </article>
  );
}
