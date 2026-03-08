export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import { GoogleGenerativeAI, Part, Content, FunctionDeclaration } from '@google/generative-ai';
import { similaritySearch } from '@/lib/pinecone';
import { getAvailableSlots, bookAppointment } from '@/lib/googleCalendar';
import { sendTelegramMessage, formatBookingNotification, formatContactNotification } from '@/lib/telegram';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);

// ─── Tool definitions (Gemini format) ─────────────────────────────────────

const functionDeclarations: FunctionDeclaration[] = [
  {
    name: 'search_pavan_info',
    description: "Search for information about Pavan Tejavath — his background, skills, projects, services, education, contact details, work experience, etc. Use this whenever someone asks about Pavan.",
    parameters: {
      type: 'object' as any,
      properties: {
        query: { type: 'string' as any, description: 'The search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'check_available_slots',
    description: "Check Pavan's available meeting slots on a given date. Returns a list of open time slots.",
    parameters: {
      type: 'object' as any,
      properties: {
        date: { type: 'string' as any, description: 'Date in YYYY-MM-DD format' },
      },
      required: ['date'],
    },
  },
  {
    name: 'book_appointment',
    description: "Book a meeting with Pavan. Only call this after the user has confirmed. Requires name, email, date (YYYY-MM-DD), and time (HH:MM 24-hour IST).",
    parameters: {
      type: 'object' as any,
      properties: {
        name: { type: 'string' as any, description: "Guest's full name" },
        email: { type: 'string' as any, description: "Guest's email address" },
        date: { type: 'string' as any, description: 'Meeting date in YYYY-MM-DD format' },
        time: { type: 'string' as any, description: 'Meeting time in HH:MM 24-hour format (IST)' },
      },
      required: ['name', 'email', 'date', 'time'],
    },
  },
  {
    name: 'contact_pavan',
    description: "Send a message to Pavan via Telegram. Only call this after the user has reviewed and confirmed their message.",
    parameters: {
      type: 'object' as any,
      properties: {
        name: { type: 'string' as any, description: "Sender's name" },
        email: { type: 'string' as any, description: "Sender's email" },
        message: { type: 'string' as any, description: 'The message to send to Pavan' },
      },
      required: ['name', 'email', 'message'],
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

// ─── Streaming agent loop (Gemini) ─────────────────────────────────────────

async function runStreamingAgent(
  messages: Array<{ role: string; content: string }>,
  sessionMemory: any,
  send: (data: object) => void
): Promise<void> {
  const systemInstruction = getSystemPrompt() + (sessionMemory
    ? `\n\nSESSION CONTEXT: ${sessionMemory.type === 'booking'
        ? `User already booked a meeting on ${sessionMemory.date} at ${sessionMemory.time} IST for ${sessionMemory.name} (${sessionMemory.email}).`
        : `User already sent a message to Pavan from ${sessionMemory.name} (${sessionMemory.email}).`}`
    : '');

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    tools: [{ functionDeclarations }],
    systemInstruction,
    generationConfig: { temperature: 0.75 },
  });

  // Convert all messages except the last into Gemini history format
  const history: Content[] = [];
  for (const m of messages.slice(0, -1)) {
    history.push({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    });
  }

  const chat = model.startChat({ history });
  const lastUserMessage = messages[messages.length - 1].content;

  let finalSessionMemory = sessionMemory || null;
  const MAX_ITERATIONS = 6;

  // First iteration sends the user message; subsequent ones send function results
  let currentInput: string | Part[] = lastUserMessage;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const streamResult = await chat.sendMessageStream(currentInput);

    // Stream text tokens to the client
    for await (const chunk of streamResult.stream) {
      try {
        const text = chunk.text();
        if (text) {
          send({ type: 'token', content: text });
        }
      } catch { /* chunk may not have text (e.g., function call chunk) */ }
    }

    const response = await streamResult.response;
    const functionCalls = response.functionCalls();

    // No tool calls — done
    if (!functionCalls || functionCalls.length === 0) {
      send({ type: 'done', sessionMemory: finalSessionMemory });
      return;
    }

    // Execute all tool calls and collect results
    const functionResponseParts: Part[] = [];

    for (const fc of functionCalls) {
      const args = (fc.args as any) || {};

      send({ type: 'status', tool: fc.name, icon: toolIcons[fc.name] || '⚙️', label: getToolLabel(fc.name, args) });

      let toolResult: any;
      try {
        const res = await executeTool(fc.name, args);
        toolResult = res.result;
        if (res.sessionMemory) finalSessionMemory = res.sessionMemory;

        // Emit structured card events for UI
        if (fc.name === 'check_available_slots' && toolResult.slots?.length > 0) {
          send({ type: 'slots', date: toolResult.date, slots: toolResult.slots });
        }
        if (fc.name === 'book_appointment' && toolResult.success) {
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

      functionResponseParts.push({
        functionResponse: {
          name: fc.name,
          response: toolResult,
        },
      });
    }

    // Next iteration: send function results back to the model
    currentInput = functionResponseParts;
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
