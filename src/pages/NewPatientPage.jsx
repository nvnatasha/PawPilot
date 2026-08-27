import { useNavigate } from 'react-router-dom';
import PatientForm from '../components/patients/PatientForm.jsx';
import { patientService } from '../services/patientService.js';

export default function NewPatientPage() {
  const navigate = useNavigate();

  function savePatient(patient) {
    const savedPatient = patientService.create(patient);
    navigate(`/patients/${savedPatient.id}`);
  }

  return (
    <section className="page-section narrow">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Patient intake</p>
          <h2>New Patient</h2>
        </div>
      </div>
      <PatientForm onSubmit={savePatient} />
    </section>
  );
}
