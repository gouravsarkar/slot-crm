import pg from 'pg';
import { DATABASE_URL } from './config.js';

// Return DATE columns as 'YYYY-MM-DD' strings instead of JS Dates (no timezone surprises).
pg.types.setTypeParser(1082, (v) => v);
// bigint (ids, counts) come back as strings by default; our ids are far below 2^53.
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10));

export const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    // The back-to-back / segment-count rules are DEFERRED triggers: they fire here.
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
