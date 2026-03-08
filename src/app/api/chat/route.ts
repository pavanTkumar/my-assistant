export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import Groq from 'groq-sdk';
import { similaritySearch } from '@/lib/pinecone';
import { getAvailableSlots, bookAppointment } from '@/lib/googleCalendar';
import { sendTelegramMessage, formatBookingNotification, formatContactNotification } from '@/lib/telegram';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─── Tool definitions (OpenAI format) ─────────────────────────────────────

const tools: Groq.Chat.Completions.ChatCompletionTool[] = [
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

  return `You are the personal AI assistant of Pavan Tejavath — sharp, warm, witty, fiercely loyal.

TODAY: ${istDate}, ${istTime} IST

━━ GOLDEN RULES ━━
1. BREVITY: 1-3 short sentences MAX. Never lists unless asked. End with ONE follow-up question.
2. TOOL FIRST, TEXT NEVER: When a tool is needed, call it IMMEDIATELY — zero preamble. Do NOT say "Let me check..." or "I'll look that up..." — just call the tool silently.
3. NEVER REFUSE CONTACT: NEVER say "I can't send/contact/reach Pavan." You ALWAYS can — use contact_pavan tool.
4. DON'T REPEAT: If you called a tool and got results, answer ONLY from those results. Don't also say what you said before calling the tool.

━━ TOOL USAGE ━━
- Pavan questions → search_pavan_info (call immediately, no preamble)
- Schedule meeting → check_available_slots first → book_appointment after user confirms all details
- Send message to Pavan → collect name + email + message → show preview → call contact_pavan after "yes"
- Off-topic → one-liner deflect + redirect

━━ BOOKING ━━
Collect: name, email, date, time slot (check first). Confirm details. Book. All times IST.

━━ CONTACT ━━
Collect: name, email, message. Preview: "Sending to Pavan: '[msg]' — confirm?" Then call contact_pavan.

━━ LANGUAGE ━━
Telugu script → reply in Telugu. Tanglish → match the energy. English → sharp English.
Examples: "Adhe ra!", "Sure babu, check chestaa", "oka second!"`;
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

// ─── Streaming agent loop (Groq) ───────────────────────────────────────────

async function runStreamingAgent(
  messages: Array<{ role: string; content: string }>,
  sessionMemory: any,
  send: (data: object) => void
): Promise<void> {
  const systemPrompt = getSystemPrompt() + (sessionMemory
    ? `\n\nSESSION CONTEXT: ${sessionMemory.type === 'booking'
        ? `User already booked a meeting on ${sessionMemory.date} at ${sessionMemory.time} IST for ${sessionMemory.name} (${sessionMemory.email}).`
        : `User already sent a message to Pavan from ${sessionMemory.name} (${sessionMemory.email}).`}`
    : '');

  // Build Groq messages array (system + full history)
  const groqMessages: Groq.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ];

  let finalSessionMemory = sessionMemory || null;
  const MAX_ITERATIONS = 6;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const stream = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: groqMessages,
      tools,
      tool_choice: 'auto',
      parallel_tool_calls: false,
      stream: true,
      temperature: 0.75,
      max_tokens: 1024,
    });

    // Accumulate streamed content and tool calls
    let fullContent = '';
    const toolCallsMap: Record<number, { id: string; name: string; arguments: string }> = {};

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        fullContent += delta.content;
        send({ type: 'token', content: delta.content });
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallsMap[idx]) {
            toolCallsMap[idx] = { id: '', name: '', arguments: '' };
          }
          if (tc.id) toolCallsMap[idx].id = tc.id;
          if (tc.function?.name) toolCallsMap[idx].name += tc.function.name;
          if (tc.function?.arguments) toolCallsMap[idx].arguments += tc.function.arguments;
        }
      }
    }

    const toolCalls = Object.values(toolCallsMap);

    // No tool calls — we're done
    if (toolCalls.length === 0) {
      send({ type: 'done', sessionMemory: finalSessionMemory });
      return;
    }

    // If the model emitted text before deciding to call a tool, clear it —
    // the real answer will come after tool results
    if (fullContent.trim()) {
      send({ type: 'reset_text' });
    }

    // Append assistant message with tool calls to history
    groqMessages.push({
      role: 'assistant',
      content: fullContent || null,
      tool_calls: toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    // Execute each tool and append results
    for (const tc of toolCalls) {
      let args: any = {};
      try { args = JSON.parse(tc.arguments); } catch { /* keep empty */ }

      send({ type: 'status', tool: tc.name, icon: toolIcons[tc.name] || '⚙️', label: getToolLabel(tc.name, args) });

      let toolResult: any;
      try {
        const res = await executeTool(tc.name, args);
        toolResult = res.result;
        if (res.sessionMemory) finalSessionMemory = res.sessionMemory;

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

      groqMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(toolResult),
      });
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
          await runStreamingAgent(messages, sessionMemory, send);
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
