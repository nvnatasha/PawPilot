import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import TprMonitoringHistory from '../components/hospitalization/TprMonitoringHistory.jsx';
import HospitalizationPrintLayout from '../components/records/HospitalizationPrintLayout.jsx';
import ResultPanel from '../components/ui/ResultPanel.jsx';
import {
  ENTRY_STATUSES,
  EVENT_TYPES,
  FLUID_TYPES,
  SCHEDULE_OPTIONS,
  TREATMENT_TYPES,
  WARD_LOCATIONS,
} from '../config/hospitalizationConfig.js';
import { ROUTES } from '../config/anesthesiaConfig.js';
import {
  addCustomEvent,
  addFluidBolus,
  addFluidEvent,
  addFluidPlan,
  addHospitalFluidCheck,
  addOccurrenceOverride,
  buildTimeline,
  changeTreatmentSchedule,
  createMedication,
  createTreatmentRow,
  documentTreatment,
  duplicateTreatmentRow,
  hospitalizationService,
  occurrencesForRecord,
  outstandingOccurrencesForRecord,
  setTreatmentStatus,
  timelineToCsv,
} from '../services/hospitalizationService.js';
import { patientService } from '../services/patientService.js';
import { calculateDrugDose, calculateFluidBolus } from '../utils/anesthesiaCalculations.js';
import { startNewBag, resetPumpBaseline } from '../utils/hospitalizationFluids.js';
import {
  formatConcentration,
  formatDateForFilename,
  formatMl,
  formatNumber,
  safeFilenamePart,
} from '../utils/formatters.js';
import { getTprEntries, hasMeaningfulValue } from '../utils/clinicalDisplay.js';
import {
  addSheetDays,
  formatDateRange,
  formatTime,
  generateSheetHours,
  getCellStatus,
  getSheetDateForTimestamp,
  getOccurrenceKey,
  sheetWindow,
} from '../utils/hospitalizationSchedule.js';
import { formatWeight } from '../utils/weight.js';

const defaultSchedule = {
  scheduleMode: '4',
  firstDueTime: '08:00',
  intervalHours: 4,
  customIntervalHours: '',
  specificTimes: '08:00, 14:00, 20:00',
};

const defaultTreatment = {
  type: 'TPR',
  name: 'TPR',
  instructions: '',
  notes: '',
  ...defaultSchedule,
};

const defaultMedication = {
  drugName: '',
  dose: '',
  doseUnit: 'mg/kg',
  concentration: '',
  concentrationUnit: 'mg/mL',
  route: 'IV',
  customRoute: '',
  instructions: '',
  notes: '',
  scheduleMode: '8',
  firstDueTime: '08:00',
  intervalHours: 8,
  customIntervalHours: '',
  specificTimes: '08:00, 20:00',
};

const defaultFluidPlan = {
  fluidType: 'LRS',
  customType: '',
  bagSizeMl: 1000,
  entryMode: 'mlHr',
  rateMlHr: '',
  rateMlKgHr: '',
  baselineMl: 0,
  scheduleMode: '2',
  firstDueTime: '10:00',
  intervalHours: 2,
  customIntervalHours: '',
  specificTimes: '',
  notes: '',
};

function isoFromLocalInput(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

function localInputFromIso(iso) {
  const date = iso ? new Date(iso) : new Date();
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

function scheduleValues(values) {
  if (values.scheduleMode === 'custom') {
    return { ...values, intervalHours: Number(values.customIntervalHours) };
  }

  if (values.scheduleMode === 'once' || values.scheduleMode === 'specificTimes') {
    return values;
  }

  return { ...values, intervalHours: Number(values.scheduleMode) };
}

function createEntryId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `entry-${Date.now()}`;
}

function routeLabel(value, customRoute) {
  return value === 'Other' ? customRoute || 'Other' : value;
}

function summarizeSheet(record, occurrences, outstandingOccurrences) {
  const { start, end } = sheetWindow(record.sheetDate);
  const entries = [
    ...record.medicationAdministrations,
    ...record.monitoringEntries,
    ...record.fluids.checks,
  ];
  const activeRows = record.treatmentSheet.rows.filter(
    (row) => !row.discontinuedAt || new Date(row.discontinuedAt) >= start,
  );
  const attentionCount = occurrences.filter((occurrence) => {
    const status = getCellStatus({ occurrence, entries, row: occurrence.row });
    return status === 'due' || status === 'overdue';
  }).length + outstandingOccurrences.length;
  const continuedRows = activeRows.filter((row) =>
    (row.schedulePeriods || []).some((period) => period.effectiveFrom && new Date(period.effectiveFrom) < start),
  ).length;
  const started = new Date(record.startedAt);
  const durationEnd = record.endedAt ? new Date(record.endedAt) : new Date();
  const durationHours = Math.max(0, Math.round((durationEnd - started) / (60 * 60 * 1000)));
  const hospitalDay = Math.max(1, Math.floor((start - started) / (24 * 60 * 60 * 1000)) + 1);

  return {
    activeRows: activeRows.length,
    attentionCount,
    continuedRows,
    hospitalDay,
    duration: `${durationHours} hr hospitalized`,
    sheetEndsAt: end.toISOString(),
  };
}

export default function HospitalizationPage() {
  const { id } = useParams();
  const patient = patientService.getById(id);
  const [record, setRecord] = useState(() => (patient ? hospitalizationService.getOrCreateActive(patient) : null));
  const [treatmentDraft, setTreatmentDraft] = useState(defaultTreatment);
  const [medDraft, setMedDraft] = useState(defaultMedication);
  const [fluidDraft, setFluidDraft] = useState(defaultFluidPlan);
  const [docTarget, setDocTarget] = useState(null);
  const [docDraft, setDocDraft] = useState({});
  const [rowActionTarget, setRowActionTarget] = useState(null);
  const [rowActionDraft, setRowActionDraft] = useState({ ...defaultSchedule, effectiveMode: 'now' });
  const [eventDraft, setEventDraft] = useState({ category: 'Note', scheduledHour: '08:00', value: '', notes: '' });
  const [fluidCheckDraft, setFluidCheckDraft] = useState({
    currentCumulativeMl: '',
    currentRateMlHr: '',
    ivSite: '',
    notes: '',
  });
  const [fluidEventDraft, setFluidEventDraft] = useState({ type: 'rateChange', value: '', notes: '' });
  const [bolusDraft, setBolusDraft] = useState({ amountMlKg: '', minutes: '', fluidType: 'LRS', status: 'planned', notes: '' });
  const [newBagDraft, setNewBagDraft] = useState({ fluidType: 'LRS', bagSizeMl: 1000, baselineMl: 0, previousBagFinalMl: '', notes: '' });
  const [message, setMessage] = useState('');

  const hours = useMemo(() => (record ? generateSheetHours(record.sheetDate) : []), [record]);
  const occurrences = useMemo(() => (record ? occurrencesForRecord(record) : []), [record]);
  const outstandingOccurrences = useMemo(() => (record ? outstandingOccurrencesForRecord(record) : []), [record]);
  const timeline = useMemo(() => (record ? buildTimeline(record) : []), [record]);
  const tprEntries = useMemo(() => (record ? getTprEntries(record.monitoringEntries) : []), [record]);
  const sheetStats = useMemo(
    () => (record ? summarizeSheet(record, occurrences, outstandingOccurrences) : null),
    [occurrences, outstandingOccurrences, record],
  );
  const medCalculation = useMemo(
    () =>
      patient
        ? calculateDrugDose({
            weightKg: patient.weightKg,
            dose: medDraft.dose,
            doseUnit: medDraft.doseUnit,
            concentration: medDraft.concentration,
            concentrationUnit: medDraft.concentrationUnit,
          })
        : null,
    [medDraft.concentration, medDraft.concentrationUnit, medDraft.dose, medDraft.doseUnit, patient],
  );
  const bolusCalculation = useMemo(
    () => (patient ? calculateFluidBolus(patient.weightKg, bolusDraft.amountMlKg, bolusDraft.minutes) : null),
    [bolusDraft.amountMlKg, bolusDraft.minutes, patient],
  );

  useEffect(() => {
    if (record) {
      hospitalizationService.save(record);
    }
  }, [record]);

  if (!patient || !record) {
    return (
      <section className="empty-state compact">
        <p className="eyebrow">Patient not found</p>
        <h2>This hospitalization record cannot be opened.</h2>
        <p>The patient may have been removed, or the link may be outdated.</p>
        <Link className="primary-button" to="/patients">
          Back to Current Patients
        </Link>
      </section>
    );
  }

  function updateRecord(updater) {
    setRecord((current) => updater(current));
  }

  function updateMeta(field, value) {
    updateRecord((current) => ({ ...current, [field]: value }));
  }

  function updateSheetDate(sheetDate) {
    updateRecord((current) => ({
      ...current,
      sheetDate,
      treatmentSheet: {
        ...current.treatmentSheet,
        sheetStart: new Date(`${sheetDate}T08:00:00`).toISOString(),
      },
    }));
  }

  function addTreatment() {
    const row = createTreatmentRow(scheduleValues(treatmentDraft));
    updateRecord((current) => ({
      ...current,
      treatmentSheet: { ...current.treatmentSheet, rows: [...current.treatmentSheet.rows, row] },
    }));
    setTreatmentDraft(defaultTreatment);
  }

  function addMedication() {
    const created = createMedication(scheduleValues(medDraft), patient);
    if (!created) {
      setMessage('Enter medication dose and concentration values greater than 0.');
      return;
    }

    updateRecord((current) => ({
      ...current,
      medications: [...current.medications, created.medication],
      treatmentSheet: {
        ...current.treatmentSheet,
        rows: [...current.treatmentSheet.rows, created.row],
      },
    }));
    setMedDraft(defaultMedication);
    setMessage('');
  }

  function openDocumentation(row, occurrence) {
    setDocTarget({ row, occurrence });
    setDocDraft({
      actualAt: localInputFromIso(new Date().toISOString()),
      technician: record.technician,
      status: row.type === 'Medication' ? ENTRY_STATUSES.GIVEN : ENTRY_STATUSES.COMPLETED,
      notes: '',
      temperatureUnit: 'F',
      bgUnit: 'mg/dL',
    });
  }

  function openPrnDocumentation(row) {
    setDocTarget({ row, occurrence: { scheduledAt: '', key: '', hourIndex: null } });
    setDocDraft({
      actualAt: localInputFromIso(new Date().toISOString()),
      technician: record.technician,
      status: row.medicationId ? ENTRY_STATUSES.GIVEN : ENTRY_STATUSES.COMPLETED,
      notes: '',
      temperatureUnit: 'F',
      bgUnit: 'mg/dL',
    });
  }

  function saveDocumentation(status = docDraft.status) {
    const values = {};
    ['temperature', 'temperatureUnit', 'hr', 'rr', 'systolicBp', 'meanBp', 'diastolicBp', 'spo2', 'painScore', 'mentation', 'mm', 'crt', 'bodyWeight', 'bg', 'bgUnit', 'value', 'unit', 'secondaryValue'].forEach(
      (key) => {
        if (hasMeaningfulValue(docDraft[key])) values[key] = docDraft[key];
      },
    );

    setRecord((current) =>
      hospitalizationService.save(
        current && {
          ...documentTreatment(current, {
            rowId: docTarget.row.id,
            scheduledAt: docTarget.occurrence.scheduledAt,
            actualAt: isoFromLocalInput(docDraft.actualAt),
            status,
            technician: docDraft.technician,
            values,
            notes: docDraft.notes,
          }),
        },
      ),
    );
    setDocTarget(null);
  }

  function saveOccurrenceOverride(type) {
    setRecord((current) =>
      addOccurrenceOverride(current, docTarget.row.id, {
        type,
        scheduledAt: docTarget.occurrence.scheduledAt,
        actualAt: isoFromLocalInput(docDraft.actualAt),
        technician: docDraft.technician,
        notes: docDraft.notes,
      }),
    );
    setDocTarget(null);
  }

  function rescheduleOccurrence() {
    if (!docDraft.rescheduledTo) {
      setMessage('Choose a new time for this occurrence.');
      return;
    }

    setRecord((current) =>
      addOccurrenceOverride(current, docTarget.row.id, {
        type: 'reschedule',
        scheduledAt: docTarget.occurrence.scheduledAt,
        rescheduledTo: isoFromLocalInput(docDraft.rescheduledTo),
        actualAt: new Date().toISOString(),
        technician: docDraft.technician,
        notes: docDraft.notes,
      }),
    );
    setDocTarget(null);
    setMessage('');
  }

  function openRowActions(row) {
    setRowActionTarget(row);
    setRowActionDraft({ ...defaultSchedule, effectiveMode: 'now', effectiveAt: localInputFromIso(new Date().toISOString()) });
  }

  function applyScheduleChange() {
    const values = {
      ...scheduleValues(rowActionDraft),
      effectiveFrom:
        rowActionDraft.effectiveMode === 'custom'
          ? isoFromLocalInput(rowActionDraft.effectiveAt)
          : new Date().toISOString(),
    };
    setRecord((current) => changeTreatmentSchedule(current, rowActionTarget.id, values));
    setRowActionTarget(null);
  }

  function applyRowStatus(status) {
    setRecord((current) => setTreatmentStatus(current, rowActionTarget.id, status));
    setRowActionTarget(null);
  }

  function duplicateRow() {
    setRecord((current) => duplicateTreatmentRow(current, rowActionTarget.id));
    setRowActionTarget(null);
  }

  function addEvent() {
    const selectedHour = hours.find((hour) => hour.time === eventDraft.scheduledHour);
    const actualAt = selectedHour?.iso || new Date(`${record.sheetDate}T${eventDraft.scheduledHour}:00`).toISOString();
    updateRecord((current) =>
      addCustomEvent(current, {
        ...eventDraft,
        item: eventDraft.category,
        actualAt,
        technician: record.technician,
      }),
    );
    setEventDraft({ category: 'Note', scheduledHour: '08:00', value: '', notes: '' });
  }

  function addPlan() {
    if (!fluidDraft.rateMlHr && !fluidDraft.rateMlKgHr) {
      setMessage('Enter a fluid rate before starting fluids.');
      return;
    }

    updateRecord((current) => addFluidPlan(current, scheduleValues(fluidDraft), patient));
    setFluidCheckDraft((current) => ({
      ...current,
      currentRateMlHr:
        fluidDraft.entryMode === 'mlKgHr'
          ? String(Number(fluidDraft.rateMlKgHr) * patient.weightKg)
          : String(fluidDraft.rateMlHr),
    }));
    setMessage('');
  }

  function addCheckFromTarget() {
    const activePlan = record.fluids.plans.find((plan) => plan.id === record.fluids.activePlanId);
    const scheduledAt = docTarget?.occurrence?.scheduledAt || '';
    const rowId = docTarget?.row?.id || '';
    const next = addHospitalFluidCheck(
      record,
      {
        id: createEntryId(),
        occurrenceKey: rowId && scheduledAt ? getOccurrenceKey(rowId, scheduledAt) : '',
        rowId,
        scheduledAt,
        actualAt: isoFromLocalInput(docDraft.actualAt || localInputFromIso(new Date().toISOString())),
        currentCumulativeMl: Number(fluidCheckDraft.currentCumulativeMl),
        currentRateMlHr: Number(fluidCheckDraft.currentRateMlHr || activePlan?.rateMlHr || 0),
        ivSite: fluidCheckDraft.ivSite,
        technician: docDraft.technician || record.technician,
        notes: fluidCheckDraft.notes || docDraft.notes,
      },
      patient,
    );

    if (!next) {
      setMessage('Fluid check could not be calculated. Confirm cumulative reading and baseline.');
      return;
    }

    setRecord(next);
    setFluidCheckDraft({ currentCumulativeMl: '', currentRateMlHr: String(activePlan?.rateMlHr || ''), ivSite: '', notes: '' });
    setDocTarget(null);
    setMessage('');
  }

  function addFluidAction() {
    if (fluidEventDraft.type === 'newBag') {
      updateRecord((current) =>
        startNewBag(current, {
          ...newBagDraft,
          id: createEntryId(),
          eventId: createEntryId(),
          actualAt: new Date().toISOString(),
        }),
      );
      return;
    }

    if (fluidEventDraft.type === 'baselineReset') {
      updateRecord((current) =>
        resetPumpBaseline(current, {
          id: createEntryId(),
          actualAt: new Date().toISOString(),
          baselineMl: fluidEventDraft.value,
          notes: fluidEventDraft.notes,
        }),
      );
      return;
    }

    updateRecord((current) =>
      addFluidEvent(current, {
        ...fluidEventDraft,
        actualAt: new Date().toISOString(),
        weightKg: patient.weightKg,
        newRateMlHr: fluidEventDraft.value,
      }),
    );
  }

  function addBolus() {
    const next = addFluidBolus(record, bolusDraft, patient);
    if (!next) {
      setMessage('Enter a bolus amount and duration greater than 0.');
      return;
    }
    setRecord(next);
    setBolusDraft({ amountMlKg: '', minutes: '', fluidType: 'LRS', status: 'planned', notes: '' });
  }

  function endHospitalization() {
    if (!window.confirm('End this hospitalization? The record will be preserved for review and export.')) {
      return;
    }

    setRecord((current) => hospitalizationService.end(current));
  }

  function downloadJson() {
    downloadFile(
      `${safeFilenamePart(patient.name)}_Hospitalization_${formatDateForFilename(record.sheetDate)}.json`,
      JSON.stringify({ exportType: 'pawpilot.hospitalizationRecord.v1', patient, record }, null, 2),
      'application/json',
    );
  }

  function downloadCsv() {
    downloadFile(
      `${safeFilenamePart(patient.name)}_Hospitalization_${formatDateForFilename(record.sheetDate)}.csv`,
      timelineToCsv(record),
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
    <>
      <section className="page-section hospitalization-screen">
        <div className="patient-hero anesthesia-hero">
          <div>
            <p className="eyebrow">Hospitalization</p>
            <h2>{patient.name.toUpperCase()}</h2>
            <p className="patient-meta large">
              {patient.species} • {formatWeight(patient.weightKg)} kg • {formatWeight(patient.weightLb)} lb
            </p>
            {(patient.age || patient.sexStatus) && <p className="patient-submeta">{[patient.age, patient.sexStatus].filter(Boolean).join(' • ')}</p>}
            {patient.reason && <p className="patient-reason hero-reason">{patient.reason}</p>}
            {sheetStats && (
              <div className="sheet-summary-row">
                <span>Hospital day {sheetStats.hospitalDay}</span>
                <span>{sheetStats.duration}</span>
                <span>{sheetStats.activeRows} active rows</span>
                <span>{sheetStats.attentionCount} due/overdue</span>
                <span>{sheetStats.continuedRows} continued</span>
              </div>
            )}
          </div>
          <div className="hero-actions">
            <button className="primary-button" onClick={() => window.print()} type="button">Print / Save Record</button>
            <Link className="ghost-button" to={`/patients/${patient.id}/handoff`}>Shift Handoff</Link>
            <button className="ghost-button" onClick={downloadJson} type="button">Download Record Data</button>
            <button className="ghost-button" onClick={downloadCsv} type="button">Download Timeline CSV</button>
            <Link className="secondary-button" to={`/patients/${patient.id}`}>Back to Patient</Link>
          </div>
        </div>

        <section className="clinical-card span-2">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Hospital stay</p>
              <h3>Patient & Hospitalization Details</h3>
            </div>
            <span className="status-pill">{record.status === 'active' ? 'Active' : 'Ended'}</span>
          </div>
          <div className="form-grid compact-grid">
            <label><span>Hospitalization start date</span><input type="date" value={record.sheetDate} onChange={(event) => updateMeta('sheetDate', event.target.value)} /></label>
            <label><span>Hospitalization start time</span><input type="time" value={new Date(record.startedAt).toTimeString().slice(0, 5)} onChange={(event) => updateMeta('startedAt', new Date(`${record.sheetDate}T${event.target.value}:00`).toISOString())} /></label>
            <label><span>Attending veterinarian</span><input value={record.veterinarian} onChange={(event) => updateMeta('veterinarian', event.target.value)} /></label>
            <label><span>Technician</span><input value={record.technician} onChange={(event) => updateMeta('technician', event.target.value)} /></label>
            <label><span>Ward/location</span><select value={record.location} onChange={(event) => updateMeta('location', event.target.value)}>{WARD_LOCATIONS.map((location) => <option key={location} value={location}>{location}</option>)}</select></label>
            {record.location === 'Other' && <label><span>Custom location</span><input value={record.customLocation} onChange={(event) => updateMeta('customLocation', event.target.value)} /></label>}
            <label className="full-span"><span>Optional hospitalization notes</span><textarea rows="3" value={record.notes} onChange={(event) => updateMeta('notes', event.target.value)} /></label>
          </div>
        </section>

        <section className="clinical-card treatment-sheet-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">8 AM through 7 AM</p>
              <h3>24-Hour Treatment Sheet · {formatDateRange(record.sheetDate)}</h3>
            </div>
          </div>
          <div className="sheet-toolbar">
            <button className="ghost-button compact-button" onClick={() => updateSheetDate(addSheetDays(record.sheetDate, -1))} type="button">Previous</button>
            <strong>{formatDateRange(record.sheetDate)}</strong>
            <button className="ghost-button compact-button" onClick={() => updateSheetDate(addSheetDays(record.sheetDate, 1))} type="button">Next</button>
            <button className="secondary-button compact-button" onClick={() => updateSheetDate(getSheetDateForTimestamp(new Date()))} type="button">Current Sheet</button>
          </div>
          {outstandingOccurrences.length > 0 && (
            <div className="sheet-alert">
              {outstandingOccurrences.length} unresolved item{outstandingOccurrences.length === 1 ? '' : 's'} carried from the prior sheet.
            </div>
          )}
          <div className="shift-legend"><span>Day shift 8a–7p</span><span>Night shift 8p–7a</span></div>
          <div className="treatment-grid-wrap">
            <div className="treatment-grid" style={{ gridTemplateColumns: `14rem repeat(${hours.length}, 4.4rem)` }}>
              <div className="sheet-cell sheet-sticky sheet-corner">Treatment</div>
              {hours.map((hour) => <div className={`sheet-cell sheet-hour ${hour.shift.toLowerCase()}`} key={hour.iso}>{hour.label}<span>{hour.shift}</span></div>)}
              {record.treatmentSheet.rows.map((row) => (
                <TreatmentRow
                  entries={[...record.medicationAdministrations, ...record.monitoringEntries, ...record.fluids.checks]}
                  hours={hours}
                  key={row.id}
                  occurrences={occurrences}
                  onOpen={openDocumentation}
                  onPrnOpen={openPrnDocumentation}
                  onRowActions={openRowActions}
                  row={row}
                  medication={record.medications.find((med) => med.id === row.medicationId)}
                />
              ))}
            </div>
          </div>
          <p className="clinical-note">Scheduled time stays on the sheet. Actual documentation time is saved separately in the patient-care timeline.</p>
        </section>

        <TprMonitoringHistory entries={tprEntries} />

        <div className="anesthesia-grid">
          <section className="clinical-card">
            <h3>Add Treatment Row</h3>
            <TreatmentFields values={treatmentDraft} onChange={setTreatmentDraft} />
            <button className="primary-button" onClick={addTreatment} type="button">Add Treatment Row</button>
          </section>

          <section className="clinical-card">
            <h3>Hospital Medication</h3>
            <MedicationFields values={medDraft} onChange={setMedDraft} />
            <div className="result-row">
              <ResultPanel label="Total dose" value={medCalculation ? `${formatNumber(medCalculation.totalDose, { maximumFractionDigits: 3 })} ${medCalculation.totalDoseUnit.replace('ug', 'µg')}` : 'Enter dose'} />
              <ResultPanel label="Volume" value={medCalculation ? `${formatMl(medCalculation.volumeMl)} mL` : 'Enter concentration'} />
            </div>
            <button className="primary-button" onClick={addMedication} type="button">Add Medication Row</button>
          </section>

          <section className="clinical-card">
            <h3>Manual Event</h3>
            <div className="form-grid single-grid">
              <label><span>Hour</span><select value={eventDraft.scheduledHour} onChange={(event) => setEventDraft((current) => ({ ...current, scheduledHour: event.target.value }))}>{hours.map((hour) => <option key={hour.iso} value={hour.time}>{hour.label}</option>)}</select></label>
              <label><span>Event type</span><select value={eventDraft.category} onChange={(event) => setEventDraft((current) => ({ ...current, category: event.target.value }))}>{EVENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
              <label><span>Value / summary</span><input value={eventDraft.value} onChange={(event) => setEventDraft((current) => ({ ...current, value: event.target.value }))} /></label>
              <label><span>Notes</span><textarea rows="3" value={eventDraft.notes} onChange={(event) => setEventDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
            </div>
            <button className="primary-button" onClick={addEvent} type="button">Add Event</button>
          </section>

          <section className="clinical-card">
            <h3>Fluid Therapy</h3>
            <FluidPlanFields values={fluidDraft} onChange={setFluidDraft} patient={patient} />
            <button className="primary-button" onClick={addPlan} type="button">Start Fluids / Add Volume Checks</button>
            <ResultPanel label="Hospitalization fluid total" value={`${formatNumber(record.fluids.hospitalizationTotalMl)} mL`} helper={`${formatNumber(record.fluids.hospitalizationTotalMl / patient.weightKg)} mL/kg documented`} />
          </section>

          <section className="clinical-card">
            <h3>Fluid Events</h3>
            <div className="form-grid single-grid">
              <label><span>Action</span><select value={fluidEventDraft.type} onChange={(event) => setFluidEventDraft((current) => ({ ...current, type: event.target.value }))}><option value="rateChange">Rate change</option><option value="pause">Pause</option><option value="restart">Restart</option><option value="discontinue">Discontinue</option><option value="baselineReset">Reset Pump Baseline</option><option value="newBag">Hang New Bag</option></select></label>
              {fluidEventDraft.type === 'newBag' ? <NewBagFields values={newBagDraft} onChange={setNewBagDraft} /> : <label><span>{fluidEventDraft.type === 'rateChange' ? 'New rate mL/hr' : 'Value / baseline'}</span><input value={fluidEventDraft.value} onChange={(event) => setFluidEventDraft((current) => ({ ...current, value: event.target.value }))} /></label>}
              <label><span>Notes</span><input value={fluidEventDraft.notes} onChange={(event) => setFluidEventDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
            </div>
            <button className="primary-button" onClick={addFluidAction} type="button">Save Fluid Event</button>
          </section>

          <section className="clinical-card">
            <h3>Fluid Bolus</h3>
            <div className="form-grid single-grid">
              <label><span>mL/kg</span><input type="number" min="0" value={bolusDraft.amountMlKg} onChange={(event) => setBolusDraft((current) => ({ ...current, amountMlKg: event.target.value }))} /></label>
              <label><span>Give over minutes</span><input type="number" min="0" value={bolusDraft.minutes} onChange={(event) => setBolusDraft((current) => ({ ...current, minutes: event.target.value }))} /></label>
              <label><span>Fluid type</span><select value={bolusDraft.fluidType} onChange={(event) => setBolusDraft((current) => ({ ...current, fluidType: event.target.value }))}>{FLUID_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
              <label><span>Notes</span><input value={bolusDraft.notes} onChange={(event) => setBolusDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
            </div>
            <div className="result-row">
              <ResultPanel label="Total volume" value={bolusCalculation ? `${formatNumber(bolusCalculation.totalMl)} mL` : 'Enter bolus'} />
              <ResultPanel label="Pump rate" value={bolusCalculation ? `${formatNumber(bolusCalculation.pumpRateMlHr)} mL/hr` : 'Enter minutes'} />
            </div>
            <button className="primary-button" onClick={addBolus} type="button">Add Bolus to Treatment Sheet</button>
          </section>
        </div>

        {message && <p className="clinical-note">{message}</p>}

        <section className="clinical-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Derived from documentation</p>
              <h3>Patient-Care Timeline</h3>
            </div>
            {record.status === 'active' && <button className="danger-button" onClick={endHospitalization} type="button">End Hospitalization</button>}
          </div>
          <div className="timeline-list">
            {timeline.length === 0 ? <p className="clinical-note">No documented events yet.</p> : timeline.map((item) => <div className="timeline-entry" key={`${item.timestamp}-${item.category}-${item.item}`}><strong>{formatTime(item.timestamp)}</strong><span>{item.item} {item.value && `— ${item.value}`} {item.status && `(${item.status})`}</span>{item.notes && <small>{item.notes}</small>}</div>)}
          </div>
        </section>
      </section>

      {docTarget && (
        <DocumentationModal
          docDraft={docDraft}
          fluidCheckDraft={fluidCheckDraft}
          medication={record.medications.find((med) => med.id === docTarget.row.medicationId)}
          onCancel={() => setDocTarget(null)}
          onChange={setDocDraft}
          onFluidCheckChange={setFluidCheckDraft}
          onHoldOccurrence={() => saveOccurrenceOverride('hold')}
          onRescheduleOccurrence={rescheduleOccurrence}
          onSave={saveDocumentation}
          onSaveFluidCheck={addCheckFromTarget}
          onSkipOccurrence={() => saveOccurrenceOverride('skip')}
          row={docTarget.row}
          scheduledAt={docTarget.occurrence.scheduledAt}
        />
      )}

      {rowActionTarget && (
        <RowActionModal
          draft={rowActionDraft}
          medication={record.medications.find((med) => med.id === rowActionTarget.medicationId)}
          onApplySchedule={applyScheduleChange}
          onCancel={() => setRowActionTarget(null)}
          onChange={setRowActionDraft}
          onDuplicate={duplicateRow}
          onStatus={applyRowStatus}
          row={rowActionTarget}
        />
      )}

      <div className="print-only">
        <HospitalizationPrintLayout patient={patient} record={record} />
      </div>
    </>
  );
}

function TreatmentRow({ row, hours, occurrences, entries, onOpen, onPrnOpen, onRowActions, medication }) {
  const concentrationText = formatConcentration(medication?.concentration, medication?.concentrationUnit);

  if (row.type === 'PRN') {
    return (
      <>
        <div className="sheet-cell sheet-sticky sheet-row-label">
          <strong>{row.name}</strong>
          <span>{['PRN', concentrationText].filter(Boolean).join(' · ')}</span>
          <div className="row-control-group">
            <button className="text-button" onClick={() => onPrnOpen(row)} type="button">Document</button>
            <button className="text-button" onClick={() => onRowActions(row)} type="button">Actions</button>
          </div>
        </div>
        {hours.map((hour, index) => (
          <div className="sheet-cell treatment-cell state-empty" key={`${row.id}-${hour.iso}`}>
            {index === 0 ? <span className="prn-chip">PRN</span> : <span className="empty-dot">—</span>}
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      <div className="sheet-cell sheet-sticky sheet-row-label">
        <strong>{row.name}</strong>
        <span>{[row.type, concentrationText].filter(Boolean).join(' · ')}</span>
        <button className="text-button" onClick={() => onRowActions(row)} type="button">Actions</button>
      </div>
      {hours.map((hour) => {
        const occurrence = occurrences.find((item) => item.rowId === row.id && item.hourIndex === hour.index);
        const status = getCellStatus({ occurrence, entries, row });
        return (
          <div className={`sheet-cell treatment-cell state-${status}`} key={`${row.id}-${hour.iso}`}>
            {occurrence ? <button type="button" onClick={() => onOpen(row, occurrence)}><strong>{status === 'upcoming' ? 'Scheduled' : status}</strong><span>{formatTime(occurrence.scheduledAt)}</span></button> : <span className="empty-dot">—</span>}
          </div>
        );
      })}
    </>
  );
}

function TreatmentFields({ values, onChange }) {
  return (
    <div className="form-grid single-grid">
      <label><span>Treatment type</span><select value={values.type} onChange={(event) => onChange((current) => ({ ...current, type: event.target.value, name: event.target.value === 'Custom' ? current.name : event.target.value }))}>{TREATMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
      <label><span>Treatment name</span><input value={values.name} onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))} /></label>
      <ScheduleFields values={values} onChange={onChange} />
      <label><span>Instructions</span><input value={values.instructions} onChange={(event) => onChange((current) => ({ ...current, instructions: event.target.value }))} /></label>
    </div>
  );
}

function MedicationFields({ values, onChange }) {
  return (
    <div className="form-grid single-grid">
      <label><span>Drug name</span><input value={values.drugName} onChange={(event) => onChange((current) => ({ ...current, drugName: event.target.value }))} /></label>
      <label><span>Dose</span><input type="number" min="0" value={values.dose} onChange={(event) => onChange((current) => ({ ...current, dose: event.target.value }))} /></label>
      <label><span>Dose unit</span><select value={values.doseUnit} onChange={(event) => onChange((current) => ({ ...current, doseUnit: event.target.value }))}><option value="mg/kg">mg/kg</option><option value="ug/kg">µg/kg</option></select></label>
      <label><span>Concentration</span><input type="number" min="0" value={values.concentration} onChange={(event) => onChange((current) => ({ ...current, concentration: event.target.value }))} /></label>
      <label><span>Concentration unit</span><select value={values.concentrationUnit} onChange={(event) => onChange((current) => ({ ...current, concentrationUnit: event.target.value }))}><option value="mg/mL">mg/mL</option><option value="ug/mL">µg/mL</option></select></label>
      <label><span>Route</span><select value={values.route} onChange={(event) => onChange((current) => ({ ...current, route: event.target.value }))}>{ROUTES.map((route) => <option key={route} value={route}>{route}</option>)}</select></label>
      <ScheduleFields values={values} onChange={onChange} />
      <label><span>Instructions</span><input value={values.instructions} onChange={(event) => onChange((current) => ({ ...current, instructions: event.target.value }))} /></label>
    </div>
  );
}

function ScheduleFields({ values, onChange }) {
  return (
    <>
      <label><span>Schedule</span><select value={values.scheduleMode} onChange={(event) => onChange((current) => ({ ...current, scheduleMode: event.target.value }))}>{SCHEDULE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      {values.scheduleMode === 'prn' ? <p className="clinical-note">PRN rows do not create automatic due cells.</p> : values.scheduleMode === 'specificTimes' ? <label><span>Specific times, comma separated</span><input value={values.specificTimes} onChange={(event) => onChange((current) => ({ ...current, specificTimes: event.target.value }))} /></label> : <label><span>First due time</span><input type="time" value={values.firstDueTime} onChange={(event) => onChange((current) => ({ ...current, firstDueTime: event.target.value }))} /></label>}
      {values.scheduleMode === 'custom' && <label><span>Custom interval hours</span><input type="number" min="1" value={values.customIntervalHours} onChange={(event) => onChange((current) => ({ ...current, customIntervalHours: event.target.value }))} /></label>}
    </>
  );
}

function FluidPlanFields({ values, onChange, patient }) {
  const calculatedMlHr = values.entryMode === 'mlKgHr' && values.rateMlKgHr ? Number(values.rateMlKgHr) * patient.weightKg : values.rateMlHr;
  const calculatedMlKgHr = values.entryMode === 'mlHr' && values.rateMlHr ? Number(values.rateMlHr) / patient.weightKg : values.rateMlKgHr;
  return (
    <div className="form-grid single-grid">
      <label><span>Fluid type</span><select value={values.fluidType} onChange={(event) => onChange((current) => ({ ...current, fluidType: event.target.value }))}>{FLUID_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
      <label><span>Bag size mL</span><input type="number" min="0" value={values.bagSizeMl} onChange={(event) => onChange((current) => ({ ...current, bagSizeMl: event.target.value }))} /></label>
      <label><span>Enter rate by</span><select value={values.entryMode} onChange={(event) => onChange((current) => ({ ...current, entryMode: event.target.value }))}><option value="mlHr">mL/hr</option><option value="mlKgHr">mL/kg/hr</option></select></label>
      {values.entryMode === 'mlHr' ? <label><span>Rate mL/hr</span><input type="number" min="0" value={values.rateMlHr} onChange={(event) => onChange((current) => ({ ...current, rateMlHr: event.target.value }))} /></label> : <label><span>Rate mL/kg/hr</span><input type="number" min="0" value={values.rateMlKgHr} onChange={(event) => onChange((current) => ({ ...current, rateMlKgHr: event.target.value }))} /></label>}
      <ResultPanel label="Calculated paired rate" value={`${formatNumber(calculatedMlHr)} mL/hr · ${formatNumber(calculatedMlKgHr, { maximumFractionDigits: 2 })} mL/kg/hr`} />
      <ScheduleFields values={values} onChange={onChange} />
      <label><span>Notes/additives</span><input value={values.notes} onChange={(event) => onChange((current) => ({ ...current, notes: event.target.value }))} placeholder="Example: + 20 mEq KCl" /></label>
    </div>
  );
}

function NewBagFields({ values, onChange }) {
  return (
    <>
      <label><span>New fluid type</span><select value={values.fluidType} onChange={(event) => onChange((current) => ({ ...current, fluidType: event.target.value }))}>{FLUID_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
      <label><span>New bag size mL</span><input type="number" min="0" value={values.bagSizeMl} onChange={(event) => onChange((current) => ({ ...current, bagSizeMl: event.target.value }))} /></label>
      <label><span>Previous bag final mL</span><input type="number" min="0" value={values.previousBagFinalMl} onChange={(event) => onChange((current) => ({ ...current, previousBagFinalMl: event.target.value }))} /></label>
      <label><span>New baseline mL</span><input type="number" min="0" value={values.baselineMl} onChange={(event) => onChange((current) => ({ ...current, baselineMl: event.target.value }))} /></label>
    </>
  );
}

function DocumentationModal({
  row,
  scheduledAt,
  medication,
  docDraft,
  onChange,
  onCancel,
  onSave,
  onSkipOccurrence,
  onHoldOccurrence,
  onRescheduleOccurrence,
  fluidCheckDraft,
  onFluidCheckChange,
  onSaveFluidCheck,
}) {
  const isMedication = row.type === 'Medication' || (row.type === 'PRN' && row.medicationId);
  const isTpr = row.type === 'TPR';
  const isBg = row.type === 'BG';
  const isFluidCheck = row.type === 'Fluid volume check';
  const hasScheduledTime = Boolean(scheduledAt);
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal treatment-modal" role="dialog" aria-modal="true" aria-labelledby="doc-title">
        <h2 id="doc-title">{row.name}</h2>
        <p className="clinical-note">{hasScheduledTime ? `Scheduled: ${formatTime(scheduledAt)}` : 'PRN documentation'}</p>
        {isMedication && medication && <div className="overview-list"><span>Dose: {medication.dose} {medication.doseUnit}</span>{formatConcentration(medication.concentration, medication.concentrationUnit) && <span>Concentration: {formatConcentration(medication.concentration, medication.concentrationUnit)}</span>}<span>Volume: {formatMl(medication.volumeMl)} mL</span><span>Route: {routeLabel(medication.route, medication.customRoute)}</span></div>}
        <label><span>Actual time</span><input type="datetime-local" value={docDraft.actualAt} onChange={(event) => onChange((current) => ({ ...current, actualAt: event.target.value }))} /></label>
        <label><span>Technician</span><input value={docDraft.technician || ''} onChange={(event) => onChange((current) => ({ ...current, technician: event.target.value }))} /></label>
        {isTpr && <div className="form-grid compact-grid"><label><span>Temperature</span><input value={docDraft.temperature || ''} onChange={(event) => onChange((current) => ({ ...current, temperature: event.target.value }))} /></label><label><span>Unit</span><select value={docDraft.temperatureUnit || 'F'} onChange={(event) => onChange((current) => ({ ...current, temperatureUnit: event.target.value }))}><option value="F">°F</option><option value="C">°C</option></select></label><label><span>HR</span><input value={docDraft.hr || ''} onChange={(event) => onChange((current) => ({ ...current, hr: event.target.value }))} /></label><label><span>RR</span><input value={docDraft.rr || ''} onChange={(event) => onChange((current) => ({ ...current, rr: event.target.value }))} /></label><label><span>BP systolic</span><input value={docDraft.systolicBp || ''} onChange={(event) => onChange((current) => ({ ...current, systolicBp: event.target.value }))} /></label><label><span>BP diastolic</span><input value={docDraft.diastolicBp || ''} onChange={(event) => onChange((current) => ({ ...current, diastolicBp: event.target.value }))} /></label><label><span>MAP</span><input value={docDraft.meanBp || ''} onChange={(event) => onChange((current) => ({ ...current, meanBp: event.target.value }))} /></label><label><span>SpO₂</span><input value={docDraft.spo2 || ''} onChange={(event) => onChange((current) => ({ ...current, spo2: event.target.value }))} /></label><label><span>Pain score</span><input value={docDraft.painScore || ''} onChange={(event) => onChange((current) => ({ ...current, painScore: event.target.value }))} /></label><label><span>MM</span><input value={docDraft.mm || ''} onChange={(event) => onChange((current) => ({ ...current, mm: event.target.value }))} /></label><label><span>CRT</span><input value={docDraft.crt || ''} onChange={(event) => onChange((current) => ({ ...current, crt: event.target.value }))} /></label><label><span>Mentation</span><input value={docDraft.mentation || ''} onChange={(event) => onChange((current) => ({ ...current, mentation: event.target.value }))} /></label></div>}
        {isBg && <div className="form-grid compact-grid"><label><span>BG value</span><input value={docDraft.bg || ''} onChange={(event) => onChange((current) => ({ ...current, bg: event.target.value }))} /></label><label><span>Unit</span><input value={docDraft.bgUnit || 'mg/dL'} onChange={(event) => onChange((current) => ({ ...current, bgUnit: event.target.value }))} /></label></div>}
        {isFluidCheck && <div className="form-grid compact-grid"><label><span>Current cumulative volume infused</span><input type="number" min="0" value={fluidCheckDraft.currentCumulativeMl} onChange={(event) => onFluidCheckChange((current) => ({ ...current, currentCumulativeMl: event.target.value }))} /></label><label><span>Current running rate mL/hr</span><input type="number" min="0" value={fluidCheckDraft.currentRateMlHr} onChange={(event) => onFluidCheckChange((current) => ({ ...current, currentRateMlHr: event.target.value }))} /></label><label><span>IV catheter/site status</span><input value={fluidCheckDraft.ivSite} onChange={(event) => onFluidCheckChange((current) => ({ ...current, ivSite: event.target.value }))} /></label></div>}
        {!isMedication && !isTpr && !isBg && !isFluidCheck && <div className="form-grid compact-grid"><label><span>Value</span><input value={docDraft.value || ''} onChange={(event) => onChange((current) => ({ ...current, value: event.target.value }))} /></label><label><span>Unit</span><input value={docDraft.unit || ''} onChange={(event) => onChange((current) => ({ ...current, unit: event.target.value }))} /></label></div>}
        <label><span>Notes</span><textarea rows="3" value={docDraft.notes || ''} onChange={(event) => onChange((current) => ({ ...current, notes: event.target.value }))} /></label>
        {hasScheduledTime && (
          <div className="form-grid compact-grid">
            <label><span>Reschedule this occurrence to</span><input type="datetime-local" value={docDraft.rescheduledTo || localInputFromIso(scheduledAt)} onChange={(event) => onChange((current) => ({ ...current, rescheduledTo: event.target.value }))} /></label>
            <button className="ghost-button" onClick={onRescheduleOccurrence} type="button">Reschedule Occurrence</button>
          </div>
        )}
        <div className="modal-actions">
          {isFluidCheck ? <button className="primary-button" onClick={onSaveFluidCheck} type="button">Document Check</button> : <button className="primary-button" onClick={() => onSave(isMedication ? 'given' : 'completed')} type="button">{isMedication ? 'Given' : 'Completed'}</button>}
          {hasScheduledTime && <button className="ghost-button" onClick={onHoldOccurrence} type="button">Hold This Time</button>}
          {hasScheduledTime && <button className="ghost-button" onClick={onSkipOccurrence} type="button">Skip This Time</button>}
          <button className="ghost-button" onClick={() => onSave('held')} type="button">Document Held</button>
          <button className="danger-button" onClick={() => onSave('discontinued')} type="button">Discontinued</button>
          <button className="ghost-button" onClick={onCancel} type="button">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function RowActionModal({ row, medication, draft, onChange, onApplySchedule, onStatus, onDuplicate, onCancel }) {
  const history = [
    ...(row.lifecycleEvents || []).map((event) => ({
      id: event.id,
      time: event.actualAt,
      label: event.type,
      detail: event.summary || '',
    })),
    ...(row.occurrenceOverrides || []).map((override) => ({
      id: override.id,
      time: override.actualAt,
      label: override.type,
      detail: override.type === 'reschedule' ? `Moved to ${formatTime(override.rescheduledTo)}` : override.notes || '',
    })),
  ].sort((a, b) => new Date(b.time) - new Date(a.time));

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal treatment-modal" role="dialog" aria-modal="true" aria-labelledby="row-action-title">
        <h2 id="row-action-title">{row.name}</h2>
        {formatConcentration(medication?.concentration, medication?.concentrationUnit) && (
          <p className="clinical-note">Concentration: {formatConcentration(medication.concentration, medication.concentrationUnit)}</p>
        )}
        <p className="clinical-note">Treatment-level changes affect this row from the selected effective time forward.</p>

        <section className="modal-section">
          <h3>Change Schedule</h3>
          <div className="form-grid compact-grid">
            <ScheduleFields values={draft} onChange={onChange} />
            <label>
              <span>Effective time</span>
              <select value={draft.effectiveMode} onChange={(event) => onChange((current) => ({ ...current, effectiveMode: event.target.value }))}>
                <option value="now">Now</option>
                <option value="custom">Custom time</option>
              </select>
            </label>
            {draft.effectiveMode === 'custom' && (
              <label>
                <span>Custom effective time</span>
                <input type="datetime-local" value={draft.effectiveAt} onChange={(event) => onChange((current) => ({ ...current, effectiveAt: event.target.value }))} />
              </label>
            )}
          </div>
          <button className="primary-button compact-button" onClick={onApplySchedule} type="button">Apply Schedule Change</button>
        </section>

        <section className="modal-section">
          <h3>Treatment Status</h3>
          <div className="row-control-group">
            <button className="ghost-button compact-button" onClick={() => onStatus('hold')} type="button">Hold Treatment</button>
            <button className="ghost-button compact-button" onClick={() => onStatus('resume')} type="button">Resume Treatment</button>
            <button className="danger-button compact-button" onClick={() => onStatus('discontinued')} type="button">Discontinue</button>
            <button className="secondary-button compact-button" onClick={onDuplicate} type="button">Duplicate Row</button>
          </div>
        </section>

        <section className="modal-section">
          <h3>History</h3>
          <div className="timeline-list compact-history">
            {history.length === 0 ? (
              <p className="clinical-note">No row history yet.</p>
            ) : (
              history.map((item) => (
                <div className="timeline-entry" key={item.id}>
                  <strong>{formatTime(item.time)}</strong>
                  <span>{item.label} {item.detail && `— ${item.detail}`}</span>
                </div>
              ))
            )}
          </div>
        </section>

        <div className="modal-actions">
          <button className="ghost-button" onClick={onCancel} type="button">Close</button>
        </div>
      </div>
    </div>
  );
}
