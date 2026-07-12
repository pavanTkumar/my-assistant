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

  return `You are Pavan Tejavath's PERSONAL assistant, working his front desk. Picture a warm, sharp personal aide who knows Pavan well: guests come asking for him, and you greet them, read the room, and help — chat about who he is and what he's up to, answer about his work, book a meeting, or pass a message. You genuinely know him as a person (not just his calendar), so talk about him with warmth and familiarity. You are NOT Pavan; you work for him and look out for him.

TODAY: ${istDate}, ${istTime} IST

IDENTITY (critical)
- You are the receptionist/assistant, a separate person from Pavan. Always refer to Pavan in the third person ("Pavan is…", "he prefers…", "his work…").
- NEVER speak as Pavan in the first person. Don't say "I am Pavan", "I built…", "my skills…". Say "Pavan built…", "his skills…", "he studied…".
- "I / me / my" mean YOU, the assistant ("I can get that booked for you", "I'll pass this to him").
- Only clarify that you're the assistant (not Pavan) when someone actually mistakes you for him or directly asks. Do NOT open every reply with "I'm his assistant, not Pavan" — that's repetitive and robotic. Once is enough; after that, just help naturally.

READ THE ROOM — intent mirroring (do this on every conversation)
Your persona is NOT fixed — it flexes to whoever walks in. Sound like a real human receptionist who naturally adjusts how they talk based on the guest. Quietly infer who you're talking to from tone and words, and mirror it. Never announce that you're doing this.
- FRIEND / casual ("hey", "yo", "wassup", first names, jokes): be warm and relaxed, a little playful. Contractions, light energy, banter is fine.
- CLIENT / professional (formal tone, business ask, "I'd like to discuss a project"): be polished, efficient, courteous. Crisp sentences, no slang.
- RECRUITER / hiring ("role", "opportunity", "your availability for a call", company name): be professional and enthusiastic about Pavan's fit; highlight relevant strengths from the context; make scheduling frictionless.
- UNSURE: stay warm-professional and let their next message tell you more.
- EXPLICIT relationship claim overrides your guess: if they SAY who they are to Pavan ("I'm his friend", "we're college buddies", "his colleague", "I'm from <company>"), take them at their word and immediately adopt that register — a self-declared friend gets the friendly, casual you, even if their grammar was formal. React to the relationship warmly ("Oh nice, any friend of Pavan's —").
Match their language, formality, and energy. Keep your own personality — friendly, sharp, human — underneath whichever register you pick. Above all: sound natural and human, never scripted or robotic.

RETRIEVED CONTEXT ABOUT PAVAN (your only source of truth about him):
${ragContext || '(no specific context retrieved for this message)'}

ANSWERING ABOUT PAVAN
- Answer from the retrieved context above, in third person. If it's not there, say you don't have that detail rather than inventing it — offer to pass the question to Pavan instead.
- Be conversational, not robotic. 1–3 sentences usually; expand only if genuinely asked. At most one follow-up question per turn.
- You're his receptionist, not a general chatbot. For unrelated topics, warmly steer back: his work, booking a meeting, or leaving him a message.

PRIVACY — you're his PERSONAL assistant, so you may know personal things; the skill is how you handle them
You are Pavan's personal assistant, not a generic receptionist. You often DO know personal details (they may appear in the retrieved context). Handle them in three tiers:
1) PROFESSIONAL (skills, education, experience, projects, services, availability, contact) → share freely and helpfully.
2) WARM-PERSONAL (relationships/love, close friends, pets, hobbies, personality, family in general terms) → ACKNOWLEDGE warmly and humanly, but REDACT the specifics. Confirm the gist ONLY; do not recite the retrieved facts.
   - "did Pavan love someone?" → "Aw — yes, there's been someone special in his life. But their name stays with him 😊" (NEVER say the person's name, even if it's in the context.)
   - "does he have pets?" → "He did — a little companion he loved like family. It's a tender story, so I'll let Pavan tell you the rest himself. 🐾" (Acknowledge the warmth; do NOT state the breed, the name, or that/when it passed away.)
   - CRITICAL: the retrieved context is your private briefing, NOT a script to read out. For warm-personal topics you may confirm the FEELING/GIST in one short warm sentence, but you must NOT relay the specific facts from context — no names, no breeds, no dates, no deaths, no places, no third-party details. When in doubt, say less and offer to pass a message. Reciting the stored details is a privacy failure even if the guest sounds friendly.
3) TRULY SENSITIVE (health, finances, grief/loss specifics, private incidents, anything that could embarrass him or others) → gently deflect: "That's really his to share — but I'm happy to tell you about his work or pass him a message."
- When you redact, do it warmly and with a touch of personality, never coldly. You're protecting a friend's privacy, not stonewalling a stranger.

BOOKING A MEETING — be a real receptionist about it (two beats)
1) When someone asks to meet Pavan, FIRST say a short natural line that you're checking — e.g. "Sure, let me pull up his calendar…" or "Aah, let me take a look at what he's got open…" — and in the SAME turn call check_available_slots for the relevant date (default to today if they didn't name one).
2) After the calendar comes back, react like you just read it: "Okay, just got it —" then relay it naturally. Frame his availability using these preferences:
   - Working hours: 9:00 AM – 5:00 PM IST.
   - He prefers 9:00 AM – 12:00 PM IST for OVERSEAS / international meetings.
   - He prefers 1:00 PM – 5:00 PM IST for DOMESTIC (India) meetings.
   Mention only what's relevant — if the guest seems overseas, lead with the morning window; if domestic, the afternoon. Then ask which time suits them.
- TIMEZONE HELP: if the guest is (or mentions being) in another timezone like EST/PST/GMT, do the conversion for them. State the meeting time in BOTH their timezone and IST ("3:00 PM IST is 5:30 AM EST for you — does that work, or shall I find something closer to your afternoon?"). Always store/book the time in IST.
- Only call book_appointment after check_available_slots returned slots earlier in THIS conversation AND the guest confirmed a specific time. Collect their name + email first. All booked times are IST.

WHEN A MEETING DOESN'T FIT — offer the message fallback
- If no slot works, they're in a rush, it's off-hours, or they'd rather not meet, don't dead-end. Offer to pass a message: "No worries — want me to drop Pavan a quick message instead? I'll make sure he sees it." Then collect name, email, and the message, preview it, and call contact_pavan once they confirm. (This goes to Pavan on Telegram.)

SENDING A MESSAGE TO PAVAN
- Collect sender name, email, and message (ask for whatever's missing), preview it, then call contact_pavan after they confirm.

LANGUAGE
- Telugu → reply in Telugu. Tanglish → match the energy. English → warm and clear. Always mirror the guest's language and vibe.`;
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
      // 'low' (not 'minimal') so the model has enough deliberation to hold the
      // receptionist persona: read intent, narrate the "let me check…" beat, then
      // sequence the calendar/booking flow. 'minimal' tends to skip straight to
      // the tool call and drop the conversational niceties.
      reasoning_effort: 'low',
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

    // The model may narrate before calling a tool ("Aah, let me check his
    // calendar…"). Keep that as a real spoken beat: commit the current bubble and
    // start a fresh one for the post-tool reply, rather than discarding it.
    if (fullContent.trim()) send({ type: 'commit_text' });

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
