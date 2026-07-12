// Register (or clear) the Telegram webhook so inbound day-log messages reach the app.
//
// Usage:
//   node scripts/set-telegram-webhook.mjs set     # register the webhook
//   node scripts/set-telegram-webhook.mjs info    # show current webhook status
//   node scripts/set-telegram-webhook.mjs delete   # remove the webhook
//
// Requires in .env.local:
//   TELEGRAM_BOT_TOKEN       — the bot token
//   TELEGRAM_WEBHOOK_SECRET  — a random string; sent back as X-Telegram-Bot-Api-Secret-Token
//   NEXT_PUBLIC_APP_URL      — your deployed https origin, e.g. https://myai.thetejavath.com

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const base = process.env.NEXT_PUBLIC_APP_URL;

if (!token) { console.error('Missing TELEGRAM_BOT_TOKEN'); process.exit(1); }

const cmd = process.argv[2] || 'info';
const api = (method) => `https://api.telegram.org/bot${token}/${method}`;

async function main() {
  if (cmd === 'set') {
    if (!secret || !base) {
      console.error('set requires TELEGRAM_WEBHOOK_SECRET and NEXT_PUBLIC_APP_URL');
      process.exit(1);
    }
    const url = `${base.replace(/\/$/, '')}/api/telegram/webhook`;
    const res = await fetch(api('setWebhook'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        secret_token: secret,
        allowed_updates: ['message', 'edited_message'],
      }),
    });
    console.log('setWebhook →', url);
    console.log(await res.json());
  } else if (cmd === 'delete') {
    const res = await fetch(api('deleteWebhook'), { method: 'POST' });
    console.log('deleteWebhook →', await res.json());
  } else {
    const res = await fetch(api('getWebhookInfo'));
    console.log('getWebhookInfo →', await res.json());
  }
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
