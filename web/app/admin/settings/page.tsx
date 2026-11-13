'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, Band, Day, EventDetail, EventSummary, patch, post } from '@/lib/api';

export default function SettingsPage() {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [eventId, setEventId] = useState<number | null>(null);
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [edits, setEdits] = useState<Record<number, { event_date: string; label: string }>>({});
  const [newDay, setNewDay] = useState({ event_date: '', label: '' });
  const [newEvent, setNewEvent] = useState({ name: '', venue: '' });
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const loadEvents = useCallback(async () => {
    const list = await api<EventSummary[]>('/api/events');
    setEvents(list);
    setEventId((cur) => cur ?? list[0]?.id ?? null);
  }, []);
  const loadEvent = useCallback(async (id: number) => {
    const ev = await api<EventDetail>(`/api/events/${id}`);
    setEvent(ev);
    setEdits(Object.fromEntries(ev.days.map((d) => [d.id, { event_date: d.event_date, label: d.label ?? '' }])));
  }, []);

  useEffect(() => { loadEvents().catch((e) => setMsg({ kind: 'err', text: e.message })); }, [loadEvents]);
  useEffect(() => { if (eventId) loadEvent(eventId).catch((e) => setMsg({ kind: 'err', text: e.message })); }, [eventId, loadEvent]);

  async function act(label: string, fn: () => Promise<unknown>) {
    try { await fn(); setMsg({ kind: 'ok', text: label }); if (eventId) await loadEvent(eventId); }
    catch (e) { setMsg({ kind: 'err', text: (e as Error).message }); }
  }

  return (
    <div>
      <h1>Event settings</h1>
      {msg && <div className={`banner ${msg.kind}`}>{msg.text}</div>}

      <div className="card">
        <h3>Create an event</h3>
        <div className="row">
          <div><label>Name</label><input value={newEvent.name} placeholder="Manchester April 2027"
            onChange={(e) => setNewEvent({ ...newEvent, name: e.target.value })} /></div>
          <div><label>Venue</label><input value={newEvent.venue}
            onChange={(e) => setNewEvent({ ...newEvent, venue: e.target.value })} /></div>
          <button className="primary" style={{ flex: '0 0 auto', marginTop: 22 }} disabled={!newEvent.name}
                  onClick={async () => {
                    try {
                      const r = await post<{ id: number }>('/api/admin/events',
                        { name: newEvent.name, venue: newEvent.venue || null });
                      setNewEvent({ name: '', venue: '' });
                      await loadEvents(); setEventId(r.id);
                      setMsg({ kind: 'ok', text: 'Event created with the GREEN / PURPLE / PINK bands. Now add its days.' });
                    } catch (e) { setMsg({ kind: 'err', text: (e as Error).message }); }
                  }}>Create</button>
        </div>
      </div>

      {events.length > 0 && (
        <div className="card">
          <div className="row fit">
            <h3 style={{ margin: 0 }}>Days for</h3>
            <select value={eventId ?? ''} onChange={(e) => setEventId(Number(e.target.value))}>
              {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <p className="muted">Changing a date keeps every assignment. A day can only be deleted once its segments are unassigned.</p>

          {event?.days.map((d: Day) => (
            <div className="row" key={d.id} style={{ marginBottom: 6 }}>
              <input type="date" value={edits[d.id]?.event_date ?? ''}
                     onChange={(e) => setEdits({ ...edits, [d.id]: { ...edits[d.id], event_date: e.target.value } })} />
              <input value={edits[d.id]?.label ?? ''} placeholder="Label"
                     onChange={(e) => setEdits({ ...edits, [d.id]: { ...edits[d.id], label: e.target.value } })} />
              <div className="row fit" style={{ flex: '0 0 auto' }}>
                <button onClick={() => act('Day updated', () => patch(`/api/admin/days/${d.id}`, edits[d.id]))}>Save</button>
                <button className="danger" onClick={() => {
                  if (confirm('Delete this day?')) act('Day deleted', () => api(`/api/admin/days/${d.id}`, { method: 'DELETE' }));
                }}>Delete</button>
              </div>
            </div>
          ))}

          <div className="row" style={{ marginTop: 12 }}>
            <input type="date" value={newDay.event_date} onChange={(e) => setNewDay({ ...newDay, event_date: e.target.value })} />
            <input placeholder="Label (optional, defaults to weekday)" value={newDay.label}
                   onChange={(e) => setNewDay({ ...newDay, label: e.target.value })} />
            <button className="primary" style={{ flex: '0 0 auto' }} disabled={!newDay.event_date || !eventId}
                    onClick={() => act('Day added with its segments', async () => {
                      await post(`/api/admin/events/${eventId}/days`,
                        { event_date: newDay.event_date, label: newDay.label || null });
                      setNewDay({ event_date: '', label: '' });
                    })}>Add day</button>
          </div>

          <h3 style={{ marginTop: 18 }}>Bands</h3>
          <div className="legend">
            {event?.bands.map((b: Band) => (
              <span key={b.id}><span className={`badge`} style={{ background: `var(--${b.code.toLowerCase()})` }}>{b.code}</span>{' '}
                {b.label} {b.start_time.slice(0, 5)}–{b.end_time.slice(0, 5)}</span>
            ))}
          </div>
          <p className="muted">Slot length: {event?.slot_minutes} minutes.</p>
        </div>
      )}
    </div>
  );
}
