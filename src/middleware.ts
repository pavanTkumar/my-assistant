import { NextRequest, NextResponse } from 'next/server';

// Edge-runtime middleware: ensure every visitor carries a signed identity cookie.
// Cookies can't be reliably set during a Server Component render, so we issue it
// here (before the page renders). Signing uses Web Crypto (available at the edge)
// and must match the HMAC-SHA256 scheme in src/lib/session.ts.

const SESSION_COOKIE = 'myai_uid';
const SECRET = process.env.ENCRYPTION_KEY || 'dev-only-insecure-secret-change-me';

async function sign(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  // base64url, matching Node's digest('base64url')
  return Buffer.from(new Uint8Array(sig))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function verify(raw: string | undefined): Promise<boolean> {
  if (!raw) return false;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return false;
  const uuid = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  return (await sign(uuid)) === sig;
}

export async function middleware(request: NextRequest) {
  const existing = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verify(existing)) {
    return NextResponse.next();
  }

  // Mint a new signed cookie.
  const uuid = crypto.randomUUID();
  const value = `${uuid}.${await sign(uuid)}`;

  const res = NextResponse.next();
  res.cookies.set(SESSION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}

// Run on the landing page and the chat API (where identity matters). Skip static assets.
export const config = {
  matcher: ['/', '/api/chat'],
};
