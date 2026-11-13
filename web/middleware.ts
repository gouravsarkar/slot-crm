import { NextRequest, NextResponse } from 'next/server';

// HTTP Basic auth in front of the admin UI and the admin API proxy.
export function middleware(req: NextRequest) {
  const user = process.env.ADMIN_USER ?? 'admin';
  const pass = process.env.ADMIN_PASSWORD ?? 'change-me';
  const header = req.headers.get('authorization') ?? '';
  if (header.startsWith('Basic ')) {
    const [u, ...rest] = atob(header.slice(6)).split(':');
    if (u === user && rest.join(':') === pass) return NextResponse.next();
  }
  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Slot CRM admin"' },
  });
}

export const config = { matcher: ['/admin/:path*', '/api/admin/:path*'] };
