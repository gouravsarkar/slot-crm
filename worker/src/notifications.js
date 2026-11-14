import nodemailer from 'nodemailer';
import { MAIL_FROM, SMTP_HOST, SMTP_PASSWORD, SMTP_PORT, SMTP_SECURE, SMTP_USER } from './config.js';
import { pool } from './db.js';

/** Nodemailer options for the three modes: no SMTP (log only), real provider, local Mailpit. */
export function transportOptions({ host, port, secure, user, password }) {
  if (!host) return { jsonTransport: true }; // no SMTP configured: log instead of send
  if (user) {
    // real provider: login + encryption (implicit TLS on 465, STARTTLS required otherwise)
    return { host, port, secure, requireTLS: !secure, auth: { user, pass: password } };
  }
  return { host, port, secure: false, ignoreTLS: true }; // local dev catcher (Mailpit)
}

const transport = nodemailer.createTransport(
  transportOptions({ host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE, user: SMTP_USER, password: SMTP_PASSWORD }));

/** Logs once at startup whether the mail settings work, so mistakes show up immediately. */
export async function verifyMail() {
  if (!SMTP_HOST) return console.log('[mail] SMTP_HOST not set: emails are logged, not sent');
  const mode = SMTP_USER ? `real SMTP as ${SMTP_USER}` : 'local catcher (no login)';
  try {
    await transport.verify();
    console.log(`[mail] connected to ${SMTP_HOST}:${SMTP_PORT} (${mode})`);
  } catch (err) {
    console.error(`[mail] CANNOT use ${SMTP_HOST}:${SMTP_PORT} (${mode}): ${err.message}`);
  }
}

const fmtDate = (d) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  });
const hhmm = (t) => t.slice(0, 5);

async function loadRequest(requestId) {
  const { rows: [req] } = await pool.query(
    `SELECT r.id, r.payment_status, r.admin_notes, g.name AS group_name, g.contact_name, g.email,
            e.name AS event_name
       FROM slot_requests r JOIN groups g ON g.id = r.group_id JOIN events e ON e.id = r.event_id
      WHERE r.id = $1`, [requestId]);
  if (!req) return null;
  const { rows: acts } = await pool.query(
    `SELECT a.id, a.name, a.segments_requested,
            min(d.event_date) AS event_date, min(s.start_time) AS start_time, max(s.end_time) AS end_time,
            count(sa.slot_id)::int AS assigned
       FROM acts a
       LEFT JOIN slot_assignments sa ON sa.act_id = a.id
       LEFT JOIN slots s ON s.id = sa.slot_id
       LEFT JOIN event_days d ON d.id = s.event_day_id
      WHERE a.request_id = $1 GROUP BY a.id ORDER BY a.id`, [requestId]);
  return { req, acts };
}

function scheduleLines(acts) {
  return acts.map((a) =>
    a.assigned > 0
      ? `  - ${a.name}: ${fmtDate(a.event_date)}, ${hhmm(a.start_time)}-${hhmm(a.end_time)}`
      : `  - ${a.name}: not yet scheduled`);
}

const templates = {
  request_received: ({ req, acts }) => ({
    subject: `We received your slot request (${req.event_name})`,
    text: [
      `Hello ${req.contact_name},`, '',
      `Thanks for requesting performance slots for ${req.group_name}. Our team will review your preferences and confirm times.`,
      '', 'Acts requested:',
      ...acts.map((a) => `  - ${a.name} (${a.segments_requested} x 10 min)`), '',
      'You will receive another email when your slots are confirmed.',
    ].join('\n'),
  }),
  assigned: ({ req, acts }) => ({
    subject: `Your performance slots are confirmed (${req.event_name})`,
    text: [
      `Hello ${req.contact_name},`, '',
      `Here is the confirmed schedule for ${req.group_name}:`, '', ...scheduleLines(acts), '',
      `Payment status: ${req.payment_status}`,
      req.admin_notes ? `\nNotes from the organisers: ${req.admin_notes}` : '',
    ].join('\n'),
  }),
  unassigned: ({ req, acts }) => ({
    subject: `Update to your performance slots (${req.event_name})`,
    text: [
      `Hello ${req.contact_name},`, '',
      `The schedule for ${req.group_name} is being changed. Current status:`, '', ...scheduleLines(acts), '',
      'We will confirm new times shortly.',
    ].join('\n'),
  }),
  declined: ({ req }) => ({
    subject: `About your slot request (${req.event_name})`,
    text: [
      `Hello ${req.contact_name},`, '',
      `Unfortunately we are unable to offer slots to ${req.group_name} for ${req.event_name}.`,
      req.admin_notes ? `\n${req.admin_notes}` : '',
    ].join('\n'),
  }),
};

export async function processNotification(job) {
  const template = templates[job.name];
  if (!template) throw new Error(`Unknown notification kind: ${job.name}`);
  const data = await loadRequest(job.data.request_id);
  if (!data) return { skipped: 'request not found' };
  const mail = template(data);
  const info = await transport.sendMail({ from: MAIL_FROM, to: data.req.email, ...mail });
  console.log(`[notify] ${job.name} -> ${data.req.email}${SMTP_HOST ? '' : ' (not sent: SMTP_HOST unset)'}`);
  return { messageId: info.messageId ?? null };
}
