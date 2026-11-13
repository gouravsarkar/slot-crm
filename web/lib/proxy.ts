import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:8000';

/** Forwards a request to FastAPI. Admin calls get the secret token added server-side. */
export async function proxy(req: NextRequest, path: string[], admin: boolean) {
  const url = `${API_URL}/api/${admin ? 'admin/' : ''}${path.join('/')}${req.nextUrl.search}`;
  const headers = new Headers({ 'content-type': req.headers.get('content-type') ?? 'application/json' });
  if (admin) headers.set('x-admin-token', process.env.ADMIN_TOKEN ?? '');
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
