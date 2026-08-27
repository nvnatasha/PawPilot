import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/styles/index.css', 'utf8');
const abandonedFlowsheetClass = ['anesthesia', 'print', 'flowsheet'].join('-');
const abandonedMonitoringClass = ['anesthesia', 'print', 'monitoring'].join('-');
const abandonedFirstMonitoringClass = ['first', ...abandonedMonitoringClass.split('-')].join('-');

function tokenValue(name) {
  const match = css.match(new RegExp(`${name}:\\s*(\\d+)`));
  return match ? Number(match[1]) : null;
}

function cssBlock(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escapedSelector} \\{[\\s\\S]*?\\n\\}`))?.[0] || '';
}

describe('application layer tokens', () => {
  it('keeps documentation modal layers above sticky treatment sheet layers', () => {
    expect(tokenValue('--layer-sheet-column')).toBeLessThan(tokenValue('--layer-sheet-header'));
    expect(tokenValue('--layer-sheet-header')).toBeLessThan(tokenValue('--layer-sheet-corner'));
    expect(tokenValue('--layer-sheet-corner')).toBeLessThan(tokenValue('--layer-modal-backdrop'));
    expect(tokenValue('--layer-modal-backdrop')).toBeLessThan(tokenValue('--layer-modal-dialog'));
  });

  it('applies modal layer tokens to the backdrop and dialog', () => {
    expect(css).toContain('z-index: var(--layer-modal-backdrop)');
    expect(css).toContain('z-index: var(--layer-modal-dialog)');
  });

  it('keeps anesthesia print monitoring styles isolated inside print media', () => {
    const printMediaStart = css.indexOf('@media print');
    const beforePrintMedia = css.slice(0, printMediaStart);

    expect(printMediaStart).toBeGreaterThan(-1);
    expect(beforePrintMedia).not.toContain('anesthesia-monitoring-print-table');
    expect(css).toContain('.print-only {\n  display: none;');
    expect(css).toContain('.print-only {\n    display: block !important;');
  });

  it('keeps the restored live anesthesia monitoring grid independent from print selectors', () => {
    const printMediaStart = css.indexOf('@media print');
    const beforePrintMedia = css.slice(0, printMediaStart);
    const monitoringWrapBlock = cssBlock('.monitoring-grid-wrap');
    const monitoringGridBlock = cssBlock('.monitoring-grid');
    const mainContentBlock = cssBlock('.main-content');
    const pageSectionBlock = cssBlock('.page-section');
    const anesthesiaContainmentBlock = cssBlock('.anesthesia-screen,\n.anesthesia-screen .clinical-card');

    expect(beforePrintMedia).toContain('.monitoring-grid-wrap');
    expect(monitoringWrapBlock).toContain('overflow-x: auto');
    expect(monitoringWrapBlock).toContain('max-height: 70vh');
    expect(monitoringWrapBlock).toContain('max-width: 100%');
    expect(monitoringWrapBlock).toContain('min-width: 0');
    expect(monitoringGridBlock).toContain('width: 100%');
    expect(monitoringGridBlock).not.toContain('width: max-content');
    expect(mainContentBlock).toContain('min-width: 0');
    expect(mainContentBlock).toContain('max-width: 100%');
    expect(pageSectionBlock).toContain('min-width: 0');
    expect(anesthesiaContainmentBlock).toContain('min-width: 0');
    expect(css).not.toContain(abandonedFlowsheetClass);
    expect(css).not.toContain(abandonedMonitoringClass);
    expect(css).not.toContain(abandonedFirstMonitoringClass);
  });
});
