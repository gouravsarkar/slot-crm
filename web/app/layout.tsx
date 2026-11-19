import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans } from 'next/font/google';
import { cookies } from 'next/headers';
import Shell from '@/components/Shell';
import { SESSION_COOKIE } from '@/lib/session';
import './globals.css';

// Self-hosted at build time by next/font: no request to Google from the browser.
const plex = IBM_Plex_Sans({
  subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans', display: 'swap',
});

export const metadata: Metadata = {
  title: 'Performance Slots',
  description: 'Request and manage performance slots',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0b1424' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const loggedIn = (await cookies()).has(SESSION_COOKIE);
  return (
    <html lang="en" className={plex.variable}>
      <body>
        <Shell loggedIn={loggedIn}>{children}</Shell>
      </body>
    </html>
  );
}
