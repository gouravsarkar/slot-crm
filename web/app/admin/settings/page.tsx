'use client';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/Icons';
import { Skeleton } from '@/components/motion';
import { useToast } from '@/components/Toasts';
import { api, Band, Day, EventDetail, EventSummary, patch, post } from '@/lib/api';

const BAND_COLOR: Record<string, string> = { GREEN: 'var(--green-d)', PURPLE: 'var(--purple-d)', PINK: 'var(--pink-d)' };
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export default function SettingsPage() {
  const toast = useToast();
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [eventId, setEventId] = useState<number | null>(null);
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [edits, setEdits] = useState<Record<number, { event_date: string; label: string }>>({});
  const [newDay, setNewDay] = useState({ event_date: '', label: '' });
  const [newEvent, setNewEvent] = useState({ name: '', venue: '' });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
    const list = await api<EventSummary[]>('/api/events');
    setEvents(list);
    setEventId((cur) => cur ?? list[0]?.id ?? null);
    setLoaded(true);
  }, []);
  const loadEvent = useCallback(async (id: number) => {
    const ev = await api<EventDetail>(`/api/events/${id}`);
    setEvent(ev);
    setEdits(Object.fromEntries(ev.days.map((d) => [d.id, { event_date: d.event_date, label: d.label ?? '' }])));
  }, []);

  useEffect(() => { loadEvents().catch((e) => toast.push({ kind: 'err', title: 'Could not load events', body: e.message })); }, [loadEvents, toast]);
  useEffect(() => { if (eventId) loadEvent(eventId).catch((e) => toast.push({ kind: 'err', title: 'Could not load the event', body: e.message })); }, [eventId, loadEvent, toast]);

  async function act(key: string, done: string, fn: () => Promise<unknown>) {
    setSaving(key);
    try { await fn(); toast.push({ kind: 'ok', title: done }); if (eventId) await loadEvent(eventId); }
    catch (e) { toast.push({ kind: 'err', title: 'Not saved', body: (e as Error).message }); }
    finally { setSaving(null); }
  }

  async function createEvent() {
    setSaving('event');
    try {
      const r = await post<{ id: number }>('/api/admin/events', { name: newEvent.name, venue: newEvent.venue || null });
      setNewEvent({ name: '', venue: '' });
      await loadEvents(); setEventId(r.id);
      toast.push({ kind: 'ok', title: 'Event created', body: 'GREEN, PURPLE and PINK bands were added. Now add its days.' });
    } catch (e) { toast.push({ kind: 'err', title: 'Event not created', body: (e as Error).message }); }
    finally { setSaving(null); }
  }

  const dayStart = Math.min(...(event?.bands.map((b) => toMin(b.start_time)) ?? [0]));
  const dayEnd = Math.max(...(event?.bands.map((b) => toMin(b.end_time)) ?? [1]));
  const span = Math.max(1, dayEnd - dayStart);

  const createSection = (
    <section className="settings-section" aria-labelledby="create-h">
      <header>
        <h2 id="create-h">{events.length ? 'Create another event' : 'Create an event'}</h2>
        <p>New events start with the standard Morning, Afternoon and Evening bands.</p>
      </header>
      <form className="card" onSubmit={(e) => { e.preventDefault(); if (newEvent.name) createEvent(); }}>
        <div className="card-body fields" style={{ alignItems: 'end' }}>
          <div className="field"><label htmlFor="ev-name">Event name</label>
            <input id="ev-name" required value={newEvent.name} placeholder="Manchester April 2027"
                   onChange={(e) => setNewEvent({ ...newEvent, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="ev-venue">Venue <span className="hint">(optional)</span></label>
            <input id="ev-venue" value={newEvent.venue}
                   onChange={(e) => setNewEvent({ ...newEvent, venue: e.target.value })} /></div>
          <div><button type="submit" className="primary" disabled={!newEvent.name || saving === 'event'} aria-busy={saving === 'event'}>
            <Icon name="plus" size={16} />Create event</button></div>
        </div>
      </form>
    </section>
  );

  return (
    <div style={{ maxWidth: 1120 }}>
      <div className="page-head">
        <div className="grow">
          <h1>Event settings</h1>
          <p className="sub">Event days, stage bands and new events.</p>
        </div>
        {events.length > 1 && (
          <div className="actions">
            <label className="sr-only" htmlFor="days-event">Event</label>
            <select id="days-event" className="inline" value={eventId ?? ''} onChange={(e) => setEventId(Number(e.target.value))}>
              {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {!loaded && <div className="card"><div className="card-body" style={{ display: 'grid', gap: 12 }}><Skeleton h={16} w="30%" /><Skeleton h={40} /><Skeleton h={40} /></div></div>}

      {loaded && events.length === 0 && createSection}

      {events.length > 0 && (
        <>
          <section className="settings-section" aria-labelledby="days-h">
            <header>
              <h2 id="days-h">Event days</h2>
              <p>Changing a date keeps every assignment. A day can only be deleted once its segments are unassigned.</p>
            </header>
            <div className="card" style={{ marginBottom: 0 }}>
              {event && event.days.length === 0 && (
                <div className="empty"><span className="empty-icon"><Icon name="schedule" /></span>
                  <strong>No days yet</strong><span>Add the first day below; its segments are created automatically.</span></div>
              )}
              {event?.days.map((d: Day, i) => (
                <div className="day-row" key={d.id} style={{ animationDelay: `${i * 40}ms` }}>
                  <div className="field">
                    <label htmlFor={`d-${d.id}-date`}>Date</label>
                    <input id={`d-${d.id}-date`} type="date" value={edits[d.id]?.event_date ?? ''}
                           onChange={(e) => setEdits({ ...edits, [d.id]: { ...edits[d.id], event_date: e.target.value } })} />
                  </div>
                  <div className="field">
                    <label htmlFor={`d-${d.id}-label`}>Label</label>
                    <input id={`d-${d.id}-label`} value={edits[d.id]?.label ?? ''} placeholder="e.g. Saturday"
                           onChange={(e) => setEdits({ ...edits, [d.id]: { ...edits[d.id], label: e.target.value } })} />
                  </div>
                  <div className="actions">
                    <button disabled={saving === `day-${d.id}`} aria-busy={saving === `day-${d.id}`}
                            onClick={() => act(`day-${d.id}`, 'Day updated', () => patch(`/api/admin/days/${d.id}`, edits[d.id]))}>Save</button>
                    <button className="icon-btn" aria-label={`Delete ${d.label ?? d.event_date}`} title="Delete day" onClick={() => {
                      if (confirm(`Delete ${d.label ?? d.event_date}? This removes its segments.`))
                        act(`del-${d.id}`, 'Day deleted', () => api(`/api/admin/days/${d.id}`, { method: 'DELETE' }));
                    }}><Icon name="trash" size={16} /></button>
                  </div>
                </div>
              ))}
              <form className="day-row new" onSubmit={(e) => {
                e.preventDefault();
                if (!newDay.event_date || !eventId) return;
                act('new-day', 'Day added with its segments', async () => {
                  await post(`/api/admin/events/${eventId}/days`, { event_date: newDay.event_date, label: newDay.label || null });
                  setNewDay({ event_date: '', label: '' });
                });
              }}>
                <div className="field">
                  <label htmlFor="new-date">New day</label>
                  <input id="new-date" type="date" required value={newDay.event_date}
                         onChange={(e) => setNewDay({ ...newDay, event_date: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="new-label">Label <span className="hint">(optional)</span></label>
                  <input id="new-label" value={newDay.label} placeholder="Defaults to the weekday"
                         onChange={(e) => setNewDay({ ...newDay, label: e.target.value })} />
                </div>
                <div className="actions">
                  <button type="submit" className="primary" disabled={!newDay.event_date || !eventId || saving === 'new-day'} aria-busy={saving === 'new-day'}>
                    <Icon name="plus" size={16} />Add day</button>
                </div>
              </form>
            </div>
          </section>

          <section className="settings-section" aria-labelledby="bands-h">
            <header>
              <h2 id="bands-h">Stage bands</h2>
              <p>Each band is split into {event?.slot_minutes ?? 10}-minute segments. An act cannot run across the gap between two bands.</p>
            </header>
            <div className="bands">
              {event?.bands.map((b: Band) => (
                <div className="band-row card" key={b.id} style={{ marginBottom: 0 }}>
                  <span className={`badge plain band-${b.code}`}>{b.code}</span>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)', marginBottom: 6 }}>
                      <span style={{ fontWeight: 500 }}>{b.label}</span>
                      <span className="muted num">{b.start_time.slice(0, 5)}–{b.end_time.slice(0, 5)}</span>
                    </div>
                    <div className="timeline-mini" aria-hidden="true">
                      <span style={{
                        left: `${((toMin(b.start_time) - dayStart) / span) * 100}%`,
                        width: `${((toMin(b.end_time) - toMin(b.start_time)) / span) * 100}%`,
                        background: BAND_COLOR[b.code] ?? 'var(--accent)',
                      }} />
                    </div>
                  </div>
                  <span className="muted num" style={{ fontSize: 'var(--text-xs)' }}>
                    {Math.round((toMin(b.end_time) - toMin(b.start_time)) / (event?.slot_minutes ?? 10))} segments
                  </span>
                </div>
              ))}
            </div>
          </section>

          {createSection}
        </>
      )}
    </div>
  );
}
