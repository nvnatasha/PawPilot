import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HospitalizationPrintLayout from './HospitalizationPrintLayout.jsx';
import { buildDefaultHospitalization } from '../../services/hospitalizationService.js';

const patient = {
  id: 'patient-1',
  name: 'Bella',
  species: 'Canine',
  weightKg: 22.4,
  weightLb: 49.4,
  reason: '',
};

describe('HospitalizationPrintLayout', () => {
  it('omits empty optional header fields and empty sections', () => {
    const record = buildDefaultHospitalization(patient);

    render(<HospitalizationPrintLayout patient={patient} record={record} />);

    const printRecord = screen.getByLabelText('Printable hospitalization record');
    expect(within(printRecord).queryByText('Veterinarian')).not.toBeInTheDocument();
    expect(within(printRecord).queryByText('Technician')).not.toBeInTheDocument();
    expect(within(printRecord).queryByText('Reason')).not.toBeInTheDocument();
    expect(within(printRecord).queryByText('Medication Administration Record')).not.toBeInTheDocument();
    expect(within(printRecord).queryByText('TPR / Monitoring')).not.toBeInTheDocument();
    expect(within(printRecord).queryByText('Timeline')).not.toBeInTheDocument();
    expect(within(printRecord).queryByText('Notes')).not.toBeInTheDocument();
  });

  it('renders populated TPR section with dynamic columns', () => {
    const record = {
      ...buildDefaultHospitalization(patient),
      monitoringEntries: [
        {
          id: 'tpr-1',
          category: 'TPR',
          item: 'TPR',
          actualAt: '2026-08-26T08:04:00.000Z',
          values: { temperature: '100.2', temperatureUnit: 'F', hr: '108', rr: '24' },
          notes: '',
        },
        {
          id: 'tpr-2',
          category: 'TPR',
          item: 'TPR',
          actualAt: '2026-08-26T12:01:00.000Z',
          values: { temperature: '100.8', temperatureUnit: 'F', hr: '102', rr: '20', painScore: 0 },
          notes: '',
        },
      ],
    };

    render(<HospitalizationPrintLayout patient={patient} record={record} />);

    const section = screen.getByText('TPR / Monitoring').closest('section');
    expect(within(section).getByText('Temp')).toBeInTheDocument();
    expect(within(section).getByText('Pain')).toBeInTheDocument();
    expect(within(section).queryByText('SpO₂')).not.toBeInTheDocument();
  });

  it('renders MAR optional columns only when populated', () => {
    const record = {
      ...buildDefaultHospitalization(patient),
      medicationAdministrations: [
        {
          id: 'admin-1',
          actualAt: '2026-08-26T14:06:00.000Z',
          medication: 'Cefazolin',
          dose: 22,
          doseUnit: 'mg/kg',
          concentration: 100,
          concentrationUnit: 'mg/mL',
          volumeMl: 4.9,
          route: 'IV',
          status: 'given',
          technician: '',
          notes: '',
        },
      ],
    };

    render(<HospitalizationPrintLayout patient={patient} record={record} />);

    const section = screen.getByText('Medication Administration Record').closest('section');
    expect(within(section).getByText('Cefazolin')).toBeInTheDocument();
    expect(within(section).getByText('Concentration')).toBeInTheDocument();
    expect(within(section).getByText('100 mg/mL')).toBeInTheDocument();
    expect(within(section).queryByText('Technician')).not.toBeInTheDocument();
    expect(within(section).queryByText('Notes')).not.toBeInTheDocument();
  });

  it('prints medication row concentration on the treatment sheet when available', () => {
    const record = {
      ...buildDefaultHospitalization(patient),
      medications: [
        {
          id: 'med-1',
          rowId: 'row-1',
          drugName: 'Cerenia',
          concentration: 10,
          concentrationUnit: 'mg/mL',
        },
      ],
      treatmentSheet: {
        rows: [
          {
            id: 'row-1',
            medicationId: 'med-1',
            type: 'Medication',
            name: 'Cerenia',
            schedule: { type: 'once', firstDueTime: '08:00' },
            schedulePeriods: [
              {
                id: 'period-1',
                effectiveFrom: '2026-08-26T08:00:00',
                effectiveUntil: '',
                status: 'active',
                schedule: { type: 'once', firstDueAt: '2026-08-26T08:00:00' },
              },
            ],
            occurrenceOverrides: [],
            lifecycleEvents: [],
            discontinuedAt: '',
          },
        ],
      },
    };

    render(<HospitalizationPrintLayout patient={patient} record={record} />);

    const section = screen.getByText('24-Hour Treatment Sheet').closest('section');
    expect(within(section).getByText('Cerenia')).toBeInTheDocument();
    expect(within(section).getByText('10 mg/mL')).toBeInTheDocument();
  });
});
