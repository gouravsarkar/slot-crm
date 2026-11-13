import assert from 'node:assert/strict';
import { test } from 'node:test';
import { suggestAllocation } from '../src/suggest.js';

// One day, two bands with a lunch gap: 11:00-11:30 (3 segs) then 14:00-14:30 (3 segs)
const mk = (id, day, date, start, end) => ({ id, day_id: day, event_date: date, start_time: start, end_time: end });
const slots = [
  mk(1, 1, '2027-04-03', '11:00:00', '11:10:00'),
  mk(2, 1, '2027-04-03', '11:10:00', '11:20:00'),
  mk(3, 1, '2027-04-03', '11:20:00', '11:30:00'),
  mk(4, 1, '2027-04-03', '14:00:00', '14:10:00'),
  mk(5, 1, '2027-04-03', '14:10:00', '14:20:00'),
  mk(6, 1, '2027-04-03', '14:20:00', '14:30:00'),
];

test('places an act on its preferred contiguous window', () => {
  const r = suggestAllocation({
    slots, takenSlotIds: [],
    acts: [{ id: 10, name: 'Dance', segments_requested: 2, preferred_slot_ids: [5, 6] }],
  });
  assert.deepEqual(r.proposals[0].slot_ids, [5, 6]);
  assert.equal(r.proposals[0].matches_preferences, true);
});

test('never proposes a window that jumps over the lunch gap', () => {
  const r = suggestAllocation({
    slots, takenSlotIds: [1, 2],           // only slot 3 free in the morning
    acts: [{ id: 10, name: 'Act', segments_requested: 2, preferred_slot_ids: [3, 4] }],
  });
  assert.ok(!r.proposals[0].slot_ids.includes(3) || !r.proposals[0].slot_ids.includes(4));
  assert.deepEqual(r.proposals[0].slot_ids, [4, 5]);
});

test('skips taken segments and reports unplaced acts', () => {
  const r = suggestAllocation({
    slots, takenSlotIds: [1, 2, 3, 4, 5],
    acts: [{ id: 10, name: 'Big', segments_requested: 2, preferred_slot_ids: [] }],
  });
  assert.equal(r.proposals.length, 0);
  assert.equal(r.unplaced[0].act_id, 10);
});

test('acts of one request never overlap each other', () => {
  const r = suggestAllocation({
    slots, takenSlotIds: [],
    acts: [
      { id: 1, name: 'A', segments_requested: 2, preferred_slot_ids: [1, 2] },
      { id: 2, name: 'B', segments_requested: 2, preferred_slot_ids: [1, 2] },
    ],
  });
  const all = r.proposals.flatMap((p) => p.slot_ids);
  assert.equal(new Set(all).size, all.length);
  assert.equal(r.proposals.length, 2);
});

test('with no preferences the earliest window is used', () => {
  const r = suggestAllocation({
    slots, takenSlotIds: [],
    acts: [{ id: 1, name: 'A', segments_requested: 3, preferred_slot_ids: [] }],
  });
  assert.deepEqual(r.proposals[0].slot_ids, [1, 2, 3]);
  assert.equal(r.proposals[0].matches_preferences, null);
});
