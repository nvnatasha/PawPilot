import { describe, expect, it } from 'vitest';
import {
  formatBloodPressure,
  formatMonitoringValue,
  getMarColumns,
  getOtherMonitoringColumns,
  getTprColumns,
  hasMeaningfulValue,
} from './clinicalDisplay.js';

describe('clinical display helpers', () => {
  it('detects meaningful values without treating zero as empty', () => {
    expect(hasMeaningfulValue('')).toBe(false);
    expect(hasMeaningfulValue('   ')).toBe(false);
    expect(hasMeaningfulValue(null)).toBe(false);
    expect(hasMeaningfulValue(undefined)).toBe(false);
    expect(hasMeaningfulValue(0)).toBe(true);
    expect(hasMeaningfulValue(false)).toBe(true);
  });

  it('renders only used TPR columns', () => {
    const columns = getTprColumns([
      { actualAt: '2026-08-26T08:04:00.000Z', values: { temperature: '100.2', temperatureUnit: 'F', hr: '108', rr: '24' }, notes: '' },
    ]);

    expect(columns.map((column) => column.key)).toEqual(['actualAt', 'temperature', 'hr', 'rr']);
  });

  it('adds optional TPR columns only when documented, preserving pain score zero', () => {
    const columns = getTprColumns([
      { actualAt: '2026-08-26T08:04:00.000Z', values: { temperature: '100.2', hr: '108', rr: '24', painScore: 0 }, notes: '' },
      { actualAt: '2026-08-26T12:01:00.000Z', values: { temperature: '100.8', hr: '102', rr: '20', systolicBp: '112', diastolicBp: '70' }, notes: '' },
    ]);

    expect(columns.map((column) => column.key)).toContain('bp');
    expect(columns.map((column) => column.key)).toContain('painScore');
    expect(columns.map((column) => column.key)).not.toContain('spo2');
    expect(columns.map((column) => column.key)).not.toContain('notes');
  });

  it('includes notes only when at least one TPR note exists', () => {
    const columns = getTprColumns([
      { actualAt: '2026-08-26T08:04:00.000Z', values: { hr: '108' }, notes: 'Bright' },
    ]);

    expect(columns.map((column) => column.key)).toContain('notes');
  });

  it('formats blood pressure cleanly', () => {
    expect(formatBloodPressure({ systolicBp: '112', diastolicBp: '70' })).toBe('112/70');
    expect(formatBloodPressure({ systolicBp: '112', diastolicBp: '70', meanBp: '84' })).toBe('112/70 (MAP 84)');
    expect(formatBloodPressure({ meanBp: '84' })).toBe('MAP 84');
    expect(formatBloodPressure({ systolicBp: '112' })).toBe('Systolic 112');
    expect(formatBloodPressure({ diastolicBp: '70' })).toBe('Diastolic 70');
  });

  it('omits optional MAR columns when unused', () => {
    const columns = getMarColumns([
      { actualAt: '2026-08-26T14:06:00.000Z', medication: 'Cefazolin', dose: 22, volumeMl: 4.9, route: 'IV', status: 'given', technician: '', notes: '' },
    ]);

    expect(columns.map((column) => column.key)).not.toContain('technician');
    expect(columns.map((column) => column.key)).not.toContain('notes');
    expect(columns.map((column) => column.key)).not.toContain('concentration');
  });

  it('includes concentration in MAR columns when documented', () => {
    const columns = getMarColumns([
      {
        actualAt: '2026-08-26T14:06:00.000Z',
        medication: 'Cerenia',
        dose: 1,
        concentration: 10,
        concentrationUnit: 'mg/mL',
        volumeMl: 2.2,
        route: 'IV',
        status: 'given',
      },
    ]);

    expect(columns.map((column) => column.key)).toContain('concentration');
  });

  it('uses dynamic labs/custom columns and readable PCV/TS formatting', () => {
    const entry = {
      actualAt: '2026-08-26T15:00:00.000Z',
      item: 'PCV/TS',
      values: { pcv: '34', ts: '6.2' },
      technician: '',
      notes: '',
    };

    expect(formatMonitoringValue(entry)).toBe('PCV 34% / TS 6.2 g/dL');
    expect(getOtherMonitoringColumns([entry]).map((column) => column.key)).toEqual([
      'actualAt',
      'item',
      'value',
    ]);
  });
});
