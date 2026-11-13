'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import SlotGrid, { GridSlot } from '@/components/SlotGrid';
import {
  addMinutes, api, Day, EventDetail, EventSummary, fmtDay, hhmm, Job, patch, pollJob, post,
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

export default function AdminPage() {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [eventId, setEventId] = useState<number | null>(null);
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [requests, setRequests] = useState<ReqRow[]>([]);
  const [grid, setGrid] = useState<GridRow[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ReqDetail | null>(null);
  const [activeAct, setActiveAct] = useState<number | null>(null);
  const [selection, setSelection] = useState<number[]>([]);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    api<EventSummary[]>('/api/events').then((e) => { setEvents(e); if (e.length) setEventId(e[0].id); })
      .catch((e) => setMsg({ kind: 'err', text: e.message }));
  }, []);

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

  useEffect(() => { reload().catch((e) => setMsg({ kind: 'err', text: e.message })); }, [reload]);

  function pick(id: number) {
    setSelectedId(id); setActiveAct(null); setSelection([]); setSuggestion(null); setMsg(null);
  }

  async function run(label: string, fn: () => Promise<Job | void>) {
    setBusy(true); setMsg({ kind: 'info', text: `${label}…` });
    try {
      const job = await fn();
      if (job && job.status === 'failed') setMsg({ kind: 'err', text: job.error ?? 'Job failed' });
      else setMsg({ kind: 'ok', text: `${label}: done` });
      await reload();
      return job;
    } catch (e) { setMsg({ kind: 'err', text: (e as Error).message }); }
    finally { setBusy(false); }
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
      setMsg({ kind: 'err', text: `Need ${act.segments_requested} free back-to-back segments starting here.` });
      return;
    }
    setMsg(null);
    setSelection(win.map((s) => s.slot_id));
  }

  const slotMinutes = events.find((e) => e.id === eventId)?.slot_minutes ?? 10;
  const dayOf = (id: number): Day | undefined => event?.days.find((d) => d.id === id);
  function describe(slots: ActSlot[]) {
    if (!slots.length) return 'not assigned';
    const first = slots[0], last = slots[slots.length - 1];
    const d = dayOf(first.day_id);
    return `${d ? d.label : ''} ${hhmm(first.start_time)}–${addMinutes(last.start_time, slotMinutes)} (${first.band})`;
  }

  const shown = requests.filter((r) => !filter || r.status === filter);

  if (!eventId) return <div className="card">No event yet. Create one under Event settings. {msg?.text}</div>;

  return (
    <div>
      <div className="row fit" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Admin</h1>
        <select value={eventId} onChange={(e) => { setEventId(Number(e.target.value)); setSelectedId(null); setDetail(null); }}>
          {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All requests</option>
          {['submitted', 'under_review', 'assigned', 'declined', 'cancelled'].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      {msg && <div className={`banner ${msg.kind}`}>{msg.text}</div>}

      <div className="two">
        <div>
          <h3>Requests ({shown.length})</h3>
          {shown.map((r) => (
            <div key={r.id} className={`list-item ${r.id === selectedId ? 'sel' : ''}`} onClick={() => pick(r.id)}>
              <strong>{r.group_name}</strong>
              <div className="row fit" style={{ gap: 6, marginTop: 4 }}>
                <span className={`badge ${r.status}`}>{r.status}</span>
                <span className={`badge ${r.payment_status}`}>{r.payment_status}</span>
                <span className="muted">{r.segments_assigned}/{r.segments_requested} seg · {r.acts} acts</span>
              </div>
            </div>
          ))}
          {!shown.length && <p className="muted">No requests yet.</p>}
        </div>

        <div>
          {detail ? (
            <div className="card">
              <div className="row">
                <div>
                  <h2 style={{ margin: 0 }}>{detail.group_name}</h2>
                  <div className="muted">{detail.contact_name} · {detail.email}{detail.phone ? ` · ${detail.phone}` : ''}</div>
                  {detail.group_notes && <div>“{detail.group_notes}”</div>}
                </div>
                <div className="row fit" style={{ justifyContent: 'flex-end' }}>
                  <span className={`badge ${detail.status}`}>{detail.status}</span>
                  <button disabled={busy} onClick={() => run('Payment updated', async () => {
                    await patch(`/api/admin/requests/${detail.id}`,
                      { payment_status: detail.payment_status === 'paid' ? 'pending' : 'paid' });
                  })}>
                    <span className={`dot ${detail.payment_status}`} />
                    {detail.payment_status === 'paid' ? 'Paid' : 'Payment pending'} (toggle)
                  </button>
                  <button className="danger" disabled={busy} onClick={() => {
                    if (confirm('Decline this request? Its segments are released and the group is emailed.'))
                      run('Declined', async () => { await patch(`/api/admin/requests/${detail.id}`, { status: 'declined' }); });
                  }}>Decline</button>
                </div>
              </div>

              <h3 style={{ marginTop: 14 }}>Acts</h3>
              {detail.acts.map((a) => (
                <div key={a.id} className={`act ${a.id === activeAct ? 'active' : ''}`}>
                  <div className="row">
                    <div>
                      <strong>{a.name}</strong> · {a.segments_requested} segment{a.segments_requested > 1 ? 's' : ''}
                      {a.notes && <span className="muted"> · {a.notes}</span>}
                      <div className="muted">
                        Wants: {a.preferred.length ? `${a.preferred.length} preferred segments` : 'no preference'} ·
                        Assigned: {describe(a.assigned)}
                      </div>
                    </div>
                    <div className="row fit" style={{ justifyContent: 'flex-end' }}>
                      <button onClick={() => { setActiveAct(a.id === activeAct ? null : a.id); setSelection([]); }}>
                        {a.id === activeAct ? 'Stop placing' : 'Place on grid'}
                      </button>
                      {a.assigned.length > 0 && (
                        <button className="danger" disabled={busy} onClick={() => run('Unassigned', () =>
                          queue(`/api/admin/requests/${detail.id}/unassign`, { act_ids: [a.id], requested_by: 'admin' }))}>
                          Unassign
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              <div className="row fit" style={{ marginTop: 8 }}>
                <button disabled={busy} onClick={async () => {
                  const job = await run('Suggestion ready', () =>
                    queue(`/api/admin/requests/${detail.id}/suggest`, { requested_by: 'admin' }));
                  if (job && job.status === 'done') setSuggestion(job.result);
                }}>Suggest allocation</button>
                {act && selection.length > 0 && (
                  <button className="primary" disabled={busy} onClick={() =>
                    run('Assigned', async () => {
                      const job = await queue(`/api/admin/requests/${detail.id}/assign`, {
                        request_id: detail.id, requested_by: 'admin',
                        assignments: [{ act_id: act.id, slot_ids: selection }],
                      });
                      if (job.status === 'done') setSelection([]);
                      return job;
                    })}>
                    Assign {selection.length} selected segment{selection.length > 1 ? 's' : ''} to “{act.name}”
                  </button>
                )}
              </div>

              {suggestion && (
                <div className="card" style={{ marginTop: 10, background: '#f8fafc' }}>
                  <strong>Suggested allocation</strong> <span className="muted">(not applied until you confirm)</span>
                  {suggestion.proposals.map((p) => (
                    <div key={p.act_id}>
                      {p.act_name}: {p.event_date} {hhmm(p.start_time)}–{hhmm(p.end_time)}
                      {p.matches_preferences === false &&
                        <span className="badge pending" style={{ marginLeft: 6 }}>
                          only {p.preference_overlap}/{p.segments_requested} in preferred times</span>}
                    </div>
                  ))}
                  {suggestion.unplaced.map((u) => (
                    <div key={u.act_id} style={{ color: '#b91c1c' }}>{u.act_name}: no free back-to-back window</div>
                  ))}
                  <div className="row fit" style={{ marginTop: 8 }}>
                    <button className="primary" disabled={busy || !suggestion.proposals.length} onClick={() =>
                      run('Suggestion applied', async () => {
                        const job = await queue(`/api/admin/requests/${detail.id}/assign`, {
                          request_id: detail.id, requested_by: 'admin',
                          assignments: suggestion.proposals.map((p) => ({ act_id: p.act_id, slot_ids: p.slot_ids })),
                        });
                        if (job.status === 'done') setSuggestion(null);
                        return job;
                      })}>Apply suggestion</button>
                    <button onClick={() => setSuggestion(null)}>Discard</button>
                  </div>
                </div>
              )}
            </div>
          ) : <div className="card muted">Select a request to review and assign its acts.</div>}

          <h3>Stage schedule</h3>
          <p className="legend muted">
            <span>Grey = taken</span><span>Yellow = this act</span><span>Dashed = group’s preference</span>
            <span>Blue = selected</span>
            <span><i className="dot pending" />payment pending</span><span><i className="dot paid" />paid</span>
          </p>
          {event && (
            <SlotGrid slots={grid} days={event.days} cell={(s) => {
              const r = grid.find((g) => g.slot_id === s.id)!;
              const mine = act && r.act_id === act.id;
              const taken = r.act_id !== null && !mine;
              const sel = selection.includes(s.id);
              return {
                className: [taken ? 'cell-taken' : '', mine ? 'cell-mine' : '', sel ? 'cell-selected' : '',
                  !taken && prefIds.has(s.id) ? 'cell-pref' : ''].join(' '),
                disabled: taken || !act,
                onClick: () => clickCell(r),
                title: taken ? `${r.group_name} · ${r.act_name}` : `${hhmm(s.start_time)}–${hhmm(s.end_time)}`,
                content: r.act_id !== null
                  ? <><i className={`dot ${r.payment_status}`} />{r.group_name} · {r.act_name}</> : null,
              };
            }} />
          )}
        </div>
      </div>
    </div>
  );
}
