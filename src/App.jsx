import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout.jsx';
import AnesthesiaPage from './pages/AnesthesiaPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import EditPatientPage from './pages/EditPatientPage.jsx';
import HospitalizationPage from './pages/HospitalizationPage.jsx';
import NewPatientPage from './pages/NewPatientPage.jsx';
import PatientDetailPage from './pages/PatientDetailPage.jsx';
import PlaceholderPage from './pages/PlaceholderPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="anesthesia" element={<PlaceholderPage moduleName="Anesthesia" />} />
        <Route path="hospitalization" element={<PlaceholderPage moduleName="Hospitalization" />} />
        <Route path="patients" element={<DashboardPage />} />
        <Route path="patients/new" element={<NewPatientPage />} />
        <Route path="patients/:id" element={<PatientDetailPage />} />
        <Route path="patients/:id/edit" element={<EditPatientPage />} />
        <Route path="patients/:id/anesthesia" element={<AnesthesiaPage />} />
        <Route path="patients/:id/hospitalization" element={<HospitalizationPage />} />
        <Route path="calculators" element={<PlaceholderPage moduleName="Dosage Calculator" />} />
        <Route path="reference" element={<PlaceholderPage moduleName="Reference" disabled />} />
        <Route path="settings" element={<PlaceholderPage moduleName="Settings" disabled />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
