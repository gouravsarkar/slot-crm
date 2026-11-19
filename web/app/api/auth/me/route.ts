import { NextRequest, NextResponse } from 'next/server';
import { API_URL, sessionCookieHeader } from '@/lib/session';

/** Who is logged in (for the sidebar). Passes the session cookie to FastAPI. */
export async function GET(req: NextRequest) {
  try {
    const res = await fetch(`${API_URL}/api/auth/me`, { headers: sessionCookieHeader(req), cache: 'no-store' });
    return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
  } catch {
    return NextResponse.json({ detail: 'Login service unavailable' }, { status: 503 });
  }
}
