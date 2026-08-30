import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';
import { createMedication, documentTreatment, hospitalizationService } from '../services/hospitalizationService.js';
import { handoffService } from '../services/handoffService.js';
import { patientService } from '../services/patientService.js';

function renderApp(initialEntries) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <App />
    </MemoryRouter>,
  );
}

function createPatient() {
  return patientService.create({
    name: 'Bella',
    species: 'Canine',
    weightKg: 22.4,
    weightLb: 49.4,
    reason: 'Pancreatitis',
    workflow: 'hospitalization',
  });
}

function baseHospitalization(patient) {
  return {
    id: 'hosp-1',
    patientId: patient.id,
    status: 'active',
    sheetDate: '2026-08-26',
    startedAt: '2026-08-26T13:00:00.000Z',
    endedAt: '',
    veterinarian: 'Dr. Smith',
    technician: 'Sam',
    location: 'ICU',
    customLocation: '',
    notes: '',
    treatmentSheet: { rows: [] },
    medications: [],
    medicationAdministrations: [],
    monitoringEntries: [],
    fluids: {
      plans: [],
      bags: [],
      checks: [],
      events: [],
      boluses: [],
      activePlanId: '',
      activeBagId: '',
      hospitalizationTotalMl: 0,
    },
    customEvents: [],
  };
}

function monitoring(id, item, actualAt, values = {}, notes = '') {
  return {
    id,
    item,
    category: item,
    scheduledAt: '2026-08-26T20:00:00.000Z',
    actualAt,
    values,
    notes,
    status: 'completed',
  };
}

function saveRealisticHospitalization(patient) {
  const med = createMedication({
    drugName: 'Cefazolin',
    dose: '22',
    doseUnit: 'mg/kg',
    concentration: '100',
    concentrationUnit: 'mg/mL',
      route: 'IV',
      scheduleMode: '8',
      firstDueTime: '08:00',
      intervalHours: 8,
    }, patient);
  const record = baseHospitalization(patient);
  hospitalizationService.save({
    ...record,
    treatmentSheet: { rows: [med.row] },
    medications: [med.medication],
    monitoringEntries: [
      monitoring('tpr-1', 'TPR', '2026-08-26T22:00:00.000Z', { temperature: '100.4', temperatureUnit: 'F', hr: 104, rr: 22, spo2: 99 }),
      monitoring('bg-1', 'BG', '2026-08-26T20:07:00.000Z', { bg: '91', bgUnit: 'mg/dL' }),
      monitoring('bg-2', 'BG', '2026-08-26T23:07:00.000Z', { bg: '82', bgUnit: 'mg/dL' }),
      monitoring('pcv-1', 'PCV/TS', '2026-08-26T21:07:00.000Z', { value: '34', secondaryValue: '6.2' }),
    ],
    fluids: {
      ...record.fluids,
      activePlanId: 'plan-1',
      plans: [{ id: 'plan-1', fluidType: 'LRS', rateMlHr: 60, rateMlKgHr: 2.68, status: 'active', additives: ['20 mEq KCl/L'] }],
      checks: [{ id: 'check-1', actualAt: '2026-08-26T23:00:00.000Z', currentCumulativeMl: 842, intervalMl: 120 }],
      hospitalizationTotalMl: 842,
    },
    customEvents: [{ id: 'event-1', actualAt: '2026-08-26T22:30:00.000Z', category: 'Vomiting', item: 'Vomiting', value: '1', unit: '', notes: 'small amount' }],
  });
}

describe('HandoffPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('is linked from the patient dashboard and active hospitalization page', () => {
    const patient = createPatient();
    saveRealisticHospitalization(patient);

    renderApp([`/patients/${patient.id}`]);

    expect(screen.getByRole('heading', { name: 'Shift Handoff' })).toBeInTheDocument();
    expect(screen.getByText('Generate current summary')).toBeInTheDocument();
  });

  it('renders derived snapshot sections without interpretation language', () => {
    const patient = createPatient();
    saveRealisticHospitalization(patient);

    renderApp([`/patients/${patient.id}/handoff`]);

    expect(screen.getByRole('heading', { name: 'BELLA' })).toBeInTheDocument();
    expect(screen.getByText(/Latest TPR/)).toBeInTheDocument();
    expect(screen.getAllByText(/T 100.4°F/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/82 mg\/dL at/).length).toBeGreaterThan(0);
    expect(screen.getByText('LRS + 20 mEq KCl/L')).toBeInTheDocument();
    expect(screen.getAllByText(/Cefazolin/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/100 mg\/mL/).length).toBeGreaterThan(0);
    expect(screen.getByText('View Trends')).toHaveAttribute('href', `/patients/${patient.id}/trends`);
    expect(document.body.textContent).not.toMatch(/stable|improving|concerning|hypotensive/i);
  });

  it('persists handoff notes and follow-up items from the page', async () => {
    const user = userEvent.setup();
    const patient = createPatient();
    saveRealisticHospitalization(patient);

    renderApp([`/patients/${patient.id}/handoff`]);

    await user.type(screen.getByLabelText('Notes for the next technician'), 'Walk with sling.{Enter}Owner update at 10 PM.');
    await user.type(screen.getByLabelText('Add item'), 'Recheck IV site');
    await user.click(screen.getByRole('button', { name: 'Add Item' }));

    const draft = handoffService.listByHospitalizationId('hosp-1').find((handoff) => handoff.status === 'draft');
    expect(draft.notes).toBe('Walk with sling.\nOwner update at 10 PM.');
    expect(draft.followUpItems[0]).toMatchObject({ text: 'Recheck IV site', completed: false });
  });

  it('copies concise handoff text including medication concentration', async () => {
    const user = userEvent.setup();
    const patient = createPatient();
    saveRealisticHospitalization(patient);
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    renderApp([`/patients/${patient.id}/handoff`]);
    await user.click(screen.getByRole('button', { name: 'Copy Handoff' }));

    expect(writeText).toHaveBeenCalled();
    expect(writeText.mock.calls[0][0]).toContain('Cefazolin · 100 mg/mL');
    expect(writeText.mock.calls[0][0]).toContain('BG 82 mg/dL');
  });

  it('finalizes a preserved handoff and shows it in history', async () => {
    const user = userEvent.setup();
    const patient = createPatient();
    saveRealisticHospitalization(patient);

    renderApp([`/patients/${patient.id}/handoff`]);
    await user.click(screen.getByRole('button', { name: 'Finalize Handoff' }));

    const finalized = handoffService.listByHospitalizationId('hosp-1').find((handoff) => handoff.status === 'finalized');
    expect(finalized.snapshot.currentSnapshot.metrics.find((item) => item.label === 'BG').value).toBe('82 mg/dL');
    expect(screen.getByText('Handoff finalized and saved to history.')).toBeInTheDocument();
    expect(within(screen.getByRole('heading', { name: 'Shift Handoffs' }).closest('section')).getByText('finalized')).toBeInTheDocument();
  });

  it('renders a print-only handoff record with notes and without app navigation', async () => {
    const user = userEvent.setup();
    const patient = createPatient();
    saveRealisticHospitalization(patient);

    renderApp([`/patients/${patient.id}/handoff`]);
    await user.type(screen.getByLabelText('Notes for the next technician'), 'Owner update after midnight labs.');

    const printRecord = document.querySelector('.handoff-print-record');
    expect(printRecord).toHaveTextContent('PawPilot — Shift Handoff');
    expect(printRecord).toHaveTextContent('Owner update after midnight labs.');
    expect(printRecord).toHaveTextContent('Cefazolin');
    expect(printRecord).not.toHaveTextContent('Dashboard');
  });
});
