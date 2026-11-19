import { NextRequest, NextResponse } from 'next/server';
import { API_URL, passSetCookies, SESSION_COOKIE, sessionCookieHeader } from '@/lib/session';

/** Ends the session (FastAPI deletes it in Postgres and expires the cookie). Used by the "Log out" form. */
export async function POST(req: NextRequest) {
  // relative Location: inside Docker req.nextUrl's host is the bind address (0.0.0.0), not the public one
  const res = new NextResponse(null, { status: 303, headers: { Location: '/login' } });
  try {
    const api = await fetch(`${API_URL}/api/auth/logout`, {
      method: 'POST', headers: sessionCookieHeader(req), cache: 'no-store',
    });
    passSetCookies(api, res);
  } catch {
    res.cookies.delete(SESSION_COOKIE); // API down: still log this browser out
  }
  return res;
}
