import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { HANDOFF_SHIFT_LABELS } from '../config/handoffConfig.js';
import { anesthesiaRecordService } from '../services/anesthesiaRecordService.js';
import { handoffService } from '../services/handoffService.js';
import { hospitalizationService } from '../services/hospitalizationService.js';
import { patientService } from '../services/patientService.js';
import { formatDateForFilename, safeFilenamePart } from '../utils/formatters.js';
import { buildHandoffSnapshot, buildHandoffText } from '../utils/handoff.js';
import { formatTime } from '../utils/hospitalizationSchedule.js';

function localInputFromIso(iso) {
  const date = iso ? new Date(iso) : new Date();
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

function isoFromLocalInput(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

function displayDateTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function HandoffPage() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const patient = patientService.getById(id);
  const hospitalizations = useMemo(() => (patient ? hospitalizationService.listByPatientId(patient.id) : []), [patient]);
  const activeHospitalization = hospitalizations.find((record) => record.status === 'active') || hospitalizations[0] || null;
  const [selectedHospitalizationId, setSelectedHospitalizationId] = useState(activeHospitalization?.id || '');
  const hospitalization = hospitalizations.find((record) => record.id === selectedHospitalizationId) || activeHospitalization;
  const [handoffsVersion, setHandoffsVersion] = useState(0);
  const handoffs = useMemo(
    () => (hospitalization ? handoffService.listByHospitalizationId(hospitalization.id) : []),
    [handoffsVersion, hospitalization],
  );
  const selectedId = searchParams.get('handoff');
  const selectedRecord = selectedId ? handoffs.find((handoff) => handoff.id === selectedId) : null;
  const [draft, setDraft] = useState(() => {
    if (!patient || !activeHospitalization) return null;
    return handoffService.getOrCreateDraft({ patientId: patient.id, hospitalizationId: activeHospitalization.id });
  });
  const handoff = selectedRecord || draft;
  const anesthesiaRecord = patient ? anesthesiaRecordService.getByPatientId(patient.id) : null;
  const liveSnapshot = useMemo(
    () => buildHandoffSnapshot({ patient, hospitalization, anesthesiaRecord, at: handoff?.handoffAt || new Date() }),
    [anesthesiaRecord, handoff?.handoffAt, hospitalization, patient],
  );
  const snapshot = handoff?.status === 'finalized' && handoff.snapshot ? handoff.snapshot : liveSnapshot;
  const [newFollowUp, setNewFollowUp] = useState('');
  const [message, setMessage] = useState('');

  if (!patient) {
    return (
      <section className="empty-state compact">
        <p className="eyebrow">Patient not found</p>
        <h2>This handoff cannot be opened.</h2>
        <p>The patient may have been removed, or the link may be outdated.</p>
        <Link className="primary-button" to="/patients">Back to Current Patients</Link>
      </section>
    );
  }

  if (!hospitalization || !handoff) {
    return (
      <section className="empty-state compact">
        <p className="eyebrow">No hospitalization data</p>
        <h2>No shift handoff yet.</h2>
        <p>Shift handoffs are available once a hospitalization record exists.</p>
        <Link className="primary-button" to={`/patients/${patient.id}/hospitalization`}>Open Hospitalization</Link>
      </section>
    );
  }

  function refresh() {
    setHandoffsVersion((current) => current + 1);
  }

  function updateHandoff(updates) {
    const next = handoffService.save({ ...handoff, ...updates });
    if (handoff.id === draft?.id) setDraft(next);
    refresh();
  }

  function generateHandoff() {
    updateHandoff({ snapshot: liveSnapshot });
    setMessage('Shift handoff generated from current documentation.');
  }

  async function copyHandoff() {
    const text = buildHandoffText({ patient, handoff, snapshot });
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      setMessage('Handoff copied.');
    } else {
      setMessage(text);
    }
  }

  function finalizeHandoff() {
    const finalized = handoffService.finalize(handoff, liveSnapshot);
    setDraft(handoffService.createNewDraft({ patientId: patient.id, hospitalizationId: hospitalization.id }));
    setSearchParams({ handoff: finalized.id });
    refresh();
    setMessage('Handoff finalized and saved to history.');
  }

  function editSelectedHandoff() {
    updateHandoff({ status: 'draft' });
    setMessage('Handoff reopened for editing.');
  }

  function addFollowUp() {
    if (!newFollowUp.trim()) return;
    updateHandoff({
      followUpItems: [
        ...(handoff.followUpItems || []),
        {
          id: `follow-${Date.now()}`,
          text: newFollowUp.trim(),
          completed: false,
        },
      ],
    });
    setNewFollowUp('');
  }

  function updateFollowUp(itemId, updates) {
    updateHandoff({
      followUpItems: (handoff.followUpItems || []).map((item) => (item.id === itemId ? { ...item, ...updates } : item)),
    });
  }

  function removeFollowUp(itemId) {
    updateHandoff({
      followUpItems: (handoff.followUpItems || []).filter((item) => item.id !== itemId),
    });
  }

  function startNewDraft() {
    const nextDraft = handoffService.createNewDraft({ patientId: patient.id, hospitalizationId: hospitalization.id });
    setDraft(nextDraft);
    setSearchParams({});
    refresh();
  }

  function downloadJson() {
    const content = JSON.stringify({ ...handoff, snapshot }, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeFilenamePart(patient.name)}_Handoff_${formatDateForFilename(handoff.handoffAt.slice(0, 10))}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <section className="page-section handoff-screen">
        <div className="patient-hero anesthesia-hero">
          <div>
            <p className="eyebrow">Shift Handoff</p>
            <h2>{patient.name.toUpperCase()}</h2>
            <p className="patient-meta large">
              {snapshot.patient.species} • {snapshot.patient.weight}
            </p>
            <p className="clinical-note">Derived sections show documented values only. PawPilot does not interpret patient status or recommend care.</p>
          </div>
          <div className="hero-actions">
            <button className="primary-button" onClick={generateHandoff} type="button">Generate Shift Handoff</button>
            <button className="ghost-button" onClick={copyHandoff} type="button">Copy Handoff</button>
            <button className="ghost-button" onClick={() => window.print()} type="button">Print / Save Handoff</button>
            <button className="ghost-button" onClick={downloadJson} type="button">Download Handoff JSON</button>
            <Link className="secondary-button" to={`/patients/${patient.id}/hospitalization`}>Back to Hospitalization</Link>
          </div>
        </div>

        <section className="clinical-card handoff-controls">
          <div className="card-heading">
            <div>
              <p className="eyebrow">{handoff.status}</p>
              <h3>Shift Information</h3>
            </div>
            {handoff.status === 'finalized' ? (
              <button className="ghost-button compact-button" onClick={editSelectedHandoff} type="button">Edit Handoff</button>
            ) : (
              <button className="primary-button compact-button" onClick={finalizeHandoff} type="button">Finalize Handoff</button>
            )}
          </div>
          <div className="form-grid compact-grid">
            <label>
              <span>Hospitalization</span>
              <select value={hospitalization.id} onChange={(event) => {
                const hospitalizationId = event.target.value;
                setSelectedHospitalizationId(hospitalizationId);
                setDraft(handoffService.getOrCreateDraft({ patientId: patient.id, hospitalizationId }));
                setSearchParams({});
              }}>
                {hospitalizations.map((record) => (
                  <option key={record.id} value={record.id}>
                    {displayDateTime(record.startedAt)}{record.endedAt ? ` – ${displayDateTime(record.endedAt)}` : ' – Active'}
                  </option>
                ))}
              </select>
            </label>
            <label><span>Outgoing technician</span><input value={handoff.outgoingTechnician} onChange={(event) => updateHandoff({ outgoingTechnician: event.target.value })} /></label>
            <label><span>Incoming technician</span><input value={handoff.incomingTechnician} onChange={(event) => updateHandoff({ incomingTechnician: event.target.value })} /></label>
            <label><span>Handoff date/time</span><input type="datetime-local" value={localInputFromIso(handoff.handoffAt)} onChange={(event) => updateHandoff({ handoffAt: isoFromLocalInput(event.target.value) })} /></label>
            <label><span>Shift label</span><select value={handoff.shiftLabel} onChange={(event) => updateHandoff({ shiftLabel: event.target.value })}>{HANDOFF_SHIFT_LABELS.map((label) => <option key={label} value={label}>{label}</option>)}</select></label>
            {handoff.shiftLabel === 'Custom' && <label><span>Custom shift label</span><input value={handoff.customShiftLabel} onChange={(event) => updateHandoff({ customShiftLabel: event.target.value })} /></label>}
          </div>
        </section>

        <HandoffSnapshotView snapshot={snapshot} patient={patient} />

        <section className="clinical-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">User-entered</p>
              <h3>Handoff Notes</h3>
            </div>
          </div>
          <label>
            <span>Notes for the next technician</span>
            <textarea rows="5" value={handoff.notes} onChange={(event) => updateHandoff({ notes: event.target.value })} />
          </label>
        </section>

        <section className="clinical-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">User-entered</p>
              <h3>Follow-Up / Watch Items</h3>
            </div>
          </div>
          <div className="field-button-row">
            <label><span>Add item</span><input value={newFollowUp} onChange={(event) => setNewFollowUp(event.target.value)} /></label>
            <button className="primary-button compact-button" onClick={addFollowUp} type="button">Add Item</button>
          </div>
          <div className="timeline-list compact-history">
            {(handoff.followUpItems || []).length === 0 ? <p className="clinical-note">No follow-up items added.</p> : handoff.followUpItems.map((item) => (
              <div className="timeline-entry" key={item.id}>
                <label className="checkbox-row">
                  <input checked={item.completed} onChange={(event) => updateFollowUp(item.id, { completed: event.target.checked })} type="checkbox" />
                  <span>{item.completed ? 'Complete' : 'Open'}</span>
                </label>
                <input aria-label={`Follow-up item ${item.text}`} value={item.text} onChange={(event) => updateFollowUp(item.id, { text: event.target.value })} />
                <button className="text-danger-button compact-button" onClick={() => removeFollowUp(item.id)} type="button">Remove</button>
              </div>
            ))}
          </div>
        </section>

        <section className="clinical-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Saved records</p>
              <h3>Shift Handoffs</h3>
            </div>
            <button className="ghost-button compact-button" onClick={startNewDraft} type="button">New Draft</button>
          </div>
          <div className="timeline-list">
            {handoffs.length === 0 ? <p className="clinical-note">No handoff history yet.</p> : handoffs.map((item) => (
              <button className="handoff-history-row" key={item.id} onClick={() => setSearchParams({ handoff: item.id })} type="button">
                <strong>{displayDateTime(item.handoffAt)}</strong>
                <span>{[item.outgoingTechnician || item.shiftLabel, item.incomingTechnician].filter(Boolean).join(' → ') || item.status}</span>
                <small>{item.status}</small>
              </button>
            ))}
          </div>
        </section>

        {message && <p className="clinical-note">{message}</p>}
      </section>

      <div className="print-only">
        <HandoffPrintLayout handoff={handoff} snapshot={snapshot} />
      </div>
    </>
  );
}

function HandoffSnapshotView({ snapshot, patient }) {
  if (!snapshot) return null;
  return (
    <div className="handoff-grid">
      <ClinicalSection title="Patient" eyebrow="Derived">
        <DetailList items={[
          ['Hospital day', snapshot.patient.hospitalDay],
          ['Reason', snapshot.patient.reason],
          ['Location', snapshot.patient.location],
          ['Attending veterinarian', snapshot.patient.veterinarian],
          ['Age', snapshot.patient.age],
          ['Sex/status', snapshot.patient.sexStatus],
        ]} />
      </ClinicalSection>

      <ClinicalSection title="Current Snapshot" eyebrow="Derived" empty={!snapshot.currentSnapshot.latestTpr && snapshot.currentSnapshot.metrics.length === 0}>
        {snapshot.currentSnapshot.latestTpr && (
          <div className="handoff-block">
            <strong>Latest TPR — {formatTime(snapshot.currentSnapshot.latestTpr.timestamp)}</strong>
            <p>{snapshot.currentSnapshot.latestTpr.values.map((item) => `${item.label} ${item.value}`).join(' · ')}</p>
          </div>
        )}
        {snapshot.currentSnapshot.metrics.map((item) => (
          <div className="handoff-row" key={item.id}>
            <strong>{item.label}</strong>
            <span>{item.value} at {formatTime(item.timestamp)}</span>
          </div>
        ))}
      </ClinicalSection>

      <ClinicalSection title="Active Fluids" eyebrow="Derived" empty={!snapshot.activeFluids}>
        {snapshot.activeFluids && (
          <>
            <strong>{[snapshot.activeFluids.fluid, ...snapshot.activeFluids.additives].filter(Boolean).join(' + ')}</strong>
            <p>{[snapshot.activeFluids.rateMlHr, snapshot.activeFluids.rateMlKgHr].filter(Boolean).join(' · ')}</p>
            {snapshot.activeFluids.latestCheck && <p>Last fluid check: {formatTime(snapshot.activeFluids.latestCheck.timestamp)} · {snapshot.activeFluids.latestCheck.cumulativeMl}</p>}
            {snapshot.activeFluids.hospitalizationTotalMl && <p>Hospitalization total: {snapshot.activeFluids.hospitalizationTotalMl}</p>}
          </>
        )}
      </ClinicalSection>

      <ClinicalSection title="Active Medications" eyebrow="Derived" empty={snapshot.activeMedications.length === 0}>
        {snapshot.activeMedications.map((med) => (
          <div className="handoff-block" key={med.id}>
            <strong>{med.drug}</strong>
            <p>{[med.dose, med.concentration, med.volume, med.route, med.schedule].filter(Boolean).join(' · ')}</p>
            {med.nextDue && <small>Next due: {formatTime(med.nextDue)}</small>}
            {med.prn && <small>PRN</small>}
          </div>
        ))}
      </ClinicalSection>

      <ClinicalSection title="Upcoming / Due Next" eyebrow="Derived" empty={snapshot.upcomingCare.length === 0}>
        {snapshot.upcomingCare.map((item) => <div className="handoff-row" key={`${item.time}-${item.label}`}><strong>{formatTime(item.time)}</strong><span>{item.label} · {item.status}</span></div>)}
      </ClinicalSection>

      <ClinicalSection title="Outstanding" eyebrow="Derived" empty={snapshot.outstandingCare.length === 0}>
        {snapshot.outstandingCare.map((item) => <div className="handoff-row" key={`${item.time}-${item.label}`}><strong>{formatTime(item.time)}</strong><span>{item.label} · {item.status}</span></div>)}
      </ClinicalSection>

      <ClinicalSection title="Recent Labs / Monitoring" eyebrow="Derived" empty={snapshot.recentLabs.length === 0}>
        {snapshot.recentLabs.map((metric) => (
          <div className="handoff-block" key={metric.id}>
            <strong>{metric.label}</strong>
            {metric.points.map((point) => <p key={point.id}>{formatTime(point.timestamp)} — {point.formatted}</p>)}
          </div>
        ))}
        <Link className="text-button" to={`/patients/${patient.id}/trends`}>View Trends</Link>
      </ClinicalSection>

      <ClinicalSection title="Recent Events" eyebrow="Derived" empty={snapshot.recentEvents.length === 0}>
        {snapshot.recentEvents.map((event) => <div className="handoff-row" key={`${event.timestamp}-${event.item}`}><strong>{formatTime(event.timestamp)}</strong><span>{event.item}{event.value ? ` — ${event.value}` : ''}</span>{event.notes && <small>{event.notes}</small>}</div>)}
      </ClinicalSection>

      <ClinicalSection title="Intake / Output Snapshot" eyebrow="Derived" empty={snapshot.intakeOutput.length === 0}>
        {snapshot.intakeOutput.map((item) => <div className="handoff-row" key={item.id}><strong>{formatTime(item.time)}</strong><span>{item.label}{item.value ? ` — ${item.value}` : ''}</span>{item.notes && <small>{item.notes}</small>}</div>)}
      </ClinicalSection>

      <ClinicalSection title="Anesthesia / Procedure Summary" eyebrow="Derived" empty={!snapshot.anesthesiaSummary}>
        {snapshot.anesthesiaSummary && <DetailList items={snapshot.anesthesiaSummary.items.map((item) => [item.label, item.value])} />}
      </ClinicalSection>
    </div>
  );
}

function ClinicalSection({ title, eyebrow, empty, children }) {
  if (empty) return null;
  return (
    <section className="clinical-card handoff-card">
      <p className="eyebrow">{eyebrow}</p>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function DetailList({ items }) {
  const visibleItems = items.filter(([, value]) => value !== '' && value !== null && value !== undefined);
  if (!visibleItems.length) return null;
  return (
    <dl className="handoff-detail-list">
      {visibleItems.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function HandoffPrintLayout({ handoff, snapshot }) {
  if (!snapshot) return null;
  return (
    <article className="print-record handoff-print-record">
      <header className="print-header">
        <div>
          <h1>PawPilot — Shift Handoff</h1>
          <p>{snapshot.patient.name} · {snapshot.patient.species} · {snapshot.patient.weight}</p>
          {[snapshot.patient.reason, `Hospital day ${snapshot.patient.hospitalDay}`].filter(Boolean).join(' · ')}
        </div>
        <div>
          <span>{displayDateTime(handoff.handoffAt)}</span>
          <span>{[handoff.outgoingTechnician, handoff.incomingTechnician].filter(Boolean).join(' → ')}</span>
          <span>{handoff.shiftLabel === 'Custom' ? handoff.customShiftLabel : handoff.shiftLabel}</span>
        </div>
      </header>
      <HandoffPrintSection title="Latest">
        {snapshot.currentSnapshot.latestTpr && <p>{snapshot.currentSnapshot.latestTpr.values.map((item) => `${item.label} ${item.value}`).join(' | ')}</p>}
        {snapshot.currentSnapshot.metrics.map((item) => <p key={item.id}>{item.label}: {item.value} at {formatTime(item.timestamp)}</p>)}
      </HandoffPrintSection>
      <HandoffPrintSection title="Fluids" hide={!snapshot.activeFluids}>
        {snapshot.activeFluids && <p>{[snapshot.activeFluids.fluid, ...snapshot.activeFluids.additives].filter(Boolean).join(' + ')} · {[snapshot.activeFluids.rateMlHr, snapshot.activeFluids.rateMlKgHr].filter(Boolean).join(' · ')}</p>}
      </HandoffPrintSection>
      <HandoffPrintSection title="Medications" hide={snapshot.activeMedications.length === 0}>
        {snapshot.activeMedications.map((med) => <p key={med.id}>{med.drug} · {[med.dose, med.concentration, med.volume, med.route, med.schedule].filter(Boolean).join(' · ')}{med.nextDue ? ` · next ${formatTime(med.nextDue)}` : ''}</p>)}
      </HandoffPrintSection>
      <HandoffPrintSection title="Upcoming" hide={snapshot.upcomingCare.length === 0}>
        {snapshot.upcomingCare.map((item) => <p key={`${item.time}-${item.label}`}>{formatTime(item.time)} — {item.label} ({item.status})</p>)}
      </HandoffPrintSection>
      <HandoffPrintSection title="Outstanding" hide={snapshot.outstandingCare.length === 0}>
        {snapshot.outstandingCare.map((item) => <p key={`${item.time}-${item.label}`}>{item.detail}</p>)}
      </HandoffPrintSection>
      <HandoffPrintSection title="Recent Labs" hide={snapshot.recentLabs.length === 0}>
        {snapshot.recentLabs.flatMap((metric) => metric.points.map((point) => <p key={`${metric.id}-${point.id}`}>{metric.label}: {point.formatted} at {formatTime(point.timestamp)}</p>))}
      </HandoffPrintSection>
      <HandoffPrintSection title="Recent Events" hide={snapshot.recentEvents.length === 0}>
        {snapshot.recentEvents.map((event) => <p key={`${event.timestamp}-${event.item}`}>{formatTime(event.timestamp)} — {event.item}{event.value ? ` — ${event.value}` : ''}</p>)}
      </HandoffPrintSection>
      <HandoffPrintSection title="Notes" hide={!handoff.notes}>
        <p className="print-notes">{handoff.notes}</p>
      </HandoffPrintSection>
      <HandoffPrintSection title="Follow-Up" hide={(handoff.followUpItems || []).length === 0}>
        {(handoff.followUpItems || []).map((item) => <p key={item.id}>{item.completed ? '[x]' : '[ ]'} {item.text}</p>)}
      </HandoffPrintSection>
      <p className="print-disclaimer">Generated by PawPilot. Verify documentation, calculations, drug doses, and treatment plans according to hospital protocols and supervising veterinarian.</p>
    </article>
  );
}

function HandoffPrintSection({ title, hide, children }) {
  if (hide) return null;
  return (
    <section className="print-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
