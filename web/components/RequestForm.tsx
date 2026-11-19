'use client';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/Icons';
import { Skeleton } from '@/components/motion';
import SlotGrid from '@/components/SlotGrid';
import { api, EventDetail, EventSummary, hhmm, plural, post, PublicSlot } from '@/lib/api';

type ActForm = { name: string; segments: number; notes: string; prefs: number[]; open: boolean };
const blankAct = (): ActForm => ({ name: '', segments: 1, notes: '', prefs: [], open: false });

type Props = {
  /** API path the request is posted to */
  endpoint?: string;
  /** participant portal: phone is mandatory */
  phoneRequired?: boolean;
  /** where "check your booking" links to after submitting */
  checkHref?: string;
  /** page title */
  title?: string;
};

/** The slot request form. Used by the organisers' "Request slots" page and the participant portal. */
export default function RequestForm({
  endpoint = '/api/requests', phoneRequired = false, checkHref, title = 'Request performance slots',
}: Props) {
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
      await post(endpoint, {
        event_id: event.id,
        ...group,
        phone: group.phone.trim() || null,
        group_notes: group.group_notes || null,
        acts: acts.map((a) => ({
          name: a.name, segments_requested: a.segments, notes: a.notes || null, preferred_slot_ids: a.prefs,
        })),
      });
      setDone(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) { setError((err as Error).message); }
    setBusy(false);
  }

  if (loading) {
    return (
      <div aria-busy="true" aria-label="Loading the event" style={{ display: 'grid', gap: 16 }}>
        <Skeleton h={36} w="55%" /><Skeleton h={16} w="35%" />
        <div className="card"><div className="card-body" style={{ display: 'grid', gap: 12 }}>
          <Skeleton h={16} w="25%" /><Skeleton h={40} /><Skeleton h={40} /></div></div>
      </div>
    );
  }
  if (!event) {
    return (
      <div className="card"><div className="empty">
        <span className="empty-icon"><Icon name="stage" /></span>
        <strong>Requests are not open yet</strong>
        <span>No event is taking requests at the moment. Please check back later.</span>
        {error && <div className="inline-alert err" role="alert"><Icon name="alert" size={16} />{error}</div>}
      </div></div>
    );
  }
  if (done) {
    return (
      <div className="card success" role="status">
        <div className="card-body">
          <svg className="check-anim" viewBox="0 0 64 64" aria-hidden="true">
            <circle cx="32" cy="32" r="30" /><path d="M20 33l8 8 16-17" />
          </svg>
          <h1>Request received</h1>
          <p className="muted">We have sent a confirmation to <strong style={{ color: 'var(--ink)' }}>{group.email}</strong>.
            The organisers will review your preferences and email you the confirmed times.</p>
          {checkHref && (
            <a href={checkHref} className="button" style={{ marginTop: 'var(--s2)' }}>
              <Icon name="search" size={16} />Check your program&rsquo;s slot
            </a>
          )}
        </div>
      </div>
    );
  }

  const total = acts.reduce((n, a) => n + a.segments, 0);
  const mins = event.slot_minutes;
  return (
    <form onSubmit={submit}>
      <header className="hero">
        <h1>{title}</h1>
        <div className="facts">
          <span className="fact"><Icon name="stage" size={16} />{event.name}</span>
          {event.venue && <span className="fact"><Icon name="overview" size={16} />{event.venue}</span>}
          <span className="fact"><Icon name="clock" size={16} />{mins}-minute segments</span>
          {event.days.length > 0 && <span className="fact"><Icon name="schedule" size={16} />{event.days.map((d) => d.label).join(' & ')}</span>}
        </div>
        <p className="muted">Tell us about your group and each act. The organisers assign the final times and email you.</p>
      </header>

      {error && <div className="inline-alert err" role="alert" style={{ marginBottom: 'var(--s5)' }}><Icon name="alert" size={16} />{error}</div>}

      <section className="card" aria-labelledby="group-h">
        <div className="card-head"><div><h2 id="group-h">Your group</h2><p>Who we should contact about this request</p></div></div>
        <div className="card-body">
          <div className="fields">
            <div className="field"><label htmlFor="g-name">Group name</label>
              <input id="g-name" required autoComplete="organization" value={group.group_name}
                     onChange={(e) => setGroup({ ...group, group_name: e.target.value })} /></div>
            <div className="field"><label htmlFor="g-contact">Contact person</label>
              <input id="g-contact" required autoComplete="name" value={group.contact_name}
                     onChange={(e) => setGroup({ ...group, contact_name: e.target.value })} /></div>
            <div className="field"><label htmlFor="g-email">Email</label>
              <input id="g-email" required type="email" autoComplete="email" value={group.email}
                     onChange={(e) => setGroup({ ...group, email: e.target.value })} /></div>
            <div className="field"><label htmlFor="g-phone">Phone {!phoneRequired && <span className="hint">(optional)</span>}</label>
              <input id="g-phone" type="tel" autoComplete="tel" required={phoneRequired} minLength={phoneRequired ? 7 : undefined}
                     inputMode="tel" value={group.phone}
                     onChange={(e) => setGroup({ ...group, phone: e.target.value })} /></div>
          </div>
          <div className="field" style={{ marginTop: 'var(--s4)' }}>
            <label htmlFor="g-notes">Anything we should know? <span className="hint">(optional)</span></label>
            <textarea id="g-notes" rows={2} value={group.group_notes}
                      onChange={(e) => setGroup({ ...group, group_notes: e.target.value })} />
          </div>
        </div>
      </section>

      {acts.map((a, i) => {
        const id = `act-${i}`;
        return (
          <section className="card act-card" key={i} aria-labelledby={`${id}-h`} style={{ animation: 'rise 220ms var(--ease-out) both' }}>
            <div className="card-head">
              <h2 id={`${id}-h`}><span className="act-num" aria-hidden="true">{i + 1}</span>
                {a.name || `Act ${i + 1}`}</h2>
              {acts.length > 1 && (
                <button type="button" className="ghost" onClick={() => setActs(acts.filter((_, k) => k !== i))}>
                  <Icon name="trash" size={16} />Remove
                </button>
              )}
            </div>
            <div className="card-body">
              <div className="fields">
                <div className="field"><label htmlFor={`${id}-name`}>Act name</label>
                  <input id={`${id}-name`} required placeholder="e.g. Adult Dance" value={a.name}
                         onChange={(e) => setAct(i, { name: e.target.value })} /></div>
                <div className="field">
                  <label htmlFor={`${id}-seg`}>Segments needed <span className="hint">({mins} min each, back-to-back)</span></label>
                  <input id={`${id}-seg`} type="number" inputMode="numeric" min={1} max={36} required value={a.segments}
                         aria-describedby={`${id}-sum`}
                         onChange={(e) => setAct(i, { segments: Math.max(1, Number(e.target.value) || 1) })} />
                </div>
              </div>

              <div className="prefs">
                <div className="prefs-bar">
                  <p id={`${id}-sum`} className="muted">
                    <strong style={{ color: 'var(--ink)' }}>{plural(a.segments, 'segment')}</strong> ({a.segments * mins} min) ·{' '}
                    {a.prefs.length === 0 ? 'any time is fine' : `${plural(a.prefs.length, 'preferred segment')} chosen`}
                  </p>
                  <button type="button" aria-expanded={a.open} aria-controls={`${id}-grid`} onClick={() => setAct(i, { open: !a.open })}>
                    <Icon name="schedule" size={16} />{a.open ? 'Hide times' : 'Choose preferred times'}
                  </button>
                </div>
                {a.open && (
                  <div id={`${id}-grid`} className="grid-reveal">
                    <div className="legend">
                      <span><i className="swatch selected" />Preferred</span>
                      <span><i className="swatch taken" />Already taken</span>
                      <span>Pick as many as you like. These are preferences, not bookings.</span>
                    </div>
                    <SlotGrid slots={slots} days={event.days} label={`Preferred times for act ${i + 1}`} cell={(s) => {
                      const chosen = a.prefs.includes(s.id);
                      const s2 = slotById.get(s.id)!;
                      return {
                        className: s2.taken ? 'cell-taken' : chosen ? 'cell-selected' : '',
                        disabled: s2.taken,
                        pressed: chosen,
                        title: s2.taken ? 'Already taken' : `${hhmm(s.start_time)}–${hhmm(s.end_time)}`,
                        content: s2.taken ? 'Taken' : chosen ? <span className="cell-check"><Icon name="check" size={13} />Preferred</span> : null,
                        onClick: () => togglePref(i, s.id),
                      };
                    }} />
                  </div>
                )}
              </div>

              <div className="field" style={{ marginTop: 'var(--s4)' }}>
                <label htmlFor={`${id}-notes`}>Notes for this act <span className="hint">(optional)</span></label>
                <input id={`${id}-notes`} value={a.notes} onChange={(e) => setAct(i, { notes: e.target.value })} />
              </div>
            </div>
          </section>
        );
      })}

      <button type="button" className="block" style={{ borderStyle: 'dashed', minHeight: 48, boxShadow: 'none' }}
              onClick={() => setActs([...acts, blankAct()])}>
        <Icon name="plus" size={16} />Add another act
      </button>

      <div className="submit-bar">
        <div className="inner">
          <div className="submit-total">
            <strong>{plural(total, 'segment')} · {total * mins} min</strong>
            <span>{plural(acts.length, 'act')} for {event.name}</span>
          </div>
          <button className="primary lg" disabled={busy} aria-busy={busy}>
            {busy ? <><Icon name="refresh" size={16} />Sending…</> : <>Send request<Icon name="arrow" size={16} /></>}
          </button>
        </div>
      </div>
    </form>
  );
}
