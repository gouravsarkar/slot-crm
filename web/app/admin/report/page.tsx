'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import SlotGrid from '@/components/SlotGrid';
import { api, EventDetail, EventSummary } from '@/lib/api';
import { buildReport, fmtStamp, GridRow, Report, RequestRow, statusLabel } from '@/lib/report';

const REFRESH_MS = 30_000;

export default function HomeReportPage() {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [eventId, setEventId] = useState<number | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [view, setView] = useState<{ event: EventDetail; grid: GridRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api<EventSummary[]>('/api/events')
      .then((list) => { setEvents(list); if (list.length) setEventId(list[0].id); })
      .catch((e) => setError(e.message));
  }, []);

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    try {
      const [event, grid, requests] = await Promise.all([
        api<EventDetail>(`/api/events/${eventId}`),
        api<GridRow[]>(`/api/admin/grid?event_id=${eventId}`),
        api<RequestRow[]>(`/api/admin/requests?event_id=${eventId}`),
      ]);
      setReport(buildReport(event, grid, requests));
      setView({ event, grid });
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function exportPdf() {
    if (!report) return;
    setExporting(true);
    try {
      // loaded on demand so the PDF library is not part of the initial page
      const { buildReportPdf, reportFileName } = await import('@/lib/pdf');
      buildReportPdf(report).save(reportFileName(report));
    } catch (e: any) {
      setError(`Could not create the PDF: ${e.message}`);
    } finally {
      setExporting(false);
    }
  }

  const t = report?.totals;
  const empty = useMemo(() => events.length === 0 && !error, [events, error]);

  return (
    <>
      <div className="row fit" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Live slot report</h1>
        {events.length > 1 && (
          <select value={eventId ?? ''} onChange={(e) => setEventId(Number(e.target.value))} style={{ width: 'auto' }}>
            {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        )}
        <span style={{ flex: 1 }} />
        <button onClick={load} disabled={loading}>{loading ? 'Refreshing...' : 'Refresh'}</button>
        <button className="primary" onClick={exportPdf} disabled={!report || exporting}>
          {exporting ? 'Creating PDF...' : 'Export PDF'}
        </button>
      </div>

      {error && <div className="banner err">{error}</div>}
      {empty && <div className="card">No event yet. Create one under <a href="/admin/settings">Event settings</a>.</div>}

      {report && t && (
        <>
          <p className="muted">
            {report.eventName}{report.venue ? ` - ${report.venue}` : ''} | updated {fmtStamp(report.generatedAt)}
            {' '}(refreshes every 30 seconds) | view only
          </p>

          <div className="stats">
            <Stat label="Segments assigned" value={`${t.assigned} / ${t.slots}`} sub={`${t.percent}% booked`} />
            <Stat label="Segments free" value={String(t.free)} />
            <Stat label="Still needed" value={String(t.segmentsStillNeeded)} sub="by active requests" />
            <Stat label="Groups" value={String(t.groups)} sub={`${t.activeRequests} active requests`} />
            <Stat label="Payment" value={`${t.paid} paid`} sub={`${t.pending} pending`} />
          </div>

          <div className="card">
            <strong>Request status: </strong>
            {Object.keys(t.byStatus).length === 0 && <span className="muted">no requests yet</span>}
            {Object.entries(t.byStatus).map(([s, n]) => (
              <span key={s} className={`badge ${s}`} style={{ marginRight: 8 }}>{statusLabel(s)}: {n}</span>
            ))}
          </div>

          {view && (
            <div className="card">
              <h2>Stage schedule</h2>
              <div className="legend muted" style={{ marginBottom: 8 }}>
                <span>Grey = booked</span>
                <span><i className="dot pending" />payment pending</span>
                <span><i className="dot paid" />paid</span>
                <span>View only. To change bookings use the <a href="/admin">Admin page</a>.</span>
              </div>
              <SlotGrid
                slots={view.grid.map((g) => ({
                  id: g.slot_id, day_id: g.day_id, event_date: g.event_date, band: g.band,
                  start_time: g.start_time, end_time: g.end_time,
                }))}
                days={view.event.days}
                cell={(s) => {
                  const g = view.grid.find((r) => r.slot_id === s.id);
                  if (!g || g.act_id === null) return {};
                  return {
                    className: 'cell-taken',
                    title: `${g.group_name} - ${g.act_name} (${g.payment_status})`,
                    content: (
                      <>
                        <i className={`dot ${g.payment_status}`} />
                        {g.group_name} · {g.act_name}
                      </>
                    ),
                  };
                }}
              />
            </div>
          )}

          {report.days.map((day) => (
            <div className="card" key={day.dayId}>
              <div className="row fit" style={{ marginBottom: 6 }}>
                <h2 style={{ margin: 0 }}>{day.label} <small className="muted">{day.date}</small></h2>
                <span className="muted">{day.assigned} of {day.total} segments assigned ({day.percent}%)</span>
              </div>
              <div className="bar-row">
                {day.bands.map((b) => (
                  <div key={b.band} className="bar-item">
                    <small>{b.band} {b.assigned}/{b.total}</small>
                    <div className="bar"><div className={`bar-fill band-${b.band}`}
                         style={{ width: `${b.total ? (b.assigned / b.total) * 100 : 0}%` }} /></div>
                  </div>
                ))}
              </div>
              {day.entries.length === 0 ? (
                <p className="muted">No segments assigned yet.</p>
              ) : (
                <table className="report-table">
                  <thead>
                    <tr><th>Time</th><th>Band</th><th>Group</th><th>Act</th><th>Segments</th><th>Payment</th></tr>
                  </thead>
                  <tbody>
                    {day.entries.map((e, i) => (
                      <tr key={i}>
                        <td className={`band-cell band-${e.bands.split(' / ')[0]}`}>{e.start} - {e.end}</td>
                        <td className={`band-cell band-${e.bands.split(' / ')[0]}`}>{e.bands}</td>
                        <td>{e.group}</td>
                        <td>{e.act}</td>
                        <td>{e.segments}</td>
                        <td><span className={`badge ${e.payment}`}>{e.payment}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}

          <div className="card">
            <h2>Requests still waiting for slots</h2>
            {report.waiting.length === 0 ? (
              <p className="muted">None. Every active request is fully assigned.</p>
            ) : (
              <table className="report-table">
                <thead>
                  <tr><th>Group</th><th>Email</th><th>Status</th><th>Assigned / requested</th><th>Payment</th></tr>
                </thead>
                <tbody>
                  {report.waiting.map((w) => (
                    <tr key={w.requestId}>
                      <td>{w.group}</td><td>{w.email}</td>
                      <td><span className={`badge ${w.status}`}>{statusLabel(w.status)}</span></td>
                      <td>{w.assigned} / {w.requested}</td>
                      <td><span className={`badge ${w.payment}`}>{w.payment}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p><a href="/admin">Open the admin page to assign slots</a></p>
          </div>
        </>
      )}
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="muted">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <small className="muted">{sub}</small>}
    </div>
  );
}
