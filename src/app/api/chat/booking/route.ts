/**
 * POST /api/chat/booking
 * Conversational booking endpoint - Production Ready
 */

import { NextRequest } from 'next/server';
import { handleBookingChat } from '@/lib/langchain-booking';
import { processConversationalBooking } from '@/lib/booking/conversation-booking';
import { createBooking, validateBookingParams } from '@/lib/booking/booking-service';
import {
  successResponse,
  errorResponse,
  internalErrorResponse,
  parseJsonBody,
} from '@/lib/api/api-utils';

export async function POST(request: NextRequest) {
  try {
    const body = await parseJsonBody(request);
    const { message, conversationHistory = [], bookingState } = body;

    if (!message) {
      return errorResponse('Message is required', 'MISSING_MESSAGE', 400);
    }

    console.log('💬 Conversational booking request:', { message, stage: bookingState?.stage });

    const aiResult = await handleBookingChat(message, conversationHistory);

    const conversationResult = await processConversationalBooking(
      message,
      bookingState || { stage: 'initial', attempts: 0 },
      aiResult.suggestedSlots
    );

    if (conversationResult.needsAction === 'create_booking' && conversationResult.actionParams) {
      try {
        const params = conversationResult.actionParams;

        const validationErrors = validateBookingParams(params);
        if (validationErrors.length > 0) {
          console.error('❌ Validation errors:', validationErrors);
          return successResponse({
            response: `❌ Sorry, there was an issue with the booking details:\n${validationErrors.join('\n')}\n\nPlease try again.`,
            bookingState: { ...conversationResult.newState, stage: 'initial', attempts: 0 },
            bookingCreated: false,
          });
        }

        const booking = await createBooking(params);

        return successResponse({
          response: `✅ **Booking Confirmed!**\n\nYour meeting is all set:\n📅 ${conversationResult.newState.selectedSlot?.date}\n🕐 ${conversationResult.newState.selectedSlot?.time.split(' - ')[0]}\n\n**Confirmation Code:** ${booking.booking.confirmationCode}\n\nYou'll receive a calendar invite at ${params.userEmail}\n\nNeed to reschedule or cancel? Just let me know!`,
          bookingState: { ...conversationResult.newState, stage: 'complete' },
          bookingCreated: true,
          booking: booking.booking,
        });
      } catch (error: any) {
        console.error('❌ Booking creation error:', error);

        let errorMessage = 'There was an issue creating your booking.';

        if (error.message.includes('no longer available')) {
          errorMessage = 'Sorry, that time slot was just booked by someone else.';
        } else if (error.message.includes('reserved')) {
          errorMessage = 'That time slot is temporarily reserved. Please try another.';
        } else if (error.message.includes('Invalid date')) {
          errorMessage = 'There was an issue with the selected time. Please try selecting a different slot.';
        }

        return successResponse({
          response: `❌ ${errorMessage}\n\nWould you like to:\n- Choose a different time slot?\n- Try a different date?\n- Start over?`,
          bookingState: { ...conversationResult.newState, stage: 'initial', attempts: 0 },
          bookingCreated: false,
        });
      }
    }

    return successResponse({
      response: conversationResult.response,
      bookingState: conversationResult.newState,
      bookingCreated: false,
      availabilityChecked: aiResult.availabilityChecked,
    });
  } catch (error: any) {
    console.error('❌ Conversational booking error:', error);
    return internalErrorResponse(error);
  }
}