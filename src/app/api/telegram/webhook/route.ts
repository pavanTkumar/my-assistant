export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getRedis } from '@/lib/session';
import { sendTelegramMessage } from '@/lib/telegram';
import { handleKbMessage } from '@/lib/kbManager';
import { env } from '@/lib/env';

// Inbound Telegram webhook: Pavan messages the bot to manage his knowledge base.
// Messages are routed by intent (add / log / update / delete / query) — see kbManager.
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
  const expectedSecret = env('TELEGRAM_WEBHOOK_SECRET');
  if (!expectedSecret || secret !== expectedSecret) {
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
  if (!chatId || String(chatId) !== env('TELEGRAM_CHAT_ID')) {
    // Not the owner — silently ack (do NOT process). 200 so Telegram won't retry.
    return NextResponse.json({ ok: true });
  }

  // Nothing to log (e.g. a sticker, a command) — ack and move on.
  if (!text.trim()) {
    return NextResponse.json({ ok: true });
  }

  // Bot commands: answer /start and /help with a usage hint; ignore the rest.
  if (text.trim().startsWith('/')) {
    const cmd = text.trim().split(/\s+/)[0].toLowerCase();
    if (cmd === '/start' || cmd === '/help') {
      await sendTelegramMessage(
        [
          '👋 *Your knowledge-base assistant.* Just message me naturally:',
          '',
          '• *Add a fact:* "I joined Acme as an AI Engineer"',
          '• *Log your day:* "spent today debugging the RAG pipeline"',
          '• *Update:* "update my role to Senior AI Engineer"',
          '• *Delete:* "remove the part about my old job"',
          '• *Check recall:* "what do you know about my job?"',
          '',
          'For updates and deletes I\'ll show you the match and wait for a *yes* before changing anything.',
        ].join('\n')
      ).catch((e) => console.error('help message failed:', e?.message));
    }
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

  // --- Route by intent (add / log / update / delete / query), reply to Pavan ---
  try {
    const reply = await handleKbMessage(text);
    await sendTelegramMessage(reply).catch((e) => console.error('reply failed:', e?.message));
  } catch (e: any) {
    console.error('handleKbMessage failed:', e?.message);
    await sendTelegramMessage("⚠️ Couldn't process that just now — try again in a moment.").catch(() => {});
  }

  // Always 200 so Telegram considers the update delivered.
  return NextResponse.json({ ok: true });
}
