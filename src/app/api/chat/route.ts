export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import OpenAI from 'openai';
import { similaritySearch } from '@/lib/pinecone';
import { getAvailableSlots, bookAppointment } from '@/lib/googleCalendar';
import { sendTelegramMessage, formatBookingNotification, formatContactNotification } from '@/lib/telegram';
import { env } from '@/lib/env';
import {
  SESSION_COOKIE,
  verifyCookieValue,
  getOrCreateUser,
  setUserName,
  recordMessage,
} from '@/lib/session';

const openai = new OpenAI({ apiKey: env('OPENAI_API_KEY') });

const CHAT_MODEL = 'gpt-5-mini';
const RAG_TOP_K = 4;
// Pinecone score below which a match is treated as irrelevant (tune with real data).
const RAG_MIN_SCORE = 0.35;

// ─── Tools (real actions only — RAG is NOT a tool; see retrieve-then-generate) ──

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'remember_visitor_name',
      description:
        "Call this once when the visitor tells you their name (e.g. 'I'm Sarah', 'this is Raj'), so you can greet them by name next time. Do not ask for their name just to call this.",
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: "The visitor's first name or full name" },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_available_slots',
      description:
        "Check Pavan's open meeting slots on a date. Call this BEFORE book_appointment — booking requires a slot returned here first.",
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date in YYYY-MM-DD format (IST)' },
        },
        required: ['date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'book_appointment',
      description:
        "Book a meeting with Pavan. Only call after the user confirmed a specific slot that check_available_slots returned. Requires name, email, date (YYYY-MM-DD), time (HH:MM 24h IST).",
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: "Guest's full name" },
          email: { type: 'string', description: "Guest's email address" },
          date: { type: 'string', description: 'Meeting date, YYYY-MM-DD' },
          time: { type: 'string', description: 'Meeting time, HH:MM 24-hour IST' },
        },
        required: ['name', 'email', 'date', 'time'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'contact_pavan',
      description:
        'Send a message to Pavan via Telegram. Only call after the user has provided their name, email, and message and confirmed sending.',
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

// ─── Validation helpers ──────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const isPastDate = (date: string): boolean => {
  // Compare against "today" in IST so a same-day booking isn't wrongly rejected.
  const todayIST = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()); // en-CA → YYYY-MM-DD
  return date < todayIST;
};

// ─── System prompt ───────────────────────────────────────────────────────────

const getSystemPrompt = (ragContext: string): string => {
  const now = new Date();
  const istDate = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  }).format(now);
  const istTime = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(now);

  return `You are Pavan Tejavath's virtual assistant — a helpful, sharp, warm concierge who speaks ABOUT Pavan to visitors of his site. You are NOT Pavan.

TODAY: ${istDate}, ${istTime} IST

IDENTITY (critical)
- You are the assistant, a separate persona from Pavan. Always refer to Pavan in the third person ("Pavan is…", "he has…", "his work…").
- NEVER speak as Pavan in the first person. Do not say "I am Pavan", "I built…", "my skills…", "I studied…". Those are Pavan's — say "Pavan built…", "his skills…", "he studied…".
- "I / me / my" refer to YOU, the assistant (e.g. "I can book you a meeting with Pavan", "I can pass your message to him").
- If a visitor addresses you as if you were Pavan, gently clarify: "I'm Pavan's assistant — happy to help you with anything about him."

RETRIEVED CONTEXT ABOUT PAVAN (use this to answer; it is your only source of truth about him):
${ragContext || '(no relevant context retrieved for this message)'}

HOW TO ANSWER
- Answer questions about Pavan ONLY from the retrieved context above, always in third person. If the context does not contain the answer, say you don't have that detail rather than guessing.
- Keep replies to 1-3 short sentences. No lists unless asked. At most one follow-up question.
- You are not a general assistant. For anything unrelated to Pavan, briefly redirect to what you can help with (his work, booking a meeting, sending him a message).

PRIVACY
- Share only professional information: skills, education, work experience, projects, services, availability, professional contact.
- Never reveal personal-life details (relationships, family, health, private events) to visitors. If asked, deflect warmly: "That's Pavan's personal space — but I'm happy to tell you about his work!"

BOOKING A MEETING
- Flow: check_available_slots(date) → let the user pick a returned slot → confirm name + email → book_appointment.
- Never call book_appointment unless check_available_slots has returned slots earlier in this conversation and the user picked one. Times are IST.

SENDING A MESSAGE TO PAVAN
- Collect sender name, email, and the message (ask for whatever is missing). Preview it, then call contact_pavan after the user confirms.

LANGUAGE
- Telugu → reply in Telugu. Tanglish → match the energy. English → sharp and clear.`;
};

// ─── Tool UI labels/icons (for the status pill) ──────────────────────────────

const getToolLabel = (name: string, args: any): string => {
  switch (name) {
    case 'remember_visitor_name': return 'Noting your name...';
    case 'check_available_slots': return `Checking Pavan's calendar for ${args?.date || 'that date'}...`;
    case 'book_appointment': return `Booking ${args?.time || ''} on ${args?.date || ''}...`;
    case 'contact_pavan': return 'Sending your message to Pavan...';
    default: return 'Working on it...';
  }
};

const toolIcons: Record<string, string> = {
  remember_visitor_name: '👋',
  check_available_slots: '📅',
  book_appointment: '✅',
  contact_pavan: '✉️',
};

// ─── Tool executor (with guardrails) ─────────────────────────────────────────

type ToolContext = { slotsChecked: boolean; userId: string | null };

const executeTool = async (
  name: string,
  args: any,
  ctx: ToolContext
): Promise<{ result: any; sessionMemory?: any }> => {
  switch (name) {
    case 'remember_visitor_name': {
      const nm = String(args?.name || '').trim();
      if (!nm) return { result: { error: 'No name provided.' } };
      if (ctx.userId) {
        try {
          await setUserName(ctx.userId, nm);
        } catch (e: any) {
          console.error('setUserName failed:', e?.message);
        }
      }
      return { result: { success: true, remembered: nm } };
    }

    case 'check_available_slots': {
      if (!args?.date || !DATE_RE.test(args.date)) {
        return { result: { error: 'Invalid date. Ask the user for a date in YYYY-MM-DD format.' } };
      }
      if (isPastDate(args.date)) {
        return { result: { error: 'That date is in the past. Ask the user for a future date.' } };
      }
      const slots = await getAvailableSlots(args.date);
      if (slots.length > 0) ctx.slotsChecked = true;
      return { result: { date: args.date, slots } };
    }

    case 'book_appointment': {
      // Guardrail: cannot book without a prior successful slot check this conversation.
      if (!ctx.slotsChecked) {
        return { result: { error: 'Cannot book yet — call check_available_slots first and have the user pick a returned slot.' } };
      }
      if (!args?.name?.trim() || !args?.email?.trim()) {
        return { result: { error: 'Name and email are required. Ask the user for them first.' } };
      }
      if (!EMAIL_RE.test(args.email)) {
        return { result: { error: 'That email looks invalid. Ask the user to confirm their email address.' } };
      }
      if (!DATE_RE.test(args.date) || !TIME_RE.test(args.time)) {
        return { result: { error: 'Date must be YYYY-MM-DD and time HH:MM (24-hour IST). Ask the user to reconfirm.' } };
      }
      if (isPastDate(args.date)) {
        return { result: { error: 'That date is in the past. Ask the user to pick a future slot.' } };
      }
      const booking = await bookAppointment(
        args.name, args.email, args.date, args.time, 30, 'Meeting with Pavan Tejavath'
      );
      sendTelegramMessage(
        formatBookingNotification(args.name, args.email, args.date, args.time)
      ).catch((e: any) => console.error('Telegram booking notification failed:', e?.message));
      return {
        result: { ...booking, success: true },
        sessionMemory: { type: 'booking', date: args.date, time: args.time, name: args.name, email: args.email },
      };
    }

    case 'contact_pavan': {
      if (!args?.name?.trim() || !args?.email?.trim() || !args?.message?.trim()) {
        return { result: { error: 'Name, email, and message are all required. Ask the user for whatever is missing.' } };
      }
      if (!EMAIL_RE.test(args.email)) {
        return { result: { error: 'That email looks invalid. Ask the user to confirm their email address.' } };
      }
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

// ─── Retrieval: embed the latest user message, pull top-k public context ─────

const retrieveContext = async (userText: string): Promise<string> => {
  if (!userText.trim()) return '';
  try {
    const docs = await similaritySearch(userText, RAG_TOP_K);
    const relevant = docs.filter((d) => (d.score ?? 0) >= RAG_MIN_SCORE && d.pageContent.trim());
    return relevant.map((d) => d.pageContent).join('\n\n---\n\n');
  } catch (e: any) {
    console.error('RAG retrieval failed:', e?.message);
    return '';
  }
};

// ─── Streaming agent loop (OpenAI) ───────────────────────────────────────────

async function runStreamingAgent(
  messages: Array<{ role: string; content: string }>,
  sessionMemory: any,
  userId: string | null,
  send: (data: object) => void
): Promise<void> {
  // Retrieve-then-generate: always inject fresh RAG context for the latest user turn.
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const ragContext = await retrieveContext(lastUser?.content || '');

  let systemPrompt = getSystemPrompt(ragContext);
  if (sessionMemory) {
    systemPrompt += `\n\nSESSION CONTEXT: ${sessionMemory.type === 'booking'
      ? `The visitor already booked a meeting on ${sessionMemory.date} at ${sessionMemory.time} IST as ${sessionMemory.name} (${sessionMemory.email}).`
      : `The visitor already sent a message to Pavan as ${sessionMemory.name} (${sessionMemory.email}).`}`;
  }

  const chatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ];

  const ctx: ToolContext = { slotsChecked: false, userId };
  let finalSessionMemory = sessionMemory || null;
  const MAX_ITERATIONS = 5;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const stream = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: chatMessages,
      tools,
      tool_choice: 'auto',
      parallel_tool_calls: false,
      // gpt-5 supports reasoning_effort: 'minimal' at runtime; the openai v4 SDK
      // types only enumerate low|medium|high, so bypass the type on this one field.
      reasoning_effort: 'minimal' as unknown as 'low',
      stream: true,
    });

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
          if (!toolCallsMap[idx]) toolCallsMap[idx] = { id: '', name: '', arguments: '' };
          if (tc.id) toolCallsMap[idx].id = tc.id;
          if (tc.function?.name) toolCallsMap[idx].name += tc.function.name;
          if (tc.function?.arguments) toolCallsMap[idx].arguments += tc.function.arguments;
        }
      }
    }

    const toolCalls = Object.values(toolCallsMap);

    // No tools requested — the model answered directly. Done.
    if (toolCalls.length === 0) {
      send({ type: 'done', sessionMemory: finalSessionMemory });
      return;
    }

    // If the model streamed chatter before deciding to call a tool, discard it
    // client-side; the real answer arrives after tool results.
    if (fullContent.trim()) send({ type: 'reset_text' });

    chatMessages.push({
      role: 'assistant',
      content: fullContent || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    for (const tc of toolCalls) {
      // Parse args; on malformed JSON, feed an explicit error back (never silent {}).
      let args: any;
      let parseError = false;
      try {
        args = JSON.parse(tc.arguments || '{}');
      } catch {
        parseError = true;
      }

      send({ type: 'status', tool: tc.name, icon: toolIcons[tc.name] || '⚙️', label: getToolLabel(tc.name, args) });

      let toolResult: any;
      if (parseError) {
        toolResult = { error: 'Your tool arguments were not valid JSON. Re-issue the call with well-formed arguments.' };
      } else {
        try {
          const res = await executeTool(tc.name, args, ctx);
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
          toolResult = { error: err?.message || 'Tool failed' };
        }
      }

      send({ type: 'status_clear' });

      chatMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(toolResult),
      });
    }
  }

  // Safety net if the loop exhausts iterations.
  send({ type: 'done', sessionMemory: finalSessionMemory });
}

// ─── POST handler (SSE) ──────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const { messages = [], sessionMemory } = await request.json();

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'Messages array is required' }), { status: 400 });
    }

    // Identify the visitor from the signed cookie (set by the landing page).
    // Best-effort: identity/tracking never blocks the chat if Redis is down.
    const cookieRaw = request.cookies.get(SESSION_COOKIE)?.value;
    const userId = verifyCookieValue(cookieRaw);
    if (userId) {
      const nowISO = new Date().toISOString();
      getOrCreateUser(userId, nowISO)
        .then(() => recordMessage(userId))
        .catch((e) => console.error('user tracking failed:', e?.message));
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: object) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };
        try {
          await runStreamingAgent(messages, sessionMemory, userId, send);
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
