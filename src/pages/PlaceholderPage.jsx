import { Link, useParams } from 'react-router-dom';
import { patientService } from '../services/patientService.js';

export default function PlaceholderPage({ moduleName, disabled = false, patientScoped = false }) {
  const { id } = useParams();
  const patient = patientScoped && id ? patientService.getById(id) : null;

  return (
    <section className="empty-state compact">
      <p className="eyebrow">{disabled ? 'Not implemented yet' : 'Coming later'}</p>
      <h2>{moduleName}</h2>
      <p>
        {patient
          ? `${moduleName} for ${patient.name} will be added in a later PawPilot iteration.`
          : `${moduleName} will be added in a later PawPilot iteration.`}
      </p>
      <Link className="primary-button" to={patient ? `/patients/${patient.id}` : '/patients'}>
        {patient ? 'Back to Patient' : 'Back to Current Patients'}
      </Link>
    </section>
  );
}
