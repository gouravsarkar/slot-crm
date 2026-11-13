import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Performance slot booking',
  description: 'Request and manage performance slots',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <strong>Performance Slots</strong>
          <nav>
            <Link href="/admin/report">Home</Link>
            <Link href="/">Request slots</Link>
            <Link href="/admin">Admin</Link>
            <Link href="/admin/settings">Event settings</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
