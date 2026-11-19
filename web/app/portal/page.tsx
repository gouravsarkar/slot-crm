import Link from 'next/link';
import { Icon } from '@/components/Icons';

export const metadata = { title: 'Participant portal · Performance Slots' };

/** Participant portal home: the two things a performing group can do. No login. */
export default function PortalHome() {
  return (
    <>
      <header className="hero portal-hero">
        <h1>Welcome, performers</h1>
        <p className="muted">Book stage time for your program, or check the slot you have been given.</p>
      </header>
      <div className="portal-options">
        <Link href="/portal/book" className="option">
          <span className="option-icon"><Icon name="plus" size={22} /></span>
          <span className="option-text">
            <strong>Book a slot for your program</strong>
            <span>Tell us about your group and acts, and choose the times you would prefer.</span>
          </span>
          <span className="option-go"><Icon name="arrow" /></span>
        </Link>
        <Link href="/portal/check" className="option">
          <span className="option-icon alt"><Icon name="search" size={22} /></span>
          <span className="option-text">
            <strong>Check your program&rsquo;s slot</strong>
            <span>Enter the email and phone number you booked with to see your times and status.</span>
          </span>
          <span className="option-go"><Icon name="arrow" /></span>
        </Link>
      </div>
    </>
  );
}
