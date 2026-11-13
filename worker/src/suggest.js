/**
 * Pure allocation heuristic (no I/O), so it can be unit tested.
 *
 * For each act, find a window of N free, back-to-back segments on one day.
 * Prefer the window that overlaps the group's preferred segments the most,
 * then the earliest one. Biggest acts are placed first because they have the
 * fewest possible windows.
 *
 * slots: [{ id, day_id, event_date, start_time, end_time }]  ('HH:MM:SS' strings)
 * acts:  [{ id, name, segments_requested, preferred_slot_ids: number[] }]
 * takenSlotIds: ids already assigned to other acts
 */
export function suggestAllocation({ slots, acts, takenSlotIds }) {
  const used = new Set(takenSlotIds);
  const byDay = new Map();
  for (const s of [...slots].sort((a, b) =>
    a.event_date.localeCompare(b.event_date) || a.start_time.localeCompare(b.start_time))) {
    if (!byDay.has(s.day_id)) byDay.set(s.day_id, []);
    byDay.get(s.day_id).push(s);
  }

  const order = [...acts].sort((a, b) => b.segments_requested - a.segments_requested || a.id - b.id);
  const proposals = [];
  const unplaced = [];

  for (const act of order) {
    const prefs = new Set(act.preferred_slot_ids ?? []);
    const n = act.segments_requested;
    let best = null;

    for (const daySlots of byDay.values()) {
      for (let i = 0; i + n <= daySlots.length; i++) {
        const win = daySlots.slice(i, i + n);
        const free = win.every((s) => !used.has(s.id));
        const contiguous = win.every((s, k) => k === 0 || win[k - 1].end_time === s.start_time);
        if (!free || !contiguous) continue;
        const overlap = win.filter((s) => prefs.has(s.id)).length;
        // slots are scanned in chronological order, so the first best-scoring window is the earliest
        if (!best || overlap > best.overlap) best = { win, overlap };
      }
    }

    if (!best) {
      unplaced.push({ act_id: act.id, act_name: act.name, segments_requested: n });
      continue;
    }
    best.win.forEach((s) => used.add(s.id));
    proposals.push({
      act_id: act.id,
      act_name: act.name,
      segments_requested: n,
      slot_ids: best.win.map((s) => s.id),
      day_id: best.win[0].day_id,
      event_date: best.win[0].event_date,
      start_time: best.win[0].start_time,
      end_time: best.win[n - 1].end_time,
      preference_overlap: best.overlap,
      matches_preferences: prefs.size === 0 ? null : best.overlap === n,
    });
  }

  proposals.sort((a, b) => a.act_id - b.act_id);
  return { proposals, unplaced };
}
