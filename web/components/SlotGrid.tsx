'use client';
import { KeyboardEvent, ReactNode } from 'react';
import { Day, hhmm } from '@/lib/api';

export type GridSlot = {
  id: number; day_id: number; event_date: string; band: string; start_time: string; end_time: string;
};
export type Cell = {
  content?: ReactNode; className?: string; disabled?: boolean; title?: string; onClick?: () => void;
  /** pressed state for toggle cells (e.g. a chosen preference) */
  pressed?: boolean;
  /** consecutive cells in a column with the same key render as one timeline block */
  mergeKey?: string;
  /** block colour: booked (default), mine, pending */
  tone?: 'booked' | 'mine' | 'muted';
};

const BAND_LABEL: Record<string, string> = { GREEN: 'Morning', PURPLE: 'Afternoon', PINK: 'Evening' };

/**
 * Stage timetable: one column per day, one row per segment, grouped under the colour bands.
 * Bookings render as blocks spanning their segments, like a scheduler.
 */
export default function SlotGrid({ slots, days, cell, label = 'Stage schedule' }: {
  slots: GridSlot[]; days: Day[]; cell: (s: GridSlot) => Cell; label?: string;
}) {
  const byDay = new Map<number, Map<string, GridSlot>>();
  const bandOf = new Map<string, string>();
  const endOf = new Map<string, string>();
  for (const s of slots) {
    if (!byDay.has(s.day_id)) byDay.set(s.day_id, new Map());
    byDay.get(s.day_id)!.set(s.start_time, s);
    bandOf.set(s.start_time, s.band);
    endOf.set(s.start_time, s.end_time);
  }
  const times = [...bandOf.keys()].sort();
  const groups: { band: string; times: string[] }[] = [];
  for (const t of times) {
    const band = bandOf.get(t)!;
    const last = groups[groups.length - 1];
    if (last && last.band === band) last.times.push(t);
    else groups.push({ band, times: [t] });
  }

  return (
    <div className="grid-wrap" tabIndex={0} role="region" aria-label={label}>
      <table className="slot-grid">
        <thead>
          <tr>
            <th scope="col" className="corner"><span className="sr-only">Time</span></th>
            {days.map((d) => (
              <th key={d.id} scope="col">
                <span className="day-name">{d.label}</span><small>{d.event_date}</small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <BandRows key={g.times[0]} g={g} days={days} byDay={byDay} cell={cell} endOf={endOf} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function activate(e: KeyboardEvent, fn: () => void) {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
}

type Planned = { slot: GridSlot; c: Cell; span: number; skip: boolean } | null;

function BandRows({ g, days, byDay, cell, endOf }: {
  g: { band: string; times: string[] }; days: Day[]; endOf: Map<string, string>;
  byDay: Map<number, Map<string, GridSlot>>; cell: (s: GridSlot) => Cell;
}) {
  // plan each column: merge runs of the same mergeKey into one rowSpan block
  const plan: Planned[][] = g.times.map(() => days.map(() => null));
  days.forEach((d, col) => {
    let head = -1;
    g.times.forEach((t, row) => {
      const slot = byDay.get(d.id)?.get(t);
      if (!slot) { plan[row][col] = null; head = -1; return; }
      const c = cell(slot);
      const prev = head >= 0 ? plan[head][col] : null;
      const contiguous = row > 0 && endOf.get(g.times[row - 1]) === t;
      if (c.mergeKey && prev && prev.c.mergeKey === c.mergeKey && contiguous && head + prev.span === row) {
        prev.span += 1;
        plan[row][col] = { slot, c, span: 0, skip: true };
      } else {
        plan[row][col] = { slot, c, span: 1, skip: false };
        head = c.mergeKey ? row : -1;
      }
    });
  });

  return (
    <>
      <tr className={`band-head band-${g.band}`}>
        <th colSpan={days.length + 1} scope="colgroup">
          <span className="band-chip" />{g.band} · {BAND_LABEL[g.band] ?? ''}
          <span className="band-time">{hhmm(g.times[0])}–{hhmm(endOf.get(g.times[g.times.length - 1])!)}</span>
        </th>
      </tr>
      {g.times.map((t, row) => (
        <tr key={t} className={`band-${g.band}`}>
          <th className="time" scope="row">{hhmm(t)}</th>
          {days.map((d, col) => {
            const p = plan[row][col];
            if (!p) return <td key={d.id} className="cell-none" />;
            if (p.skip) return null;
            const { c, slot, span } = p;
            const interactive = !!c.onClick && !c.disabled;
            const block = !!c.mergeKey;
            const endTime = endOf.get(g.times[row + span - 1]) ?? slot.end_time;
            return (
              <td key={d.id} rowSpan={span > 1 ? span : undefined}
                  className={`cell ${interactive ? 'clickable' : ''} ${block ? 'has-block' : ''} ${c.className ?? ''}`}
                  title={c.title}
                  {...(interactive ? {
                    role: 'button',
                    tabIndex: 0,
                    'aria-label': `${d.label ?? d.event_date} ${hhmm(slot.start_time)}${c.title ? `, ${c.title}` : ''}`,
                    'aria-pressed': c.pressed,
                    onClick: c.onClick,
                    onKeyDown: (e: KeyboardEvent) => activate(e, c.onClick!),
                  } : {})}>
                {block ? (
                  <div className={`tblock tone-${c.tone ?? 'booked'}`} style={{ animationDelay: `${Math.min(row, 12) * 18}ms` }}>
                    <span className="block-title">{c.content}</span>
                    {span > 1 && <span className="block-time">{hhmm(slot.start_time)}–{hhmm(endTime)}</span>}
                  </div>
                ) : c.content}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
