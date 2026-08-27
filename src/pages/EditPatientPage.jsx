import { Link, useNavigate, useParams } from 'react-router-dom';
import PatientForm from '../components/patients/PatientForm.jsx';
import { patientService } from '../services/patientService.js';

export default function EditPatientPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const patient = patientService.getById(id);

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

  function updatePatient(updates) {
    patientService.update(patient.id, updates);
    navigate(`/patients/${patient.id}`);
  }

  return (
    <section className="page-section narrow">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Patient profile</p>
          <h2>Edit {patient.name}</h2>
        </div>
      </div>
      <PatientForm
        initialValues={{
          name: patient.name,
          species: patient.species,
          weight: String(patient.weightKg),
          weightUnit: 'kg',
          workflow: patient.workflow,
          age: patient.age,
          sexStatus: patient.sexStatus,
          reason: patient.reason,
        }}
        onSubmit={updatePatient}
        submitLabel="Update Patient"
      />
    </section>
  );
}
