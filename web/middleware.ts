import { NextRequest, NextResponse } from 'next/server';
import { API_URL, SESSION_COOKIE, sessionCookieHeader } from '@/lib/session';

// Admin pages need a valid session cookie; it is checked against the API (Postgres).
// The /api/admin/* proxy is not listed here: FastAPI checks the session on every admin call.
export async function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, { headers: sessionCookieHeader(req), cache: 'no-store' });
      if (res.ok) return NextResponse.next();
      if (res.status !== 401) return new NextResponse('Login service error', { status: 503 });
    } catch {
      return new NextResponse('Login service unavailable', { status: 503 });
    }
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  const res = NextResponse.redirect(url);
  if (token) res.cookies.delete(SESSION_COOKIE); // expired or revoked
  return res;
}

export const config = { matcher: ['/admin/:path*'] };
