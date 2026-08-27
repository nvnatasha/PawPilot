import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PatientRecordPrintLayout from './PatientRecordPrintLayout.jsx';
import { buildDefaultAnesthesiaRecord } from '../../services/anesthesiaRecordService.js';

const patient = {
  id: 'patient-1',
  name: 'Bella',
  species: 'Canine',
  weightKg: 22.4,
  weightLb: 49.4,
  reason: 'Splenectomy',
};

const abandonedFlowsheetClass = ['anesthesia', 'print', 'flowsheet'].join('-');
const abandonedMonitoringClass = ['anesthesia', 'print', 'monitoring'].join('-');

function monitoringEntry(index, timestamp, overrides = {}) {
  return {
    id: `entry-${index}`,
    scheduledAt: timestamp,
    timestamp,
    hr: String(100 + index),
    rr: String(20 + index),
    spo2: '99',
    etco2: '42',
    temperature: '100.2',
    temperatureUnit: 'F',
    sap: '110',
    map: '75',
    dap: '60',
    vaporizerPercent: '2.0',
    oxygenLMin: '1.5',
    ...overrides,
  };
}

function q5Record(pointCount, overrides = {}) {
  const start = new Date('2026-08-26T10:00:00.000Z');
  const entries = Array.from({ length: pointCount }, (_, index) => {
    const timestamp = new Date(start.getTime() + index * 5 * 60000).toISOString();
    return monitoringEntry(index, timestamp);
  });

  return {
    ...buildDefaultAnesthesiaRecord(patient),
    procedure: 'Splenectomy',
    monitoring: {
      ...buildDefaultAnesthesiaRecord(patient).monitoring,
      startedAt: entries[0].scheduledAt,
      endedAt: entries.at(-1).scheduledAt,
      intervalMinutes: 5,
      entries,
      ...overrides,
    },
  };
}

describe('PatientRecordPrintLayout', () => {
  it('renders monitoring grid and omits unused optional rows', () => {
    const record = {
      ...buildDefaultAnesthesiaRecord(patient),
      monitoring: {
        ...buildDefaultAnesthesiaRecord(patient).monitoring,
        startedAt: '2026-08-26T10:00:00',
        intervalMinutes: 5,
        entries: [
          {
            id: 'entry-1',
            scheduledAt: '2026-08-26T10:00:00',
            timestamp: '2026-08-26T10:00:00',
            hr: '110',
            map: 0,
          },
        ],
      },
    };

    render(<PatientRecordPrintLayout patient={patient} record={record} />);

    const section = screen.getByText(/Anesthetic Monitoring/).closest('section');
    expect(within(section).getByText('HR')).toBeInTheDocument();
    expect(within(section).getByText('MAP')).toBeInTheDocument();
    expect(within(section).getByText('0')).toBeInTheDocument();
    expect(within(section).queryByText('PEEP')).not.toBeInTheDocument();
  });

  it('prints monitoring in one stable clinical table without continuation compaction', () => {
    const { container } = render(<PatientRecordPrintLayout patient={patient} record={q5Record(18)} />);

    const table = container.querySelector('.anesthesia-monitoring-print-table');
    expect(table).toBeInTheDocument();
    expect(container.querySelector(`.${abandonedFlowsheetClass}`)).not.toBeInTheDocument();
    expect(container.querySelector(`.${abandonedMonitoringClass}`)).not.toBeInTheDocument();
    expect(table.querySelectorAll('thead th')).toHaveLength(19);
    expect(within(table).getByText('Vapor %')).toBeInTheDocument();
    expect(within(table).getByText('O₂ L/min')).toBeInTheDocument();
    expect([...table.querySelectorAll('thead th')].some((cell) => /\d{1,2}:\d{2}[ap]\*?/.test(cell.textContent))).toBe(true);
    expect(within(table).queryByText('Vaporizer %')).not.toBeInTheDocument();
    expect(screen.queryByText(/Monitoring Page/)).not.toBeInTheDocument();
  });

  it('keeps extra monitoring points chronologically ordered in print', () => {
    const start = new Date('2026-08-26T10:00:00.000Z');
    const extraTimestamp = new Date(start.getTime() + 17 * 60000).toISOString();
    const regularEntries = [0, 5, 10, 15, 20].map((minutes, index) => {
      const timestamp = new Date(start.getTime() + minutes * 60000).toISOString();
      return monitoringEntry(index, timestamp);
    });
    const record = {
      ...q5Record(5, {
        startedAt: regularEntries[0].scheduledAt,
        endedAt: regularEntries.at(-1).scheduledAt,
        entries: [...regularEntries, monitoringEntry(99, extraTimestamp, { scheduledAt: extraTimestamp, hr: '117' })],
        extraPoints: [extraTimestamp],
      }),
    };
    const { container } = render(<PatientRecordPrintLayout patient={patient} record={record} />);

    const headerText = [...container.querySelectorAll('.anesthesia-monitoring-print-table thead th')]
      .map((cell) => cell.textContent);

    expect(headerText).toHaveLength(7);
    expect(headerText[5]).toContain(':17');
    expect(headerText[4]).toContain(':15');
    expect(headerText[6]).toContain(':20');
  });

  it('prints medication concentration in anesthesia administrations', () => {
    const record = {
      ...buildDefaultAnesthesiaRecord(patient),
      monitoring: {
        ...buildDefaultAnesthesiaRecord(patient).monitoring,
        medicationAdministrations: [
          {
            id: 'admin-1',
            actualAt: '2026-08-26T10:02:00',
            name: 'Propofol',
            dose: 4,
            doseUnit: 'mg/kg',
            concentration: 10,
            concentrationUnit: 'mg/mL',
            volumeMl: 8.96,
            route: 'IV',
            technician: '',
            notes: '',
          },
        ],
      },
    };

    render(<PatientRecordPrintLayout patient={patient} record={record} />);

    const section = screen.getByText('Anesthesia Medication Administration').closest('section');
    expect(within(section).getByText('Propofol')).toBeInTheDocument();
    expect(within(section).getByText('10 mg/mL')).toBeInTheDocument();
    expect(within(section).queryByText('Technician')).not.toBeInTheDocument();
  });

  it('prints planned drug stage and human-readable medication values', () => {
    const record = {
      ...buildDefaultAnesthesiaRecord(patient),
      drugs: [
        {
          id: 'drug-1',
          presetId: 'buprenorphine',
          stage: 'Premedication',
          name: 'Buprenorphine',
          dose: 0.02,
          doseUnit: 'mg/kg',
          concentration: 0.6,
          concentrationUnit: 'mg/mL',
          totalDose: 0.448,
          totalDoseUnit: 'mg',
          volumeMl: 0.746,
          route: 'IM',
        },
      ],
    };

    render(<PatientRecordPrintLayout patient={patient} record={record} />);

    const section = screen.getByText('Drugs').closest('section');
    expect(within(section).getByText('Buprenorphine')).toBeInTheDocument();
    expect(within(section).getByText('Premedication')).toBeInTheDocument();
    expect(within(section).getByText('0.6 mg/mL')).toBeInTheDocument();
    expect(within(section).queryByText('buprenorphine')).not.toBeInTheDocument();
  });

  it('omits empty events and recovery sections until documented', () => {
    const record = buildDefaultAnesthesiaRecord(patient);

    render(<PatientRecordPrintLayout patient={patient} record={record} />);

    expect(screen.queryByText('Anesthesia Events')).not.toBeInTheDocument();
    expect(screen.queryByText('Recovery')).not.toBeInTheDocument();
  });

  it('prints partial recovery without blank labels', () => {
    const record = {
      ...buildDefaultAnesthesiaRecord(patient),
      monitoring: {
        ...buildDefaultAnesthesiaRecord(patient).monitoring,
        recoveryStatus: 'Smooth',
        recoveryEntries: [
          {
            id: 'recovery-1',
            actualAt: '2026-08-26T11:20:00',
            hr: '92',
            painScore: 0,
          },
        ],
      },
    };

    render(<PatientRecordPrintLayout patient={patient} record={record} />);

    const section = screen.getByText('Recovery').closest('section');
    expect(within(section).getByText('HR')).toBeInTheDocument();
    expect(within(section).getByText('92')).toBeInTheDocument();
    expect(within(section).getByText('Pain')).toBeInTheDocument();
    expect(within(section).queryByText('RR')).not.toBeInTheDocument();
  });
});
