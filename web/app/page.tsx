'use client';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import SlotGrid from '@/components/SlotGrid';
import { api, EventDetail, EventSummary, hhmm, post, PublicSlot } from '@/lib/api';

type ActForm = { name: string; segments: number; notes: string; prefs: number[]; open: boolean };
const blankAct = (): ActForm => ({ name: '', segments: 1, notes: '', prefs: [], open: false });

export default function RequestPage() {
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [slots, setSlots] = useState<PublicSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const [group, setGroup] = useState({ group_name: '', contact_name: '', email: '', phone: '', group_notes: '' });
  const [acts, setActs] = useState<ActForm[]>([blankAct()]);

  useEffect(() => {
    (async () => {
      try {
        const events = await api<EventSummary[]>('/api/events');
        if (events.length) {
          const id = events[0].id;
          const [detail, s] = await Promise.all([
            api<EventDetail>(`/api/events/${id}`), api<PublicSlot[]>(`/api/events/${id}/slots`)]);
          setEvent(detail);
          setSlots(s);
        }
      } catch (e) { setError((e as Error).message); }
      setLoading(false);
    })();
  }, []);

  const slotById = useMemo(() => new Map(slots.map((s) => [s.id, s])), [slots]);
  const setAct = (i: number, patch: Partial<ActForm>) =>
    setActs((a) => a.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  function togglePref(i: number, slotId: number) {
    const cur = acts[i].prefs;
    setAct(i, { prefs: cur.includes(slotId) ? cur.filter((x) => x !== slotId) : [...cur, slotId] });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!event) return;
    setError('');
    setBusy(true);
    try {
      await post('/api/requests', {
        event_id: event.id,
        ...group,
        phone: group.phone || null,
        group_notes: group.group_notes || null,
        acts: acts.map((a) => ({
          name: a.name, segments_requested: a.segments, notes: a.notes || null, preferred_slot_ids: a.prefs,
        })),
      });
      setDone(true);
    } catch (err) { setError((err as Error).message); }
    setBusy(false);
  }

  if (loading) return <p>Loading…</p>;
  if (!event) return <div className="card">No event is open for requests yet. {error}</div>;
  if (done) {
    return (
      <div className="card">
        <h2>Request received</h2>
        <p>Thank you. We have sent a confirmation to {group.email}. The organisers will review your
          preferences and email you the confirmed times.</p>
      </div>
    );
  }

  const total = acts.reduce((n, a) => n + a.segments, 0);
  return (
    <form onSubmit={submit}>
      <h1>Request performance slots</h1>
      <p className="muted">{event.name}{event.venue ? ` · ${event.venue}` : ''}. Each segment is
        {' '}{event.slot_minutes} minutes. Tell us what you would like; the organisers assign the final times.</p>
      {error && <div className="banner err">{error}</div>}

      <div className="card">
        <h3>Your group</h3>
        <div className="row">
          <div><label>Group name</label>
            <input required value={group.group_name} onChange={(e) => setGroup({ ...group, group_name: e.target.value })} /></div>
          <div><label>Contact person</label>
            <input required value={group.contact_name} onChange={(e) => setGroup({ ...group, contact_name: e.target.value })} /></div>
          <div><label>Email</label>
            <input required type="email" value={group.email} onChange={(e) => setGroup({ ...group, email: e.target.value })} /></div>
          <div><label>Phone</label>
            <input value={group.phone} onChange={(e) => setGroup({ ...group, phone: e.target.value })} /></div>
        </div>
        <label>Anything we should know?</label>
        <textarea rows={2} value={group.group_notes} onChange={(e) => setGroup({ ...group, group_notes: e.target.value })} />
      </div>

      {acts.map((a, i) => (
        <div className="card" key={i}>
          <div className="row">
            <h3 style={{ flex: '0 0 auto', margin: 0 }}>Act {i + 1}</h3>
            <div><label>Act name</label>
              <input required placeholder="e.g. Adult Dance" value={a.name} onChange={(e) => setAct(i, { name: e.target.value })} /></div>
            <div><label>Segments needed ({event.slot_minutes} min each, back-to-back)</label>
              <input type="number" min={1} max={36} required value={a.segments}
                     onChange={(e) => setAct(i, { segments: Math.max(1, Number(e.target.value) || 1) })} /></div>
            {acts.length > 1 && (
              <button type="button" className="danger" style={{ flex: '0 0 auto' }}
                      onClick={() => setActs(acts.filter((_, k) => k !== i))}>Remove</button>
            )}
          </div>
          <p className="muted" style={{ margin: '8px 0' }}>
            Preferred segments: {a.prefs.length === 0 ? 'none chosen (any time is fine)'
              : `${a.prefs.length} chosen`} · asked for {a.segments} ({a.segments * event.slot_minutes} min)
          </p>
          <button type="button" onClick={() => setAct(i, { open: !a.open })}>
            {a.open ? 'Hide time grid' : 'Choose preferred times'}
          </button>
          {a.open && (
            <div style={{ marginTop: 10 }}>
              <SlotGrid slots={slots} days={event.days} cell={(s) => {
                const chosen = a.prefs.includes(s.id);
                const s2 = slotById.get(s.id)!;
                return {
                  className: s2.taken ? 'cell-taken' : chosen ? 'cell-selected' : '',
                  disabled: s2.taken,
                  title: s2.taken ? 'Already taken' : `${hhmm(s.start_time)}–${hhmm(s.end_time)}`,
                  content: s2.taken ? 'taken' : chosen ? '✓' : '',
                  onClick: () => togglePref(i, s.id),
                };
              }} />
            </div>
          )}
          <label>Notes for this act (optional)</label>
          <input value={a.notes} onChange={(e) => setAct(i, { notes: e.target.value })} />
        </div>
      ))}

      <div className="row fit">
        <button type="button" onClick={() => setActs([...acts, blankAct()])}>+ Add another act</button>
        <button className="primary" disabled={busy}>{busy ? 'Sending…' : `Send request (${total} segments)`}</button>
      </div>
    </form>
  );
}
