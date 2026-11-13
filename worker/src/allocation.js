import { pool, withTransaction } from './db.js';
import { notificationQueue } from './queues.js';
import { suggestAllocation } from './suggest.js';

const PG_UNIQUE = '23505';
const PG_RAISE = 'P0001'; // RAISE EXCEPTION from the contiguity trigger
const PG_FK = '23503';

function domainMessage(err) {
  if (err.code === PG_UNIQUE) return 'One or more segments are already assigned to another act.';
  if (err.code === PG_RAISE) return err.message;
  if (err.code === PG_FK) return 'A referenced act or segment no longer exists.';
  return null; // infrastructure error
}

/** Assign: replaces each act's current segments with the new ones, atomically. */
async function assign({ request_id, assignments, assigned_by }) {
  const outcome = await withTransaction(async (c) => {
    for (const { act_id, slot_ids } of assignments) {
      await c.query('DELETE FROM slot_assignments WHERE act_id = $1', [act_id]);
      await c.query(
        'INSERT INTO slot_assignments (slot_id, act_id, assigned_by) SELECT unnest($1::bigint[]), $2, $3',
        [slot_ids, act_id, assigned_by ?? 'admin'],
      );
    }
    const { rows } = await c.query(
      `SELECT bool_and(COALESCE(x.n, 0) = a.segments_requested) AS complete
         FROM acts a
         LEFT JOIN (SELECT act_id, count(*) AS n FROM slot_assignments GROUP BY act_id) x ON x.act_id = a.id
        WHERE a.request_id = $1`,
      [request_id],
    );
    const complete = rows[0].complete === true;
    await c.query(
      `UPDATE slot_requests
          SET status = CASE WHEN $2 THEN 'assigned'::request_status ELSE 'under_review'::request_status END,
              updated_at = now()
        WHERE id = $1 AND status IN ('submitted', 'under_review', 'assigned')`,
      [request_id, complete],
    );
    return { complete };
  });
  if (outcome.complete) {
    await notificationQueue.add('assigned', { request_id }, { attempts: 5, backoff: { type: 'exponential', delay: 5000 } });
  }
  return { request_id, request_status: outcome.complete ? 'assigned' : 'under_review', assigned: assignments };
}

async function unassign({ request_id, act_ids }) {
  const released = await withTransaction(async (c) => {
    const { rows } = await c.query(
      'DELETE FROM slot_assignments WHERE act_id = ANY($1::bigint[]) RETURNING slot_id, act_id', [act_ids]);
    await c.query(
      `UPDATE slot_requests SET status = 'under_review', updated_at = now()
        WHERE id = $1 AND status = 'assigned'`, [request_id]);
    return rows;
  });
  if (released.length) {
    await notificationQueue.add('unassigned', { request_id }, { attempts: 5, backoff: { type: 'exponential', delay: 5000 } });
  }
  return { request_id, released: released.length };
}

async function suggest({ request_id }) {
  const { rows: [req] } = await pool.query('SELECT event_id FROM slot_requests WHERE id = $1', [request_id]);
  if (!req) throw Object.assign(new Error('Request not found'), { code: PG_RAISE });

  const { rows: slots } = await pool.query(
    `SELECT s.id, s.event_day_id AS day_id, d.event_date, s.start_time, s.end_time
       FROM slots s JOIN event_days d ON d.id = s.event_day_id WHERE d.event_id = $1`, [req.event_id]);
  // Segments already held by acts of OTHER requests are unavailable. This request's own
  // current assignments are free to be re-proposed.
  const { rows: taken } = await pool.query(
    `SELECT sa.slot_id FROM slot_assignments sa JOIN acts a ON a.id = sa.act_id
      WHERE a.request_id <> $1 AND sa.slot_id IN (SELECT s.id FROM slots s JOIN event_days d ON d.id = s.event_day_id
                                                  WHERE d.event_id = $2)`, [request_id, req.event_id]);
  const { rows: acts } = await pool.query(
    `SELECT a.id, a.name, a.segments_requested,
            COALESCE(array_agg(p.slot_id) FILTER (WHERE p.slot_id IS NOT NULL), '{}') AS preferred_slot_ids
       FROM acts a LEFT JOIN act_preferences p ON p.act_id = a.id
      WHERE a.request_id = $1 GROUP BY a.id`, [request_id]);

  const result = suggestAllocation({
    slots,
    acts: acts.map((a) => ({ ...a, preferred_slot_ids: a.preferred_slot_ids.map(Number) })),
    takenSlotIds: taken.map((t) => Number(t.slot_id)),
  });
  return { request_id, ...result };
}

const handlers = { assign, unassign, suggest };

/**
 * BullMQ processor for the 'allocation' queue. The Worker runs with concurrency 1,
 * so assignments are applied strictly one after another.
 * Business failures are recorded on the job row (status 'failed') and NOT retried.
 */
export async function processAllocation(job) {
  const jobId = job.data.job_id;
  await pool.query("UPDATE allocation_jobs SET status = 'running', started_at = now() WHERE id = $1", [jobId]);
  try {
    const result = await handlers[job.name](job.data);
    await pool.query(
      "UPDATE allocation_jobs SET status = 'done', result = $2, finished_at = now() WHERE id = $1",
      [jobId, JSON.stringify(result)]);
    return result;
  } catch (err) {
    const message = domainMessage(err);
    if (message === null) {
      await pool.query(
        "UPDATE allocation_jobs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1",
        [jobId, `Internal error: ${err.message}`]);
      throw err;
    }
    await pool.query(
      "UPDATE allocation_jobs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1",
      [jobId, message]);
    return { failed: message };
  }
}
