export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://slotcrm:slotcrm@localhost:5432/slotcrm';
export const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

export const ALLOCATION_QUEUE = 'allocation';
export const NOTIFICATION_QUEUE = 'notifications';

export const SMTP_HOST = process.env.SMTP_HOST ?? '';
export const SMTP_PORT = Number(process.env.SMTP_PORT ?? 1025);
export const MAIL_FROM = process.env.MAIL_FROM ?? 'Event Bookings <bookings@example.org>';
