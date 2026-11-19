'use client';
import { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Icon } from './Icons';

export type ToastKind = 'ok' | 'err' | 'info' | 'progress';
export type ToastInput = { kind: ToastKind; title: string; body?: string };
type Toast = ToastInput & { id: number; leaving?: boolean };

type Api = {
  push: (t: ToastInput) => number;
  update: (id: number, t: ToastInput) => void;
  dismiss: (id: number) => void;
};

const Ctx = createContext<Api | null>(null);
const LIFETIME: Record<ToastKind, number | null> = { ok: 4000, info: 5000, err: 9000, progress: null };
const ICON = { ok: 'check', err: 'alert', info: 'info', progress: 'clock' } as const;

/** Bottom-right notification stack. Progress toasts stay until updated to ok/err (used for queued jobs). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    setToasts((all) => all.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), 200);
  }, []);

  const schedule = useCallback((id: number, kind: ToastKind) => {
    clearTimeout(timers.current.get(id));
    const ms = LIFETIME[kind];
    if (ms) timers.current.set(id, setTimeout(() => dismiss(id), ms));
  }, [dismiss]);

  const push = useCallback((t: ToastInput) => {
    const id = ++seq.current;
    setToasts((all) => [...all.slice(-3), { ...t, id }]);
    schedule(id, t.kind);
    return id;
  }, [schedule]);

  const update = useCallback((id: number, t: ToastInput) => {
    setToasts((all) => all.map((x) => (x.id === id ? { ...t, id } : x)));
    schedule(id, t.kind);
  }, [schedule]);

  const api = useMemo(() => ({ push, update, dismiss }), [push, update, dismiss]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind} ${t.leaving ? 'leaving' : ''}`} role={t.kind === 'err' ? 'alert' : 'status'}>
            <span className="toast-icon"><Icon name={ICON[t.kind]} size={16} /></span>
            <div className="toast-text">
              <strong>{t.title}</strong>
              {t.body && <span>{t.body}</span>}
            </div>
            <button type="button" className="icon-btn" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
              <Icon name="close" size={14} />
            </button>
            {t.kind === 'progress' && <span className="toast-progress" aria-hidden="true" />}
            {LIFETIME[t.kind] && !t.leaving && (
              <span className="toast-timer" aria-hidden="true" style={{ animationDuration: `${LIFETIME[t.kind]}ms` }} />
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): Api {
  const api = useContext(Ctx);
  if (!api) throw new Error('useToast outside ToastProvider');
  return api;
}
