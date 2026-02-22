export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { generateRagResponse, isContactQuery, isAppointmentQuery } from '@/lib/langchain';
import { getAvailableSlots, bookAppointment } from '@/lib/googleCalendar';
import { sendWhatsAppMessage, formatWhatsAppMessage, isValidPhoneNumber } from '@/lib/twilio';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

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

  // Handle relative terms locally — fast, never fails
  if (/\b(today|now|tonight|this (morning|afternoon|evening))\b/.test(msg)) {
    return now.toISOString().split('T')[0];
  }
  if (/\btomorrow\b/.test(msg)) {
    const tmr = new Date(now);
    tmr.setDate(tmr.getDate() + 1);
    return tmr.toISOString().split('T')[0];
  }
  // "day after tomorrow"
  if (/\bday after tomorrow\b/.test(msg)) {
    const dat = new Date(now);
    dat.setDate(dat.getDate() + 2);
    return dat.toISOString().split('T')[0];
  }
  // ISO format already present
  const isoMatch = message.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];

  // Fall back to GPT for "next Monday", "February 25", etc.
  const today = now.toISOString().split('T')[0];
  try {
    const res = await extractorModel.invoke([
      new SystemMessage(
        `Today is ${today}. Extract the date from the user's message and return ONLY a date in YYYY-MM-DD format. ` +
        `"today" = ${today}. For relative days like "next Monday", calculate the actual date. ` +
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

// Match user's slot selection to available slots
const parseSlotSelection = (message: string, slots: Array<{ time: string }>): { time: string } | null => {
  const msg = message.toLowerCase().trim();

  // By number ("1", "2", etc.)
  const numMatch = msg.match(/\b([1-6])\b/);
  if (numMatch) {
    const index = parseInt(numMatch[1]) - 1;
    if (index >= 0 && index < slots.length) return slots[index];
  }

  // By time string ("9:00", "9 AM", "14:00", "2 PM", etc.)
  for (const slot of slots) {
    if (msg.includes(slot.time)) return slot;
    // Also match 12-hour variants like "9 am" for "09:00"
    const [h] = slot.time.split(':').map(Number);
    const ampm = h < 12 ? 'am' : 'pm';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    if (msg.includes(`${h12} ${ampm}`) || msg.includes(`${h12}${ampm}`) || msg.includes(`${h12}:00`)) {
      return slot;
    }
  }

  // By ordinal ("first", "second", etc.)
  const ordinals = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
  for (let i = 0; i < ordinals.length; i++) {
    if (msg.includes(ordinals[i]) && slots[i]) return slots[i];
  }

  return null;
};

// Check if user is cancelling
const isCancellation = (msg: string): boolean => {
  const m = msg.toLowerCase();
  return (
    m.includes('cancel') ||
    m.includes('never mind') ||
    m.includes('nevermind') ||
    m.includes('no thanks') ||
    (m === 'no' || m === 'nope' || m === 'nah')
  );
};

// Handle the full booking flow
async function handleBookingFlow(userMessage: string, state: any): Promise<NextResponse> {
  const stage = state?.stage || 'initial';

  // Allow cancellation at any stage
  if (stage !== 'initial' && isCancellation(userMessage)) {
    return NextResponse.json({
      response: 'No worries! Let me know if you want to schedule something later.',
      bookingState: null,
    });
  }

  // Initial: check if date is already in the message, otherwise ask
  if (stage === 'initial') {
    const date = await extractDate(userMessage);
    if (date) {
      return await fetchAndShowSlots(date);
    }
    return NextResponse.json({
      response: "Sure! What date would you like to meet? You can say something like 'tomorrow', 'next Monday', or 'March 5'.",
      bookingState: { stage: 'date_asked' },
    });
  }

  // Waiting for date input
  if (stage === 'date_asked') {
    const date = await extractDate(userMessage);
    if (!date) {
      return NextResponse.json({
        response: "I didn't catch a date. Could you mention a specific date like 'February 25' or '2026-02-28'?",
        bookingState: { stage: 'date_asked' },
      });
    }
    return await fetchAndShowSlots(date);
  }

  // Slots were shown, waiting for selection
  if (stage === 'slots_shown') {
    const slot = parseSlotSelection(userMessage, state.slots);
    if (!slot) {
      const slotList = state.slots.map((s: any, i: number) => `${i + 1}. ${s.time}`).join('\n');
      return NextResponse.json({
        response: `Please pick one of these slots by number or time:\n\n${slotList}`,
        bookingState: state,
      });
    }
    return NextResponse.json({
      response: `${slot.time} on ${state.date} — perfect! What's your name?`,
      bookingState: { ...state, stage: 'name_asked', selectedSlot: slot },
    });
  }

  // Waiting for name
  if (stage === 'name_asked') {
    const name = userMessage.trim();
    if (!name || name.length < 2) {
      return NextResponse.json({
        response: "Could you share your name?",
        bookingState: state,
      });
    }
    return NextResponse.json({
      response: `Nice to meet you, ${name}! What's your email address?`,
      bookingState: { ...state, stage: 'email_asked', userName: name },
    });
  }

  // Waiting for email
  if (stage === 'email_asked') {
    const email = extractEmail(userMessage);
    if (!email) {
      return NextResponse.json({
        response: "I need a valid email to send the calendar invite. Could you share it?",
        bookingState: state,
      });
    }
    const { date, selectedSlot, userName } = state;
    return NextResponse.json({
      response: `Almost done! Here's a summary:\n\n📅 Date: ${date}\n⏰ Time: ${selectedSlot.time}\n👤 Name: ${userName}\n📧 Email: ${email}\n\nShall I confirm the booking? (yes / no)`,
      bookingState: { ...state, stage: 'confirming', userEmail: email },
    });
  }

  // Waiting for confirmation
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

      // Non-blocking WhatsApp notification
      const ownerPhone = process.env.OWNER_PHONE_NUMBER;
      if (ownerPhone && isValidPhoneNumber(ownerPhone)) {
        sendWhatsAppMessage(
          ownerPhone,
          formatWhatsAppMessage(userName, userEmail, `New booking: ${date} at ${selectedSlot.time}`, false)
        ).catch(console.error);
      }

      return NextResponse.json({
        response: `Booking confirmed!\n\n📅 ${date} at ${selectedSlot.time}\n👤 ${userName}\n📧 ${userEmail}\n\nPavan will reach out to you at ${userEmail} before the meeting. See you then!`,
        bookingState: null,
      });
    } catch (err: any) {
      console.error('Booking error:', err);
      return NextResponse.json({
        response: `Sorry, something went wrong while booking: ${err.message}. Please try again.`,
        bookingState: { ...state, stage: 'confirming' },
      });
    }
  }

  // Fallback
  return NextResponse.json({
    response: "What date would you like to book the meeting?",
    bookingState: { stage: 'date_asked' },
  });
}

// Helper: fetch slots for a date and return formatted response
async function fetchAndShowSlots(date: string): Promise<NextResponse> {
  try {
    const slots = await getAvailableSlots(date);
    if (slots.length === 0) {
      // Today might be fully in the past (after working hours)
      const isToday = date === new Date().toISOString().split('T')[0];
      return NextResponse.json({
        response: isToday
          ? `All slots for today (${date}) are already taken or past. Would you like to check tomorrow instead?`
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
    // Log full error details for Vercel function logs
    const status = err?.response?.status || err?.code;
    const errMsg = err?.message || String(err);
    console.error(`Calendar API error [${status}] for date ${date}:`, errMsg);

    const isAuthError =
      status === 401 || status === 403 ||
      errMsg.toLowerCase().includes('auth') ||
      errMsg.toLowerCase().includes('token') ||
      errMsg.toLowerCase().includes('credential') ||
      errMsg.toLowerCase().includes('permission') ||
      errMsg.toLowerCase().includes('forbidden') ||
      errMsg.toLowerCase().includes('unauthorized');

    return NextResponse.json({
      response: isAuthError
        ? `I can't access the calendar right now (error ${status}). Please reach out to Pavan directly at pavan@thetejavath.com.`
        : `I had trouble checking availability for ${date} (error: ${errMsg.slice(0, 80)}). Please try again or contact Pavan at pavan@thetejavath.com.`,
      bookingState: { stage: 'date_asked' },
    });
  }
}

// Handle the full contact flow
async function handleContactFlow(userMessage: string, state: any): Promise<NextResponse> {
  const stage = state?.stage || 'initial';

  // Allow cancellation
  if (stage !== 'initial' && isCancellation(userMessage)) {
    return NextResponse.json({
      response: "Alright, no worries! Feel free to ask if you'd like to reach out later.",
      contactState: null,
    });
  }

  if (stage === 'initial') {
    return NextResponse.json({
      response: "I'd be happy to pass your message along to Pavan! What's your name?",
      contactState: { stage: 'collecting_name' },
    });
  }

  if (stage === 'collecting_name') {
    const name = userMessage.trim();
    if (!name || name.length < 2) {
      return NextResponse.json({
        response: "Could you share your name so Pavan knows who to reply to?",
        contactState: state,
      });
    }
    return NextResponse.json({
      response: `Thanks, ${name}! What's your email address?`,
      contactState: { stage: 'collecting_email', userName: name },
    });
  }

  if (stage === 'collecting_email') {
    const email = extractEmail(userMessage);
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
      const ownerPhone = process.env.OWNER_PHONE_NUMBER;
      if (ownerPhone && isValidPhoneNumber(ownerPhone)) {
        await sendWhatsAppMessage(
          ownerPhone,
          formatWhatsAppMessage(userName, userEmail, msgContent, false)
        );
      }
      return NextResponse.json({
        response: `Your message has been sent to Pavan!\n\nHe'll get back to you at ${userEmail} within 24-48 hours.`,
        contactState: null,
      });
    } catch (err: any) {
      console.error('WhatsApp send error:', err);
      return NextResponse.json({
        response: `Sorry, I couldn't deliver the message: ${err.message}. Please try again.`,
        contactState: { ...state, stage: 'confirming' },
      });
    }
  }

  // Fallback
  return NextResponse.json({
    response: "I'd be happy to help you contact Pavan. What's your name?",
    contactState: { stage: 'collecting_name' },
  });
}

// Main POST handler
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages = [], bookingState, contactState } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Messages array is required' }, { status: 400 });
    }

    const latestMessage = messages[messages.length - 1];
    const userMessage: string = latestMessage?.content || '';

    // --- BOOKING FLOW (active state or intent) ---
    if (bookingState?.stage || (!contactState?.stage && isAppointmentQuery(userMessage))) {
      return handleBookingFlow(userMessage, bookingState || null);
    }

    // --- CONTACT FLOW (active state or intent) ---
    if (contactState?.stage || isContactQuery(userMessage)) {
      return handleContactFlow(userMessage, contactState || null);
    }

    // --- GENERAL RAG ---
    const response = await generateRagResponse(userMessage);
    return NextResponse.json({ response });
  } catch (error: any) {
    console.error('Error in chat API:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process chat request' },
      { status: 500 }
    );
  }
}
