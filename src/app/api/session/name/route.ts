export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifyCookieValue, getOrCreateUser, setUserName } from '@/lib/session';

// Persist the visitor's name to Redis (the "accept / remember me" path from the splash).
// Requires the signed identity cookie (issued by middleware). Session-only visitors
// who declined never call this — their name stays client-side in sessionStorage.

export async function POST(request: NextRequest) {
  const uid = verifyCookieValue(request.cookies.get(SESSION_COOKIE)?.value);
  if (!uid) {
    return NextResponse.json({ ok: false, error: 'no session' }, { status: 400 });
  }

  let name = '';
  try {
    const body = await request.json();
    name = String(body?.name || '').trim().slice(0, 60);
  } catch {
    /* ignore */
  }
  if (!name) {
    return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 });
  }

  try {
    await getOrCreateUser(uid, new Date().toISOString());
    await setUserName(uid, name);
    return NextResponse.json({ ok: true, name });
  } catch (e: any) {
    console.error('persist name failed:', e?.message);
    return NextResponse.json({ ok: false, error: 'store failed' }, { status: 500 });
  }
}
