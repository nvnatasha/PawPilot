import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';
import { anesthesiaRecordService } from '../services/anesthesiaRecordService.js';
import { patientService } from '../services/patientService.js';

const abandonedFlowsheetClass = ['anesthesia', 'print', 'flowsheet'].join('-');
const abandonedMonitoringClass = ['anesthesia', 'print', 'monitoring'].join('-');

function renderApp(initialEntries) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <App />
    </MemoryRouter>,
  );
}

describe('AnesthesiaPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('loads patient context from the route', () => {
    const patient = patientService.create({
      name: 'Bella',
      species: 'Canine',
      weightKg: 22.4,
      weightLb: 49.383488,
      age: '6 years',
      sexStatus: 'FS',
      reason: 'Splenectomy',
      workflow: 'anesthesia',
    });

    renderApp([`/patients/${patient.id}/anesthesia`]);

    expect(screen.getByRole('heading', { name: 'BELLA' })).toBeInTheDocument();
    expect(screen.getAllByText(/Canine • 22.4 kg • 49.4 lb/i).length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue('Splenectomy')).toBeInTheDocument();
    expect(screen.getByText('Recommended setup')).toBeInTheDocument();
    expect(screen.getAllByText('Rebreathing').length).toBeGreaterThan(0);
  });

  it('handles invalid patient IDs gracefully', () => {
    renderApp(['/patients/missing/anesthesia']);

    expect(screen.getByText('This anesthesia record cannot be opened.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to current patients/i })).toBeInTheDocument();
  });

  it('renders a print record without app navigation content', () => {
    const patient = patientService.create({
      name: 'Bella',
      species: 'Canine',
      weightKg: 22.4,
      weightLb: 49.383488,
      age: '',
      sexStatus: '',
      reason: 'Splenectomy',
      workflow: 'anesthesia',
    });

    renderApp([`/patients/${patient.id}/anesthesia`]);

    const printRecord = screen.getByLabelText('Printable anesthesia record');
    expect(within(printRecord).getByText('PawPilot — Anesthesia Record')).toBeInTheDocument();
    expect(within(printRecord).queryByText('Dashboard')).not.toBeInTheDocument();
    expect(within(printRecord).queryByText('New Patient')).not.toBeInTheDocument();
  });

  it('documents an anesthesia monitoring point without saving blank values', async () => {
    const user = userEvent.setup();
    const patient = patientService.create({
      name: 'Bella',
      species: 'Canine',
      weightKg: 22.4,
      weightLb: 49.383488,
      reason: 'Splenectomy',
      workflow: 'anesthesia',
    });

    renderApp([`/patients/${patient.id}/anesthesia`]);

    await user.type(screen.getByLabelText('Monitoring start'), '10:00');
    await user.click(screen.getByRole('button', { name: '10:00 AM' }));
    await user.type(screen.getByLabelText('Monitoring HR'), '110');
    await user.type(screen.getByLabelText('Monitoring MAP'), '0');
    await user.click(screen.getByRole('button', { name: 'Save Monitoring Point' }));

    expect(screen.getByText('Latest — 10:00 AM')).toBeInTheDocument();
    expect(screen.getByText('HR 110')).toBeInTheDocument();
    expect(screen.getByText('MAP 0')).toBeInTheDocument();
  });

  it('keeps the live monitoring grid flexible, contained, and screen-only', () => {
    const patient = patientService.create({
      name: 'Bella',
      species: 'Canine',
      weightKg: 22.4,
      weightLb: 49.383488,
      reason: 'Splenectomy',
      workflow: 'anesthesia',
    });
    const record = anesthesiaRecordService.getOrCreateForPatient(patient);
    anesthesiaRecordService.save({
      ...record,
      monitoring: {
        ...record.monitoring,
        startedAt: '2026-08-26T10:00:00.000Z',
        endedAt: '2026-08-26T10:25:00.000Z',
        intervalMinutes: 5,
        entries: [
          {
            id: 'entry-1',
            scheduledAt: '2026-08-26T10:00:00.000Z',
            timestamp: '2026-08-26T10:00:00.000Z',
            hr: '110',
          },
        ],
      },
    });

    const { container } = renderApp([`/patients/${patient.id}/anesthesia`]);
    const screenSection = container.querySelector('.anesthesia-screen');
    const liveGrid = screenSection.querySelector('.monitoring-grid');

    expect(liveGrid).toBeInTheDocument();
    expect(liveGrid.getAttribute('style')).toContain('grid-template-columns: 10.5rem repeat(6, minmax(4.5rem, 5.5rem))');
    expect(liveGrid.getAttribute('style')).toContain('min-width: calc(10.5rem + 6 * 4.5rem)');
    expect(liveGrid.getAttribute('style')).toContain('width: 100%');
    expect(liveGrid.getAttribute('style')).not.toContain('minmax(4.5rem, 1fr)');
    expect(screenSection.querySelectorAll('.monitoring-time')).toHaveLength(6);
    expect(screenSection.querySelector(`.${abandonedMonitoringClass}`)).not.toBeInTheDocument();
    expect(screenSection.querySelector(`.${abandonedFlowsheetClass}`)).not.toBeInTheDocument();
    expect(container.querySelector('.print-only .anesthesia-monitoring-print-table')).toBeInTheDocument();
  });

  it('lets a few monitoring columns fill the card while many columns keep a readable minimum', () => {
    const patient = patientService.create({
      name: 'Bella',
      species: 'Canine',
      weightKg: 22.4,
      weightLb: 49.383488,
      reason: 'Splenectomy',
      workflow: 'anesthesia',
    });
    const record = anesthesiaRecordService.getOrCreateForPatient(patient);
    anesthesiaRecordService.save({
      ...record,
      monitoring: {
        ...record.monitoring,
        startedAt: '2026-08-26T10:00:00.000Z',
        endedAt: '2026-08-26T11:10:00.000Z',
        intervalMinutes: 5,
        entries: [],
      },
    });

    const { container } = renderApp([`/patients/${patient.id}/anesthesia`]);
    const liveGrid = container.querySelector('.anesthesia-screen .monitoring-grid');
    const style = liveGrid.getAttribute('style');

    expect(style).toContain('grid-template-columns: 10.5rem repeat(15, minmax(4.5rem, 5.5rem))');
    expect(style).toContain('min-width: calc(10.5rem + 15 * 4.5rem)');
    expect(style).toContain('width: 100%');
    expect(style).not.toContain('minmax(4.5rem, 1fr)');
    expect(container.querySelectorAll('.anesthesia-screen .monitoring-time')).toHaveLength(15);
  });

  it('shows upcoming monitoring slots without persisting entries until one is documented', async () => {
    const user = userEvent.setup();
    const patient = patientService.create({
      name: 'Bella',
      species: 'Canine',
      weightKg: 22.4,
      weightLb: 49.383488,
      reason: 'Splenectomy',
      workflow: 'anesthesia',
    });
    const record = anesthesiaRecordService.getOrCreateForPatient(patient);
    anesthesiaRecordService.save({
      ...record,
      monitoring: {
        ...record.monitoring,
        startedAt: '2026-08-26T10:00:00.000Z',
        intervalMinutes: 5,
        entries: [],
      },
    });

    const { container } = renderApp([`/patients/${patient.id}/anesthesia`]);
    const timeButtons = container.querySelectorAll('.anesthesia-screen .monitoring-time');

    expect(timeButtons).toHaveLength(12);
    expect(container.querySelectorAll('.anesthesia-screen .monitoring-time.upcoming')).toHaveLength(12);
    expect(anesthesiaRecordService.getByPatientId(patient.id).monitoring.entries).toHaveLength(0);
    expect(container.querySelectorAll('.anesthesia-screen .monitoring-value-cell .empty-dot')).toHaveLength(0);

    await user.click(timeButtons[6]);
    await user.type(screen.getByLabelText('Monitoring HR'), '108');
    await user.click(screen.getByRole('button', { name: 'Save Monitoring Point' }));

    const savedRecord = anesthesiaRecordService.getByPatientId(patient.id);
    expect(savedRecord.monitoring.entries).toHaveLength(1);
    expect(savedRecord.monitoring.entries[0]).toMatchObject({
      scheduledAt: timeButtons[6].getAttribute('data-timestamp'),
      hr: '108',
    });
  });

  it('does not generate future placeholder slots after the anesthesia record is completed', () => {
    const patient = patientService.create({
      name: 'Bella',
      species: 'Canine',
      weightKg: 22.4,
      weightLb: 49.383488,
      reason: 'Splenectomy',
      workflow: 'anesthesia',
    });
    const record = anesthesiaRecordService.getOrCreateForPatient(patient);
    anesthesiaRecordService.save({
      ...record,
      status: 'Completed',
      monitoring: {
        ...record.monitoring,
        startedAt: '2026-08-26T10:00:00.000Z',
        intervalMinutes: 5,
        entries: [
          {
            id: 'entry-1',
            scheduledAt: '2026-08-26T10:10:00.000Z',
            timestamp: '2026-08-26T10:12:00.000Z',
            hr: '108',
          },
        ],
      },
    });

    const { container } = renderApp([`/patients/${patient.id}/anesthesia`]);

    expect(container.querySelectorAll('.anesthesia-screen .monitoring-time')).toHaveLength(3);
    expect(container.querySelectorAll('.anesthesia-screen .monitoring-time.upcoming')).toHaveLength(0);
  });

  it('uses medication presets without filling a dose and saves edited concentration by stage', async () => {
    const user = userEvent.setup();
    const patient = patientService.create({
      name: 'Bella',
      species: 'Canine',
      weightKg: 22.4,
      weightLb: 49.383488,
      reason: 'Splenectomy',
      workflow: 'anesthesia',
    });

    renderApp([`/patients/${patient.id}/anesthesia`]);

    await user.click(screen.getByRole('button', { name: 'Add Premed' }));
    await user.selectOptions(screen.getByLabelText('Medication'), 'buprenorphine');

    expect(screen.getByLabelText('Medication entry concentration')).toHaveValue(0.6);
    expect(screen.getByLabelText('Medication entry dose')).toHaveValue(null);

    await user.clear(screen.getByLabelText('Medication entry concentration'));
    await user.type(screen.getByLabelText('Medication entry concentration'), '0.3');
    await user.type(screen.getByLabelText('Medication entry dose'), '0.02');
    await user.selectOptions(screen.getByLabelText('Medication entry route'), 'IM');

    expect(screen.getByText('1.49 mL')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add to Anesthesia Record' }));

    expect(screen.getByRole('heading', { name: 'Buprenorphine' })).toBeInTheDocument();
    expect(screen.getAllByText('Premedication').length).toBeGreaterThan(0);
    expect(screen.getByText('Dose: 0.02 mg/kg')).toBeInTheDocument();
    expect(screen.getByText('Concentration: 0.3 mg/mL')).toBeInTheDocument();

    const savedRecord = anesthesiaRecordService.getByPatientId(patient.id);
    expect(savedRecord.drugs[0]).toMatchObject({
      name: 'Buprenorphine',
      stage: 'Premedication',
      concentration: 0.3,
      concentrationUnit: 'mg/mL',
      dose: 0.02,
    });
    expect(savedRecord.monitoring.medicationAdministrations).toHaveLength(0);
  });

  it('keeps custom medication units visible, calculates Cefazolin, and restores values when editing', async () => {
    const user = userEvent.setup();
    const patient = patientService.create({
      name: 'Poppy',
      species: 'Canine',
      weightKg: 5.443,
      weightLb: 11.999,
      reason: 'Dental',
      workflow: 'anesthesia',
    });

    renderApp([`/patients/${patient.id}/anesthesia`]);

    await user.click(screen.getByRole('button', { name: 'Add Induction' }));
    await user.selectOptions(screen.getByLabelText('Medication'), 'custom');
    expect(screen.queryByLabelText('Search common medications')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Medication entry concentration unit')).toHaveValue('mg/mL');
    expect(screen.getByLabelText('Medication entry dose unit')).toHaveValue('mg/kg');
    const moreOptions = screen.getByText('More options').closest('details');
    expect(within(moreOptions).queryByText('Dose unit')).not.toBeInTheDocument();
    expect(within(moreOptions).queryByText('Concentration unit')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Stage / use'), 'Intraoperative');
    await user.type(screen.getByLabelText('Drug name'), 'Cefazolin');
    await user.type(screen.getByLabelText('Medication entry concentration'), '100');
    await user.type(screen.getByLabelText('Medication entry dose'), '0.6');
    await user.selectOptions(screen.getByLabelText('Medication entry route'), 'IV');

    expect(screen.getByText('3.266 mg')).toBeInTheDocument();
    expect(screen.getByText('0.033 mL')).toBeInTheDocument();
    expect(screen.getByText(/5.443 kg × 0.6 mg\/kg = 3.266 mg ÷ 100 mg\/mL = 0.033 mL/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add to Anesthesia Record' }));

    expect(screen.getByRole('heading', { name: 'Cefazolin' })).toBeInTheDocument();
    expect(screen.getAllByText('Intraoperative').length).toBeGreaterThan(0);
    expect(screen.getByText('Dose: 0.6 mg/kg')).toBeInTheDocument();
    expect(screen.getByText('Concentration: 100 mg/mL')).toBeInTheDocument();
    expect(screen.getByText('Total dose: 3.266 mg')).toBeInTheDocument();
    expect(screen.getByText('Volume: 0.033 mL')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.getByLabelText('Drug name')).toHaveValue('Cefazolin');
    expect(screen.getByLabelText('Medication entry concentration')).toHaveValue(100);
    expect(screen.getByLabelText('Medication entry concentration unit')).toHaveValue('mg/mL');
    expect(screen.getByLabelText('Medication entry dose')).toHaveValue(0.6);
    expect(screen.getByLabelText('Medication entry dose unit')).toHaveValue('mg/kg');
    expect(screen.getByLabelText('Medication entry route')).toHaveValue('IV');
    expect(screen.getByLabelText('Stage / use')).toHaveValue('Intraoperative');
  });

  it('keeps planned-vs-given behavior unchanged for custom medications', async () => {
    const user = userEvent.setup();
    const patient = patientService.create({
      name: 'Milo',
      species: 'Canine',
      weightKg: 10,
      weightLb: 22.0462,
      reason: 'Dental',
      workflow: 'anesthesia',
    });

    renderApp([`/patients/${patient.id}/anesthesia`]);

    await user.click(screen.getByRole('button', { name: 'Add Induction' }));
    await user.selectOptions(screen.getByLabelText('Medication'), 'custom');
    await user.type(screen.getByLabelText('Drug name'), 'Alfaxalone');
    await user.type(screen.getByLabelText('Medication entry concentration'), '10');
    await user.type(screen.getByLabelText('Medication entry dose'), '2');
    await user.selectOptions(screen.getByLabelText('Medication entry route'), 'IV');
    await user.click(screen.getByRole('button', { name: 'Add to Anesthesia Record' }));

    let savedRecord = anesthesiaRecordService.getByPatientId(patient.id);
    expect(savedRecord.monitoring.medicationAdministrations).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Mark Given' }));

    savedRecord = anesthesiaRecordService.getByPatientId(patient.id);
    expect(savedRecord.monitoring.medicationAdministrations[0]).toMatchObject({
      name: 'Alfaxalone',
      stage: 'Induction',
      dose: 2,
      concentration: 10,
      route: 'IV',
    });
    expect(savedRecord.monitoring.medicationAdministrations[0].actualAt).toBeTruthy();
  });
});
