export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import OpenAI from 'openai';
import { similaritySearch } from '@/lib/pinecone';
import { getAvailableSlots, bookAppointment } from '@/lib/googleCalendar';
import { sendTelegramMessage, formatBookingNotification, formatContactNotification } from '@/lib/telegram';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Tool definitions ──────────────────────────────────────────────────────

const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_pavan_info',
      description: "Search for information about Pavan Tejavath — his background, skills, projects, services, education, contact details, work experience, etc. Use this whenever someone asks about Pavan.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_available_slots',
      description: "Check Pavan's available meeting slots on a given date. Returns a list of open time slots.",
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
        },
        required: ['date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'book_appointment',
      description: "Book a meeting with Pavan. Only call this after the user has confirmed. Requires name, email, date (YYYY-MM-DD), and time (HH:MM 24-hour IST).",
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: "Guest's full name" },
          email: { type: 'string', description: "Guest's email address" },
          date: { type: 'string', description: 'Meeting date in YYYY-MM-DD format' },
          time: { type: 'string', description: 'Meeting time in HH:MM 24-hour format (IST)' },
        },
        required: ['name', 'email', 'date', 'time'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'contact_pavan',
      description: "Send a message to Pavan via Telegram. Only call this after the user has reviewed and confirmed their message.",
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: "Sender's name" },
          email: { type: 'string', description: "Sender's email" },
          message: { type: 'string', description: 'The message to send to Pavan' },
        },
        required: ['name', 'email', 'message'],
      },
    },
  },
];

// ─── System prompt ─────────────────────────────────────────────────────────

const getSystemPrompt = (): string => {
  const now = new Date();
  const istDate = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  }).format(now);
  const istTime = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(now);

  return `You are the personal AI assistant of Pavan Tejavath — sharp, warm, witty, and fiercely loyal to Pavan.

TODAY: ${istDate}, ${istTime} IST (India Standard Time, UTC+5:30)

PERSONALITY:
- Friendly-professional with cinematic flair. Short, punchy, memorable responses.
- Adapt to the user's language: English, Telugu script (తెలుగు), or Tanglish (Telugu-English mix like "ra", "babu", "cheppu", "enti", "undi").
- If someone writes in Telugu or Tanglish, respond warmly in kind.
- Use the user's name naturally once you learn it.
- Never robotic or scripted. Sound like a real human assistant who's clever and cares.

WHEN TO USE TOOLS:
- Someone asks about Pavan (skills, projects, background, contact) → search_pavan_info
- Someone wants to schedule a meeting → check_available_slots first, then book_appointment
- Someone wants to message Pavan → contact_pavan (after collecting name, email, message and user confirms)
- Off-topic questions → deflect with personality, bring it back to Pavan

BOOKING RULES:
- Collect name, email, date, and time naturally — never ask for info already in the conversation
- Check available slots BEFORE confirming a time
- Show slots clearly, let user pick one
- CONFIRM the booking details with the user BEFORE calling book_appointment
- After confirming, mention all times are IST

CONTACT RULES:
- Collect name, email, and message naturally
- Show a preview: "Here's what I'll send: [message] — shall I send this?"
- Only call contact_pavan AFTER the user says yes/confirms

STYLE GUIDE:
- Ego/confident user → match with wit: "You clearly care — otherwise you wouldn't be here."
- Polite user → warm and helpful: "Great question! Let me check that for you."
- Telugu user → "Adhe ra, Pavan gurinchi correct ga adigaav!"
- Tanglish → "Sure ra, check chestaa — oka second!"
- Keep responses concise. No walls of text. Personality over length.`;
};

// ─── Tool labels (shown in UI status) ─────────────────────────────────────

const getToolLabel = (name: string, args: any): string => {
  switch (name) {
    case 'search_pavan_info': return 'Looking that up...';
    case 'check_available_slots': return `Checking Pavan's calendar for ${args.date || 'that date'}...`;
    case 'book_appointment': return `Booking ${args.time || ''} on ${args.date || ''}...`;
    case 'contact_pavan': return 'Sending your message to Pavan...';
    default: return 'Working on it...';
  }
};

const toolIcons: Record<string, string> = {
  search_pavan_info: '🔍',
  check_available_slots: '📅',
  book_appointment: '✅',
  contact_pavan: '✉️',
};

// ─── Tool executor ─────────────────────────────────────────────────────────

const executeTool = async (
  name: string,
  args: any
): Promise<{ result: any; sessionMemory?: any }> => {
  switch (name) {
    case 'search_pavan_info': {
      const docs = await similaritySearch(args.query);
      if (docs.length === 0) return { result: { found: false } };
      return { result: { found: true, context: docs.map((d: any) => d.pageContent).join('\n\n') } };
    }
    case 'check_available_slots': {
      const slots = await getAvailableSlots(args.date);
      return { result: { date: args.date, slots } };
    }
    case 'book_appointment': {
      const booking = await bookAppointment(
        args.name, args.email, args.date, args.time, 30, 'Meeting with Pavan Tejavath'
      );
      sendTelegramMessage(
        formatBookingNotification(args.name, args.email, args.date, args.time)
      ).catch((e: any) => console.error('Telegram notification failed:', e?.message));
      return {
        result: { ...booking, success: true },
        sessionMemory: { type: 'booking', date: args.date, time: args.time, name: args.name, email: args.email },
      };
    }
    case 'contact_pavan': {
      await sendTelegramMessage(
        formatContactNotification(args.name, args.email, args.message)
      );
      return {
        result: { success: true },
        sessionMemory: { type: 'contact', name: args.name, email: args.email },
      };
    }
    default:
      return { result: { error: 'Unknown tool' } };
  }
};

// ─── Streaming agent loop ──────────────────────────────────────────────────

async function runStreamingAgent(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  sessionMemory: any,
  send: (data: object) => void
): Promise<void> {
  const systemMessage: OpenAI.Chat.ChatCompletionSystemMessageParam = {
    role: 'system',
    content: getSystemPrompt() + (sessionMemory
      ? `\n\nSESSION CONTEXT: ${sessionMemory.type === 'booking'
          ? `User already booked a meeting on ${sessionMemory.date} at ${sessionMemory.time} IST for ${sessionMemory.name} (${sessionMemory.email}).`
          : `User already sent a message to Pavan from ${sessionMemory.name} (${sessionMemory.email}).`}`
      : ''),
  };

  const currentMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [systemMessage, ...messages];
  let finalSessionMemory = sessionMemory || null;
  const MAX_ITERATIONS = 6;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const stream = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: currentMessages,
      tools,
      tool_choice: 'auto',
      stream: true,
      temperature: 0.75,
    });

    let textContent = '';
    const toolCallsMap: Record<number, { id: string; name: string; arguments: string }> = {};
    let finishReason = '';

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      finishReason = chunk.choices[0]?.finish_reason || finishReason;

      if (delta?.content) {
        textContent += delta.content;
        send({ type: 'token', content: delta.content });
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCallsMap[idx]) {
            toolCallsMap[idx] = { id: tc.id || '', name: tc.function?.name || '', arguments: '' };
          }
          if (tc.id) toolCallsMap[idx].id = tc.id;
          if (tc.function?.name) toolCallsMap[idx].name += tc.function.name;
          if (tc.function?.arguments) toolCallsMap[idx].arguments += tc.function.arguments;
        }
      }
    }

    const toolCalls = Object.values(toolCallsMap);

    if (finishReason === 'stop' || toolCalls.length === 0) {
      send({ type: 'done', sessionMemory: finalSessionMemory });
      return;
    }

    if (finishReason === 'tool_calls' && toolCalls.length > 0) {
      currentMessages.push({
        role: 'assistant',
        content: textContent || null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      for (const tc of toolCalls) {
        let args: any = {};
        try { args = JSON.parse(tc.arguments); } catch { /* bad json */ }

        send({ type: 'status', tool: tc.name, icon: toolIcons[tc.name] || '⚙️', label: getToolLabel(tc.name, args) });

        let toolResult: any;
        try {
          const res = await executeTool(tc.name, args);
          toolResult = res.result;
          if (res.sessionMemory) finalSessionMemory = res.sessionMemory;

          // Emit structured card events for UI rendering
          if (tc.name === 'check_available_slots' && toolResult.slots?.length > 0) {
            send({ type: 'slots', date: toolResult.date, slots: toolResult.slots });
          }
          if (tc.name === 'book_appointment' && toolResult.success) {
            send({
              type: 'booking_confirmed',
              name: args.name, email: args.email, date: args.date, time: args.time,
              eventLink: toolResult.eventLink,
            });
          }
        } catch (err: any) {
          toolResult = { error: err.message || 'Tool failed' };
        }

        send({ type: 'status_clear' });

        currentMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(toolResult),
        });
      }
    }
  }

  send({ type: 'done', sessionMemory: finalSessionMemory });
}

// ─── POST handler ──────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const { messages = [], sessionMemory } = await request.json();

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'Messages array is required' }), { status: 400 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: object) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };
        try {
          // Map messages to OpenAI format
          const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = messages.map((m: any) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }));
          await runStreamingAgent(openaiMessages, sessionMemory, send);
        } catch (err: any) {
          console.error('Agent error:', err);
          send({ type: 'error', message: 'Something went wrong. Please try again.' });
          send({ type: 'done', sessionMemory: null });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err: any) {
    console.error('POST handler error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
