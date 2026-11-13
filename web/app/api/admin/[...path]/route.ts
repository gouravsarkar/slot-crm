import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

type Ctx = { params: Promise<{ path: string[] }> };
const handler = async (req: NextRequest, { params }: Ctx) => proxy(req, (await params).path, true);

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
