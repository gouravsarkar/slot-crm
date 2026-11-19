import type { NextRequest } from 'next/server';

// Shared by middleware (edge) and route handlers: keep this file free of Node-only imports.
export const API_URL = process.env.API_URL ?? 'http://localhost:8000';

/**
 * httpOnly session cookie. FastAPI sets it on login, reads it on every admin call and expires it
 * on logout; Next.js only passes it through. Must match SESSION_COOKIE in api/app/config.py.
 */
export const SESSION_COOKIE = 'slotcrm_session';

/** `Cookie` header carrying only the session cookie (other site cookies are not sent to the API). */
export function sessionCookieHeader(req: NextRequest): Record<string, string> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return token ? { cookie: `${SESSION_COOKIE}=${token}` } : {};
}

/** Copies the API's Set-Cookie headers (login / logout) onto the response sent to the browser. */
export function passSetCookies(from: Response, to: Response): void {
  for (const c of from.headers.getSetCookie()) to.headers.append('set-cookie', c);
}

/** Only allow redirects back into this site (blocks `//evil.com` and `https://...`). */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/admin/report';
}
