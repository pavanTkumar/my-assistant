export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { generateRagResponse, isContactQuery, isAppointmentQuery } from '@/lib/langchain';
import { getAvailableSlots, bookAppointment } from '@/lib/googleCalendar';
import { sendTelegramMessage, formatBookingNotification, formatContactNotification } from '@/lib/telegram';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

type ConversationMessage = { role: string; content: string };

// Lightweight AI model for entity extraction
const extractorModel = new ChatOpenAI({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: 'gpt-4o-mini',
  temperature: 0,
});

// Extract a date from natural language (returns YYYY-MM-DD or null)
const extractDate = async (message: string): Promise<string | null> => {
  const now = new Date();
  const msg = message.toLowerCase();

  if (/\b(today|now|tonight|this (morning|afternoon|evening))\b/.test(msg)) {
    return now.toISOString().split('T')[0];
  }
  if (/\btomorrow\b/.test(msg)) {
    const tmr = new Date(now);
    tmr.setDate(tmr.getDate() + 1);
    return tmr.toISOString().split('T')[0];
  }
  if (/\bday after tomorrow\b/.test(msg)) {
    const dat = new Date(now);
    dat.setDate(dat.getDate() + 2);
    return dat.toISOString().split('T')[0];
  }
  const isoMatch = message.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];

  const today = now.toISOString().split('T')[0];
  try {
    const res = await extractorModel.invoke([
      new SystemMessage(
        `Today is ${today}. Extract the date from the user's message and return ONLY a date in YYYY-MM-DD format. ` +
        `For relative days like "next Monday", calculate the actual date. ` +
        `If no date is mentioned at all, return "none". Do not include any other text.`
      ),
      new HumanMessage(message),
    ]);
    const content = typeof res.content === 'string' ? res.content.trim() : '';
    return /^\d{4}-\d{2}-\d{2}$/.test(content) ? content : null;
  } catch {
    return null;
  }
};

// Extract email address from text
const extractEmail = (text: string): string | null => {
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : null;
};

// ─── Conversation context helpers ──────────────────────────────────────────

// Scan full message history to find name and email the user has already provided
const extractUserInfoFromConversation = (messages: ConversationMessage[]) => {
  let userName: string | null = null;
  let userEmail: string | null = null;

  // Scan all user messages for email and explicit name patterns
  for (const msg of messages) {
    if (msg.role !== 'user') continue;
    const email = extractEmail(msg.content);
    if (email) userEmail = email;

    const namePatterns = [
      /my name is ([a-zA-Z][\w ]{1,30})/i,
      /i'?m ([a-zA-Z][\w ]{1,30})[.,!]?\s*$/i,
      /call me ([a-zA-Z][\w ]{1,30})/i,
    ];
    for (const pat of namePatterns) {
      const m = msg.content.match(pat);
      if (m) { userName = m[1].trim(); break; }
    }
  }

  // Most reliable: assistant asked "what's your name?" → very next user message is the name
  for (let i = 0; i < messages.length - 1; i++) {
    const curr = messages[i];
    const next = messages[i + 1];
    if (curr.role !== 'assistant' || next.role !== 'user') continue;
    const a = curr.content.toLowerCase();
    const u = next.content.trim();
    if (
      (a.includes("what's your name") || a.includes("your name?") ||
       a.includes("share your name") || a.includes("what is your name")) &&
      u.length >= 2 && u.length < 60 &&
      !u.includes('@') &&
      !/^(yes|no|sure|ok|cancel|nevermind|nope)/i.test(u)
    ) {
      userName = u;
    }
  }

  return { userName, userEmail };
};

// User is hinting that info was already given ("you already know my name", etc.)
const isReferringToKnown = (msg: string): boolean => {
  const m = msg.toLowerCase();
  return (
    m.includes('you already know') ||
    m.includes('already told you') ||
    m.includes('same as before') ||
    m.includes('same name') ||
    m.includes('same email') ||
    m.includes('as mentioned') ||
    m.includes('already gave') ||
    m.includes('already said') ||
    (m.includes('you know') && (m.includes('name') || m.includes('email')))
  );
};

// ─── Session follow-up helpers ─────────────────────────────────────────────

// Answer a follow-up question using completed session context
const answerFromSession = async (
  question: string,
  sessionMemory: { type: string; date?: string; time?: string; name: string; email: string }
): Promise<string> => {
  const ctx =
    sessionMemory.type === 'booking'
      ? `The user just booked a meeting with Pavan Tejavath on ${sessionMemory.date} at ${sessionMemory.time} IST (India Standard Time, UTC+5:30). Pavan will reach out before the meeting to ${sessionMemory.email}.`
      : `The user just sent a message to Pavan Tejavath from ${sessionMemory.name}. Reply will go to ${sessionMemory.email}.`;

  const res = await extractorModel.invoke([
    new SystemMessage(
      `You are Pavan Tejavath's assistant. Answer the user's follow-up question based ONLY on this context:\n${ctx}\nBe concise and friendly.`
    ),
    new HumanMessage(question),
  ]);
  return typeof res.content === 'string' ? res.content.trim() : '';
};

const isSessionFollowUp = (msg: string): boolean => {
  const m = msg.toLowerCase();
  return [
    'that', 'it ', 'this ', 'the meeting', 'my booking', 'i booked', 'i scheduled',
    'my appointment', 'the booking', 'timezone', 'time zone', 'ist', 'est', 'gmt',
    'invite', 'already booked', 'confirmation', 'what time', 'which time',
    'the slot', 'what date', 'which date',
  ].some(t => m.includes(t));
};

// ─── Utility ───────────────────────────────────────────────────────────────

const isCancellation = (msg: string): boolean => {
  const m = msg.toLowerCase().trim();
  return (
    m.includes('cancel') ||
    m.includes('never mind') ||
    m.includes('nevermind') ||
    m.includes('no thanks') ||
    m === 'no' || m === 'nope' || m === 'nah'
  );
};

const parseSlotSelection = (message: string, slots: Array<{ time: string }>): { time: string } | null => {
  const msg = message.toLowerCase().trim();
  const numMatch = msg.match(/\b([1-6])\b/);
  if (numMatch) {
    const index = parseInt(numMatch[1]) - 1;
    if (index >= 0 && index < slots.length) return slots[index];
  }
  for (const slot of slots) {
    if (msg.includes(slot.time)) return slot;
    const [h] = slot.time.split(':').map(Number);
    const ampm = h < 12 ? 'am' : 'pm';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    if (msg.includes(`${h12} ${ampm}`) || msg.includes(`${h12}${ampm}`) || msg.includes(`${h12}:00`)) {
      return slot;
    }
  }
  const ordinals = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
  for (let i = 0; i < ordinals.length; i++) {
    if (msg.includes(ordinals[i]) && slots[i]) return slots[i];
  }
  return null;
};

// ─── Booking flow ──────────────────────────────────────────────────────────

async function handleBookingFlow(
  userMessage: string,
  state: any,
  messages: ConversationMessage[]
): Promise<NextResponse> {
  const stage = state?.stage || 'initial';
  const { userName: knownName, userEmail: knownEmail } = extractUserInfoFromConversation(messages);

  if (stage !== 'initial' && isCancellation(userMessage)) {
    return NextResponse.json({
      response: 'No worries! Let me know if you want to schedule something later.',
      bookingState: null,
    });
  }

  if (stage === 'initial') {
    const date = await extractDate(userMessage);
    if (date) return fetchAndShowSlots(date);
    return NextResponse.json({
      response: "Sure! What date would you like to meet? You can say something like 'tomorrow', 'next Monday', or 'March 5'.",
      bookingState: { stage: 'date_asked' },
    });
  }

  if (stage === 'date_asked') {
    const date = await extractDate(userMessage);
    if (!date) {
      return NextResponse.json({
        response: "I didn't catch a date. Could you mention a specific date like 'February 25' or '2026-02-28'?",
        bookingState: { stage: 'date_asked' },
      });
    }
    return fetchAndShowSlots(date);
  }

  if (stage === 'slots_shown') {
    const slot = parseSlotSelection(userMessage, state.slots);
    if (!slot) {
      const slotList = state.slots.map((s: any, i: number) => `${i + 1}. ${s.time}`).join('\n');
      return NextResponse.json({
        response: `Please pick one of these slots by number or time:\n\n${slotList}`,
        bookingState: state,
      });
    }
    // Already know both name and email — skip straight to confirmation
    if (knownName && knownEmail) {
      return NextResponse.json({
        response: `${slot.time} on ${state.date} — locked in!\n\n📅 Date: ${state.date}\n⏰ Time: ${slot.time} IST\n👤 Name: ${knownName}\n📧 Email: ${knownEmail}\n\nShall I confirm the booking? (yes / no)`,
        bookingState: { ...state, stage: 'confirming', selectedSlot: slot, userName: knownName, userEmail: knownEmail },
      });
    }
    // Already know name — skip that question
    if (knownName) {
      return NextResponse.json({
        response: `${slot.time} on ${state.date} — great choice, ${knownName}! What's the best email to reach you?`,
        bookingState: { ...state, stage: 'email_asked', selectedSlot: slot, userName: knownName },
      });
    }
    return NextResponse.json({
      response: `${slot.time} on ${state.date} — perfect! What's your name?`,
      bookingState: { ...state, stage: 'name_asked', selectedSlot: slot },
    });
  }

  if (stage === 'name_asked') {
    let name = userMessage.trim();
    // Handle "you already know my name" style responses
    if (isReferringToKnown(userMessage) && knownName) name = knownName;
    if (!name || name.length < 2) {
      return NextResponse.json({ response: "Could you share your name?", bookingState: state });
    }
    // Already know email — skip to confirmation
    if (knownEmail) {
      return NextResponse.json({
        response: `Got it, ${name}!\n\n📅 Date: ${state.date}\n⏰ Time: ${state.selectedSlot.time} IST\n👤 Name: ${name}\n📧 Email: ${knownEmail}\n\nShall I confirm? (yes / no)`,
        bookingState: { ...state, stage: 'confirming', userName: name, userEmail: knownEmail },
      });
    }
    return NextResponse.json({
      response: `Nice to meet you, ${name}! What's your email address?`,
      bookingState: { ...state, stage: 'email_asked', userName: name },
    });
  }

  if (stage === 'email_asked') {
    let email = extractEmail(userMessage);
    // Handle "same email / you know my email" style responses
    if (!email && isReferringToKnown(userMessage) && knownEmail) email = knownEmail;
    if (!email) {
      return NextResponse.json({
        response: "I need a valid email for the calendar booking. Could you share it?",
        bookingState: state,
      });
    }
    const { date, selectedSlot, userName } = state;
    return NextResponse.json({
      response: `Almost there!\n\n📅 Date: ${date}\n⏰ Time: ${selectedSlot.time} IST\n👤 Name: ${userName}\n📧 Email: ${email}\n\nShall I confirm the booking? (yes / no)`,
      bookingState: { ...state, stage: 'confirming', userEmail: email },
    });
  }

  if (stage === 'confirming') {
    const msg = userMessage.toLowerCase();
    const confirmed =
      msg.includes('yes') || msg.includes('confirm') || msg.includes('sure') || msg.includes('ok') || msg.includes('book');

    if (!confirmed) {
      return NextResponse.json({
        response: "No problem! Would you like to choose a different slot or start over?",
        bookingState: null,
      });
    }

    const { date, selectedSlot, userName, userEmail } = state;
    try {
      await bookAppointment(userName, userEmail, date, selectedSlot.time, 30, 'Meeting with Pavan Tejavath');

      // Non-blocking Telegram notification
      sendTelegramMessage(
        formatBookingNotification(userName, userEmail, date, selectedSlot.time)
      ).catch((err: any) => console.error('Telegram notification failed:', err?.message));

      return NextResponse.json({
        response: `Booking confirmed! 🎉\n\n📅 ${date} at ${selectedSlot.time} IST\n👤 ${userName}\n📧 ${userEmail}\n\nPavan will reach out to you at ${userEmail} before the meeting. See you then!`,
        bookingState: null,
        sessionMemory: { type: 'booking', date, time: selectedSlot.time, name: userName, email: userEmail },
      });
    } catch (err: any) {
      console.error('Booking error:', err);
      return NextResponse.json({
        response: `Something went wrong with the booking (${err.message}). Please try again.`,
        bookingState: { ...state, stage: 'confirming' },
      });
    }
  }

  return NextResponse.json({
    response: "What date would you like to book the meeting?",
    bookingState: { stage: 'date_asked' },
  });
}

// ─── Calendar slots helper ─────────────────────────────────────────────────

async function fetchAndShowSlots(date: string): Promise<NextResponse> {
  try {
    const slots = await getAvailableSlots(date);
    if (slots.length === 0) {
      const isToday = date === new Date().toISOString().split('T')[0];
      return NextResponse.json({
        response: isToday
          ? `All slots for today (${date}) are past working hours. Want to check tomorrow instead?`
          : `No open slots on ${date}. Would you like to try a different date?`,
        bookingState: { stage: 'date_asked' },
      });
    }
    const available = slots.slice(0, 6);
    const slotList = available.map((s: any, i: number) => `${i + 1}. ${s.time}`).join('\n');
    return NextResponse.json({
      response: `Here are the available slots on ${date}:\n\n${slotList}\n\nWhich one works for you?`,
      bookingState: { stage: 'slots_shown', date, slots: available },
    });
  } catch (err: any) {
    console.error('Calendar API error for date', date, ':', err?.message || err);
    const status = err?.response?.status || err?.code;
    const isAuthError =
      status === 401 || status === 403 ||
      err?.message?.toLowerCase().includes('auth') ||
      err?.message?.toLowerCase().includes('permission');
    return NextResponse.json({
      response: isAuthError
        ? "I can't access the calendar right now. Please reach out to Pavan directly at pavan@thetejavath.com."
        : `I had trouble checking availability for ${date}. Could you try another date?`,
      bookingState: { stage: 'date_asked' },
    });
  }
}

// ─── Contact flow ──────────────────────────────────────────────────────────

async function handleContactFlow(
  userMessage: string,
  state: any,
  messages: ConversationMessage[]
): Promise<NextResponse> {
  const stage = state?.stage || 'initial';
  const { userName: knownName, userEmail: knownEmail } = extractUserInfoFromConversation(messages);

  if (stage !== 'initial' && isCancellation(userMessage)) {
    return NextResponse.json({
      response: "Alright, no worries! Feel free to ask if you'd like to reach out later.",
      contactState: null,
    });
  }

  if (stage === 'initial') {
    // Already know both — go straight to message collection
    if (knownName && knownEmail) {
      return NextResponse.json({
        response: `Happy to pass that along to Pavan, ${knownName}! What would you like to tell him?`,
        contactState: { stage: 'collecting_message', userName: knownName, userEmail: knownEmail },
      });
    }
    if (knownName) {
      return NextResponse.json({
        response: `Happy to help, ${knownName}! What's your email address so Pavan can reply?`,
        contactState: { stage: 'collecting_email', userName: knownName },
      });
    }
    return NextResponse.json({
      response: "I'd be happy to pass your message along to Pavan! What's your name?",
      contactState: { stage: 'collecting_name' },
    });
  }

  if (stage === 'collecting_name') {
    let name = userMessage.trim();
    if (isReferringToKnown(userMessage) && knownName) name = knownName;
    if (!name || name.length < 2) {
      return NextResponse.json({
        response: "Could you share your name so Pavan knows who to reply to?",
        contactState: state,
      });
    }
    // Already know email — skip to message
    if (knownEmail) {
      return NextResponse.json({
        response: `Thanks, ${name}! What would you like to tell Pavan?`,
        contactState: { stage: 'collecting_message', userName: name, userEmail: knownEmail },
      });
    }
    return NextResponse.json({
      response: `Thanks, ${name}! What's your email address?`,
      contactState: { stage: 'collecting_email', userName: name },
    });
  }

  if (stage === 'collecting_email') {
    let email = extractEmail(userMessage);
    if (!email && isReferringToKnown(userMessage) && knownEmail) email = knownEmail;
    if (!email) {
      return NextResponse.json({
        response: "I need a valid email address so Pavan can reply. Could you share it?",
        contactState: state,
      });
    }
    return NextResponse.json({
      response: "Got it! What would you like to tell Pavan?",
      contactState: { ...state, stage: 'collecting_message', userEmail: email },
    });
  }

  if (stage === 'collecting_message') {
    const msgContent = userMessage.trim();
    const { userName, userEmail } = state;
    return NextResponse.json({
      response: `Here's what I'll send to Pavan:\n\n"${msgContent}"\n\nFrom: ${userName} (${userEmail})\n\nShall I send this? (yes / no)`,
      contactState: { ...state, stage: 'confirming', msgContent },
    });
  }

  if (stage === 'confirming') {
    const msg = userMessage.toLowerCase();
    const confirmed =
      msg.includes('yes') || msg.includes('send') || msg.includes('sure') || msg.includes('ok');

    if (!confirmed) {
      return NextResponse.json({
        response: "No worries! Feel free to rephrase and I'll help you send it.",
        contactState: null,
      });
    }

    const { userName, userEmail, msgContent } = state;
    try {
      await sendTelegramMessage(
        formatContactNotification(userName, userEmail, msgContent)
      );
      return NextResponse.json({
        response: `Your message has been sent to Pavan! 📨\n\nHe'll get back to you at ${userEmail} within 24–48 hours.`,
        contactState: null,
        sessionMemory: { type: 'contact', name: userName, email: userEmail },
      });
    } catch (err: any) {
      console.error('Telegram send error:', err?.message);
      return NextResponse.json({
        response: `I wasn't able to deliver the message right now. You can reach Pavan directly at pavan@thetejavath.com — sorry for the trouble!`,
        contactState: null,
      });
    }
  }

  return NextResponse.json({
    response: "I'd be happy to help you contact Pavan. What's your name?",
    contactState: { stage: 'collecting_name' },
  });
}

// ─── Main POST handler ─────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages = [], bookingState, contactState, sessionMemory } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Messages array is required' }, { status: 400 });
    }

    const latestMessage = messages[messages.length - 1];
    const userMessage: string = latestMessage?.content || '';

    // --- BOOKING FLOW ---
    if (bookingState?.stage || (!contactState?.stage && isAppointmentQuery(userMessage))) {
      return handleBookingFlow(userMessage, bookingState || null, messages);
    }

    // --- CONTACT FLOW ---
    if (contactState?.stage || isContactQuery(userMessage)) {
      return handleContactFlow(userMessage, contactState || null, messages);
    }

    // --- SESSION FOLLOW-UP ---
    if (sessionMemory && isSessionFollowUp(userMessage)) {
      const response = await answerFromSession(userMessage, sessionMemory);
      if (response) return NextResponse.json({ response, sessionMemory });
    }

    // --- GENERAL RAG ---
    const response = await generateRagResponse(userMessage);
    return NextResponse.json({ response, sessionMemory: sessionMemory || null });
  } catch (error: any) {
    console.error('Error in chat API:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process chat request' },
      { status: 500 }
    );
  }
}
