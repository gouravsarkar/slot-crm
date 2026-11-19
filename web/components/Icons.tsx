// One icon family: 20px grid, 1.6 stroke, round caps. Decorative by default (aria-hidden).
const PATHS: Record<string, string> = {
  overview: 'M3.5 10.5 10 4l6.5 6.5M5.5 9v7h3.5v-4h2v4h3.5V9',
  schedule: 'M4 5.5h12v11H4zM4 8.5h12M7.5 3.5v3M12.5 3.5v3M7 11.5h2.5M7 14h5',
  form: 'M6 3.5h6l3 3v10H6zM12 3.5v3h3M8.5 10h4M8.5 13h4',
  settings: 'M10 7.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6zM10 3v2M10 15v2M3 10h2M15 10h2M5.1 5.1l1.4 1.4M13.5 13.5l1.4 1.4M5.1 14.9l1.4-1.4M13.5 6.5l1.4-1.4',
  logout: 'M8 4H5v12h3M12 7l3 3-3 3M15 10H8',
  refresh: 'M15.5 8.5A5.8 5.8 0 0 0 5 6.6M4.5 11.5A5.8 5.8 0 0 0 15 13.4M5 3.5v3.1h3.1M15 16.5v-3.1h-3.1',
  download: 'M10 4v8M6.5 8.5 10 12l3.5-3.5M4.5 15.5h11',
  check: 'M5 10.5 8.3 13.5 15 6.5',
  close: 'M5.5 5.5l9 9M14.5 5.5l-9 9',
  alert: 'M10 3.5 17 16H3zM10 8.5v3.5M10 14v.01',
  info: 'M10 3.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM10 9v4.5M10 6.6v.01',
  search: 'M9 4a5 5 0 1 1 0 10A5 5 0 0 1 9 4zM12.6 12.6 16 16',
  menu: 'M4 6h12M4 10h12M4 14h12',
  plus: 'M10 4.5v11M4.5 10h11',
  trash: 'M4.5 6h11M8 6V4.5h4V6M6 6l.7 10h6.6L14 6',
  spark: 'M10 3.5v3M10 13.5v3M3.5 10h3M13.5 10h3M5.6 5.6l2 2M12.4 12.4l2 2M5.6 14.4l2-2M12.4 7.6l2-2',
  user: 'M10 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM4.5 16.5c.8-2.6 2.9-4 5.5-4s4.7 1.4 5.5 4',
  clock: 'M10 3.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM10 6.5V10l2.5 1.8',
  arrow: 'M4.5 10h11M11.5 6l4 4-4 4',
  stage: 'M3.5 15.5h13M5 15.5V9l5-4 5 4v6.5M8.5 15.5v-3.5h3v3.5',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className, label }: {
  name: IconName; size?: number; className?: string; label?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6}
         strokeLinecap="round" strokeLinejoin="round" className={`icon ${className ?? ''}`}
         role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={PATHS[name]} />
    </svg>
  );
}
