import { Worker } from 'bullmq';
import { processAllocation } from './allocation.js';
import { ALLOCATION_QUEUE, NOTIFICATION_QUEUE } from './config.js';
import { pool } from './db.js';
import { processNotification, verifyMail } from './notifications.js';
import { connection } from './queues.js';

// concurrency 1 = assignments are applied strictly one at a time
const allocation = new Worker(ALLOCATION_QUEUE, processAllocation, { connection, concurrency: 1 });
const notifications = new Worker(NOTIFICATION_QUEUE, processNotification, { connection, concurrency: 5 });

for (const w of [allocation, notifications]) {
  w.on('failed', (job, err) => console.error(`[${w.name}] job ${job?.id} (${job?.name}) failed:`, err.message));
  w.on('error', (err) => console.error(`[${w.name}] worker error:`, err.message));
}
console.log('Workers running: allocation (concurrency 1), notifications (concurrency 5)');
verifyMail();

async function shutdown() {
  await Promise.all([allocation.close(), notifications.close()]);
  await pool.end();
  connection.disconnect();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
