import { NextRequest, NextResponse } from 'next/server';
import { API_URL, passSetCookies } from '@/lib/session';

/** Checks the email/password with FastAPI; FastAPI's Set-Cookie (the session) is passed to the browser. */
export async function POST(req: NextRequest) {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: await req.text(),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ detail: 'Login service unavailable' }, { status: 503 });
  }
  const out = NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
  passSetCookies(res, out);
  return out;
}
