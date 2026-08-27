import {
  formatBloodPressure,
  formatMonitoringValue,
  formatTemperature,
  getTprColumns,
  hasMeaningfulValue,
} from '../../utils/clinicalDisplay.js';
import { formatTime } from '../../utils/hospitalizationSchedule.js';

function cellValue(column, entry) {
  const values = entry.values || {};

  if (column.key === 'actualAt') return formatTime(entry.actualAt);
  if (column.key === 'temperature') return formatTemperature(values);
  if (column.key === 'bp') return formatBloodPressure(values);
  if (column.key === 'notes') return entry.notes;
  if (column.key === 'value') return formatMonitoringValue(entry);

  return values[column.key] ?? entry[column.key] ?? '';
}

export default function TprMonitoringHistory({ entries }) {
  const columns = getTprColumns(entries);
  const latest = entries.at(-1);

  return (
    <section className="clinical-card">
      <div className="card-heading">
        <div>
          <p className="eyebrow">Vitals trend</p>
          <h3>TPR / Monitoring History</h3>
        </div>
      </div>

      {!latest ? (
        <p className="clinical-note">No TPR checks documented yet.</p>
      ) : (
        <>
          <LatestTpr entry={latest} />
          <div className="drug-table-wrap">
            <table className="drug-table monitoring-table">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column.key}>{column.label}</th>
                  ))}
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    {columns.map((column) => (
                      <td key={column.key}>{cellValue(column, entry)}</td>
                    ))}
                    <td>
                      <details>
                        <summary>View</summary>
                        <dl className="monitoring-details">
                          {entry.scheduledAt && (
                            <>
                              <dt>Scheduled</dt>
                              <dd>{formatTime(entry.scheduledAt)}</dd>
                            </>
                          )}
                          <dt>Actual</dt>
                          <dd>{formatTime(entry.actualAt)}</dd>
                          {entry.technician && (
                            <>
                              <dt>Technician</dt>
                              <dd>{entry.technician}</dd>
                            </>
                          )}
                          {Object.entries(entry.values || {})
                            .filter(([, value]) => hasMeaningfulValue(value))
                            .map(([key, value]) => (
                              <div className="detail-pair" key={key}>
                                <dt>{key}</dt>
                                <dd>{value}</dd>
                              </div>
                            ))}
                          {entry.notes && (
                            <>
                              <dt>Notes</dt>
                              <dd>{entry.notes}</dd>
                            </>
                          )}
                        </dl>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function LatestTpr({ entry }) {
  const values = entry.values || {};
  const items = [
    ['T', formatTemperature(values)],
    ['HR', values.hr],
    ['RR', values.rr],
    ['BP', formatBloodPressure(values)],
    ['SpO₂', values.spo2],
    ['Pain', values.painScore],
    ['MM', values.mm],
    ['CRT', values.crt],
  ].filter(([, value]) => hasMeaningfulValue(value));

  return (
    <div className="latest-tpr">
      <strong>Latest TPR — {formatTime(entry.actualAt)}</strong>
      <div>
        {items.map(([label, value]) => (
          <span key={label}>
            {label} {value}
          </span>
        ))}
      </div>
    </div>
  );
}
