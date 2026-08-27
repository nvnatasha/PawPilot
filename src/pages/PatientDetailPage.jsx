import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ConfirmModal from '../components/ui/ConfirmModal.jsx';
import { anesthesiaRecordService } from '../services/anesthesiaRecordService.js';
import { getNextTreatment, hospitalizationService } from '../services/hospitalizationService.js';
import { patientService } from '../services/patientService.js';
import { displayTime } from '../utils/anesthesiaMonitoring.js';
import { formatWeight } from '../utils/weight.js';

const workflowLabels = {
  anesthesia: 'Anesthesia',
  hospitalization: 'Hospitalization',
  both: 'Anesthesia + Hospitalization',
};

const moduleCards = [
  {
    title: 'Anesthesia',
    path: 'anesthesia',
    items: [
      'Surgical fluids',
      'Breathing circuit',
      'Oxygen flow',
      'Drug calculations',
      'Setup checklist',
    ],
  },
  {
    title: 'Hospitalization',
    path: 'hospitalization',
    items: ['Fluids', 'Medication tracking', 'TPR', 'Pain score', 'Labs and monitoring'],
  },
  {
    title: 'Calculators',
    path: '/calculators',
    items: ['Quick technician calculations', 'Dose and concentration support', 'Reusable patient weight'],
  },
  {
    title: 'Trends',
    path: 'trends',
    items: ['Vitals and labs', 'Hospitalization-wide review', 'Metric CSV export'],
  },
];

export default function PatientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [showRemove, setShowRemove] = useState(false);
  const patient = patientService.getById(id);
  const activeHospitalization = patient ? hospitalizationService.getActiveByPatientId(patient.id) : null;
  const anesthesiaRecord = patient ? anesthesiaRecordService.getByPatientId(patient.id) : null;

  if (!patient) {
    return (
      <section className="empty-state compact">
        <p className="eyebrow">Patient not found</p>
        <h2>This patient is not in the current list.</h2>
        <p>The patient may have been removed, or the link may be outdated.</p>
        <Link className="primary-button" to="/patients">
          Back to Current Patients
        </Link>
      </section>
    );
  }

  function removePatient() {
    patientService.remove(patient.id);
    navigate('/patients');
  }

  return (
    <section className="page-section">
      <div className="patient-hero">
        <div>
          <p className="eyebrow">{workflowLabels[patient.workflow]}</p>
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
          <button className="ghost-button" onClick={() => navigate(`/patients/${patient.id}/edit`)} type="button">
            Edit Patient
          </button>
          <button className="text-danger-button" onClick={() => setShowRemove(true)} type="button">
            Remove
          </button>
        </div>
      </div>

      <div className="module-grid">
        {moduleCards.map((module) => (
          <Link
            className="module-card"
            key={module.title}
            to={module.path.startsWith('/') ? module.path : `/patients/${patient.id}/${module.path}`}
          >
            <span className="module-kicker">
              {module.title === 'Hospitalization' ? 'Treatment sheet' : module.title === 'Anesthesia' ? 'Setup & monitoring' : module.title === 'Trends' ? 'Labs & monitoring' : 'Future module'}
            </span>
            <h3>{module.title}</h3>
            {module.title === 'Anesthesia' && (
              <p className="clinical-note">
                {anesthesiaRecord
                  ? `${anesthesiaRecord.status || 'Setup'}${anesthesiaRecord.monitoring?.startedAt ? ` · Monitoring started ${displayTime(anesthesiaRecord.monitoring.startedAt)}` : ''}`
                  : 'No anesthesia record yet'}
              </p>
            )}
            {module.title === 'Hospitalization' && (
              <p className="clinical-note">
                {activeHospitalization
                  ? `Active · Next: ${getNextTreatment(activeHospitalization)}`
                  : 'No active hospitalization · Start Hospitalization'}
              </p>
            )}
            {module.title === 'Trends' && (
              <p className="clinical-note">
                {activeHospitalization ? 'Review recorded hospitalization values' : 'Available after hospitalization data exists'}
              </p>
            )}
            <ul>
              {module.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Link>
        ))}
      </div>

      {showRemove && (
        <ConfirmModal
          confirmLabel="Remove Patient"
          message={`${patient.name} will be removed from current patients.`}
          onCancel={() => setShowRemove(false)}
          onConfirm={removePatient}
          title="Remove this patient?"
        />
      )}
    </section>
  );
}
