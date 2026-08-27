import { useState } from 'react';
import { Link } from 'react-router-dom';
import PatientCard from '../components/patients/PatientCard.jsx';
import ConfirmModal from '../components/ui/ConfirmModal.jsx';
import { usePatients } from '../hooks/usePatients.js';
import { patientService } from '../services/patientService.js';

export default function DashboardPage() {
  const { patients, refreshPatients } = usePatients();
  const [patientToRemove, setPatientToRemove] = useState(null);

  function confirmRemove() {
    patientService.remove(patientToRemove.id);
    setPatientToRemove(null);
    refreshPatients();
  }

  return (
    <section className="page-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Live board</p>
          <h2>Current Patients</h2>
        </div>
        {patients.length > 0 && (
          <Link className="primary-button" to="/patients/new">
            Add Patient
          </Link>
        )}
      </div>

      {patients.length === 0 ? (
        <div className="empty-state">
          <p className="eyebrow">Ready when your next case arrives</p>
          <h2>No current patients yet.</h2>
          <p>
            Add a patient once, then carry their species, weight, and workflow context into future
            anesthesia, hospitalization, and calculation tools.
          </p>
          <Link className="primary-button" to="/patients/new">
            Add Your First Patient
          </Link>
        </div>
      ) : (
        <div className="patient-grid" aria-label="Current patients">
          {patients.map((patient) => (
            <PatientCard key={patient.id} patient={patient} onRemove={setPatientToRemove} />
          ))}
        </div>
      )}

      {patientToRemove && (
        <ConfirmModal
          confirmLabel="Remove Patient"
          message={`${patientToRemove.name} will be removed from current patients.`}
          onCancel={() => setPatientToRemove(null)}
          onConfirm={confirmRemove}
          title="Remove this patient?"
        />
      )}
    </section>
  );
}
