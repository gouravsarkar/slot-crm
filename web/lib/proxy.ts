import { NextRequest, NextResponse } from 'next/server';
import { API_URL, sessionCookieHeader } from './session';

/** Forwards a request to FastAPI. Admin calls pass the session cookie through; public calls send no cookies. */
export async function proxy(req: NextRequest, path: string[], admin: boolean) {
  const url = `${API_URL}/api/${admin ? 'admin/' : ''}${path.join('/')}${req.nextUrl.search}`;
  const headers = new Headers({ 'content-type': req.headers.get('content-type') ?? 'application/json' });
  if (admin) {
    for (const [k, v] of Object.entries(sessionCookieHeader(req))) headers.set(k, v);
  }
  const hasBody = !['GET', 'HEAD', 'DELETE'].includes(req.method);
  const res = await fetch(url, {
    method: req.method,
    headers,
    body: hasBody ? await req.text() : undefined,
    cache: 'no-store',
  });
  return new NextResponse(res.status === 204 ? null : await res.text(), {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
  });
}
