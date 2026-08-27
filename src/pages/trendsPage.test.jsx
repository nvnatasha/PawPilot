import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';
import { buildDefaultHospitalization, hospitalizationService } from '../services/hospitalizationService.js';
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

describe('TrendsPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('is linked from the patient dashboard', () => {
    const patient = createPatient();

    renderApp([`/patients/${patient.id}`]);

    expect(screen.getByRole('heading', { name: 'Trends' })).toBeInTheDocument();
    expect(screen.getByText('Available after hospitalization data exists')).toBeInTheDocument();
  });

  it('shows a clean empty state when no hospitalization exists', () => {
    const patient = createPatient();

    renderApp([`/patients/${patient.id}/trends`]);

    expect(screen.getByText('No hospitalization trends yet.')).toBeInTheDocument();
  });

  it('renders graph, summaries, table values, and neutral safety language', async () => {
    const user = userEvent.setup();
    const patient = createPatient();
    const record = buildDefaultHospitalization(patient);
    hospitalizationService.save({
      ...record,
      startedAt: '2026-08-26T12:00:00.000Z',
      sheetDate: '2026-08-26',
      monitoringEntries: [
        {
          id: 'bg-1',
          item: 'BG',
          category: 'BG',
          scheduledAt: '2026-08-26T20:00:00.000Z',
          actualAt: '2026-08-26T20:07:00.000Z',
          values: { bg: '91', bgUnit: 'mg/dL' },
          notes: '',
        },
        {
          id: 'bg-2',
          item: 'BG',
          category: 'BG',
          scheduledAt: '2026-08-26T22:00:00.000Z',
          actualAt: '2026-08-26T22:02:00.000Z',
          values: { bg: '82', bgUnit: 'mg/dL' },
          notes: 'Ate small meal',
        },
        {
          id: 'pcv-1',
          item: 'PCV/TS',
          category: 'PCV/TS',
          actualAt: '2026-08-26T23:00:00.000Z',
          values: { value: '34', secondaryValue: '6.2' },
          notes: '',
        },
      ],
    });

    renderApp([`/patients/${patient.id}/trends`]);

    expect(screen.getByRole('heading', { name: 'BELLA' })).toBeInTheDocument();
    expect(screen.getByText(/PawPilot does not interpret trends/i)).toBeInTheDocument();
    expect(screen.queryByText(/improved|worsened|concerning|hypotensive|transfusion/i)).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: /line chart with 2 recorded values/i })).toBeInTheDocument();
    expect(screen.getByText('82 mg/dL')).toBeInTheDocument();
    expect(screen.getByText('Ate small meal')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Metric'), 'pcv');
    expect(screen.getByRole('heading', { name: 'Packed Cell Volume' })).toBeInTheDocument();
    expect(screen.getByText('34 %')).toBeInTheDocument();
  });

  it('exports the selected metric CSV', async () => {
    const user = userEvent.setup();
    const patient = createPatient();
    const record = buildDefaultHospitalization(patient);
    const clicks = [];
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:trend');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
      clicks.push(this.download);
    });
    hospitalizationService.save({
      ...record,
      startedAt: '2026-08-26T12:00:00.000Z',
      sheetDate: '2026-08-26',
      monitoringEntries: [
        {
          id: 'bg-1',
          item: 'BG',
          category: 'BG',
          actualAt: '2026-08-26T20:07:00.000Z',
          values: { bg: '91', bgUnit: 'mg/dL' },
          notes: '',
        },
      ],
    });

    renderApp([`/patients/${patient.id}/trends`]);
    await user.click(screen.getByRole('button', { name: 'Download Trend CSV' }));

    expect(clicks[0]).toMatch(/Bella_BG_/);
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
  });

  it('shows one-point and empty metric states', async () => {
    const user = userEvent.setup();
    const patient = createPatient();
    const record = buildDefaultHospitalization(patient);
    hospitalizationService.save({
      ...record,
      startedAt: '2026-08-26T12:00:00.000Z',
      sheetDate: '2026-08-26',
      monitoringEntries: [
        {
          id: 'bg-1',
          item: 'BG',
          category: 'BG',
          actualAt: '2026-08-26T20:07:00.000Z',
          values: { bg: '91', bgUnit: 'mg/dL' },
          notes: '',
        },
      ],
    });

    renderApp([`/patients/${patient.id}/trends`]);

    expect(screen.getByText(/One value is documented/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Metric'), 'lactate');
    expect(screen.getByText('No Lactate values documented for this hospitalization.')).toBeInTheDocument();
  });
});
