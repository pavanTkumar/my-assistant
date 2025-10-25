/**
 * LangChain Configuration with Booking Capabilities
 * Extends the base LangChain setup with availability tools
 */

import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import {
  checkAvailability,
  parseUserDateInput,
  extractDuration,
  extractTimePreferences,
} from './tools/availability-tool';
import {
  detectBookingIntent,
  analyzeBookingContext,
  getRandomTemplate,
  BOOKING_RESPONSE_TEMPLATES,
} from './tools/booking-intents';

// ============================================================================
// BOOKING-AWARE SYSTEM PROMPT
// ============================================================================

const BOOKING_SYSTEM_PROMPT = `You are Pavan's AI assistant with advanced meeting scheduling capabilities.

**Your Capabilities:**
- Answer questions about Pavan and his work
- Check calendar availability and suggest meeting times
- Help users schedule meetings naturally through conversation
- Provide intelligent meeting recommendations

**When Users Want to Schedule:**
1. Detect booking intent (schedule, book, meet, available, etc.)
2. Extract date/time preferences from natural language
3. Use the check_availability function to find available slots
4. Present options in a friendly, conversational way
5. Guide users through the booking process

**Date Understanding:**
- "today" = current day
- "tomorrow" = next day
- "next week" = 7 days from now
- "Monday", "Tuesday", etc. = next occurrence of that day

**Meeting Durations:**
- "quick call" = 15 minutes
- Default = 30 minutes
- "1 hour" = 60 minutes
- Extract specific durations when mentioned

**Response Style:**
- Be conversational and helpful
- Present availability clearly with dates and times
- Highlight optimal slots (high quality scores)
- Ask clarifying questions when needed
- Confirm details before finalizing

**Example Flow:**
User: "Can we meet next Tuesday?"
You: *Check availability for next Tuesday*
You: "I have several slots available on Tuesday, October 29th. Here are the best times:
- 2:00 PM - 2:30 PM (Optimal afternoon slot)
- 10:00 AM - 10:30 AM (Good morning time)
- 4:00 PM - 4:30 PM (Late afternoon available)

Which time works best for you?"

Always be proactive in offering specific times and making the scheduling process smooth.`;

// ============================================================================
// ENHANCED CHAT HANDLER
// ============================================================================

export async function handleBookingChat(
  userMessage: string,
  conversationHistory: { role: string; content: string }[] = []
): Promise<{
  response: string;
  bookingDetected: boolean;
  availabilityChecked: boolean;
  suggestedSlots?: any[];
}> {
  try {
    // Step 1: Detect booking intent
    const intent = detectBookingIntent(userMessage);
    const context = analyzeBookingContext(
      userMessage,
      conversationHistory.map((msg) => msg.content)
    );

    console.log('🎯 Intent:', intent);
    console.log('📊 Context:', context);

    // Step 2: Check if we should query availability
    let availabilityData = null;
    let availabilityChecked = false;

    if (
      intent.confidence > 0.7 ||
      context.suggestedAction === 'query_availability'
    ) {
      console.log('🔍 Booking intent detected, checking availability...');

      // Extract date range
      const dateRange = parseUserDateInput(userMessage);
      const duration = extractDuration(userMessage);
      const preferences = extractTimePreferences(userMessage);

      console.log('📅 Date range:', dateRange);
      console.log('⏱️  Duration:', duration);
      console.log('⚙️  Preferences:', preferences);

      // Query availability
      try {
        const availabilityResult = await checkAvailability({
          startDate: dateRange.startDate.toISOString(),
          endDate: dateRange.endDate.toISOString(),
          duration,
          preferences,
        });

        availabilityData = JSON.parse(availabilityResult);
        availabilityChecked = true;

        console.log('✅ Availability checked:', availabilityData);
      } catch (error) {
        console.error('❌ Availability check failed:', error);
      }
    }

    // Step 3: Build enhanced prompt with availability data
    const messages = [];

    // System message
    messages.push(new SystemMessage(BOOKING_SYSTEM_PROMPT));

    // Add conversation history
    conversationHistory.forEach((msg) => {
      if (msg.role === 'user') {
        messages.push(new HumanMessage(msg.content));
      } else {
        messages.push(new AIMessage(msg.content));
      }
    });

    // Add availability context if we have it
    if (availabilityData && availabilityData.success) {
      const availabilityContext = `
Available Slots Found:
${availabilityData.topSlots
  .map(
    (slot: any, i: number) =>
      `${i + 1}. ${slot.date} at ${slot.time} (Score: ${slot.qualityScore}/100${
        slot.isOptimal ? ' ⭐ OPTIMAL' : ''
      })
   Reasons: ${slot.reasons.join(', ')}`
  )
  .join('\n')}

Total slots available: ${availabilityData.totalSlotsFound}

Present these options to the user in a friendly, conversational way.`;

      messages.push(new SystemMessage(availabilityContext));
    } else if (availabilityChecked && availabilityData && !availabilityData.success) {
      messages.push(
        new SystemMessage(
          'No available slots found for the requested time. Suggest alternative dates or times.'
        )
      );
    }

    // Add current user message
    messages.push(new HumanMessage(userMessage));

    // Step 4: Get AI response
    const model = new ChatOpenAI({
      modelName: 'gpt-4o-mini',
      temperature: 0.7,
    });

    const response = await model.invoke(messages);

    return {
      response: response.content as string,
      bookingDetected: intent.confidence > 0.7,
      availabilityChecked,
      suggestedSlots: availabilityData?.topSlots || [],
    };
  } catch (error) {
    console.error('❌ Booking chat error:', error);
    throw error;
  }
}

// ============================================================================
// QUICK AVAILABILITY CHECK (FOR API ROUTES)
// ============================================================================

export async function quickAvailabilityCheck(dateString: string, duration: number = 30) {
  const dateRange = parseUserDateInput(dateString);

  const result = await checkAvailability({
    startDate: dateRange.startDate.toISOString(),
    endDate: dateRange.endDate.toISOString(),
    duration,
  });

  return JSON.parse(result);
}

// ============================================================================
// BOOKING CONVERSATION STATE
// ============================================================================

export interface BookingConversationState {
  stage: 'initial' | 'date_selection' | 'time_selection' | 'confirmation' | 'complete';
  selectedDate?: string;
  selectedTime?: string;
  duration?: number;
  availableSlots?: any[];
  userPreferences?: any;
}

export function createBookingState(): BookingConversationState {
  return {
    stage: 'initial',
  };
}

export function updateBookingState(
  state: BookingConversationState,
  userMessage: string,
  availabilityData?: any
): BookingConversationState {
  const newState = { ...state };

  // Detect what stage we're in based on context
  if (availabilityData && availabilityData.success) {
    newState.stage = 'time_selection';
    newState.availableSlots = availabilityData.topSlots;
  }

  // Check if user is confirming a slot
  if (
    state.stage === 'time_selection' &&
    (userMessage.toLowerCase().includes('book') ||
      userMessage.toLowerCase().includes('confirm') ||
      userMessage.toLowerCase().includes('yes'))
  ) {
    newState.stage = 'confirmation';
  }

  return newState;
}