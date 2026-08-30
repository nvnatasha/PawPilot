import { beforeEach, describe, expect, it } from 'vitest';
import { handoffService } from './handoffService.js';

describe('handoffService', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('creates one reusable draft per patient hospitalization', () => {
    const first = handoffService.getOrCreateDraft({ patientId: 'patient-1', hospitalizationId: 'hosp-1' });
    const second = handoffService.getOrCreateDraft({ patientId: 'patient-1', hospitalizationId: 'hosp-1' });

    expect(second.id).toBe(first.id);
    expect(handoffService.listByHospitalizationId('hosp-1')).toHaveLength(1);
  });

  it('persists notes and preserves line breaks', () => {
    const draft = handoffService.getOrCreateDraft({ patientId: 'patient-1', hospitalizationId: 'hosp-1' });
    handoffService.save({ ...draft, notes: 'Walk with sling.\nOwner update at 10 PM.' });

    expect(handoffService.getById(draft.id).notes).toBe('Walk with sling.\nOwner update at 10 PM.');
  });

  it('persists add, edit, complete, and remove follow-up item state', () => {
    const draft = handoffService.getOrCreateDraft({ patientId: 'patient-1', hospitalizationId: 'hosp-1' });
    const added = handoffService.save({ ...draft, followUpItems: [{ id: 'item-1', text: 'Recheck IV site', completed: false }] });
    const edited = handoffService.save({ ...added, followUpItems: [{ id: 'item-1', text: 'Recheck catheter site', completed: true }] });

    expect(handoffService.getById(edited.id).followUpItems[0]).toMatchObject({ text: 'Recheck catheter site', completed: true });
    const removed = handoffService.save({ ...edited, followUpItems: [] });
    expect(handoffService.getById(removed.id).followUpItems).toEqual([]);
  });

  it('finalizes a handoff with a preserved generated snapshot and keeps it in history', () => {
    const draft = handoffService.getOrCreateDraft({ patientId: 'patient-1', hospitalizationId: 'hosp-1' });
    const finalized = handoffService.finalize(draft, { currentSnapshot: { metrics: [{ label: 'BG', value: '82 mg/dL' }] } });

    expect(finalized.status).toBe('finalized');
    expect(handoffService.getById(finalized.id).snapshot.currentSnapshot.metrics[0].value).toBe('82 mg/dL');
    expect(handoffService.listByHospitalizationId('hosp-1')[0].id).toBe(finalized.id);
  });

  it('can create a second handoff without losing the first', () => {
    const first = handoffService.finalize(
      handoffService.getOrCreateDraft({ patientId: 'patient-1', hospitalizationId: 'hosp-1' }),
      { label: 'first' },
    );
    const second = handoffService.createNewDraft({ patientId: 'patient-1', hospitalizationId: 'hosp-1' });

    expect(second.id).not.toBe(first.id);
    expect(handoffService.listByHospitalizationId('hosp-1')).toHaveLength(2);
  });
});
