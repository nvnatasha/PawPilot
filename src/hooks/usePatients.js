import { useCallback, useEffect, useState } from 'react';
import { patientService } from '../services/patientService.js';

export function usePatients() {
  const [patients, setPatients] = useState([]);

  const refreshPatients = useCallback(() => {
    setPatients(patientService.list());
  }, []);

  useEffect(() => {
    refreshPatients();
  }, [refreshPatients]);

  return {
    patients,
    refreshPatients,
  };
}
