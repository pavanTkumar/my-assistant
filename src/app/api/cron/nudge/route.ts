export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { sendTelegramMessage } from '@/lib/telegram';

// Daily nudge: Vercel Cron hits this to prompt Pavan to log his day.
// Guarded by CRON_SECRET so only Vercel Cron (which sends it as a Bearer token)
// can trigger it. NOTE: Vercel Cron runs in UTC — schedule accordingly in vercel.json.

const NUDGE =
  "👋 *Daily check-in* — what did you get up to today? " +
  "Reply here in a sentence or two (work, learning, projects, life) and I'll keep your assistant's memory up to date.";

async function handle(request: NextRequest) {
  const auth = request.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return new NextResponse('forbidden', { status: 403 });
  }

  try {
    await sendTelegramMessage(NUDGE);
    return NextResponse.json({ ok: true, sent: true });
  } catch (e: any) {
    console.error('nudge failed:', e?.message);
    return NextResponse.json({ ok: false, error: 'send failed' }, { status: 500 });
  }
}

// Vercel Cron issues GET requests; support POST too for manual testing.
export const GET = handle;
export const POST = handle;
