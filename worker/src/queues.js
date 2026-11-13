import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { NOTIFICATION_QUEUE, REDIS_URL } from './config.js';

export const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
export const notificationQueue = new Queue(NOTIFICATION_QUEUE, { connection });
