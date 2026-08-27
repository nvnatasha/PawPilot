import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';
import { createMedication, hospitalizationService } from '../services/hospitalizationService.js';
import { patientService } from '../services/patientService.js';

function renderApp(initialEntries) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <App />
    </MemoryRouter>,
  );
}

describe('HospitalizationPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('loads patient context from the route and renders the treatment grid', () => {
    const patient = patientService.create({
      name: 'Bella',
      species: 'Canine',
      weightKg: 22.4,
      weightLb: 49.383488,
      age: '6 years',
      sexStatus: 'FS',
      reason: 'Pancreatitis',
      workflow: 'hospitalization',
    });

    renderApp([`/patients/${patient.id}/hospitalization`]);

    expect(screen.getByRole('heading', { name: 'BELLA' })).toBeInTheDocument();
    expect(screen.getByText(/Canine • 22.4 kg • 49.4 lb/i)).toBeInTheDocument();
    expect(screen.getAllByText(/24-Hour Treatment Sheet/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Day shift 8a–7p')).toBeInTheDocument();
    expect(screen.getByText('Night shift 8p–7a')).toBeInTheDocument();
  });

  it('handles invalid patient IDs gracefully', () => {
    renderApp(['/patients/missing/hospitalization']);

    expect(screen.getByText('This hospitalization record cannot be opened.')).toBeInTheDocument();
  });

  it('renders a print record without app navigation content', () => {
    const patient = patientService.create({
      name: 'Bella',
      species: 'Canine',
      weightKg: 22.4,
      weightLb: 49.383488,
      reason: 'Pancreatitis',
      workflow: 'hospitalization',
    });

    renderApp([`/patients/${patient.id}/hospitalization`]);

    const printRecord = screen.getByLabelText('Printable hospitalization record');
    expect(within(printRecord).getByText('PawPilot — Hospitalization Treatment Record')).toBeInTheDocument();
    expect(within(printRecord).queryByText('Dashboard')).not.toBeInTheDocument();
    expect(within(printRecord).queryByText('New Patient')).not.toBeInTheDocument();
  });

  it('shows medication concentration on the sheet and documentation modal', async () => {
    const user = userEvent.setup();
    const patient = patientService.create({
      name: 'Bella',
      species: 'Canine',
      weightKg: 22,
      weightLb: 48.5,
      reason: 'Pancreatitis',
      workflow: 'hospitalization',
    });
    const record = hospitalizationService.getOrCreateActive(patient);
    const created = createMedication(
      {
        drugName: 'Cerenia',
        dose: 1,
        doseUnit: 'mg/kg',
        concentration: 10,
        concentrationUnit: 'mg/mL',
        route: 'IV',
        scheduleMode: 'once',
        firstDueTime: '08:00',
      },
      patient,
    );
    hospitalizationService.save({
      ...record,
      medications: [created.medication],
      treatmentSheet: { ...record.treatmentSheet, rows: [created.row] },
    });

    renderApp([`/patients/${patient.id}/hospitalization`]);

    expect(screen.getByText('Medication · 10 mg/mL')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /8:00 AM/ }));

    const modal = screen.getByRole('dialog', { name: 'Cerenia' });
    expect(within(modal).getByText('Concentration: 10 mg/mL')).toBeInTheDocument();
  });
});
