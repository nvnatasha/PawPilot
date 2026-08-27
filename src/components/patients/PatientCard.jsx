import { Link } from 'react-router-dom';
import { getNextTreatment, hospitalizationService } from '../../services/hospitalizationService.js';
import { formatWeight } from '../../utils/weight.js';

const workflowLabels = {
  anesthesia: 'Anesthesia',
  hospitalization: 'Hospitalization',
  both: 'Anesthesia + Hospitalization',
};

export default function PatientCard({ patient, onRemove }) {
  const activeHospitalization = hospitalizationService.getActiveByPatientId(patient.id);

  return (
    <article className="patient-card">
      <div>
        <div className="card-topline">
          <h3>{patient.name}</h3>
          <span className="status-pill">{workflowLabels[patient.workflow]}</span>
        </div>
        <p className="patient-meta">
          {patient.species} • {formatWeight(patient.weightKg)} kg • {formatWeight(patient.weightLb)} lb
        </p>
        <p className="patient-reason">{patient.reason || 'No reason entered'}</p>
        {activeHospitalization && (
          <p className="patient-submeta">
            Hospitalized · Next: {getNextTreatment(activeHospitalization)}
          </p>
        )}
      </div>
      <div className="card-actions">
        <Link className="secondary-button" to={`/patients/${patient.id}`}>
          Open Patient
        </Link>
        <button className="text-danger-button" onClick={() => onRemove(patient)} type="button">
          Remove
        </button>
      </div>
    </article>
  );
}
