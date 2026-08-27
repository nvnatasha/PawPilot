import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PatientRecordPrintLayout from '../components/records/PatientRecordPrintLayout.jsx';
import ResultPanel from '../components/ui/ResultPanel.jsx';
import {
  CIRCUIT_TYPES,
  COMMON_BAG_SIZES_L,
  FLUID_TYPES,
  OXYGEN_REFERENCE_RATES_ML_KG_MIN,
  ROUTES,
} from '../config/anesthesiaConfig.js';
import {
  CUSTOM_MEDICATION_PRESET_ID,
  MEDICATION_STAGES,
  filterMedicationPresets,
  findMedicationPreset,
} from '../config/anesthesiaMedicationPresets.js';
import {
  addAnesthesiaFluidEvent,
  addAnesthesiaMedicationAdministration,
  addMonitoringEvent,
  addRecoveryEntry,
  anesthesiaRecordService,
  completeAnesthesiaRecord,
  recalculateRecordForPatient,
  upsertMonitoringEntry,
} from '../services/anesthesiaRecordService.js';
import { patientService } from '../services/patientService.js';
import { calculateDrugDose } from '../utils/anesthesiaCalculations.js';
import { toCsv } from '../utils/csv.js';
import {
  displayUnit,
  formatConcentration,
  formatDateForFilename,
  formatMl,
  formatNumber,
  safeFilenamePart,
} from '../utils/formatters.js';
import {
  CORE_MONITORING_FIELDS,
  OPTIONAL_MONITORING_FIELDS,
  displayTime,
  entryForPoint,
  formatMonitoringValue,
  getMonitoringDisplayPoints,
  getUsedMonitoringFields,
  hasMeaningfulMonitoringValue,
  latestMonitoringSummary,
  localDateTimeInput,
  toIsoFromDateAndTime,
} from '../utils/anesthesiaMonitoring.js';
import { formatWeight } from '../utils/weight.js';

const emptyDrug = {
  presetId: '',
  presetSearch: '',
  stage: 'Premedication',
  name: '',
  dose: '',
  doseUnit: 'mg/kg',
  concentration: '',
  concentrationUnit: 'mg/mL',
  route: '',
  customRoute: '',
  note: '',
  showMore: false,
};

const emptyAdminDraft = {
  sourceDrugId: '',
  presetId: '',
  presetSearch: '',
  stage: 'Emergency / Additional',
  name: '',
  dose: '',
  doseUnit: 'mg/kg',
  concentration: '',
  concentrationUnit: 'mg/mL',
  route: '',
  customRoute: '',
  actualAt: '',
  technician: '',
  notes: '',
  showMore: false,
};

function createEntryId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `drug-${Date.now()}`;
}

const eventTypes = [
  'Premed given',
  'Induction',
  'Intubation',
  'Procedure start',
  'Incision',
  'Position change',
  'Fluid bolus',
  'Medication given',
  'Vaporizer changed',
  'Hypotension noted',
  'Ventilation started',
  'Ventilation stopped',
  'Procedure end',
  'Vaporizer off',
  'Extubation',
  'Recovery',
  'Custom event',
];

const recoveryStatuses = ['Smooth', 'Prolonged', 'Dysphoric', 'Other'];

function defaultMonitoringDraft(timestamp = '') {
  return {
    id: '',
    scheduledAt: timestamp,
    timestamp,
    actualAt: timestamp,
    temperatureUnit: 'F',
    technician: '',
    notes: '',
  };
}

function isoFromLocalInput(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

function localTimeValue(iso) {
  return localDateTimeInput(iso).slice(11, 16);
}

function getFluidType(record) {
  return record.fluids.type === 'Other' ? record.fluids.customType : record.fluids.type;
}

export default function AnesthesiaPage() {
  const { id } = useParams();
  const patient = patientService.getById(id);
  const [drugDraft, setDrugDraft] = useState(emptyDrug);
  const [drugError, setDrugError] = useState('');
  const [editingDrugId, setEditingDrugId] = useState(null);
  const [showDrugForm, setShowDrugForm] = useState(false);
  const [showAdminForm, setShowAdminForm] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState('');
  const [monitoringDraft, setMonitoringDraft] = useState(defaultMonitoringDraft());
  const [eventDraft, setEventDraft] = useState({
    actualAt: '',
    type: 'Induction',
    description: '',
    technician: '',
    notes: '',
  });
  const [adminDraft, setAdminDraft] = useState(emptyAdminDraft);
  const [fluidEventDraft, setFluidEventDraft] = useState({
    actualAt: '',
    type: 'rateChange',
    fluidType: 'LRS',
    rateMlHr: '',
    rateMlKgHr: '',
    bolusMl: '',
    notes: '',
  });
  const [recoveryDraft, setRecoveryDraft] = useState({
    actualAt: '',
    temperatureUnit: 'F',
    recoveryPosition: '',
    hr: '',
    rr: '',
    spo2: '',
    temperature: '',
    painScore: '',
    mentation: '',
    notes: '',
  });
  const [extraPointTime, setExtraPointTime] = useState('');
  const [record, setRecord] = useState(() => {
    if (!patient) {
      return null;
    }

    return recalculateRecordForPatient(anesthesiaRecordService.getOrCreateForPatient(patient), patient);
  });

  const calculatedDrug = useMemo(() => {
    if (!patient) {
      return null;
    }

    return calculateDrugDose({
      weightKg: patient.weightKg,
      dose: drugDraft.dose,
      doseUnit: drugDraft.doseUnit,
      concentration: drugDraft.concentration,
      concentrationUnit: drugDraft.concentrationUnit,
    });
  }, [drugDraft.concentration, drugDraft.concentrationUnit, drugDraft.dose, drugDraft.doseUnit, patient]);

  const adminCalculation = useMemo(() => {
    if (!patient) return null;
    return calculateDrugDose({
      weightKg: patient.weightKg,
      dose: adminDraft.dose,
      doseUnit: adminDraft.doseUnit,
      concentration: adminDraft.concentration,
      concentrationUnit: adminDraft.concentrationUnit,
    });
  }, [adminDraft.concentration, adminDraft.concentrationUnit, adminDraft.dose, adminDraft.doseUnit, patient]);

  const monitoringPoints = useMemo(
    () =>
      record
        ? getMonitoringDisplayPoints({
            monitoringStart: record.monitoring.startedAt,
            monitoringEnd: record.monitoring.endedAt,
            intervalMinutes: record.monitoring.intervalMinutes,
            documentedEntries: record.monitoring.entries,
            extraPoints: record.monitoring.extraPoints,
            completed: record.status === 'Completed',
          })
        : [],
    [record],
  );
  const monitoringFields = useMemo(
    () => (record ? getUsedMonitoringFields(record.monitoring.entries, record.monitoring.enabledFields) : []),
    [record],
  );
  const latestSummary = useMemo(
    () => (record ? latestMonitoringSummary(record.monitoring.entries) : null),
    [record],
  );

  useEffect(() => {
    if (record) {
      anesthesiaRecordService.save(record);
    }
  }, [record]);

  if (!patient || !record) {
    return (
      <section className="empty-state compact">
        <p className="eyebrow">Patient not found</p>
        <h2>This anesthesia record cannot be opened.</h2>
        <p>The patient may have been removed, or the link may be outdated.</p>
        <Link className="primary-button" to="/patients">
          Back to Current Patients
        </Link>
      </section>
    );
  }

  function updateRecord(updater) {
    setRecord((current) => recalculateRecordForPatient(updater(current), patient));
  }

  function updateField(field, value) {
    updateRecord((current) => ({ ...current, [field]: value }));
  }

  function updateNested(section, updates) {
    updateRecord((current) => ({
      ...current,
      [section]: {
        ...current[section],
        ...updates,
      },
    }));
  }

  function updateCircuit(selectedType) {
    const rate = OXYGEN_REFERENCE_RATES_ML_KG_MIN[selectedType];
    updateRecord((current) => ({
      ...current,
      circuit: {
        ...current.circuit,
        selectedType,
      },
      oxygen: {
        ...current.oxygen,
        selectedRatePerKg: rate,
      },
    }));
  }

  function updateDrugDraft(event) {
    const { name, value } = event.target;
    if (name === 'presetId') {
      selectDrugPreset(value);
      return;
    }

    setDrugDraft((current) => ({ ...current, [name]: value }));
    setDrugError('');
  }

  function startDrug(stage = 'Premedication') {
    setDrugDraft({ ...emptyDrug, stage });
    setEditingDrugId(null);
    setDrugError('');
    setShowDrugForm(true);
  }

  function cancelDrugEntry() {
    setDrugDraft(emptyDrug);
    setEditingDrugId(null);
    setDrugError('');
    setShowDrugForm(false);
  }

  function selectDrugPreset(presetId) {
    if (presetId === CUSTOM_MEDICATION_PRESET_ID) {
      setDrugDraft((current) => ({
        ...current,
        presetId,
        name: '',
        concentration: '',
        concentrationUnit: current.concentrationUnit || 'mg/mL',
      }));
      setDrugError('');
      return;
    }

    const preset = findMedicationPreset(presetId);
    setDrugDraft((current) => ({
      ...current,
      presetId,
      name: preset?.displayName || '',
      concentration: preset?.concentration ?? '',
      concentrationUnit: preset?.concentrationUnit || current.concentrationUnit || 'mg/mL',
    }));
    setDrugError('');
  }

  function selectAdminPreset(presetId) {
    if (presetId === CUSTOM_MEDICATION_PRESET_ID) {
      setAdminDraft((current) => ({
        ...current,
        sourceDrugId: '',
        presetId,
        name: '',
        concentration: '',
        concentrationUnit: current.concentrationUnit || 'mg/mL',
        actualAt: current.actualAt || localDateTimeInput(new Date().toISOString()),
        technician: current.technician || record.technician,
      }));
      return;
    }

    const preset = findMedicationPreset(presetId);
    setAdminDraft((current) => ({
      ...current,
      sourceDrugId: '',
      presetId,
      name: preset?.displayName || '',
      concentration: preset?.concentration ?? '',
      concentrationUnit: preset?.concentrationUnit || current.concentrationUnit || 'mg/mL',
      actualAt: current.actualAt || localDateTimeInput(new Date().toISOString()),
      technician: current.technician || record.technician,
    }));
  }

  function addOrUpdateDrug() {
    if (!drugDraft.name.trim()) {
      setDrugError('Enter a drug name.');
      return;
    }

    if (!calculatedDrug) {
      setDrugError('Enter a dose and concentration greater than 0.');
      return;
    }

    const entry = {
      ...drugDraft,
      id: editingDrugId || createEntryId(),
      presetId: drugDraft.presetId === CUSTOM_MEDICATION_PRESET_ID ? '' : drugDraft.presetId,
      stage: drugDraft.stage || 'Other',
      name: drugDraft.name.trim(),
      dose: Number(drugDraft.dose),
      concentration: Number(drugDraft.concentration),
      note: drugDraft.note.trim(),
      totalDose: calculatedDrug.totalDose,
      totalDoseUnit: calculatedDrug.totalDoseUnit,
      totalDoseMicrograms: calculatedDrug.totalDoseMicrograms,
      volumeMl: calculatedDrug.volumeMl,
    };

    updateRecord((current) => ({
      ...current,
      drugs: editingDrugId
        ? current.drugs.map((drug) => (drug.id === editingDrugId ? entry : drug))
        : [...current.drugs, entry],
    }));
    setDrugDraft(emptyDrug);
    setEditingDrugId(null);
    setShowDrugForm(false);
  }

  function editDrug(drug) {
    setEditingDrugId(drug.id);
    setDrugDraft({
      presetId: drug.presetId || CUSTOM_MEDICATION_PRESET_ID,
      presetSearch: '',
      stage: drug.stage || 'Other',
      name: drug.name,
      dose: drug.dose == null ? '' : String(drug.dose),
      doseUnit: drug.doseUnit || 'mg/kg',
      concentration: drug.concentration == null ? '' : String(drug.concentration),
      concentrationUnit: drug.concentrationUnit || 'mg/mL',
      route: drug.route || '',
      customRoute: drug.customRoute || '',
      note: drug.note || '',
      showMore: Boolean(drug.note || drug.customRoute || drug.doseUnit !== 'mg/kg' || drug.concentrationUnit !== 'mg/mL'),
    });
    setShowDrugForm(true);
    setDrugError('');
  }

  function removeDrug(drugId) {
    updateRecord((current) => ({
      ...current,
      drugs: current.drugs.filter((drug) => drug.id !== drugId),
    }));
  }

  function markPlannedDrugGiven(drug) {
    setRecord((current) =>
      addAnesthesiaMedicationAdministration(
        current,
        {
          ...drug,
          sourceDrugId: drug.id,
          stage: drug.stage || 'Other',
          actualAt: new Date().toISOString(),
          technician: record.technician,
          notes: drug.note || '',
        },
        patient,
      ),
    );
  }

  function updateMonitoring(updates) {
    updateRecord((current) => ({
      ...current,
      monitoring: {
        ...current.monitoring,
        ...updates,
      },
    }));
  }

  function setMonitoringStart(time) {
    const startedAt = toIsoFromDateAndTime(record.date, time);
    updateMonitoring({ startedAt });
    if (startedAt && !selectedPoint) {
      selectMonitoringPoint({ timestamp: startedAt, scheduled: true });
    }
  }

  function selectMonitoringPoint(point) {
    const existing = entryForPoint(record.monitoring.entries, point);
    const nextDraft = {
      ...defaultMonitoringDraft(point.timestamp),
      ...(existing || {}),
      actualAt: existing?.timestamp || point.timestamp,
      scheduledAt: point.timestamp,
      timestamp: existing?.timestamp || point.timestamp,
      technician: existing?.technician || record.technician,
      temperatureUnit: existing?.temperatureUnit || 'F',
    };
    setSelectedPoint(point.timestamp);
    setMonitoringDraft(nextDraft);
  }

  function copyPreviousEquipmentSettings() {
    const prior = record.monitoring.entries
      .filter((entry) => new Date(entry.timestamp) < new Date(monitoringDraft.scheduledAt || monitoringDraft.timestamp))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
    if (!prior) return;
    setMonitoringDraft((current) => ({
      ...current,
      vaporizerPercent: prior.vaporizerPercent ?? current.vaporizerPercent ?? '',
      oxygenLMin: prior.oxygenLMin ?? current.oxygenLMin ?? '',
    }));
  }

  function saveMonitoringPoint() {
    setRecord((current) =>
      upsertMonitoringEntry(current, {
        ...monitoringDraft,
        scheduledAt: monitoringDraft.scheduledAt || selectedPoint,
        timestamp: isoFromLocalInput(localDateTimeInput(monitoringDraft.actualAt || monitoringDraft.timestamp)),
      }),
    );
  }

  function addExtraMonitoringPoint() {
    if (!extraPointTime) return;
    const iso = isoFromLocalInput(extraPointTime);
    updateMonitoring({ extraPoints: [...record.monitoring.extraPoints, iso] });
    setExtraPointTime('');
  }

  function addEvent() {
    updateRecord((current) =>
      addMonitoringEvent(current, {
        ...eventDraft,
        actualAt: eventDraft.actualAt ? isoFromLocalInput(eventDraft.actualAt) : new Date().toISOString(),
        technician: eventDraft.technician || record.technician,
      }),
    );
    setEventDraft({ actualAt: '', type: 'Induction', description: '', technician: '', notes: '' });
  }

  function populateAdminFromSetup(drugId) {
    const drug = record.drugs.find((item) => item.id === drugId);
    setShowAdminForm(true);
    setAdminDraft((current) => ({
      ...current,
      sourceDrugId: drugId,
      presetId: drug?.presetId || '',
      stage: drug?.stage || current.stage || 'Other',
      name: drug?.name || '',
      dose: drug?.dose || '',
      doseUnit: drug?.doseUnit || 'mg/kg',
      concentration: drug?.concentration || '',
      concentrationUnit: drug?.concentrationUnit || 'mg/mL',
      route: drug?.route || '',
      customRoute: drug?.customRoute || '',
      actualAt: current.actualAt || localDateTimeInput(new Date().toISOString()),
      technician: current.technician || record.technician,
    }));
  }

  function addMedicationAdministration() {
    setRecord((current) =>
      addAnesthesiaMedicationAdministration(
        current,
        {
          ...adminDraft,
          presetId: adminDraft.presetId === CUSTOM_MEDICATION_PRESET_ID ? '' : adminDraft.presetId,
          stage: adminDraft.stage || 'Other',
          actualAt: adminDraft.actualAt ? isoFromLocalInput(adminDraft.actualAt) : new Date().toISOString(),
          totalDose: adminCalculation?.totalDose,
          totalDoseUnit: adminCalculation?.totalDoseUnit,
          volumeMl: adminCalculation?.volumeMl,
        },
        patient,
      ),
    );
    setAdminDraft(emptyAdminDraft);
    setShowAdminForm(false);
  }

  function startAdditionalMedication() {
    setShowAdminForm(true);
    setAdminDraft({
      ...emptyAdminDraft,
      actualAt: localDateTimeInput(new Date().toISOString()),
      technician: record.technician,
    });
    document.getElementById('anesthesia-medication-administration')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function addFluidEvent() {
    updateRecord((current) =>
      addAnesthesiaFluidEvent(current, {
        ...fluidEventDraft,
        actualAt: fluidEventDraft.actualAt ? isoFromLocalInput(fluidEventDraft.actualAt) : new Date().toISOString(),
      }),
    );
    setFluidEventDraft({ actualAt: '', type: 'rateChange', fluidType: 'LRS', rateMlHr: '', rateMlKgHr: '', bolusMl: '', notes: '' });
  }

  function saveRecovery() {
    updateRecord((current) =>
      addRecoveryEntry(current, {
        ...recoveryDraft,
        actualAt: recoveryDraft.actualAt ? isoFromLocalInput(recoveryDraft.actualAt) : new Date().toISOString(),
      }),
    );
    setRecoveryDraft({ actualAt: '', temperatureUnit: 'F', recoveryPosition: '', hr: '', rr: '', spo2: '', temperature: '', painScore: '', mentation: '', notes: '' });
  }

  function completeRecord() {
    if (!window.confirm('Complete this anesthesia record? Optional fields can still be reviewed in the saved record.')) {
      return;
    }
    updateRecord((current) => completeAnesthesiaRecord(current));
  }

  function downloadRecordData() {
    const payload = {
      exportType: 'pawpilot.anesthesiaRecord.v1',
      patient: {
        id: patient.id,
        name: patient.name,
        species: patient.species,
        weightKg: patient.weightKg,
        weightLb: patient.weightLb,
        age: patient.age,
        sexStatus: patient.sexStatus,
        reason: patient.reason,
      },
      record,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeFilenamePart(patient.name)}_Anesthesia_${formatDateForFilename(
      record.date,
    )}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadMonitoringCsv() {
    const csv = toCsv(record.monitoring.entries, [
      { key: 'scheduledAt', header: 'Scheduled Time' },
      { key: 'timestamp', header: 'Actual Time' },
      { key: 'hr', header: 'HR' },
      { key: 'rr', header: 'RR' },
      { key: 'spo2', header: 'SpO2' },
      { key: 'etco2', header: 'ETCO2' },
      { key: 'temperature', header: 'Temp' },
      { key: 'temperatureUnit', header: 'Temp Unit' },
      { key: 'sap', header: 'SAP' },
      { key: 'map', header: 'MAP' },
      { key: 'dap', header: 'DAP' },
      { key: 'vaporizerPercent', header: 'Vaporizer %' },
      { key: 'oxygenLMin', header: 'O2 L/min' },
      { key: 'notes', header: 'Notes' },
    ]);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeFilenamePart(patient.name)}_Anesthesia_Monitoring_${formatDateForFilename(record.date)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <section className="page-section anesthesia-screen">
        <div className="patient-hero anesthesia-hero">
          <div>
            <p className="eyebrow">Anesthesia Setup</p>
            <h2>{patient.name.toUpperCase()}</h2>
            <p className="patient-meta large">
              {patient.species} • {formatWeight(patient.weightKg)} kg • {formatWeight(patient.weightLb)} lb
            </p>
            {(patient.age || patient.sexStatus) && (
              <p className="patient-submeta">
                {[patient.age, patient.sexStatus].filter(Boolean).join(' • ')}
              </p>
            )}
            {patient.reason && <p className="patient-reason hero-reason">{patient.reason}</p>}
          </div>
          <div className="hero-actions">
            <button className="primary-button" onClick={() => window.print()} type="button">
              Print / Save Record
            </button>
            <button className="ghost-button" onClick={downloadRecordData} type="button">
              Download Record Data
            </button>
            <button className="ghost-button" onClick={downloadMonitoringCsv} type="button">
              Download Monitoring CSV
            </button>
            <Link className="secondary-button" to={`/patients/${patient.id}`}>
              Back to Patient
            </Link>
          </div>
        </div>

        <div className="anesthesia-grid">
          <section className="clinical-card span-2">
            <div className="card-heading">
              <div>
                <p className="eyebrow">Record overview</p>
                <h3>Patient & Procedure</h3>
              </div>
            </div>
            <div className="overview-list">
              <span>Patient: {patient.name}</span>
              <span>Species: {patient.species}</span>
              <span>Weight: {formatWeight(patient.weightKg)} kg / {formatWeight(patient.weightLb)} lb</span>
              {patient.age && <span>Age: {patient.age}</span>}
              {patient.sexStatus && <span>Sex/status: {patient.sexStatus}</span>}
            </div>
            <div className="form-grid compact-grid">
              <label className="full-span">
                <span>Procedure being performed today</span>
                <input
                  name="procedure"
                  onChange={(event) => updateField('procedure', event.target.value)}
                  value={record.procedure}
                />
              </label>
              <label>
                <span>Technician</span>
                <input
                  name="technician"
                  onChange={(event) => updateField('technician', event.target.value)}
                  value={record.technician}
                />
              </label>
              <label>
                <span>Veterinarian</span>
                <input
                  name="veterinarian"
                  onChange={(event) => updateField('veterinarian', event.target.value)}
                  value={record.veterinarian}
                />
              </label>
              <label>
                <span>Date</span>
                <input
                  name="date"
                  onChange={(event) => updateField('date', event.target.value)}
                  type="date"
                  value={record.date}
                />
              </label>
              <label>
                <span>Procedure start time</span>
                <input
                  name="startTime"
                  onChange={(event) => updateField('startTime', event.target.value)}
                  type="time"
                  value={record.startTime}
                />
              </label>
            </div>
          </section>

          <section className="clinical-card">
            <div className="card-heading">
              <div>
                <p className="eyebrow">Circuit & equipment</p>
                <h3>Breathing Circuit</h3>
              </div>
            </div>
            <ResultPanel
              helper={`Based on patient weight: ${formatWeight(patient.weightKg)} kg`}
              label="Recommended setup"
              value={record.circuit.suggestedType}
            />
            <label>
              <span>Selected circuit</span>
              <select
                name="selectedCircuit"
                onChange={(event) => updateCircuit(event.target.value)}
                value={record.circuit.selectedType}
              >
                <option value={CIRCUIT_TYPES.NON_REBREATHING}>Non-Rebreathing</option>
                <option value={CIRCUIT_TYPES.REBREATHING}>Rebreathing</option>
              </select>
            </label>
            <p className="clinical-note">
              Verify circuit selection according to patient needs and hospital protocol.
            </p>
          </section>

          <section className="clinical-card">
            <div className="card-heading">
              <div>
                <p className="eyebrow">Circuit & equipment</p>
                <h3>Reservoir Bag</h3>
              </div>
            </div>
            <ResultPanel
              label="Estimated tidal volume"
              value={`${formatNumber(record.reservoirBag.tidalVolumeLowMl)}–${formatNumber(
                record.reservoirBag.tidalVolumeHighMl,
              )} mL`}
            />
            <ResultPanel
              label="Calculated reservoir capacity"
              value={`${formatNumber(record.reservoirBag.reservoirLowMl)}–${formatNumber(
                record.reservoirBag.reservoirHighMl,
              )} mL`}
            />
            <label>
              <span>Common bag size to consider</span>
              <select
                name="selectedBagSizeL"
                onChange={(event) =>
                  updateNested('reservoirBag', { selectedBagSizeL: event.target.value })
                }
                value={record.reservoirBag.selectedBagSizeL}
              >
                {COMMON_BAG_SIZES_L.map((size) => (
                  <option key={size} value={size}>
                    {size} L
                  </option>
                ))}
              </select>
            </label>
            <p className="clinical-note">
              Bag sizing is a setup reference. Confirm final equipment choices with protocol and
              patient needs.
            </p>
          </section>

          <section className="clinical-card">
            <div className="card-heading">
              <div>
                <p className="eyebrow">Protocol-entered value</p>
                <h3>Oxygen Flow</h3>
              </div>
            </div>
            <label>
              <span>
                {record.circuit.selectedType} oxygen flow reference, mL/kg/min
              </span>
              <input
                inputMode="decimal"
                min="0"
                name="oxygenRate"
                onChange={(event) =>
                  updateNested('oxygen', { selectedRatePerKg: event.target.value })
                }
                type="number"
                value={record.oxygen.selectedRatePerKg}
              />
            </label>
            <div className="result-row">
              <ResultPanel
                label="Required flow"
                value={
                  record.oxygen.calculatedMlMin
                    ? `${formatNumber(record.oxygen.calculatedMlMin)} mL/min`
                    : 'Enter rate'
                }
              />
              <ResultPanel
                label="Required flow"
                value={
                  record.oxygen.calculatedLMin
                    ? `${formatNumber(record.oxygen.calculatedLMin, {
                        maximumFractionDigits: 2,
                      })} L/min`
                    : 'Enter rate'
                }
              />
            </div>
            <p className="clinical-note">
              Flow rate is entered by the technician and should follow anesthetist or hospital
              protocol.
            </p>
          </section>

          <section className="clinical-card span-2">
            <div className="card-heading">
              <div>
                <p className="eyebrow">Monitoring</p>
                <h3>Anesthesia Monitoring Sheet</h3>
              </div>
              <span className="status-pill">{record.status}</span>
            </div>
            <div className="form-grid compact-grid">
              <label>
                <span>Workflow status</span>
                <select value={record.status} onChange={(event) => updateField('status', event.target.value)}>
                  <option value="Setup">Setup</option>
                  <option value="In progress">In progress</option>
                  <option value="Recovery">Recovery</option>
                  <option value="Completed">Completed</option>
                </select>
              </label>
              <label>
                <span>Monitoring interval</span>
                <select
                  value={record.monitoring.intervalMinutes}
                  onChange={(event) => updateMonitoring({ intervalMinutes: Number(event.target.value) })}
                >
                  <option value={5}>Every 5 minutes</option>
                  <option value={10}>Every 10 minutes</option>
                  <option value={15}>Every 15 minutes</option>
                  <option value={Number(record.monitoring.customIntervalMinutes) || 20}>Custom interval</option>
                </select>
              </label>
              <label>
                <span>Custom interval minutes</span>
                <input
                  min="1"
                  type="number"
                  value={record.monitoring.customIntervalMinutes}
                  onChange={(event) =>
                    updateMonitoring({
                      customIntervalMinutes: event.target.value,
                      intervalMinutes: Number(event.target.value) || record.monitoring.intervalMinutes,
                    })
                  }
                />
              </label>
              <label>
                <span>Monitoring start</span>
                <input
                  type="time"
                  value={localTimeValue(record.monitoring.startedAt)}
                  onChange={(event) => setMonitoringStart(event.target.value)}
                />
              </label>
              <label>
                <span>Induction time</span>
                <input type="time" value={localTimeValue(record.monitoring.inductionAt)} onChange={(event) => updateMonitoring({ inductionAt: toIsoFromDateAndTime(record.date, event.target.value) })} />
              </label>
              <label>
                <span>Procedure start</span>
                <input type="time" value={localTimeValue(record.monitoring.procedureStartAt)} onChange={(event) => updateMonitoring({ procedureStartAt: toIsoFromDateAndTime(record.date, event.target.value) })} />
              </label>
              <label>
                <span>Procedure end</span>
                <input type="time" value={localTimeValue(record.monitoring.procedureEndAt)} onChange={(event) => updateMonitoring({ procedureEndAt: toIsoFromDateAndTime(record.date, event.target.value) })} />
              </label>
              <label>
                <span>Anesthesia end</span>
                <input type="time" value={localTimeValue(record.monitoring.endedAt)} onChange={(event) => updateMonitoring({ endedAt: toIsoFromDateAndTime(record.date, event.target.value) })} />
              </label>
              <label>
                <span>Extubation time</span>
                <input type="time" value={localTimeValue(record.monitoring.extubationAt)} onChange={(event) => updateMonitoring({ extubationAt: toIsoFromDateAndTime(record.date, event.target.value) })} />
              </label>
              <label>
                <span>Recovery time</span>
                <input type="time" value={localTimeValue(record.monitoring.recoveryAt)} onChange={(event) => updateMonitoring({ recoveryAt: toIsoFromDateAndTime(record.date, event.target.value) })} />
              </label>
            </div>
            {latestSummary && (
              <div className="latest-tpr">
                <strong>Latest — {displayTime(latestSummary.timestamp)}</strong>
                <div>
                  {latestSummary.values.map((item) => (
                    <span key={item.key}>{item.label} {item.value}</span>
                  ))}
                </div>
              </div>
            )}
            <OptionalFieldChooser
              enabledFields={record.monitoring.enabledFields}
              onChange={(enabledFields) => updateMonitoring({ enabledFields })}
            />
            <MonitoringGrid
              entries={record.monitoring.entries}
              fields={monitoringFields}
              onSelect={selectMonitoringPoint}
              points={monitoringPoints}
              selectedPoint={selectedPoint}
            />
            <div className="form-grid compact-grid">
              <label>
                <span>Add extra monitoring point</span>
                <input
                  type="datetime-local"
                  value={extraPointTime}
                  onChange={(event) => setExtraPointTime(event.target.value)}
                />
              </label>
              <div className="field-button-row">
                <button className="secondary-button" onClick={addExtraMonitoringPoint} type="button">
                  Add Extra Monitoring Point
                </button>
              </div>
            </div>
            {selectedPoint ? (
              <MonitoringEntryPanel
                draft={monitoringDraft}
                enabledFields={record.monitoring.enabledFields}
                fields={monitoringFields}
                onChange={setMonitoringDraft}
                onCopyEquipment={copyPreviousEquipmentSettings}
                onSave={saveMonitoringPoint}
                scheduledAt={selectedPoint}
              />
            ) : (
              <p className="clinical-note">Set a monitoring start time, then select a time column to document values.</p>
            )}
          </section>

          <section className="clinical-card span-2">
            <div className="card-heading">
              <div>
                <p className="eyebrow">Events / Notes</p>
                <h3>Anesthesia Events</h3>
              </div>
            </div>
            <div className="form-grid compact-grid">
              <label><span>Actual time</span><input type="datetime-local" value={eventDraft.actualAt} onChange={(event) => setEventDraft((current) => ({ ...current, actualAt: event.target.value }))} /></label>
              <label><span>Event type</span><select value={eventDraft.type} onChange={(event) => setEventDraft((current) => ({ ...current, type: event.target.value }))}>{eventTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
              <label><span>Description</span><input value={eventDraft.description} onChange={(event) => setEventDraft((current) => ({ ...current, description: event.target.value }))} /></label>
              <label><span>Technician</span><input value={eventDraft.technician} onChange={(event) => setEventDraft((current) => ({ ...current, technician: event.target.value }))} /></label>
              <label className="full-span"><span>Notes</span><input value={eventDraft.notes} onChange={(event) => setEventDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
            </div>
            <button className="primary-button" onClick={addEvent} type="button">Add Event</button>
            <TimelineList items={record.monitoring.events.map((event) => ({ time: event.actualAt, title: event.type, detail: [event.description, event.notes].filter(Boolean).join(' — ') }))} />
          </section>

          <section className="clinical-card span-2" id="anesthesia-medication-administration">
            <div className="card-heading">
              <div>
                <p className="eyebrow">Medication administration</p>
                <h3>Anesthesia Medications Given</h3>
              </div>
              <button className="secondary-button compact-button" onClick={startAdditionalMedication} type="button">+ Medication</button>
            </div>
            {showAdminForm ? (
              <div className="compact-entry-panel">
                <div className="form-grid compact-grid">
                  <label><span>Use setup drug</span><select value={adminDraft.sourceDrugId} onChange={(event) => populateAdminFromSetup(event.target.value)}><option value="">Additional medication</option>{record.drugs.map((drug) => <option key={drug.id} value={drug.id}>{drug.name} · {formatConcentration(drug.concentration, drug.concentrationUnit)}</option>)}</select></label>
                  {!adminDraft.sourceDrugId && (
                    <>
                      <label><span>Search common medications</span><input value={adminDraft.presetSearch} onChange={(event) => setAdminDraft((current) => ({ ...current, presetSearch: event.target.value }))} placeholder="bup, prop..." /></label>
                      <label><span>Medication preset</span><select value={adminDraft.presetId} onChange={(event) => selectAdminPreset(event.target.value)}><option value="">Choose medication</option>{filterMedicationPresets(adminDraft.presetSearch).map((preset) => <option key={preset.id} value={preset.id}>{preset.displayName}</option>)}<option value={CUSTOM_MEDICATION_PRESET_ID}>Custom Medication</option></select></label>
                    </>
                  )}
                  <label><span>Stage / use</span><select value={adminDraft.stage} onChange={(event) => setAdminDraft((current) => ({ ...current, stage: event.target.value }))}>{MEDICATION_STAGES.map((stage) => <option key={stage} value={stage}>{stage}</option>)}</select></label>
                  <label><span>Drug</span><input value={adminDraft.name} onChange={(event) => setAdminDraft((current) => ({ ...current, name: event.target.value }))} /></label>
                  <label><span>Dose</span><input type="number" min="0" value={adminDraft.dose} onChange={(event) => setAdminDraft((current) => ({ ...current, dose: event.target.value }))} /></label>
                  <label><span>Dose unit</span><select value={adminDraft.doseUnit} onChange={(event) => setAdminDraft((current) => ({ ...current, doseUnit: event.target.value }))}><option value="mg/kg">mg/kg</option><option value="ug/kg">µg/kg</option></select></label>
                  <label><span>Concentration</span><input type="number" min="0" value={adminDraft.concentration} onChange={(event) => setAdminDraft((current) => ({ ...current, concentration: event.target.value }))} /></label>
                  <label><span>Concentration unit</span><select value={adminDraft.concentrationUnit} onChange={(event) => setAdminDraft((current) => ({ ...current, concentrationUnit: event.target.value }))}><option value="mg/mL">mg/mL</option><option value="ug/mL">µg/mL</option></select></label>
                  <label><span>Route</span><select value={adminDraft.route} onChange={(event) => setAdminDraft((current) => ({ ...current, route: event.target.value }))}><option value="">Choose route</option>{ROUTES.map((route) => <option key={route} value={route}>{route}</option>)}</select></label>
                  {adminDraft.route === 'Other' && <label><span>Custom route</span><input value={adminDraft.customRoute} onChange={(event) => setAdminDraft((current) => ({ ...current, customRoute: event.target.value }))} /></label>}
                  <label><span>Actual time</span><input type="datetime-local" value={adminDraft.actualAt} onChange={(event) => setAdminDraft((current) => ({ ...current, actualAt: event.target.value }))} /></label>
                  <label><span>Technician</span><input value={adminDraft.technician} onChange={(event) => setAdminDraft((current) => ({ ...current, technician: event.target.value }))} /></label>
                  <label className="full-span"><span>Notes</span><input value={adminDraft.notes} onChange={(event) => setAdminDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
                </div>
                <div className="result-row">
                  <ResultPanel label="Calculated total dose" value={adminCalculation ? `${formatNumber(adminCalculation.totalDose, { maximumFractionDigits: 3 })} ${displayUnit(adminCalculation.totalDoseUnit)}` : 'Enter dose'} />
                  <ResultPanel label="Calculated volume" value={adminCalculation ? `${formatMl(adminCalculation.volumeMl)} mL` : 'Enter concentration'} />
                </div>
                <div className="form-actions">
                  <button className="primary-button" onClick={addMedicationAdministration} type="button">Document Medication Given</button>
                  <button className="ghost-button" onClick={() => { setAdminDraft(emptyAdminDraft); setShowAdminForm(false); }} type="button">Cancel</button>
                </div>
              </div>
            ) : (
              <p className="clinical-note">Use + Medication for an additional medication, or Mark Given on a planned medication card.</p>
            )}
            <MedicationAdminTable administrations={record.monitoring.medicationAdministrations} />
          </section>

          <section className="clinical-card">
            <div className="card-heading"><div><p className="eyebrow">Fluids</p><h3>Anesthesia Fluid Events</h3></div></div>
            <div className="form-grid single-grid">
              <label><span>Actual time</span><input type="datetime-local" value={fluidEventDraft.actualAt} onChange={(event) => setFluidEventDraft((current) => ({ ...current, actualAt: event.target.value }))} /></label>
              <label><span>Event type</span><select value={fluidEventDraft.type} onChange={(event) => setFluidEventDraft((current) => ({ ...current, type: event.target.value }))}><option value="rateChange">Rate change</option><option value="bolus">Bolus</option><option value="stopped">Fluids stopped</option><option value="newBag">New bag</option></select></label>
              <label><span>Fluid type</span><select value={fluidEventDraft.fluidType} onChange={(event) => setFluidEventDraft((current) => ({ ...current, fluidType: event.target.value }))}>{FLUID_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
              <label><span>Rate mL/hr</span><input value={fluidEventDraft.rateMlHr} onChange={(event) => setFluidEventDraft((current) => ({ ...current, rateMlHr: event.target.value }))} /></label>
              <label><span>Rate mL/kg/hr</span><input value={fluidEventDraft.rateMlKgHr} onChange={(event) => setFluidEventDraft((current) => ({ ...current, rateMlKgHr: event.target.value }))} /></label>
              <label><span>Bolus mL</span><input value={fluidEventDraft.bolusMl} onChange={(event) => setFluidEventDraft((current) => ({ ...current, bolusMl: event.target.value }))} /></label>
              <label><span>Notes</span><input value={fluidEventDraft.notes} onChange={(event) => setFluidEventDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
              <label><span>Documented final total mL</span><input value={record.monitoring.documentedFluidTotalMl} onChange={(event) => updateMonitoring({ documentedFluidTotalMl: event.target.value })} /></label>
              <label><span>Estimated total mL</span><input value={record.monitoring.estimatedFluidTotalMl} onChange={(event) => updateMonitoring({ estimatedFluidTotalMl: event.target.value })} /></label>
            </div>
            <button className="primary-button" onClick={addFluidEvent} type="button">Add Fluid Event</button>
          </section>

          <section className="clinical-card">
            <div className="card-heading"><div><p className="eyebrow">Recovery</p><h3>Immediate Recovery</h3></div></div>
            <div className="form-grid single-grid">
              <label><span>Recovery status</span><select value={record.monitoring.recoveryStatus} onChange={(event) => updateMonitoring({ recoveryStatus: event.target.value })}><option value="">Choose status</option>{recoveryStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
              {record.monitoring.recoveryStatus === 'Other' && <label><span>Custom status</span><input value={record.monitoring.recoveryCustomStatus} onChange={(event) => updateMonitoring({ recoveryCustomStatus: event.target.value })} /></label>}
              <label><span>Actual time</span><input type="datetime-local" value={recoveryDraft.actualAt} onChange={(event) => setRecoveryDraft((current) => ({ ...current, actualAt: event.target.value }))} /></label>
              <label><span>Recovery position</span><input value={recoveryDraft.recoveryPosition} onChange={(event) => setRecoveryDraft((current) => ({ ...current, recoveryPosition: event.target.value }))} /></label>
              <label><span>Temperature</span><input value={recoveryDraft.temperature} onChange={(event) => setRecoveryDraft((current) => ({ ...current, temperature: event.target.value }))} /></label>
              <label><span>Temp unit</span><select value={recoveryDraft.temperatureUnit} onChange={(event) => setRecoveryDraft((current) => ({ ...current, temperatureUnit: event.target.value }))}><option value="F">°F</option><option value="C">°C</option></select></label>
              <label><span>HR</span><input value={recoveryDraft.hr} onChange={(event) => setRecoveryDraft((current) => ({ ...current, hr: event.target.value }))} /></label>
              <label><span>RR</span><input value={recoveryDraft.rr} onChange={(event) => setRecoveryDraft((current) => ({ ...current, rr: event.target.value }))} /></label>
              <label><span>SpO₂</span><input value={recoveryDraft.spo2} onChange={(event) => setRecoveryDraft((current) => ({ ...current, spo2: event.target.value }))} /></label>
              <label><span>Pain score</span><input value={recoveryDraft.painScore} onChange={(event) => setRecoveryDraft((current) => ({ ...current, painScore: event.target.value }))} /></label>
              <label><span>Mentation</span><input value={recoveryDraft.mentation} onChange={(event) => setRecoveryDraft((current) => ({ ...current, mentation: event.target.value }))} /></label>
              <label><span>Notes</span><textarea rows="3" value={recoveryDraft.notes} onChange={(event) => setRecoveryDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
            </div>
            <button className="primary-button" onClick={saveRecovery} type="button">Add Recovery Entry</button>
          </section>

          <section className="clinical-card span-2">
            <div className="card-heading">
              <div>
                <p className="eyebrow">User-selected rate</p>
                <h3>Fluids</h3>
              </div>
            </div>
            <div className="form-grid compact-grid">
              <label>
                <span>Fluid type</span>
                <select
                  name="fluidType"
                  onChange={(event) => updateNested('fluids', { type: event.target.value })}
                  value={record.fluids.type}
                >
                  {FLUID_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
              {record.fluids.type === 'Other' && (
                <label>
                  <span>Custom fluid type</span>
                  <input
                    name="customFluidType"
                    onChange={(event) => updateNested('fluids', { customType: event.target.value })}
                    value={record.fluids.customType}
                  />
                </label>
              )}
              <label>
                <span>Fluid rate, mL/kg/hr</span>
                <input
                  inputMode="decimal"
                  min="0"
                  name="fluidRate"
                  onChange={(event) => updateNested('fluids', { ratePerKg: event.target.value })}
                  placeholder="Enter selected rate"
                  type="number"
                  value={record.fluids.ratePerKg}
                />
              </label>
            </div>
            <ResultPanel
              label="Calculated Rate"
              value={
                record.fluids.calculatedMlHr
                  ? `${formatNumber(record.fluids.calculatedMlHr)} mL/hr`
                  : 'Enter fluid rate'
              }
              helper={`${getFluidType(record) || 'Fluid'} using ${formatWeight(patient.weightKg)} kg`}
            />
          </section>

          <section className="clinical-card">
            <div className="card-heading">
              <div>
                <p className="eyebrow">Fluids</p>
                <h3>Bolus Calculator</h3>
              </div>
            </div>
            <div className="form-grid single-grid">
              <label>
                <span>Bolus amount, mL/kg</span>
                <input
                  inputMode="decimal"
                  min="0"
                  name="bolusAmount"
                  onChange={(event) => updateNested('bolus', { amountPerKg: event.target.value })}
                  type="number"
                  value={record.bolus.amountPerKg}
                />
              </label>
              <label>
                <span>Give over minutes</span>
                <input
                  inputMode="decimal"
                  min="0"
                  name="bolusMinutes"
                  onChange={(event) => updateNested('bolus', { minutes: event.target.value })}
                  type="number"
                  value={record.bolus.minutes}
                />
              </label>
            </div>
            <div className="result-row">
              <ResultPanel
                label="Total volume"
                value={record.bolus.totalMl ? `${formatNumber(record.bolus.totalMl)} mL` : 'Enter bolus'}
              />
              <ResultPanel
                label="Pump rate"
                value={
                  record.bolus.pumpRateMlHr
                    ? `${formatNumber(record.bolus.pumpRateMlHr)} mL/hr`
                    : 'Enter time'
                }
              />
            </div>
          </section>

          <section className="clinical-card span-2">
            <div className="card-heading">
              <div>
                <p className="eyebrow">User-supplied medication values</p>
                <h3>Medications</h3>
              </div>
            </div>
            <div className="quick-action-row">
              <button className="secondary-button compact-button" onClick={() => startDrug('Premedication')} type="button">Add Premed</button>
              <button className="secondary-button compact-button" onClick={() => startDrug('Induction')} type="button">Add Induction</button>
              <button className="secondary-button compact-button" onClick={() => startDrug('Intraoperative')} type="button">Add Intra-op</button>
              <button className="secondary-button compact-button" onClick={() => startDrug('Emergency / Additional')} type="button">Add Emergency / Additional</button>
            </div>
            {showDrugForm && (
              <MedicationEntryForm
                calculation={calculatedDrug}
                draft={drugDraft}
                error={drugError}
                isEditing={Boolean(editingDrugId)}
                onCancel={cancelDrugEntry}
                onChange={updateDrugDraft}
                onSave={addOrUpdateDrug}
                setDraft={setDrugDraft}
                weightKg={patient.weightKg}
              />
            )}
            {!showDrugForm && record.drugs.length === 0 && (
              <p className="clinical-note">Add a medication from a stage to calculate volume. PawPilot uses the patient weight and the dose entered by the technician.</p>
            )}
            <PlannedMedicationCards
              drugs={record.drugs}
              onEdit={editDrug}
              onMarkGiven={markPlannedDrugGiven}
              onRemove={removeDrug}
            />
          </section>

          <section className="clinical-card span-2">
            <div className="card-heading">
              <div>
                <p className="eyebrow">Documentation</p>
                <h3>Anesthesia / Procedure Notes</h3>
              </div>
            </div>
            <label>
              <span>Notes</span>
              <textarea
                name="notes"
                onChange={(event) => updateField('notes', event.target.value)}
                rows="7"
                value={record.notes}
              />
            </label>
          </section>

          <section className="clinical-card span-2">
            <div className="card-heading">
              <div><p className="eyebrow">Record / Export</p><h3>Anesthesia Record Status</h3></div>
              {record.status !== 'Completed' && <button className="danger-button" onClick={completeRecord} type="button">Complete Anesthesia Record</button>}
            </div>
            <p className="clinical-note">PawPilot records technician-entered monitoring, medication, fluid, and recovery documentation. It does not interpret anesthetic values or recommend interventions.</p>
          </section>
        </div>
      </section>

      <div className="print-only">
        <PatientRecordPrintLayout patient={patient} record={record} />
      </div>
    </>
  );
}

function MedicationEntryForm({
  calculation,
  draft,
  error,
  isEditing,
  onCancel,
  onChange,
  onSave,
  setDraft,
  weightKg,
}) {
  const selectedPreset = findMedicationPreset(draft.presetId);
  const isCustom = draft.presetId === CUSTOM_MEDICATION_PRESET_ID || (!draft.presetId && draft.name);
  const calculationSummary = calculation
    ? `${formatNumber(weightKg, { maximumFractionDigits: 3 })} kg × ${formatNumber(draft.dose, { maximumFractionDigits: 3 })} ${displayUnit(draft.doseUnit)} = ${formatNumber(
        calculation.totalDose,
        { maximumFractionDigits: 3 },
      )} ${displayUnit(calculation.totalDoseUnit)} ÷ ${formatConcentration(draft.concentration, draft.concentrationUnit)} = ${formatMl(calculation.volumeMl)} mL`
    : '';

  return (
    <div className="compact-entry-panel">
      <div className="form-grid compact-grid">
        <label>
          <span>Stage / use</span>
          <select name="stage" onChange={onChange} value={draft.stage}>
            {MEDICATION_STAGES.map((stage) => (
              <option key={stage} value={stage}>{stage}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Medication</span>
          <select name="presetId" onChange={onChange} value={draft.presetId}>
            <option value="">Choose medication</option>
            {filterMedicationPresets('').map((preset) => (
              <option key={preset.id} value={preset.id}>
                {[preset.displayName, formatConcentration(preset.concentration, preset.concentrationUnit)].filter(Boolean).join(' — ')}
              </option>
            ))}
            <option value={CUSTOM_MEDICATION_PRESET_ID}>Custom Medication</option>
          </select>
        </label>
        {(isCustom || draft.presetId === CUSTOM_MEDICATION_PRESET_ID) && (
          <label>
            <span>Drug name</span>
            <input name="name" onChange={onChange} value={draft.name} />
          </label>
        )}
        {selectedPreset?.requiresConcentrationConfirmation && (
          <p className="clinical-note full-span">
            Confirm this medication concentration before calculating. PawPilot has not stored a starter concentration for this preset.
          </p>
        )}
        <label className="inline-unit-field">
          <span>Concentration</span>
          <span className="inline-unit-control">
            <input
              aria-label="Medication entry concentration"
              inputMode="decimal"
              min="0"
              name="concentration"
              onChange={onChange}
              type="number"
              value={draft.concentration}
            />
            <select aria-label="Medication entry concentration unit" name="concentrationUnit" onChange={onChange} value={draft.concentrationUnit}>
              <option value="mg/mL">mg/mL</option>
              <option value="ug/mL">µg/mL</option>
            </select>
          </span>
        </label>
        <label className="inline-unit-field">
          <span>Ordered dose</span>
          <span className="inline-unit-control">
            <input
              aria-label="Medication entry dose"
              inputMode="decimal"
              min="0"
              name="dose"
              onChange={onChange}
              placeholder="Enter ordered dose"
              type="number"
              value={draft.dose}
            />
            <select aria-label="Medication entry dose unit" name="doseUnit" onChange={onChange} value={draft.doseUnit}>
              <option value="mg/kg">mg/kg</option>
              <option value="ug/kg">µg/kg</option>
            </select>
          </span>
        </label>
        <label>
          <span>Route</span>
          <select aria-label="Medication entry route" name="route" onChange={onChange} value={draft.route}>
            <option value="">Choose route</option>
            {ROUTES.map((route) => (
              <option key={route} value={route}>{route}</option>
            ))}
          </select>
        </label>
        {draft.route === 'Other' && (
          <label>
            <span>Custom route</span>
            <input name="customRoute" onChange={onChange} value={draft.customRoute} />
          </label>
        )}
      </div>

      <details className="more-options-panel" open={draft.showMore}>
        <summary>More options</summary>
        <div className="form-grid compact-grid">
          <label className="full-span">
            <span>Optional note</span>
            <input name="note" onChange={onChange} value={draft.note} />
          </label>
        </div>
      </details>

      <div className="result-row">
        <ResultPanel
          label="Total drug dose"
          value={
            calculation
              ? `${formatNumber(calculation.totalDose, { maximumFractionDigits: 3 })} ${displayUnit(
                  calculation.totalDoseUnit,
                )}`
              : 'Enter dose'
          }
        />
        <ResultPanel
          label="Volume to administer"
          value={calculation ? `${formatMl(calculation.volumeMl)} mL` : 'Enter concentration'}
        />
      </div>
      {calculationSummary && <p className="calculation-summary">{calculationSummary}</p>}
      {error && <small>{error}</small>}
      <div className="form-actions">
        <button className="primary-button" onClick={onSave} type="button">
          {isEditing ? 'Update Medication' : 'Add to Anesthesia Record'}
        </button>
        <button
          className="ghost-button"
          onClick={() => {
            setDraft(emptyDrug);
            onCancel();
          }}
          type="button"
        >
          Cancel
        </button>
      </div>
      <p className="clinical-note">Presets fill medication identity and concentration only. Enter the ordered dose before saving.</p>
    </div>
  );
}

function PlannedMedicationCards({ drugs, onEdit, onMarkGiven, onRemove }) {
  if (drugs.length === 0) {
    return null;
  }

  return (
    <div className="medication-card-grid">
      {drugs.map((drug) => (
        <article className="medication-summary-card" key={drug.id}>
          <div>
            <p className="eyebrow">{drug.stage || 'Other'}</p>
            <h4>{drug.name}</h4>
          </div>
          <div className="overview-list">
            <span>Dose: {formatNumber(drug.dose, { maximumFractionDigits: 3 })} {displayUnit(drug.doseUnit)}</span>
            {formatConcentration(drug.concentration, drug.concentrationUnit) && <span>Concentration: {formatConcentration(drug.concentration, drug.concentrationUnit)}</span>}
            <span>Total dose: {formatNumber(drug.totalDose, { maximumFractionDigits: 3 })} {displayUnit(drug.totalDoseUnit)}</span>
            <span>Volume: {formatMl(drug.volumeMl)} mL</span>
            {drug.route && <span>Route: {drug.route === 'Other' ? drug.customRoute || 'Other' : drug.route}</span>}
          </div>
          {drug.note && <p className="clinical-note">{drug.note}</p>}
          <div className="form-actions">
            <button className="ghost-button compact-button" onClick={() => onEdit(drug)} type="button">Edit</button>
            <button className="secondary-button compact-button" onClick={() => onMarkGiven(drug)} type="button">Mark Given</button>
            <button className="text-danger-button compact-button" onClick={() => onRemove(drug.id)} type="button">Remove</button>
          </div>
        </article>
      ))}
    </div>
  );
}

function OptionalFieldChooser({ enabledFields, onChange }) {
  function toggle(fieldKey) {
    onChange(
      enabledFields.includes(fieldKey)
        ? enabledFields.filter((key) => key !== fieldKey)
        : [...enabledFields, fieldKey],
    );
  }

  return (
    <div>
      <p className="clinical-note">Optional monitoring rows</p>
      <div className="monitoring-field-toggle-grid">
        {OPTIONAL_MONITORING_FIELDS.map((field) => (
          <label className="checkbox-row" key={field.key}>
            <input
              checked={enabledFields.includes(field.key)}
              onChange={() => toggle(field.key)}
              type="checkbox"
            />
            <span>{field.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function MonitoringGrid({ points, fields, entries, selectedPoint, onSelect }) {
  const parameterColumnWidth = '10.5rem';
  const minimumTimeColumnWidth = '4.5rem';
  const maximumTimeColumnWidth = '5.5rem';
  const gridTemplateColumns = `${parameterColumnWidth} repeat(${points.length}, minmax(${minimumTimeColumnWidth}, ${maximumTimeColumnWidth}))`;
  const minGridWidth = `calc(${parameterColumnWidth} + ${points.length} * ${minimumTimeColumnWidth})`;

  if (points.length === 0) {
    return (
      <div className="empty-state compact">
        <p>No monitoring times yet.</p>
        <p>Set a monitoring start time to generate the flowsheet.</p>
      </div>
    );
  }

  return (
    <div className="monitoring-grid-wrap">
      <div
        className="monitoring-grid"
        style={{
          gridTemplateColumns,
          minWidth: minGridWidth,
          width: '100%',
        }}
      >
        <div className="sheet-cell sheet-sticky sheet-corner">Parameter</div>
        {points.map((point) => {
          const entry = entryForPoint(entries, point);
          return (
            <button
              className={[
                'sheet-cell monitoring-time',
                selectedPoint === point.timestamp ? 'selected' : '',
                point.upcoming ? 'upcoming' : '',
              ].filter(Boolean).join(' ')}
              data-timestamp={point.timestamp}
              key={point.timestamp}
              onClick={() => onSelect(point)}
              type="button"
            >
              {displayTime(point.timestamp)}
              {!point.scheduled && <span>Extra</span>}
            </button>
          );
        })}
        {fields.map((field) => (
          <MonitoringRow entries={entries} field={field} key={field.key} points={points} />
        ))}
      </div>
    </div>
  );
}

function MonitoringRow({ field, points, entries }) {
  return (
    <>
      <div className="sheet-cell sheet-sticky sheet-row-label">
        <strong>{field.label}</strong>
      </div>
      {points.map((point) => {
        const entry = entryForPoint(entries, point);
        return (
          <div className="sheet-cell monitoring-value-cell" key={`${field.key}-${point.timestamp}`}>
            {entry ? formatMonitoringValue(field.key, entry) || <span className="empty-dot">—</span> : ''}
          </div>
        );
      })}
    </>
  );
}

function MonitoringEntryPanel({ scheduledAt, draft, fields, enabledFields, onChange, onCopyEquipment, onSave }) {
  const entryFields = fields.filter(
    (field) => CORE_MONITORING_FIELDS.some((core) => core.key === field.key) || enabledFields.includes(field.key),
  );

  return (
    <section className="monitoring-entry-panel">
      <div className="card-heading">
        <div>
          <p className="eyebrow">{displayTime(scheduledAt)} Monitoring</p>
          <h3>Document Time Point</h3>
        </div>
        <button className="ghost-button compact-button" onClick={onCopyEquipment} type="button">
          Copy Prior Equipment Settings
        </button>
      </div>
      <div className="form-grid compact-grid">
        <label>
          <span>Actual documentation time</span>
          <input
            type="datetime-local"
            value={localDateTimeInput(draft.actualAt || draft.timestamp)}
            onChange={(event) => onChange((current) => ({ ...current, actualAt: isoFromLocalInput(event.target.value), timestamp: isoFromLocalInput(event.target.value) }))}
          />
        </label>
        <label>
          <span>Technician</span>
          <input value={draft.technician || ''} onChange={(event) => onChange((current) => ({ ...current, technician: event.target.value }))} />
        </label>
        {entryFields.map((field) => (
          <label key={field.key}>
            <span>{field.label}</span>
            <input
              aria-label={`Monitoring ${field.label}`}
              inputMode={field.type === 'number' ? 'decimal' : undefined}
              type={field.type === 'number' ? 'number' : 'text'}
              value={draft[field.key] ?? ''}
              onChange={(event) => onChange((current) => ({ ...current, [field.key]: event.target.value }))}
            />
          </label>
        ))}
        <label>
          <span>Temperature unit</span>
          <select value={draft.temperatureUnit || 'F'} onChange={(event) => onChange((current) => ({ ...current, temperatureUnit: event.target.value }))}>
            <option value="F">°F</option>
            <option value="C">°C</option>
          </select>
        </label>
        <label className="full-span">
          <span>Notes</span>
          <textarea rows="3" value={draft.notes || ''} onChange={(event) => onChange((current) => ({ ...current, notes: event.target.value }))} />
        </label>
      </div>
      <button className="primary-button" onClick={onSave} type="button">Save Monitoring Point</button>
      <p className="clinical-note">Empty fields are not saved as documentation. Scheduled and actual times are preserved separately.</p>
    </section>
  );
}

function TimelineList({ items }) {
  if (items.length === 0) {
    return <p className="clinical-note">No events documented yet.</p>;
  }

  return (
    <div className="timeline-list">
      {items.map((item) => (
        <div className="timeline-entry" key={`${item.time}-${item.title}-${item.detail}`}>
          <strong>{displayTime(item.time)}</strong>
          <span>{item.title}{item.detail ? ` — ${item.detail}` : ''}</span>
        </div>
      ))}
    </div>
  );
}

function MedicationAdminTable({ administrations }) {
  if (administrations.length === 0) {
    return <p className="clinical-note">No anesthesia medications documented as given yet.</p>;
  }

  return (
    <div className="drug-table-wrap">
      <table className="drug-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Drug</th>
            <th>Dose</th>
            <th>Concentration</th>
            <th>Volume</th>
            <th>Route</th>
          </tr>
        </thead>
        <tbody>
          {administrations.map((admin) => (
            <tr key={admin.id}>
              <td>{displayTime(admin.actualAt)}</td>
              <td>{admin.name}</td>
              <td>{formatNumber(admin.dose, { maximumFractionDigits: 3 })} {displayUnit(admin.doseUnit)}</td>
              <td>{formatConcentration(admin.concentration, admin.concentrationUnit)}</td>
              <td>{formatMl(admin.volumeMl)} mL</td>
              <td>{admin.route === 'Other' ? admin.customRoute || 'Other' : admin.route}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
