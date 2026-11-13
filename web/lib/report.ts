import type { EventDetail } from './api';

/** Row shape returned by GET /api/admin/grid */
export type GridRow = {
  slot_id: number; day_id: number; event_date: string; day_label: string | null;
  band: string; start_time: string; end_time: string;
  act_id: number | null; act_name: string | null;
  request_id: number | null; group_name: string | null; payment_status: string | null;
};

/** Row shape returned by GET /api/admin/requests */
export type RequestRow = {
  id: number; status: string; payment_status: string; group_name: string; contact_name?: string; email: string;
  acts: number; segments_requested: number; segments_assigned: number;
};

export type Entry = {
  start: string; end: string; bands: string; group: string; act: string;
  segments: number; payment: string; requestId: number;
};
export type BandStat = { band: string; assigned: number; total: number };
export type DayReport = {
  dayId: number; label: string; date: string;
  assigned: number; total: number; percent: number;
  bands: BandStat[]; entries: Entry[];
};
export type Waiting = {
  requestId: number; group: string; email: string; status: string;
  requested: number; assigned: number; payment: string;
};
export type Report = {
  generatedAt: string; eventName: string; venue: string | null; slotMinutes: number;
  totals: {
    slots: number; assigned: number; free: number; percent: number;
    groups: number; requests: number; activeRequests: number;
    segmentsRequested: number; segmentsStillNeeded: number;
    paid: number; pending: number;
    byStatus: Record<string, number>;
  };
  days: DayReport[];
  waiting: Waiting[];
};

const hhmm = (t: string) => t.slice(0, 5);
const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 100));
const INACTIVE = new Set(['declined', 'cancelled']);

export function buildReport(event: EventDetail, grid: GridRow[], requests: RequestRow[], now: Date = new Date()): Report {
  const days: DayReport[] = [];
  const orderedDays = [...event.days].sort((a, b) => a.event_date.localeCompare(b.event_date));

  for (const d of orderedDays) {
    const slots = grid.filter((g) => g.day_id === d.id).sort((a, b) => a.start_time.localeCompare(b.start_time));
    const bandNames = [...new Set(slots.map((s) => s.band))]; // slots are time-ordered, so bands are too
    const bands = bandNames.map((band) => {
      const inBand = slots.filter((s) => s.band === band);
      return { band, total: inBand.length, assigned: inBand.filter((s) => s.act_id !== null).length };
    });

    // merge back-to-back segments of the same act into a single schedule line
    const work: (Entry & { actId: number; bandList: string[] })[] = [];
    let cur: (Entry & { actId: number; bandList: string[] }) | null = null;
    for (const s of slots) {
      if (s.act_id === null) { cur = null; continue; }
      if (cur && cur.actId === s.act_id && cur.end === hhmm(s.start_time)) {
        cur.end = hhmm(s.end_time);
        cur.segments += 1;
        if (!cur.bandList.includes(s.band)) cur.bandList.push(s.band);
        cur.bands = cur.bandList.join(' / ');
      } else {
        cur = {
          start: hhmm(s.start_time), end: hhmm(s.end_time), bands: s.band, bandList: [s.band],
          group: s.group_name ?? '', act: s.act_name ?? '', segments: 1,
          payment: s.payment_status ?? 'pending', requestId: s.request_id ?? 0, actId: s.act_id,
        };
        work.push(cur);
      }
    }
    const assigned = slots.filter((s) => s.act_id !== null).length;
    days.push({
      dayId: d.id, label: d.label ?? '', date: d.event_date,
      assigned, total: slots.length, percent: pct(assigned, slots.length), bands,
      entries: work.map(({ actId: _a, bandList: _b, ...e }) => e),
    });
  }

  const active = requests.filter((r) => !INACTIVE.has(r.status));
  const waiting: Waiting[] = active
    .filter((r) => r.segments_assigned < r.segments_requested)
    .map((r) => ({
      requestId: r.id, group: r.group_name, email: r.email, status: r.status,
      requested: r.segments_requested, assigned: r.segments_assigned, payment: r.payment_status,
    }))
    .sort((a, b) => a.group.localeCompare(b.group));

  const byStatus: Record<string, number> = {};
  for (const r of requests) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

  const totalSlots = days.reduce((n, d) => n + d.total, 0);
  const totalAssigned = days.reduce((n, d) => n + d.assigned, 0);

  return {
    generatedAt: now.toISOString(),
    eventName: event.name, venue: event.venue, slotMinutes: event.slot_minutes,
    totals: {
      slots: totalSlots, assigned: totalAssigned, free: totalSlots - totalAssigned,
      percent: pct(totalAssigned, totalSlots),
      groups: new Set(active.map((r) => r.group_name.toLowerCase())).size,
      requests: requests.length, activeRequests: active.length,
      segmentsRequested: active.reduce((n, r) => n + r.segments_requested, 0),
      segmentsStillNeeded: waiting.reduce((n, w) => n + (w.requested - w.assigned), 0),
      paid: active.filter((r) => r.payment_status === 'paid').length,
      pending: active.filter((r) => r.payment_status !== 'paid').length,
      byStatus,
    },
    days, waiting,
  };
}

export const fmtStamp = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export const statusLabel = (s: string) => s.replace('_', ' ');
