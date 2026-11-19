'use client';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { Icon } from '@/components/Icons';
import { hhmm, plural, statusLabel } from '@/lib/api';

type Act = {
  id: number; name: string; segments_requested: number; notes: string | null; segments_assigned: number;
  event_date: string | null; day_label: string | null; start_time: string | null; end_time: string | null;
  bands: string[]; preferences: number;
};
type Booking = {
  id: number; status: string; payment_status: string; submitted_at: string; group_notes: string | null;
  group_name: string; contact_name: string; email: string; phone: string | null;
  event_name: string; venue: string | null; slot_minutes: number; acts: Act[];
};

const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const fmtStamp = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

const STATUS_HELP: Record<string, string> = {
  submitted: 'Received. The organisers have not reviewed it yet.',
  under_review: 'The organisers are working on your times.',
  assigned: 'Your times are confirmed.',
  declined: 'The organisers could not offer slots for this request.',
  cancelled: 'This request was cancelled.',
};

/** Participant lookup by email + phone. Both go in the POST body, never the URL. */
export default function PortalCheck() {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [bookings, setBookings] = useState<Booking[] | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/portal/lookup', {
        method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ email, phone }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.detail === 'string' ? body.detail : 'Something went wrong. Please try again.');
        return;
      }
      setBookings(body.requests);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally { setBusy(false); }
  }

  if (bookings) {
    return (
      <>
        <header className="hero">
          <h1>Your bookings</h1>
          <p className="muted">{plural(bookings.length, 'request')} for {bookings[0].email}</p>
        </header>
        {bookings.map((b, i) => <BookingCard key={b.id} b={b} delay={i * 60} />)}
        <div className="actions" style={{ marginTop: 'var(--s4)' }}>
          <button type="button" onClick={() => { setBookings(null); setPhone(''); }}>
            <Icon name="search" size={16} />Check another booking</button>
          <Link href="/portal/book" className="button"><Icon name="plus" size={16} />Book another slot</Link>
        </div>
      </>
    );
  }

  return (
    <div className="lookup">
      <header className="hero">
        <h1>Check your program&rsquo;s slot</h1>
        <p className="muted">Enter the email address and phone number you used when booking.</p>
      </header>
      <form className="card" onSubmit={submit}>
        <div className="card-body stack-4">
          {error && <div className="inline-alert err" role="alert"><Icon name="alert" size={16} />{error}</div>}
          <div className="field">
            <label htmlFor="lk-email">Email</label>
            <input id="lk-email" type="email" required autoComplete="email" autoFocus
                   value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="lk-phone">Phone number</label>
            <input id="lk-phone" type="tel" required minLength={7} autoComplete="tel" inputMode="tel"
                   value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <button type="submit" className="primary lg block" disabled={busy} aria-busy={busy}>
            {busy ? <><Icon name="refresh" size={16} />Looking up…</> : <>Show my booking<Icon name="arrow" size={16} /></>}
          </button>
        </div>
      </form>
      <p className="muted" style={{ fontSize: 'var(--text-sm)', textAlign: 'center' }}>
        Not booked yet? <Link href="/portal/book">Book a slot for your program</Link>
      </p>
    </div>
  );
}

function BookingCard({ b, delay }: { b: Booking; delay: number }) {
  return (
    <section className="card booking" aria-labelledby={`bk-${b.id}`} style={{ animationDelay: `${delay}ms` }}>
      <div className="card-head">
        <div>
          <h2 id={`bk-${b.id}`}>{b.event_name}</h2>
          <p>{b.venue ? `${b.venue} · ` : ''}Request #{b.id} · sent {fmtStamp(b.submitted_at)}</p>
        </div>
        <div className="actions">
          <span className={`badge ${b.status}`}>{statusLabel(b.status)}</span>
          <span className={`badge ${b.payment_status}`}>Payment {b.payment_status}</span>
        </div>
      </div>
      <div className="card-body">
        <p className={`status-line ${b.status}`}><Icon name={b.status === 'assigned' ? 'check' : 'info'} size={16} />{STATUS_HELP[b.status] ?? ''}</p>
        <dl className="booking-who">
          <div><dt>Group</dt><dd>{b.group_name}</dd></div>
          <div><dt>Contact</dt><dd>{b.contact_name}</dd></div>
          <div><dt>Phone</dt><dd>{b.phone ?? '—'}</dd></div>
        </dl>
        {b.group_notes && <p className="quote" style={{ margin: '0 0 var(--s4)' }}>“{b.group_notes}”</p>}
        <ul className="booking-acts">
          {b.acts.map((a) => {
            const placed = a.segments_assigned > 0 && a.event_date && a.start_time && a.end_time;
            return (
              <li key={a.id} className={placed ? 'placed' : ''}>
                <div className="ba-main">
                  <strong>{a.name}</strong>
                  <span className="muted">{plural(a.segments_requested, 'segment')} · {a.segments_requested * b.slot_minutes} min
                    {a.notes ? ` · ${a.notes}` : ''}</span>
                </div>
                {placed ? (
                  <div className="ba-slot">
                    <span className="ba-time num">{hhmm(a.start_time!)}–{hhmm(a.end_time!)}</span>
                    <span>{fmtDate(a.event_date!)}</span>
                    {a.bands.map((x) => <span key={x} className={`badge plain band-${x}`}>{x}</span>)}
                  </div>
                ) : (
                  <div className="ba-slot pending">
                    <Icon name="clock" size={16} />
                    {b.status === 'declined' || b.status === 'cancelled' ? 'No slot' : 'Not scheduled yet'}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
