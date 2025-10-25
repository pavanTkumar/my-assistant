/**
 * POST /api/chat
 * Main chat endpoint with booking detection
 */

import { NextRequest } from 'next/server';
import { handleBookingChat } from '@/lib/langchain-booking';
import { detectBookingIntent } from '@/lib/tools/booking-intents';
import {
  successResponse,
  errorResponse,
  internalErrorResponse,
  parseJsonBody,
} from '@/lib/api/api-utils';

export async function POST(request: NextRequest) {
  try {
    const body = await parseJsonBody(request);
    const { message, conversationHistory = [] } = body;

    if (!message) {
      return errorResponse('Message is required', 'MISSING_MESSAGE', 400);
    }

    // Detect if this is a booking-related query
    const intent = detectBookingIntent(message);

    if (intent.confidence > 0.5) {
      // Route to booking handler
      console.log('🎯 Booking intent detected, routing to booking handler');
      const result = await handleBookingChat(message, conversationHistory);

      return successResponse({
        response: result.response,
        type: 'booking',
        bookingDetected: true,
        availabilityChecked: result.availabilityChecked,
        suggestedSlots: result.suggestedSlots,
      });
    }

    // Handle as regular chat (your existing implementation)
    // ... your existing chat logic here ...

    return successResponse({
      response: 'Regular chat response here',
      type: 'general',
      bookingDetected: false,
    });
  } catch (error: any) {
    console.error('❌ Chat API error:', error);
    return internalErrorResponse(error);
  }
}