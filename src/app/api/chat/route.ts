export const dynamic = 'force-dynamic';
/**
 * POST /api/chat
 * Unified chat endpoint — routes to booking, contact, or general RAG
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateRagResponse, isContactQuery } from '@/lib/langchain';
import { detectBookingIntent } from '@/lib/tools/booking-intents';
import { handleBookingChat } from '@/lib/langchain-booking';
import {
  processConversationalBooking,
  extractEmail,
  extractName,
  ConversationBookingState,
} from '@/lib/booking/conversation-booking';
import { createBooking, validateBookingParams } from '@/lib/booking/booking-service';
import {
  sendWhatsAppMessage,
  formatWhatsAppMessage,
  isValidPhoneNumber,
} from '@/lib/twilio';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

interface ContactState {
  stage: 'initial' | 'collecting_name' | 'collecting_email' | 'collecting_message' | 'confirming' | 'complete';
  userName?: string;
  userEmail?: string;
  userMessage?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// POST handler
// ────────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // FIX: Frontend sends `messages` array — extract latest message and history
    const { messages = [], bookingState, contactState } = body;

    if (!messages || messages.length === 0) {
      return NextResponse.json({ response: 'Please send a message.' }, { status: 400 });
    }

    const latestMessage = messages[messages.length - 1];
    const userMessage: string = latestMessage?.content?.trim() || '';
    const conversationHistory: { role: string; content: string }[] = messages.slice(0, -1);

    if (!userMessage) {
      return NextResponse.json({ response: 'Please send a message.' }, { status: 400 });
    }

    // ────────────────────────────────────────────────────────────────────────
    // Route 1: Contact flow (stateful)
    // Triggered when contactState is active OR user expresses contact intent
    // ────────────────────────────────────────────────────────────────────────
    const currentContactState: ContactState = contactState || { stage: 'initial' };

    if (currentContactState.stage !== 'initial' || isContactQuery(userMessage)) {
      return handleContactFlow(userMessage, currentContactState);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Route 2: Booking flow (stateful)
    // Triggered when bookingState is active OR booking intent is detected
    // ────────────────────────────────────────────────────────────────────────
    const intent = detectBookingIntent(userMessage);
    const currentBookingState: ConversationBookingState = bookingState || { stage: 'initial', attempts: 0 };

    if (currentBookingState.stage !== 'initial' || intent.confidence > 0.5) {
      return handleBookingFlow(userMessage, conversationHistory, currentBookingState);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Route 3: General RAG — knowledge about Pavan
    // ────────────────────────────────────────────────────────────────────────
    const response = await generateRagResponse(userMessage);
    return NextResponse.json({ response });

  } catch (error: any) {
    console.error('❌ Chat API error:', error);
    return NextResponse.json(
      { response: 'Something went wrong. Please try again.' },
      { status: 500 }
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Booking flow handler
// Mirrors /api/chat/booking/route.ts but integrated into the main route
// ────────────────────────────────────────────────────────────────────────────

async function handleBookingFlow(
  userMessage: string,
  conversationHistory: { role: string; content: string }[],
  bookingState: ConversationBookingState
): Promise<NextResponse> {
  try {
    console.log('📅 Booking flow — stage:', bookingState.stage);

    // Step 1: Get AI availability response + suggested slots
    const aiResult = await handleBookingChat(userMessage, conversationHistory);

    // Step 2: Advance the state machine
    const conversationResult = await processConversationalBooking(
      userMessage,
      bookingState,
      aiResult.suggestedSlots
    );

    console.log('🔄 New booking state:', conversationResult.newState.stage);

    // Step 3: If the state machine signals it's time to create a booking, do it
    if (conversationResult.needsAction === 'create_booking' && conversationResult.actionParams) {
      try {
        const validationErrors = validateBookingParams(conversationResult.actionParams);
        if (validationErrors.length > 0) {
          console.error('❌ Booking validation errors:', validationErrors);
          return NextResponse.json({
            response: `❌ There was an issue with the booking details:\n${validationErrors.join('\n')}\n\nPlease try again.`,
            bookingState: { ...conversationResult.newState, stage: 'initial', attempts: 0 },
          });
        }

        const booking = await createBooking(conversationResult.actionParams);
        console.log('✅ Booking created:', booking.booking.confirmationCode);

        // Non-blocking WhatsApp notification to Pavan
        const ownerPhone = process.env.OWNER_PHONE_NUMBER;
        if (ownerPhone && isValidPhoneNumber(ownerPhone)) {
          const slot = conversationResult.newState.selectedSlot;
          const notificationBody = formatWhatsAppMessage(
            conversationResult.actionParams.userName,
            conversationResult.actionParams.userEmail,
            `New meeting booked!\n📅 ${slot?.date ?? ''} at ${slot?.time?.split(' - ')[0] ?? ''}\nConfirmation: ${booking.booking.confirmationCode}`,
            false
          );
          sendWhatsAppMessage(ownerPhone, notificationBody).catch((err) =>
            console.error('⚠️ WhatsApp notification failed:', err)
          );
        }

        const slot = conversationResult.newState.selectedSlot;
        return NextResponse.json({
          response: `✅ **Booking Confirmed!**\n\nYour meeting is all set:\n📅 ${slot?.date ?? ''}\n🕐 ${slot?.time?.split(' - ')[0] ?? ''}\n\n**Confirmation Code:** ${booking.booking.confirmationCode}\n\nA calendar invite will be sent to ${conversationResult.actionParams.userEmail}.\n\nNeed to reschedule or cancel? Just let me know!`,
          bookingState: { stage: 'complete' },
          bookingCreated: true,
        });

      } catch (error: any) {
        console.error('❌ Booking creation error:', error.message);

        let errorMessage = 'There was an issue creating your booking.';
        if (error.message?.includes('no longer available')) {
          errorMessage = 'That time slot was just booked by someone else.';
        } else if (error.message?.includes('reserved')) {
          errorMessage = 'That slot is temporarily reserved. Please choose another.';
        } else if (error.message?.includes('Invalid date')) {
          errorMessage = 'There was an issue with the selected time. Please pick a different slot.';
        }

        return NextResponse.json({
          response: `❌ ${errorMessage}\n\nWould you like to choose a different slot or try a different date?`,
          bookingState: { ...conversationResult.newState, stage: 'initial', attempts: 0 },
          bookingCreated: false,
        });
      }
    }

    // Normal progress response
    return NextResponse.json({
      response: conversationResult.response,
      bookingState: conversationResult.newState,
      bookingCreated: false,
    });

  } catch (error: any) {
    console.error('❌ Booking flow error:', error);
    return NextResponse.json({
      response: "I had trouble checking availability. Please try again — just tell me when you'd like to meet!",
      bookingState: { stage: 'initial', attempts: 0 },
    });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Contact flow handler
// Collects name → email → message → sends WhatsApp to Pavan
// ────────────────────────────────────────────────────────────────────────────

async function handleContactFlow(
  userMessage: string,
  contactState: ContactState
): Promise<NextResponse> {
  const normalized = userMessage.trim();

  switch (contactState.stage) {
    case 'initial': {
      return NextResponse.json({
        response: "Of course! I can pass your message to Pavan directly. What's your name?",
        contactState: { stage: 'collecting_name' },
      });
    }

    case 'collecting_name': {
      // Try to extract a name; fall back to the whole message
      const extracted = extractName(normalized);
      const userName = extracted || normalized;

      return NextResponse.json({
        response: `Nice to meet you, ${userName}! What's your email address so Pavan can get back to you?`,
        contactState: { ...contactState, stage: 'collecting_email', userName },
      });
    }

    case 'collecting_email': {
      const email = extractEmail(normalized);
      if (!email) {
        return NextResponse.json({
          response: "I didn't catch a valid email address. Could you share it again? (e.g. yourname@example.com)",
          contactState,
        });
      }

      return NextResponse.json({
        response: `Got it! What would you like to say to Pavan?`,
        contactState: { ...contactState, stage: 'collecting_message', userEmail: email },
      });
    }

    case 'collecting_message': {
      return NextResponse.json({
        response: `Here's what I'll send to Pavan:\n\n*From:* ${contactState.userName} (${contactState.userEmail})\n*Message:* ${normalized}\n\nShall I send this? (yes / no)`,
        contactState: { ...contactState, stage: 'confirming', userMessage: normalized },
      });
    }

    case 'confirming': {
      if (/^(yes|yeah|yep|sure|ok|okay|send|go ahead|do it)$/i.test(normalized)) {
        const ownerPhone = process.env.OWNER_PHONE_NUMBER;

        if (!ownerPhone || !isValidPhoneNumber(ownerPhone)) {
          console.error('❌ Owner phone not configured for WhatsApp');
          return NextResponse.json({
            response: "I'm unable to reach Pavan right now. Please try the contact form or reach out directly via email.",
            contactState: { stage: 'initial' },
          });
        }

        try {
          const formatted = formatWhatsAppMessage(
            contactState.userName!,
            contactState.userEmail!,
            contactState.userMessage!,
            false
          );

          await sendWhatsAppMessage(ownerPhone, formatted);
          console.log('✅ WhatsApp message sent to owner');

          return NextResponse.json({
            response: `✅ Done! Your message has been sent to Pavan.\n\nHe'll get back to you at ${contactState.userEmail} typically within 24–48 hours. Is there anything else I can help with?`,
            contactState: { stage: 'complete' },
          });

        } catch (error: any) {
          console.error('❌ WhatsApp send failed:', error.message);
          return NextResponse.json({
            response: "I had trouble sending your message just now. Please try again shortly.",
            contactState,
          });
        }
      }

      if (/^(no|nope|cancel|stop|never mind|nevermind)$/i.test(normalized)) {
        return NextResponse.json({
          response: "No problem — your message was not sent. Is there anything else I can help with?",
          contactState: { stage: 'initial' },
        });
      }

      return NextResponse.json({
        response: "Just say *yes* to send or *no* to cancel.",
        contactState,
      });
    }

    case 'complete': {
      // Flow is done — fall through to RAG for any follow-up questions
      const response = await generateRagResponse(userMessage);
      return NextResponse.json({ response, contactState: { stage: 'initial' } });
    }

    default: {
      return NextResponse.json({
        response: "Of course! What's your name?",
        contactState: { stage: 'collecting_name' },
      });
    }
  }
}
