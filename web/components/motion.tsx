'use client';
import { useEffect, useRef, useState } from 'react';

const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Animates a number from its previous value to `value` (ease-out). Instant under reduced motion. */
export function useCountUp(value: number, duration = 700): number {
  const [shown, setShown] = useState(0); // same on server and client (no hydration mismatch)
  const from = useRef(0);
  useEffect(() => {
    if (reduced()) { setShown(value); from.current = value; return; }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(a + (value - a) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return shown;
}

export function CountUp({ value }: { value: number }) {
  return <>{useCountUp(value)}</>;
}

/** Width that starts at 0 and transitions to `pct` after mount, so bars visibly fill. */
export function Fill({ pct, className, style }: { pct: number; className?: string; style?: React.CSSProperties }) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setW(Math.max(0, Math.min(100, pct))));
    return () => cancelAnimationFrame(id);
  }, [pct]);
  return <span className={`fill ${className ?? ''}`} style={{ ...style, width: `${w}%` }} />;
}

export function Skeleton({ h = 16, w = '100%', r }: { h?: number; w?: number | string; r?: number }) {
  return <span className="skeleton" style={{ height: h, width: w, borderRadius: r }} aria-hidden="true" />;
}
