import { formatConcentration, formatDisplayDate, formatMl, formatNumber } from '../../utils/formatters.js';
import {
  displayTime,
  entryForPoint,
  formatMonitoringValue,
  generateMonitoringTimes,
  getUsedMonitoringFields,
  hasMeaningfulMonitoringValue,
} from '../../utils/anesthesiaMonitoring.js';
import { formatWeight } from '../../utils/weight.js';

function displayUnit(unit) {
  return unit?.replace('ug', 'µg') || '';
}

function fluidType(record) {
  return record.fluids.type === 'Other' ? record.fluids.customType || 'Other' : record.fluids.type;
}

function optionalDetail(label, value) {
  if (!hasMeaningfulMonitoringValue(value)) return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function monitoringValue(field, entry) {
  return entry ? formatMonitoringValue(field.key, entry) : '';
}

function pointHasActualTimeDifference(point, entry) {
  if (!entry?.timestamp || !point?.timestamp) return false;
  return new Date(entry.timestamp).getTime() !== new Date(point.timestamp).getTime();
}

function AnesthesiaMonitoringPrintTable({ fields, monitoring, points }) {
  return (
    <table className="anesthesia-monitoring-print-table">
      <thead>
        <tr>
          <th>Parameter</th>
          {points.map((point) => {
            const entry = entryForPoint(monitoring.entries, point);
            const marker = pointHasActualTimeDifference(point, entry) ? '*' : '';
            return <th key={point.timestamp}>{displayTime(point.timestamp)}{marker}</th>;
          })}
        </tr>
      </thead>
      <tbody>
        {fields.map((field) => (
          <tr key={field.key}>
            <th>{field.label}</th>
            {points.map((point) => {
              const entry = entryForPoint(monitoring.entries, point);
              return <td key={point.timestamp}>{monitoringValue(field, entry)}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function PatientRecordPrintLayout({ patient, record }) {
  const monitoring = record.monitoring || {};
  const points = generateMonitoringTimes({
    startedAt: monitoring.startedAt,
    endedAt: monitoring.endedAt,
    intervalMinutes: monitoring.intervalMinutes,
    entries: monitoring.entries || [],
    extraPoints: monitoring.extraPoints || [],
  });
  const fields = getUsedMonitoringFields(monitoring.entries || [], monitoring.enabledFields || []).filter(
    (field) =>
      field.key === 'hr' ||
      field.key === 'rr' ||
      field.key === 'spo2' ||
      field.key === 'etco2' ||
      field.key === 'temperature' ||
      field.key === 'sap' ||
      field.key === 'map' ||
      field.key === 'dap' ||
      field.key === 'vaporizerPercent' ||
      field.key === 'oxygenLMin' ||
      (monitoring.entries || []).some((entry) => hasMeaningfulMonitoringValue(entry[field.key])),
  );
  const hasMonitoring = points.length > 0 && (monitoring.entries || []).length > 0;
  const medicationAdministrations = monitoring.medicationAdministrations || [];
  const events = monitoring.events || [];
  const fluidEvents = monitoring.fluidEvents || [];
  const recoveryEntries = monitoring.recoveryEntries || [];
  const hasRecovery = recoveryEntries.length > 0 || hasMeaningfulMonitoringValue(monitoring.recoveryStatus);

  return (
    <article className="print-record" aria-label="Printable anesthesia record">
      <header className="print-header">
        <div>
          <h1>PawPilot — Anesthesia Record</h1>
          <p>Generated patient-care setup summary</p>
        </div>
        <div>
          <strong>{formatDisplayDate(record.date)}</strong>
          {record.startTime && <span>Start: {record.startTime}</span>}
        </div>
      </header>

      <section className="print-section">
        <h2>Patient</h2>
        <dl className="print-details">
          <div>
            <dt>Patient</dt>
            <dd>{patient.name}</dd>
          </div>
          <div>
            <dt>Species</dt>
            <dd>{patient.species}</dd>
          </div>
          <div>
            <dt>Weight</dt>
            <dd>
              {formatWeight(patient.weightKg)} kg / {formatWeight(patient.weightLb)} lb
            </dd>
          </div>
          {patient.age && (
            <div>
              <dt>Age</dt>
              <dd>{patient.age}</dd>
            </div>
          )}
          {patient.sexStatus && (
            <div>
              <dt>Sex/status</dt>
              <dd>{patient.sexStatus}</dd>
            </div>
          )}
          <div>
            <dt>Procedure</dt>
            <dd>{record.procedure || patient.reason || 'Not entered'}</dd>
          </div>
          <div>
            <dt>Veterinarian</dt>
            <dd>{record.veterinarian || 'Not entered'}</dd>
          </div>
          <div>
            <dt>Technician</dt>
            <dd>{record.technician || 'Not entered'}</dd>
          </div>
          {optionalDetail('Induction', displayTime(monitoring.inductionAt))}
          {optionalDetail('Procedure start', displayTime(monitoring.procedureStartAt))}
          {optionalDetail('Procedure end', displayTime(monitoring.procedureEndAt))}
          {optionalDetail('Extubation', displayTime(monitoring.extubationAt))}
          {optionalDetail('Recovery', displayTime(monitoring.recoveryAt))}
        </dl>
      </section>

      <section className="print-section">
        <h2>Anesthesia Setup</h2>
        <dl className="print-details">
          <div>
            <dt>Circuit</dt>
            <dd>{record.circuit.selectedType}</dd>
          </div>
          <div>
            <dt>Reservoir bag</dt>
            <dd>{record.reservoirBag.selectedBagSizeL || record.reservoirBag.suggestedBagSizeL || 'Not selected'} L</dd>
          </div>
          <div>
            <dt>Oxygen flow</dt>
            <dd>
              {record.oxygen.calculatedLMin
                ? `${formatNumber(record.oxygen.calculatedLMin, { maximumFractionDigits: 2 })} L/min`
                : 'Not calculated'}
            </dd>
          </div>
        </dl>
      </section>

      <section className="print-section">
        <h2>Fluids</h2>
        <p>{fluidType(record) || 'Not entered'}</p>
        <p>
          {record.fluids.ratePerKg || 'Not entered'} mL/kg/hr
          {record.fluids.calculatedMlHr
            ? ` · Calculated rate: ${formatNumber(record.fluids.calculatedMlHr, {
                maximumFractionDigits: 1,
              })} mL/hr`
            : ''}
        </p>
        {record.bolus.totalMl && (
          <p>
            Bolus: {formatNumber(record.bolus.amountPerKg, { maximumFractionDigits: 2 })} mL/kg over{' '}
            {formatNumber(record.bolus.minutes, { maximumFractionDigits: 1 })} min · Total{' '}
            {formatNumber(record.bolus.totalMl, { maximumFractionDigits: 1 })} mL · Pump{' '}
            {formatNumber(record.bolus.pumpRateMlHr, { maximumFractionDigits: 1 })} mL/hr
          </p>
        )}
      </section>

      <section className="print-section">
        <h2>Drugs</h2>
        {record.drugs.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Drug</th>
                <th>Stage</th>
                <th>Dose</th>
                <th>Concentration</th>
                <th>Total Dose</th>
                <th>Volume</th>
                <th>Route</th>
              </tr>
            </thead>
            <tbody>
              {record.drugs.map((drug) => (
                <tr key={drug.id}>
                  <td>{drug.name}</td>
                  <td>{drug.stage || 'Other'}</td>
                  <td>
                    {formatNumber(drug.dose, { maximumFractionDigits: 3 })} {displayUnit(drug.doseUnit)}
                  </td>
                  <td>
                    {formatNumber(drug.concentration, { maximumFractionDigits: 3 })}{' '}
                    {displayUnit(drug.concentrationUnit)}
                  </td>
                  <td>
                    {formatNumber(drug.totalDose, { maximumFractionDigits: 3 })}{' '}
                    {displayUnit(drug.totalDoseUnit)}
                  </td>
                  <td>{formatMl(drug.volumeMl)} mL</td>
                  <td>{drug.route === 'Other' ? drug.customRoute || 'Other' : drug.route || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>No drugs added to this anesthesia record.</p>
        )}
      </section>

      <section className="print-section">
        <h2>Notes</h2>
        <p className="print-notes">{record.notes || 'No notes entered.'}</p>
      </section>

      {hasMonitoring && (
        <section className="print-section">
          <h2>Anesthetic Monitoring Record</h2>
          <p className="print-notes">
            Monitoring interval: q{monitoring.intervalMinutes || 5} min
          </p>
          <AnesthesiaMonitoringPrintTable fields={fields} monitoring={monitoring} points={points} />
          {points.some((point) => pointHasActualTimeDifference(point, entryForPoint(monitoring.entries, point))) && (
            <p className="print-notes">
              * Scheduled and actual documentation times differ.
            </p>
          )}
          {points.some((point) => hasMeaningfulMonitoringValue(entryForPoint(monitoring.entries, point)?.notes)) && (
            <>
              <h3>Monitoring Notes</h3>
              <ul>
                {points
                  .map((point) => ({ point, entry: entryForPoint(monitoring.entries, point) }))
                  .filter(({ entry }) => hasMeaningfulMonitoringValue(entry?.notes))
                  .map(({ point, entry }) => (
                    <li key={`${point.timestamp}-note`}>
                      {displayTime(point.timestamp)} — {entry.notes}
                    </li>
                  ))}
              </ul>
            </>
          )}
        </section>
      )}

      {medicationAdministrations.length > 0 && (
        <section className="print-section">
          <h2>Anesthesia Medication Administration</h2>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Drug</th>
                {medicationAdministrations.some((item) => item.stage) && <th>Stage</th>}
                <th>Dose</th>
                <th>Concentration</th>
                <th>Volume</th>
                <th>Route</th>
                {medicationAdministrations.some((item) => item.technician) && <th>Technician</th>}
                {medicationAdministrations.some((item) => item.notes) && <th>Notes</th>}
              </tr>
            </thead>
            <tbody>
              {medicationAdministrations.map((admin) => (
                <tr key={admin.id}>
                  <td>{displayTime(admin.actualAt)}</td>
                  <td>{admin.name}</td>
                  {medicationAdministrations.some((item) => item.stage) && <td>{admin.stage || ''}</td>}
                  <td>{formatNumber(admin.dose, { maximumFractionDigits: 3 })} {displayUnit(admin.doseUnit)}</td>
                  <td>{formatConcentration(admin.concentration, admin.concentrationUnit)}</td>
                  <td>{formatMl(admin.volumeMl)} mL</td>
                  <td>{admin.route === 'Other' ? admin.customRoute || 'Other' : admin.route}</td>
                  {medicationAdministrations.some((item) => item.technician) && <td>{admin.technician}</td>}
                  {medicationAdministrations.some((item) => item.notes) && <td>{admin.notes}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {events.length > 0 && (
        <section className="print-section">
          <h2>Anesthesia Events</h2>
          <ul>
            {events.map((event) => (
              <li key={event.id}>
                {[displayTime(event.actualAt), event.type, event.description, event.notes].filter(Boolean).join(' — ')}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(fluidEvents.length > 0 || hasMeaningfulMonitoringValue(monitoring.documentedFluidTotalMl) || hasMeaningfulMonitoringValue(monitoring.estimatedFluidTotalMl)) && (
        <section className="print-section">
          <h2>Anesthesia Fluids</h2>
          {fluidEvents.length > 0 && (
            <ul>
              {fluidEvents.map((event) => (
                <li key={event.id}>
                  {[displayTime(event.actualAt), event.type, event.fluidType, event.rateMlHr && `${event.rateMlHr} mL/hr`, event.rateMlKgHr && `${event.rateMlKgHr} mL/kg/hr`, event.bolusMl && `${event.bolusMl} mL bolus`, event.notes].filter(Boolean).join(' — ')}
                </li>
              ))}
            </ul>
          )}
          {hasMeaningfulMonitoringValue(monitoring.documentedFluidTotalMl) && <p>Documented total: {monitoring.documentedFluidTotalMl} mL</p>}
          {hasMeaningfulMonitoringValue(monitoring.estimatedFluidTotalMl) && <p>Estimated total: {monitoring.estimatedFluidTotalMl} mL</p>}
        </section>
      )}

      {hasRecovery && (
        <section className="print-section">
          <h2>Recovery</h2>
          {hasMeaningfulMonitoringValue(monitoring.recoveryStatus) && (
            <p>Recovery status: {monitoring.recoveryStatus === 'Other' ? monitoring.recoveryCustomStatus || 'Other' : monitoring.recoveryStatus}</p>
          )}
          {recoveryEntries.map((entry) => (
            <dl className="print-details" key={entry.id}>
              {optionalDetail('Time', displayTime(entry.actualAt))}
              {optionalDetail('Position', entry.recoveryPosition)}
              {optionalDetail('Temp', formatMonitoringValue('temperature', entry))}
              {optionalDetail('HR', entry.hr)}
              {optionalDetail('RR', entry.rr)}
              {optionalDetail('SpO₂', entry.spo2)}
              {optionalDetail('Pain', entry.painScore)}
              {optionalDetail('Mentation', entry.mentation)}
              {optionalDetail('Notes', entry.notes)}
            </dl>
          ))}
        </section>
      )}

      <footer className="print-disclaimer">
        Generated by PawPilot. Verify calculations, drug doses, treatment plans, and documentation
        according to hospital protocols and supervising veterinarian.
      </footer>
    </article>
  );
}
