// Telegram Bot notifications — free, instant, no package needed

export async function sendTelegramMessage(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn('Telegram not configured: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing');
    return;
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram error: ${err}`);
  }
}

export function formatBookingNotification(
  name: string,
  email: string,
  date: string,
  time: string
): string {
  return `📅 *New Meeting Booked*\n\n*Name:* ${name}\n*Email:* ${email}\n*Date:* ${date}\n*Time:* ${time} IST\n\n_Via Pavan's Virtual Assistant_`;
}

export function formatContactNotification(
  name: string,
  email: string,
  message: string
): string {
  return `📨 *New Message*\n\n*From:* ${name}\n*Email:* ${email}\n*Message:* ${message}\n\n_Via Pavan's Virtual Assistant_`;
}
