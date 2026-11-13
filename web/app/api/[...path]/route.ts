import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

// Public endpoints only (events, slots, create request). /api/admin/* is handled by the
// more specific admin route, which sits behind Basic auth.
type Ctx = { params: Promise<{ path: string[] }> };
const handler = async (req: NextRequest, { params }: Ctx) => proxy(req, (await params).path, false);

export const GET = handler;
export const POST = handler;
