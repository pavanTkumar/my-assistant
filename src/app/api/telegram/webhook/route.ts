export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getRedis } from '@/lib/session';
import { sendTelegramMessage } from '@/lib/telegram';
import { logActivity } from '@/lib/activityLog';

// Inbound Telegram webhook: receives Pavan's day-log replies and stores them in Pinecone.
//
// SECURITY (both checks required):
//  1. The `X-Telegram-Bot-Api-Secret-Token` header must equal TELEGRAM_WEBHOOK_SECRET
//     (set when registering the webhook). Rejects anyone hitting the URL directly.
//  2. The message chat.id must equal TELEGRAM_CHAT_ID (the owner). Rejects anyone else
//     who somehow reaches the bot — without this, a stranger could poison the KB.
//
// Idempotency: dedupe on Telegram update_id (retries reuse the same id).

export async function POST(request: NextRequest) {
  // --- Guard 1: shared secret header ---
  const secret = request.headers.get('x-telegram-bot-api-secret-token');
  if (!process.env.TELEGRAM_WEBHOOK_SECRET || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return new NextResponse('forbidden', { status: 403 });
  }

  let update: any;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ ok: true }); // ack malformed bodies so Telegram stops retrying
  }

  const message = update?.message ?? update?.edited_message;
  const chatId = message?.chat?.id;
  const text: string = message?.text || '';
  const updateId = update?.update_id;

  // --- Guard 2: owner-only chat ---
  if (!chatId || String(chatId) !== String(process.env.TELEGRAM_CHAT_ID)) {
    // Not the owner — silently ack (do NOT process). 200 so Telegram won't retry.
    return NextResponse.json({ ok: true });
  }

  // Nothing to log (e.g. a sticker, a command) — ack and move on.
  if (!text.trim()) {
    return NextResponse.json({ ok: true });
  }

  // Ignore bot commands like /start.
  if (text.trim().startsWith('/')) {
    return NextResponse.json({ ok: true });
  }

  // --- Idempotency: dedupe on update_id (Telegram retries reuse it) ---
  try {
    if (updateId != null) {
      const redis = getRedis();
      // SET NX with a TTL; if it already existed, this update was handled.
      const set = await redis.set(`tg:update:${updateId}`, '1', { nx: true, ex: 60 * 60 * 24 });
      if (set === null) {
        return NextResponse.json({ ok: true }); // already processed
      }
    }
  } catch (e: any) {
    console.error('dedupe check failed (continuing):', e?.message);
  }

  // --- Structure + embed + upsert, then confirm back to Pavan ---
  try {
    const entry = await logActivity(text);
    await sendTelegramMessage(
      `✅ *Logged* (${entry.category})\n${entry.summary}${
        entry.entities.length ? `\n_${entry.entities.join(', ')}_` : ''
      }`
    ).catch((e) => console.error('confirm message failed:', e?.message));
  } catch (e: any) {
    console.error('logActivity failed:', e?.message);
    await sendTelegramMessage("⚠️ Couldn't log that just now — try again in a moment.").catch(() => {});
  }

  // Always 200 so Telegram considers the update delivered.
  return NextResponse.json({ ok: true });
}
