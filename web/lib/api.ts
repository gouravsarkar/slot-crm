export type EventSummary = { id: number; name: string; venue: string | null; slot_minutes: number };
export type Day = { id: number; event_date: string; label: string | null };
export type Band = { id: number; code: string; label: string; start_time: string; end_time: string };
export type EventDetail = EventSummary & { days: Day[]; bands: Band[] };

export type PublicSlot = {
  id: number; day_id: number; event_date: string; band: string;
  start_time: string; end_time: string; taken: boolean;
};

export type Job = {
  id: string; kind: string; status: 'queued' | 'running' | 'done' | 'failed';
  result: any; error: string | null;
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body);
    } catch { /* keep statusText */ }
    throw new Error(message);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const post = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const patch = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

/** Wait for a worker job to finish (the allocation queue runs them one at a time). */
export async function pollJob(id: string): Promise<Job> {
  for (let i = 0; i < 75; i++) {
    const job = await api<Job>(`/api/admin/jobs/${id}`);
    if (job.status === 'done' || job.status === 'failed') return job;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('Timed out waiting for the worker');
}

export const hhmm = (t: string) => t.slice(0, 5);

export function addMinutes(t: string, mins: number): string {
  const [h, m] = t.split(':').map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export const fmtDay = (d: Day) => `${d.label ?? ''} ${d.event_date}`.trim();
