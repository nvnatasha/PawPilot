import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { hospitalizationService } from '../services/hospitalizationService.js';
import { patientService } from '../services/patientService.js';
import { formatDateForFilename, formatNumber, safeFilenamePart } from '../utils/formatters.js';
import {
  TIME_RANGES,
  buildTrendSeries,
  getTrendMetricOptions,
  summarizeSeries,
  trendSeriesToCsv,
} from '../utils/trends.js';
import { formatWeight } from '../utils/weight.js';

function displayDateTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function localInputFromIso(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

function formatValue(point) {
  if (!point) return 'Not documented';
  return `${formatNumber(point.value, { maximumFractionDigits: 2 })}${point.unit ? ` ${point.unit}` : ''}`;
}

export default function TrendsPage() {
  const { id } = useParams();
  const patient = patientService.getById(id);
  const hospitalizations = useMemo(() => (patient ? hospitalizationService.listByPatientId(patient.id) : []), [patient]);
  const [selectedHospitalizationId, setSelectedHospitalizationId] = useState(() => hospitalizations[0]?.id || '');
  const selectedHospitalization =
    hospitalizations.find((record) => record.id === selectedHospitalizationId) || hospitalizations[0] || null;
  const metricOptions = useMemo(() => getTrendMetricOptions(selectedHospitalization), [selectedHospitalization]);
  const [metricId, setMetricId] = useState('bg');
  const selectedMetricId = metricOptions.some((metric) => metric.id === metricId) ? metricId : metricOptions[0]?.id || '';
  const [rangeId, setRangeId] = useState('entire');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const series = useMemo(
    () =>
      buildTrendSeries({
        hospitalization: selectedHospitalization,
        metricId: selectedMetricId,
        rangeId,
        customStart,
        customEnd,
      }),
    [customEnd, customStart, rangeId, selectedHospitalization, selectedMetricId],
  );
  const summary = summarizeSeries(series);
  const summaryCards = metricOptions
    .map((metric) => buildTrendSeries({ hospitalization: selectedHospitalization, metricId: metric.id, rangeId: 'entire' }))
    .filter((item) => item.points.length > 0)
    .slice(0, 6);

  if (!patient) {
    return (
      <section className="empty-state compact">
        <p className="eyebrow">Patient not found</p>
        <h2>This trends view cannot be opened.</h2>
        <p>The patient may have been removed, or the link may be outdated.</p>
        <Link className="primary-button" to="/patients">Back to Current Patients</Link>
      </section>
    );
  }

  function downloadMetricCsv() {
    downloadFile(
      `${safeFilenamePart(patient.name)}_${safeFilenamePart(series.metric?.shortLabel || 'Trend')}_${formatDateForFilename(selectedHospitalization?.sheetDate)}.csv`,
      trendSeriesToCsv(series),
      'text/csv',
    );
  }

  function downloadAllCsv() {
    const content = metricOptions
      .map((metric) => trendSeriesToCsv(buildTrendSeries({ hospitalization: selectedHospitalization, metricId: metric.id, rangeId: 'entire' })))
      .join('\n');
    downloadFile(
      `${safeFilenamePart(patient.name)}_All_Trends_${formatDateForFilename(selectedHospitalization?.sheetDate)}.csv`,
      content,
      'text/csv',
    );
  }

  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="page-section trends-screen">
      <div className="patient-hero anesthesia-hero">
        <div>
          <p className="eyebrow">Lab & Monitoring Trends</p>
          <h2>{patient.name.toUpperCase()}</h2>
          <p className="patient-meta large">
            {patient.species} • {formatWeight(patient.weightKg)} kg • {formatWeight(patient.weightLb)} lb
          </p>
          <p className="clinical-note">Recorded values only. PawPilot does not interpret trends or apply reference ranges.</p>
        </div>
        <div className="hero-actions">
          <button className="ghost-button" disabled={!series.points.length} onClick={downloadMetricCsv} type="button">Download Trend CSV</button>
          <button className="ghost-button" disabled={!summaryCards.length} onClick={downloadAllCsv} type="button">Download All Trend Data</button>
          <Link className="secondary-button" to={`/patients/${patient.id}`}>Back to Patient</Link>
        </div>
      </div>

      {hospitalizations.length === 0 ? (
        <section className="empty-state compact">
          <p className="eyebrow">No hospitalization data</p>
          <h2>No hospitalization trends yet.</h2>
          <p>Trends are derived from hospitalization monitoring, lab, output, and fluid documentation.</p>
          <Link className="primary-button" to={`/patients/${patient.id}/hospitalization`}>Open Hospitalization</Link>
        </section>
      ) : (
        <>
          <section className="clinical-card">
            <div className="card-heading">
              <div>
                <p className="eyebrow">Trend filters</p>
                <h3>Hospitalization & Metric</h3>
              </div>
            </div>
            <div className="form-grid compact-grid">
              <label>
                <span>Hospitalization</span>
                <select value={selectedHospitalization?.id || ''} onChange={(event) => setSelectedHospitalizationId(event.target.value)}>
                  {hospitalizations.map((record) => (
                    <option key={record.id} value={record.id}>
                      {displayDateTime(record.startedAt)}{record.endedAt ? ` – ${displayDateTime(record.endedAt)}` : ' – Active'}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Metric</span>
                <select value={selectedMetricId} onChange={(event) => setMetricId(event.target.value)}>
                  {metricOptions.map((metric) => (
                    <option key={metric.id} value={metric.id}>{metric.shortLabel} · {metric.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Time range</span>
                <select value={rangeId} onChange={(event) => setRangeId(event.target.value)}>
                  {TIME_RANGES.map((range) => <option key={range.id} value={range.id}>{range.label}</option>)}
                </select>
              </label>
              {rangeId === 'custom' && (
                <>
                  <label><span>Start</span><input type="datetime-local" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label>
                  <label><span>End</span><input type="datetime-local" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label>
                </>
              )}
            </div>
          </section>

          {summaryCards.length > 0 && (
            <section className="trend-summary-grid" aria-label="Trend summaries">
              {summaryCards.map((item) => {
                const itemSummary = summarizeSeries(item);
                return (
                  <button className="trend-summary-card" key={item.metric.id} onClick={() => setMetricId(item.metric.id)} type="button">
                    <strong>{item.metric.shortLabel}</strong>
                    <span>Latest: {formatValue(itemSummary.latest)}</span>
                    <span>Previous: {formatValue(itemSummary.previous)}</span>
                    <span>Entries: {itemSummary.count}</span>
                  </button>
                );
              })}
            </section>
          )}

          <section className="clinical-card trend-chart-card">
            <div className="card-heading">
              <div>
                <p className="eyebrow">{series.metric?.category || 'Trend'}</p>
                <h3>{series.metric?.label || 'Trend'}</h3>
              </div>
              <span className="status-pill">{summary.count} entries</span>
            </div>
            {series.incompatibleUnits > 0 && (
              <p className="clinical-note">{series.incompatibleUnits} value{series.incompatibleUnits === 1 ? '' : 's'} with a different unit are not graphed with this series.</p>
            )}
            {series.points.length === 0 ? (
              <div className="empty-state compact">
                <p>No {series.metric?.shortLabel || 'trend'} values documented for this hospitalization.</p>
              </div>
            ) : (
              <>
                <TrendChart points={series.points} unit={series.unit} />
                {series.points.length === 1 && <p className="clinical-note">One value is documented. The point is shown without implying a direction.</p>}
                <TrendTable points={series.points} />
              </>
            )}
          </section>
        </>
      )}
    </section>
  );
}

function TrendChart({ points, unit }) {
  const width = 720;
  const height = 260;
  const padding = 36;
  const values = points.map((point) => point.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueRange = maxValue - minValue || 1;
  const times = points.map((point) => new Date(point.timestamp).getTime());
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const timeRange = maxTime - minTime || 1;
  const coords = points.map((point) => {
    const x = padding + ((new Date(point.timestamp).getTime() - minTime) / timeRange) * (width - padding * 2);
    const y = height - padding - ((point.value - minValue) / valueRange) * (height - padding * 2);
    return { x, y, point };
  });
  const path = coords.map((coord, index) => `${index === 0 ? 'M' : 'L'} ${coord.x} ${coord.y}`).join(' ');

  return (
    <div className="trend-chart-wrap" role="img" aria-label={`Line chart with ${points.length} recorded values`}>
      <svg className="trend-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <line className="trend-axis" x1={padding} x2={padding} y1={padding} y2={height - padding} />
        <line className="trend-axis" x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} />
        {[0, 0.5, 1].map((tick) => {
          const y = height - padding - tick * (height - padding * 2);
          const value = minValue + tick * valueRange;
          return (
            <g key={tick}>
              <line className="trend-grid-line" x1={padding} x2={width - padding} y1={y} y2={y} />
              <text className="trend-axis-label" x={4} y={y + 4}>{formatNumber(value, { maximumFractionDigits: 1 })}</text>
            </g>
          );
        })}
        {points.length > 1 && <path className="trend-line" d={path} />}
        {coords.map(({ x, y, point }) => (
          <g key={point.id}>
            <circle className="trend-point" cx={x} cy={y} r="4">
              <title>{formatValue(point)} · {displayDateTime(point.timestamp)}{point.notes ? ` · ${point.notes}` : ''}</title>
            </circle>
          </g>
        ))}
      </svg>
      <div className="trend-chart-meta">
        <span>{displayDateTime(points[0].timestamp)}</span>
        <span>{unit}</span>
        <span>{displayDateTime(points.at(-1).timestamp)}</span>
      </div>
    </div>
  );
}

function TrendTable({ points }) {
  return (
    <div className="drug-table-wrap">
      <table className="drug-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Value</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.id}>
              <td>{displayDateTime(point.timestamp)}</td>
              <td>{formatValue(point)}</td>
              <td>{point.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
