'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/Icons';
import { CountUp, Fill, Skeleton } from '@/components/motion';
import SlotGrid from '@/components/SlotGrid';
import { useToast } from '@/components/Toasts';
import { api, EventDetail, EventSummary, plural } from '@/lib/api';
import { buildReport, fmtStamp, GridRow, Report, RequestRow, statusLabel } from '@/lib/report';

const REFRESH_MS = 30_000;
const STATUS_ORDER = ['submitted', 'under_review', 'assigned', 'declined', 'cancelled'];

export default function HomeReportPage() {
  const toast = useToast();
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [eventId, setEventId] = useState<number | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [view, setView] = useState<{ event: EventDetail; grid: GridRow[]; requests: RequestRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loadedEvents, setLoadedEvents] = useState(false);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    api<EventSummary[]>('/api/events')
      .then((list) => { setEvents(list); if (list.length) setEventId(list[0].id); })
      .catch((e) => setError(e.message))
      .finally(() => setLoadedEvents(true));
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
      setView({ event, grid, requests });
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
    const id = toast.push({ kind: 'progress', title: 'Creating PDF…' });
    try {
      // loaded on demand so the PDF library is not part of the initial page
      const { buildReportPdf, reportFileName } = await import('@/lib/pdf');
      const name = reportFileName(report);
      buildReportPdf(report).save(name);
      toast.update(id, { kind: 'ok', title: 'PDF downloaded', body: name });
    } catch (e: any) {
      toast.update(id, { kind: 'err', title: 'Could not create the PDF', body: e.message });
    } finally {
      setExporting(false);
    }
  }

  const t = report?.totals;
  const noEvent = loadedEvents && events.length === 0 && !error;
  const payTotal = t ? t.paid + t.pending : 0;
  const statusTotal = t ? Object.values(t.byStatus).reduce((a, b) => a + b, 0) : 0;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Live slot report</h1>
          <p className="sub">
            {report
              ? <>{report.eventName}{report.venue ? ` · ${report.venue}` : ''} · updated <span className="num">{fmtStamp(report.generatedAt)}</span></>
              : 'Bookings, capacity and requests for the current event'}
          </p>
        </div>
        <div className="actions">
          {report && (
            <span className={`live ${loading ? 'busy' : ''}`} title="Refreshes every 30 seconds">
              <span className="live-dot" />{loading ? 'Updating' : 'Live'}
              {!loading && <span className="countdown" key={report.generatedAt} style={{ animationDuration: `${REFRESH_MS}ms` }} />}
            </span>
          )}
          {events.length > 1 && (
            <>
              <label className="sr-only" htmlFor="report-event">Event</label>
              <select id="report-event" className="inline" value={eventId ?? ''} onChange={(e) => setEventId(Number(e.target.value))}>
                {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </>
          )}
          <button onClick={load} disabled={loading || !eventId} aria-busy={loading}><Icon name="refresh" size={16} />Refresh</button>
          <button className="primary" onClick={exportPdf} disabled={!report || exporting} aria-busy={exporting}>
            <Icon name="download" size={16} />Export PDF
          </button>
        </div>
      </div>

      {error && <div className="inline-alert err" role="alert" style={{ marginBottom: 'var(--s5)' }}><Icon name="alert" size={16} />{error}</div>}

      {noEvent && (
        <div className="card"><div className="empty">
          <span className="empty-icon"><Icon name="stage" /></span>
          <strong>No event yet</strong>
          <span>Create one in <a href="/admin/settings">Event settings</a>, then add its days.</span>
        </div></div>
      )}

      {!report && !noEvent && !error && <LoadingSkeleton />}

      {report && t && view && (
        <>
          <section className="kpis" aria-label="Summary">
            <div className="kpi">
              <div className="kpi-label"><Icon name="schedule" size={16} />Segments booked</div>
              <div className="kpi-value"><CountUp value={t.assigned} /><small>/ {t.slots}</small></div>
              <span className="track"><Fill pct={t.percent} /></span>
              <div className="kpi-sub">{t.percent}% of capacity · {t.free} free</div>
            </div>
            <div className="kpi">
              <div className="kpi-label"><Icon name="clock" size={16} />Still needed</div>
              <div className="kpi-value"><CountUp value={t.segmentsStillNeeded} /><small>segments</small></div>
              <div className="kpi-sub">{report.waiting.length ? `${plural(report.waiting.length, 'request')} waiting` : 'Every active request is placed'}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label"><Icon name="user" size={16} />Groups</div>
              <div className="kpi-value"><CountUp value={t.groups} /></div>
              <div className="kpi-sub">{plural(t.activeRequests, 'active request')} · {t.requests} total</div>
            </div>
            <div className="kpi">
              <div className="kpi-label"><Icon name="check" size={16} />Paid</div>
              <div className="kpi-value"><CountUp value={t.paid} /><small>/ {payTotal}</small></div>
              <span className="track"><Fill pct={payTotal ? (t.paid / payTotal) * 100 : 0} style={{ background: 'var(--ok)' }} /></span>
              <div className="kpi-sub">{t.pending} payment{t.pending === 1 ? '' : 's'} pending</div>
            </div>
          </section>

          <div className="grid-2" style={{ marginBottom: 'var(--s5)' }}>
            <section className="card" aria-labelledby="cap-h">
              <div className="card-head"><div><h2 id="cap-h">Capacity by day</h2><p>Segments booked in each band</p></div></div>
              <div className="card-body capacity">
                {report.days.map((d) => (
                  <div key={d.dayId}>
                    <div className="cap-day-head">
                      <strong>{d.label} <span className="muted num" style={{ fontWeight: 400 }}>{d.date}</span></strong>
                      <span className="muted num">{d.assigned}/{d.total} · {d.percent}%</span>
                    </div>
                    <div className="cap-bands">
                      {d.bands.map((b) => (
                        <div key={b.band}>
                          <div className="cap-band-label"><span>{b.band}</span><b className="num">{b.assigned}/{b.total}</b></div>
                          <span className="track" role="img" aria-label={`${d.label} ${b.band}: ${b.assigned} of ${b.total} booked`}>
                            <Fill pct={b.total ? (b.assigned / b.total) * 100 : 0} className={`band-${b.band}`} />
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {report.days.length === 0 && <p className="muted">No days yet. Add them in <a href="/admin/settings">Event settings</a>.</p>}
              </div>
            </section>

            <section className="card" aria-labelledby="pipe-h">
              <div className="card-head"><div><h2 id="pipe-h">Request pipeline</h2><p>Where every request stands</p></div></div>
              <div className="card-body">
                {statusTotal === 0 ? <p className="muted">No requests yet.</p> : (
                  <>
                    <div className="stacked" role="img" aria-label="Requests by status">
                      {STATUS_ORDER.filter((s) => t.byStatus[s]).map((s) => (
                        <Fill key={s} pct={(t.byStatus[s] / statusTotal) * 100} className={`seg-${s}`} />
                      ))}
                    </div>
                    <ul className="key">
                      {STATUS_ORDER.filter((s) => t.byStatus[s]).map((s) => (
                        <li key={s}><span className={`key-dot seg-${s}`} />{statusLabel(s)}<span className="n">{t.byStatus[s]}</span></li>
                      ))}
                    </ul>
                  </>
                )}
                {payTotal > 0 && (
                  <div style={{ marginTop: 'var(--s5)' }}>
                    <div className="cap-band-label"><span>Payment (active requests)</span><b className="num">{t.paid} paid · {t.pending} pending</b></div>
                    <div className="stacked">
                      <Fill pct={(t.paid / payTotal) * 100} className="seg-paid" />
                      <Fill pct={(t.pending / payTotal) * 100} className="seg-pending" />
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>

          <section className="card" aria-labelledby="sched-h">
            <div className="card-head">
              <div><h2 id="sched-h">Stage schedule</h2><p>View only · bookings appear as blocks</p></div>
              <div className="actions">
                <div className="legend">
                  <span><i className="swatch taken" />Booked</span>
                  <span><i className="dot pending" />Payment pending</span>
                  <span><i className="dot paid" />Paid</span>
                </div>
                <a href="/admin" className="button"><Icon name="schedule" size={16} />Open scheduler</a>
              </div>
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
                  mergeKey: `act-${g.act_id}`,
                  title: `${g.group_name} · ${g.act_name} (${g.payment_status})`,
                  content: <><i className={`dot ${g.payment_status}`} />{g.group_name} · {g.act_name}</>,
                };
              }}
            />
          </section>

          <RunSheets report={report} tab={tab} setTab={setTab} />

          <section className="card" aria-labelledby="waiting-h">
            <div className="card-head">
              <div><h2 id="waiting-h">Requests waiting for slots</h2><p>Active requests not yet fully placed</p></div>
              {report.waiting.length > 0 && <a href="/admin" className="button">Assign now<Icon name="arrow" size={16} /></a>}
            </div>
            {report.waiting.length === 0 ? (
              <div className="empty">
                <span className="empty-icon" style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }}><Icon name="check" /></span>
                <strong>All caught up</strong><span>Every active request is fully assigned.</span>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Group</th><th>Email</th><th>Status</th><th className="n">Assigned</th><th>Progress</th><th>Payment</th></tr></thead>
                  <tbody>
                    {report.waiting.map((w, i) => (
                      <tr key={w.requestId} style={{ animationDelay: `${i * 30}ms` }}>
                        <td style={{ fontWeight: 500 }}>{w.group}</td>
                        <td><a href={`mailto:${w.email}`}>{w.email}</a></td>
                        <td><span className={`badge ${w.status}`}>{statusLabel(w.status)}</span></td>
                        <td className="n num">{w.assigned} / {w.requested}</td>
                        <td style={{ minWidth: 120 }}><span className="track"><Fill pct={w.requested ? (w.assigned / w.requested) * 100 : 0} /></span></td>
                        <td><span className={`badge ${w.payment}`}>{statusLabel(w.payment)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}


/** Per-day run sheet, one tab per day, with a sliding tab indicator. */
function RunSheets({ report, tab, setTab }: { report: Report; tab: number; setTab: (i: number) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [bar, setBar] = useState({ x: 0, w: 0 });
  const i = Math.min(tab, Math.max(0, report.days.length - 1));
  const day = report.days[i];

  useLayoutEffect(() => {
    const el = refs.current[i];
    if (el) setBar({ x: el.offsetLeft, w: el.offsetWidth });
  }, [i, report.days.length]);

  const entries = useMemo(() => day?.entries ?? [], [day]);
  if (!day) return null;

  return (
    <section className="card" aria-labelledby="run-h">
      <div className="card-head"><div><h2 id="run-h">Run sheet</h2><p>Who is on stage, in order</p></div></div>
      <div className="tabs" role="tablist" aria-label="Days">
        {report.days.map((d, k) => (
          <button key={d.dayId} ref={(el) => { refs.current[k] = el; }} role="tab" aria-selected={k === i}
                  aria-controls="run-panel" onClick={() => setTab(k)}>
            {d.label} <span className="muted num" style={{ fontWeight: 400 }}>· {d.assigned}/{d.total}</span>
          </button>
        ))}
        <span className="tab-indicator" style={{ transform: `translateX(${bar.x - 20}px)`, width: bar.w, left: 20 }} aria-hidden="true" />
      </div>
      <div id="run-panel" role="tabpanel" key={day.dayId}>
        {entries.length === 0 ? (
          <div className="empty"><span className="empty-icon"><Icon name="stage" /></span><strong>Nothing booked yet</strong>
            <span>No acts are scheduled on {day.label}.</span></div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Time</th><th>Band</th><th>Group</th><th>Act</th><th className="n">Segments</th><th>Payment</th></tr></thead>
              <tbody>
                {entries.map((e, k) => (
                  <tr key={k} style={{ animationDelay: `${k * 30}ms` }}>
                    <td className="when num">{e.start}–{e.end}</td>
                    <td>{e.bands.split(' / ').map((b) => <span key={b} className={`badge plain band-${b}`} style={{ marginRight: 4 }}>{b}</span>)}</td>
                    <td style={{ fontWeight: 500 }}>{e.group}</td>
                    <td>{e.act}</td>
                    <td className="n num">{e.segments}</td>
                    <td><span className={`badge ${e.payment}`}>{statusLabel(e.payment)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function LoadingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading report">
      <div className="kpis">
        {[0, 1, 2, 3].map((k) => (
          <div className="kpi" key={k}><Skeleton h={12} w="50%" /><div style={{ height: 14 }} /><Skeleton h={28} w="40%" /><div style={{ height: 12 }} /><Skeleton h={6} /></div>
        ))}
      </div>
      <div className="grid-2" style={{ marginBottom: 'var(--s5)' }}>
        {[0, 1].map((k) => (
          <div className="card" key={k}><div className="card-body" style={{ display: 'grid', gap: 14 }}>
            <Skeleton h={14} w="35%" /><Skeleton h={10} /><Skeleton h={10} w="80%" /><Skeleton h={10} w="60%" />
          </div></div>
        ))}
      </div>
      <div className="card"><div className="card-body" style={{ display: 'grid', gap: 10 }}>
        {Array.from({ length: 8 }, (_, k) => <Skeleton key={k} h={22} />)}
      </div></div>
    </div>
  );
}
