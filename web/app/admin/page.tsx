'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/Icons';
import { Fill, Skeleton } from '@/components/motion';
import SlotGrid, { GridSlot } from '@/components/SlotGrid';
import { useToast } from '@/components/Toasts';
import {
  addMinutes, api, Day, EventDetail, EventSummary, hhmm, Job, patch, plural, pollJob, post, statusLabel,
} from '@/lib/api';

type ReqRow = {
  id: number; status: string; payment_status: string; group_name: string; email: string;
  acts: number; segments_requested: number; segments_assigned: number;
};
type ActSlot = { slot_id: number; day_id: number; start_time: string; band: string };
type ActDetail = {
  id: number; name: string; segments_requested: number; notes: string | null;
  preferred: ActSlot[]; assigned: ActSlot[];
};
type ReqDetail = {
  id: number; status: string; payment_status: string; group_name: string; contact_name: string;
  email: string; phone: string | null; group_notes: string | null; admin_notes: string | null; acts: ActDetail[];
};
type GridRow = GridSlot & {
  slot_id: number; day_label: string; act_id: number | null; act_name: string | null;
  request_id: number | null; group_name: string | null; payment_status: string | null;
};
type Proposal = {
  act_id: number; act_name: string; slot_ids: number[]; event_date: string; start_time: string;
  end_time: string; preference_overlap: number; segments_requested: number; matches_preferences: boolean | null;
};
type Suggestion = { proposals: Proposal[]; unplaced: { act_id: number; act_name: string }[] };

const FILTERS = ['', 'submitted', 'under_review', 'assigned', 'declined'] as const;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export default function AdminPage() {
  const toast = useToast();
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [eventId, setEventId] = useState<number | null>(null);
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [requests, setRequests] = useState<ReqRow[] | null>(null);
  const [grid, setGrid] = useState<GridRow[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ReqDetail | null>(null);
  const [activeAct, setActiveAct] = useState<number | null>(null);
  const [selection, setSelection] = useState<number[]>([]);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<string>('');
  const [query, setQuery] = useState('');
  const [loadedEvents, setLoadedEvents] = useState(false);

  useEffect(() => {
    api<EventSummary[]>('/api/events').then((e) => { setEvents(e); if (e.length) setEventId(e[0].id); })
      .catch((e) => toast.push({ kind: 'err', title: 'Could not load events', body: e.message }))
      .finally(() => setLoadedEvents(true));
  }, [toast]);

  const reload = useCallback(async (reqId: number | null = selectedId) => {
    if (!eventId) return;
    const [ev, rq, gr] = await Promise.all([
      api<EventDetail>(`/api/events/${eventId}`),
      api<ReqRow[]>(`/api/admin/requests?event_id=${eventId}`),
      api<GridRow[]>(`/api/admin/grid?event_id=${eventId}`),
    ]);
    setEvent(ev); setRequests(rq);
    setGrid(gr.map((r) => ({ ...r, id: r.slot_id })));
    if (reqId) setDetail(await api<ReqDetail>(`/api/admin/requests/${reqId}`));
  }, [eventId, selectedId]);

  useEffect(() => {
    reload().catch((e) => toast.push({ kind: 'err', title: 'Could not load requests', body: e.message }));
  }, [reload, toast]);

  function pick(id: number) {
    setSelectedId(id); setActiveAct(null); setSelection([]); setSuggestion(null);
  }

  /** Runs an action with a progress notification that turns into success or failure. */
  async function run(pending: string, done: string, fn: () => Promise<Job | void>) {
    setBusy(true);
    const id = toast.push({ kind: 'progress', title: pending });
    try {
      const job = await fn();
      if (job && job.status === 'failed') toast.update(id, { kind: 'err', title: 'Not applied', body: job.error ?? 'The job failed' });
      else toast.update(id, { kind: 'ok', title: done });
      await reload();
      return job;
    } catch (e) {
      toast.update(id, { kind: 'err', title: 'Something went wrong', body: (e as Error).message });
    } finally { setBusy(false); }
  }

  const queue = async (path: string, body: unknown) => {
    const { job_id } = await post<{ job_id: string }>(path, body);
    return pollJob(job_id);
  };

  const daySlots = useMemo(() => {
    const m = new Map<number, GridRow[]>();
    for (const r of grid) { if (!m.has(r.day_id)) m.set(r.day_id, []); m.get(r.day_id)!.push(r); }
    return m;
  }, [grid]);

  const act = detail?.acts.find((a) => a.id === activeAct) ?? null;
  const prefIds = new Set(act?.preferred.map((p) => p.slot_id));

  function clickCell(row: GridRow) {
    if (!act) return;
    const list = daySlots.get(row.day_id)!;
    const i = list.findIndex((s) => s.slot_id === row.slot_id);
    const win = list.slice(i, i + act.segments_requested);
    const ok = win.length === act.segments_requested
      && win.every((s, k) => (k === 0 || win[k - 1].end_time === s.start_time)
        && (s.act_id === null || s.act_id === act.id));
    if (!ok) {
      setSelection([]);
      toast.push({
        kind: 'err', title: `Needs ${plural(act.segments_requested, 'free segment')} in a row`,
        body: 'Start on a time that has enough free back-to-back segments after it, within one band run.',
      });
      return;
    }
    setSelection(win.map((s) => s.slot_id));
  }

  const slotMinutes = events.find((e) => e.id === eventId)?.slot_minutes ?? 10;
  const dayOf = (id: number): Day | undefined => event?.days.find((d) => d.id === id);
  function describe(slots: ActSlot[]) {
    if (!slots.length) return null;
    const first = slots[0], last = slots[slots.length - 1];
    const d = dayOf(first.day_id);
    return `${d ? d.label : ''} ${hhmm(first.start_time)}–${addMinutes(last.start_time, slotMinutes)} · ${first.band}`;
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { '': requests?.length ?? 0 };
    for (const r of requests ?? []) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [requests]);
  const q = query.trim().toLowerCase();
  const shown = (requests ?? []).filter((r) => (!filter || r.status === filter)
    && (!q || r.group_name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q)));

  if (loadedEvents && !eventId) {
    return (
      <div className="card"><div className="empty">
        <span className="empty-icon"><Icon name="stage" /></span>
        <strong>No event yet</strong>
        <span>Create one in <a href="/admin/settings">Event settings</a>, then add its days.</span>
      </div></div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Admin</h1>
          <p className="sub">Review requests and place each act on the stage timetable.</p>
        </div>
        <div className="actions">
          <label className="sr-only" htmlFor="event-pick">Event</label>
          <select id="event-pick" className="inline" value={eventId ?? ''}
                  onChange={(e) => { setEventId(Number(e.target.value)); setSelectedId(null); setDetail(null); }}>
            {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
      </div>

      <div className="workbench">
        <section className="card queue" aria-labelledby="req-h">
          <div className="card-head">
            <h2 id="req-h">Requests</h2>
            <span className="badge plain num">{shown.length}</span>
          </div>
          <div className="queue-tools">
            <div className="input-icon">
              <Icon name="search" size={16} />
              <label className="sr-only" htmlFor="req-search">Search requests</label>
              <input id="req-search" type="search" placeholder="Search group or email" value={query}
                     onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="segmented" role="group" aria-label="Filter by status">
              {FILTERS.map((f) => (
                <button key={f || 'all'} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {f ? statusLabel(f) : 'All'} <span className="count">{counts[f] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>
          {requests === null ? (
            <div style={{ padding: 'var(--s4)', display: 'grid', gap: 12 }}>
              {[0, 1, 2, 3].map((k) => <Skeleton key={k} h={44} />)}
            </div>
          ) : shown.length ? (
            <ul className="req-list">
              {shown.map((r, i) => (
                <li key={r.id} style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }}>
                  <button type="button" className="list-item" aria-current={r.id === selectedId ? 'true' : undefined}
                          onClick={() => pick(r.id)}>
                    <span className="avatar" aria-hidden="true">{initials(r.group_name)}</span>
                    <span className="title">{r.group_name}</span>
                    <span className="meta">
                      <span className={`badge ${r.status}`}>{statusLabel(r.status)}</span>
                      <span className="num">{r.segments_assigned}/{r.segments_requested} seg</span>
                      <span>· {plural(r.acts, 'act')}</span>
                      {r.payment_status === 'pending' && <span title="Payment pending"><i className="dot pending" /></span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty">
              <span className="empty-icon"><Icon name="search" /></span>
              <strong>No matches</strong>
              <span>{requests.length ? 'Try another search or filter.' : <>No requests yet. Groups send them from the <a href="/">request form</a>.</>}</span>
            </div>
          )}
        </section>

        <div style={{ minWidth: 0 }}>
          {detail ? (
            <section className="card" aria-labelledby="detail-h" key={detail.id} style={{ animation: 'rise 220ms var(--ease-out) both' }}>
              <div className="detail-head">
                <div className="who">
                  <span className="avatar light" aria-hidden="true">{initials(detail.group_name)}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                      <h2 id="detail-h">{detail.group_name}</h2>
                      <span className={`badge ${detail.status}`}>{statusLabel(detail.status)}</span>
                    </div>
                    <div className="contact">
                      {detail.contact_name} · <a href={`mailto:${detail.email}`}>{detail.email}</a>
                      {detail.phone ? <> · <a href={`tel:${detail.phone}`}>{detail.phone}</a></> : null}
                    </div>
                  </div>
                </div>
                <div className="actions">
                  <button type="button" className="switch" role="switch" aria-checked={detail.payment_status === 'paid'}
                          disabled={busy} title="Payment is a reminder only; it never blocks assignment"
                          onClick={() => run('Updating payment…', detail.payment_status === 'paid' ? 'Marked as pending' : 'Marked as paid', async () => {
                            await patch(`/api/admin/requests/${detail.id}`,
                              { payment_status: detail.payment_status === 'paid' ? 'pending' : 'paid' });
                          })}>
                    <span className="knob" aria-hidden="true" />Paid
                  </button>
                  <button className="danger" disabled={busy} onClick={() => {
                    if (confirm('Decline this request? Its segments are released and the group is emailed.'))
                      run('Declining…', 'Request declined', async () => { await patch(`/api/admin/requests/${detail.id}`, { status: 'declined' }); });
                  }}>Decline</button>
                </div>
              </div>

              {detail.group_notes && <p className="quote">“{detail.group_notes}”</p>}

              <div className="acts">
                {detail.acts.map((a) => {
                  const when = describe(a.assigned);
                  const placing = a.id === activeAct;
                  return (
                    <div key={a.id} className={`act ${placing ? 'active' : ''}`}>
                      <div style={{ minWidth: 0 }}>
                        <div className="act-title">
                          {a.name}
                          <span className="badge plain">{plural(a.segments_requested, 'segment')}</span>
                          {when && <span className="badge assigned">{when}</span>}
                        </div>
                        <div className="act-sub">
                          {a.preferred.length ? `Prefers ${plural(a.preferred.length, 'segment')}` : 'Any time is fine'}
                          {a.notes && <> · {a.notes}</>}
                        </div>
                        <div className="act-progress">
                          <span className="track"><Fill pct={(a.assigned.length / a.segments_requested) * 100} style={{ background: 'var(--ok)' }} /></span>
                          <span className="num">{a.assigned.length}/{a.segments_requested}</span>
                        </div>
                        {placing && (
                          <p className="placing-hint"><span className="pulse" />
                            Click a start time on the timetable to select {plural(a.segments_requested, 'segment')} in a row.
                          </p>
                        )}
                      </div>
                      <div className="actions">
                        <button aria-pressed={placing} className={placing ? '' : 'primary'}
                                onClick={() => { setActiveAct(placing ? null : a.id); setSelection([]); }}>
                          {placing ? 'Stop placing' : <><Icon name="schedule" size={16} />Place</>}
                        </button>
                        {a.assigned.length > 0 && (
                          <button className="danger" disabled={busy} onClick={() => run('Releasing segments…', `Unassigned “${a.name}”`, () =>
                            queue(`/api/admin/requests/${detail.id}/unassign`, { act_ids: [a.id] }))}>
                            Unassign
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="detail-foot">
                {act && selection.length > 0 && (
                  <button className="primary" disabled={busy} aria-busy={busy} onClick={() =>
                    run('Assigning…', `Assigned “${act.name}”`, async () => {
                      const job = await queue(`/api/admin/requests/${detail.id}/assign`, {
                        request_id: detail.id,
                        assignments: [{ act_id: act.id, slot_ids: selection }],
                      });
                      if (job.status === 'done') { setSelection([]); setActiveAct(null); }
                      return job;
                    })}>
                    <Icon name="check" size={16} />Assign {plural(selection.length, 'segment')} to “{act.name}”
                  </button>
                )}
                <button disabled={busy} onClick={async () => {
                  const job = await run('Finding the best times…', 'Suggestion ready', () =>
                    queue(`/api/admin/requests/${detail.id}/suggest`, {}));
                  if (job && job.status === 'done') setSuggestion(job.result);
                }}><Icon name="spark" size={16} />Suggest allocation</button>
              </div>

              {suggestion && (
                <div className="suggestion" role="region" aria-label="Suggested allocation">
                  <div className="suggestion-head"><Icon name="spark" size={16} />Suggested allocation
                    <span className="muted" style={{ fontWeight: 400 }}>· not applied until you confirm</span></div>
                  <ul>
                    {suggestion.proposals.map((p) => (
                      <li key={p.act_id}>
                        <strong>{p.act_name}</strong>
                        <span className="num muted">{p.event_date} · {hhmm(p.start_time)}–{hhmm(p.end_time)}</span>
                        {p.matches_preferences === true && <span className="badge assigned">matches preference</span>}
                        {p.matches_preferences === false &&
                          <span className="badge pending">{p.preference_overlap}/{p.segments_requested} in preferred times</span>}
                      </li>
                    ))}
                    {suggestion.unplaced.map((u) => (
                      <li key={u.act_id} className="unplaced"><Icon name="alert" size={14} />{u.act_name}: no free back-to-back window</li>
                    ))}
                  </ul>
                  <div className="actions">
                    <button className="primary" disabled={busy || !suggestion.proposals.length} onClick={() =>
                      run('Applying suggestion…', 'Suggestion applied', async () => {
                        const job = await queue(`/api/admin/requests/${detail.id}/assign`, {
                          request_id: detail.id,
                          assignments: suggestion.proposals.map((p) => ({ act_id: p.act_id, slot_ids: p.slot_ids })),
                        });
                        if (job.status === 'done') setSuggestion(null);
                        return job;
                      })}><Icon name="check" size={16} />Apply suggestion</button>
                    <button className="ghost" onClick={() => setSuggestion(null)}>Discard</button>
                  </div>
                </div>
              )}
            </section>
          ) : (
            <div className="card"><div className="empty">
              <span className="empty-icon"><Icon name="user" /></span>
              <strong>Select a request</strong>
              <span>Pick a group from the list to review its acts and place them on the timetable.</span>
            </div></div>
          )}

          <section className="card" aria-labelledby="grid-h">
            <div className="card-head">
              <div>
                <h2 id="grid-h">Stage timetable</h2>
                <p>{act ? <>Placing <strong style={{ color: 'var(--ink)' }}>“{act.name}”</strong>: choose a start time</> : 'Choose “Place” on an act to start assigning'}</p>
              </div>
              <div className="legend">
                <span><i className="swatch taken" />Booked</span>
                <span><i className="swatch mine" />This act</span>
                <span><i className="swatch pref" />Preferred</span>
                <span><i className="swatch selected" />Selected</span>
                <span><i className="dot pending" />Unpaid</span>
              </div>
            </div>
            {event ? (
              <SlotGrid slots={grid} days={event.days} cell={(s) => {
                const r = grid.find((g) => g.slot_id === s.id)!;
                const mine = act && r.act_id === act.id;
                const taken = r.act_id !== null && !mine;
                const sel = selection.includes(s.id);
                return {
                  className: [taken ? 'cell-taken' : '', sel ? 'cell-selected' : '',
                    !taken && !sel && prefIds.has(s.id) ? 'cell-pref' : ''].join(' '),
                  disabled: taken || !act,
                  pressed: sel,
                  mergeKey: taken || (mine && !sel) ? `act-${r.act_id}` : undefined,
                  tone: mine ? 'mine' : 'booked',
                  onClick: () => clickCell(r),
                  title: taken ? `${r.group_name} · ${r.act_name}` : `${hhmm(s.start_time)}–${hhmm(s.end_time)}`,
                  content: r.act_id !== null
                    ? <><i className={`dot ${r.payment_status}`} />{r.group_name} · {r.act_name}</>
                    : sel ? 'Selected' : null,
                };
              }} />
            ) : (
              <div className="card-body" style={{ display: 'grid', gap: 8 }}>
                {Array.from({ length: 8 }, (_, k) => <Skeleton key={k} h={22} />)}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

