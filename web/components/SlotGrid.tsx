'use client';
import { ReactNode } from 'react';
import { Day, hhmm } from '@/lib/api';

export type GridSlot = {
  id: number; day_id: number; event_date: string; band: string; start_time: string; end_time: string;
};
export type Cell = {
  content?: ReactNode; className?: string; disabled?: boolean; title?: string; onClick?: () => void;
};

const BAND_LABEL: Record<string, string> = { GREEN: 'Morning', PURPLE: 'Afternoon', PINK: 'Evening' };

/** One column per day, one row per 10-minute segment, grouped under the colour bands. */
export default function SlotGrid({ slots, days, cell }: {
  slots: GridSlot[]; days: Day[]; cell: (s: GridSlot) => Cell;
}) {
  const byDay = new Map<number, Map<string, GridSlot>>();
  const bandOf = new Map<string, string>();
  for (const s of slots) {
    if (!byDay.has(s.day_id)) byDay.set(s.day_id, new Map());
    byDay.get(s.day_id)!.set(s.start_time, s);
    bandOf.set(s.start_time, s.band);
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
    <div className="grid-wrap">
      <table className="slot-grid">
        <thead>
          <tr>
            <th />
            {days.map((d) => (
              <th key={d.id}>{d.label}<br /><small>{d.event_date}</small></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <BandRows key={g.times[0]} g={g} days={days} byDay={byDay} cell={cell} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BandRows({ g, days, byDay, cell }: {
  g: { band: string; times: string[] }; days: Day[];
  byDay: Map<number, Map<string, GridSlot>>; cell: (s: GridSlot) => Cell;
}) {
  return (
    <>
      <tr className={`band-head band-${g.band}`}>
        <th colSpan={days.length + 1}>{g.band} · {BAND_LABEL[g.band] ?? ''}</th>
      </tr>
      {g.times.map((t) => (
        <tr key={t} className={`band-${g.band}`}>
          <th className="time">{hhmm(t)}</th>
          {days.map((d) => {
            const slot = byDay.get(d.id)?.get(t);
            if (!slot) return <td key={d.id} className="cell-none" />;
            const c = cell(slot);
            return (
              <td key={d.id} className={`cell ${c.className ?? ''}`} title={c.title}
                  onClick={c.disabled ? undefined : c.onClick}
                  style={{ cursor: c.disabled || !c.onClick ? 'default' : 'pointer' }}>
                {c.content}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
