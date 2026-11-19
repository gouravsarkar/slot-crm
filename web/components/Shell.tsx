'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { Icon, IconName } from './Icons';
import { ToastProvider } from './Toasts';

const NAV: { href: string; label: string; icon: IconName; hint: string }[] = [
  { href: '/admin/report', label: 'Home', icon: 'overview', hint: 'Live slot report' },
  { href: '/admin', label: 'Admin', icon: 'schedule', hint: 'Review and assign' },
  { href: '/admin/settings', label: 'Event settings', icon: 'settings', hint: 'Events and dates' },
  { href: '/', label: 'Request slots', icon: 'form', hint: 'Public request form' },
];

function Brand() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span /><span /><span />
    </span>
  );
}

/**
 * App frame. Logged-in admins get the sidebar workspace; groups get a light public header;
 * /login is full-bleed. `key={path}` replays the page-enter motion on every navigation.
 */
export default function Shell({ loggedIn, children }: { loggedIn: boolean; children: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!loggedIn) return;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null)).then((u) => setEmail(u?.email ?? null)).catch(() => {});
  }, [loggedIn]);

  if (path === '/login') return <ToastProvider><div className="auth-screen">{children}</div></ToastProvider>;

  // Participant portal: standalone, no login, no links into the organiser system.
  if (path === '/portal' || path.startsWith('/portal/')) {
    return (
      <ToastProvider>
        <header className="public-bar portal-bar">
          <Link href="/portal" className="brand"><Brand /><span>Performance Slots</span>
            <span className="portal-tag">Participant portal</span></Link>
          {path !== '/portal' && (
            <Link href="/portal" className="public-login"><Icon name="overview" size={16} />Portal home</Link>
          )}
        </header>
        <main className="public-main page-enter" key={path}>{children}</main>
      </ToastProvider>
    );
  }

  if (!loggedIn) {
    return (
      <ToastProvider>
        <header className="public-bar">
          <Link href="/" className="brand"><Brand /><span>Performance Slots</span></Link>
          <Link href="/login" className="public-login">Organiser login <Icon name="arrow" size={16} /></Link>
        </header>
        <main className="public-main page-enter" key={path}>{children}</main>
      </ToastProvider>
    );
  }

  const active = NAV.findIndex((n) => n.href === path);
  return (
    <ToastProvider>
      <div className={`app ${open ? 'nav-open' : ''}`}>
        <aside className="rail" aria-label="Workspace">
          <div className="rail-head">
            <Link href="/admin/report" className="brand"><Brand /><span>Performance Slots</span></Link>
          </div>
          <nav className="rail-nav" aria-label="Main">
            {active >= 0 && <span className="rail-indicator" style={{ transform: `translateY(${active * 52}px)` }} aria-hidden="true" />}
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={path === n.href ? 'page' : undefined}>
                <Icon name={n.icon} />
                <span className="rail-text"><span>{n.label}</span><small>{n.hint}</small></span>
              </Link>
            ))}
          </nav>
          <div className="rail-foot">
            <span className="avatar" aria-hidden="true">{(email ?? '?').slice(0, 1).toUpperCase()}</span>
            <span className="rail-user" title={email ?? undefined}>
              <span>{email ?? 'Signed in'}</span><small>Organiser</small>
            </span>
            <form action="/api/auth/logout" method="post">
              <button type="submit" className="icon-btn on-dark" aria-label="Log out" title="Log out">
                <Icon name="logout" />
              </button>
            </form>
          </div>
        </aside>
        <button type="button" className="scrim" aria-label="Close menu" tabIndex={open ? 0 : -1} onClick={() => setOpen(false)} />
        <div className="workspace">
          <header className="mobile-bar">
            <button type="button" className="icon-btn on-dark" aria-label="Open menu" aria-expanded={open}
                    onClick={() => setOpen(true)}><Icon name="menu" /></button>
            <Link href="/admin/report" className="brand"><Brand /><span>Performance Slots</span></Link>
          </header>
          <main className="page page-enter" key={path}>{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
