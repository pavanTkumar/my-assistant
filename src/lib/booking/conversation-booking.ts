/**
 * Conversational Booking Manager - Production Ready
 */

import {
    parseUserDateInput,
    extractDuration,
    extractTimePreferences,
  } from '../tools/availability-tool';
  
  export interface ConversationBookingState {
    stage:
      | 'initial'
      | 'slots_presented'
      | 'slot_selected'
      | 'collecting_email'
      | 'collecting_phone'
      | 'confirming'
      | 'complete';
    selectedSlot?: {
      id: string;
      date: string;
      time: string;
      startTime: Date;
      endTime: Date;
      duration: number;
    };
    userName?: string;
    userEmail?: string;
    userPhone?: string;
    availableSlots?: any[];
    lastQuery?: string;
    attempts: number;
  }
  
  function parseSlotDateTime(dateStr: string, timeStr: string): { start: Date; end: Date } {
    const [startTimeStr, endTimeStr] = timeStr.split(' - ');
    const year = new Date().getFullYear();
  
    const dateMatch = dateStr.match(/(\w+),\s+(\w+)\s+(\d+)/);
    if (!dateMatch) {
      throw new Error(`Invalid date format: ${dateStr}`);
    }
  
    const [, , monthStr, dayStr] = dateMatch;
  
    const months: Record<string, number> = {
      Jan: 0,
      Feb: 1,
      Mar: 2,
      Apr: 3,
      May: 4,
      Jun: 5,
      Jul: 6,
      Aug: 7,
      Sep: 8,
      Oct: 9,
      Nov: 10,
      Dec: 11,
    };
  
    const month = months[monthStr];
    const day = parseInt(dayStr);
  
    const parseTime = (time: string): { hours: number; minutes: number } => {
      const match = time.match(/(\d+):(\d+)\s*(AM|PM)/i);
      if (!match) throw new Error(`Invalid time format: ${time}`);
  
      let hours = parseInt(match[1]);
      const minutes = parseInt(match[2]);
      const period = match[3].toUpperCase();
  
      if (period === 'PM' && hours !== 12) hours += 12;
      if (period === 'AM' && hours === 12) hours = 0;
  
      return { hours, minutes };
    };
  
    const startTimeParsed = parseTime(startTimeStr.trim());
    const endTimeParsed = parseTime(endTimeStr.trim());
  
    const start = new Date(year, month, day, startTimeParsed.hours, startTimeParsed.minutes);
    const end = new Date(year, month, day, endTimeParsed.hours, endTimeParsed.minutes);
  
    return { start, end };
  }
  
  export function extractEmail(text: string): string | null {
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
    const match = text.match(emailRegex);
    return match ? match[0] : null;
  }
  
  export function extractPhone(text: string): string | null {
    const phonePatterns = [
      /\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
      /\d{10}/,
      /\d{3}[-.\s]\d{3}[-.\s]\d{4}/,
    ];
  
    for (const pattern of phonePatterns) {
      const match = text.match(pattern);
      if (match) return match[0];
    }
    return null;
  }
  
  export function extractName(text: string): string | null {
    const patterns = [
      /(?:i'm|i am|my name is|this is|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
      /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)$/i,
    ];
  
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1].trim();
    }
    return null;
  }
  
  export function detectSlotSelection(text: string, availableSlots: any[]): any | null {
    const normalized = text.toLowerCase().trim();
  
    const timeMatch = normalized.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (timeMatch) {
      let hour = parseInt(timeMatch[1]);
      const minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      const period = timeMatch[3]?.toLowerCase();
  
      if (period === 'pm' && hour < 12) hour += 12;
      if (period === 'am' && hour === 12) hour = 0;
  
      return availableSlots.find((slot) => {
        const slotTime = slot.time.split(' - ')[0].toLowerCase();
        return slotTime.includes(`${hour}:`) || slotTime.includes(`${(hour % 12) || 12}:`);
      });
    }
  
    const positionPatterns = [
      { pattern: /first|1st|one/i, index: 0 },
      { pattern: /second|2nd|two/i, index: 1 },
      { pattern: /third|3rd|three/i, index: 2 },
      { pattern: /fourth|4th|four/i, index: 3 },
      { pattern: /fifth|5th|five/i, index: 4 },
      { pattern: /last/i, index: -1 },
    ];
  
    for (const { pattern, index } of positionPatterns) {
      if (pattern.test(normalized)) {
        const slot = index === -1 ? availableSlots[availableSlots.length - 1] : availableSlots[index];
        return slot || null;
      }
    }
  
    if (normalized.includes('morning')) {
      return availableSlots.find((slot) => {
        const hour = parseInt(slot.time.split(':')[0]);
        return hour >= 8 && hour < 12;
      });
    }
  
    if (normalized.includes('afternoon')) {
      return availableSlots.find((slot) => {
        const hour = parseInt(slot.time.split(':')[0]);
        return hour >= 12 && hour < 17;
      });
    }
  
    if (
      normalized.match(/^(yes|yeah|yep|sure|ok|okay|sounds good|perfect|great)$/i) &&
      availableSlots.length > 0
    ) {
      return availableSlots[0];
    }
  
    return null;
  }
  
  function createBookingParams(state: ConversationBookingState, phone?: string) {
    if (!state.selectedSlot) {
      throw new Error('No slot selected');
    }
  
    // Ensure dates are proper Date objects
    const startTime = state.selectedSlot.startTime instanceof Date 
      ? state.selectedSlot.startTime 
      : new Date(state.selectedSlot.startTime);
      
    const endTime = state.selectedSlot.endTime instanceof Date 
      ? state.selectedSlot.endTime 
      : new Date(state.selectedSlot.endTime);
  
    console.log('🔍 Creating booking params with dates:', {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      isStartDateObject: startTime instanceof Date,
      isEndDateObject: endTime instanceof Date,
    });
  
    return {
      userName: state.userName || 'Guest',
      userEmail: state.userEmail!,
      userPhone: phone,
      slotId: state.selectedSlot.id,
      startTime: startTime,
      endTime: endTime,
      duration: state.selectedSlot.duration,
      timezone: 'Asia/Kolkata',
      source: 'chat',
    };
  }
  
  export async function processConversationalBooking(
    userMessage: string,
    state: ConversationBookingState,
    availableSlots?: any[]
  ): Promise<{
    response: string;
    newState: ConversationBookingState;
    needsAction?: 'create_booking';
    actionParams?: any;
  }> {
    const normalized = userMessage.toLowerCase().trim();
    const newState = { ...state, attempts: state.attempts + 1 };
  
    if (state.stage === 'initial' || state.stage === 'slots_presented') {
      if (availableSlots && availableSlots.length > 0) {
        newState.stage = 'slots_presented';
        newState.availableSlots = availableSlots;
  
        const topSlots = availableSlots.slice(0, 5);
        const slotList = topSlots
          .map((slot) => {
            const indicator = slot.isOptimal ? '🟢' : '🔵';
            const reason = slot.reasons[0] || 'Available';
            return `${indicator} ${slot.time} - ${reason}`;
          })
          .join('\n     ');
  
        return {
          response: `I found ${availableSlots.length} available slots! Here are the best times:\n\n     ${slotList}\n\nWhich time works best for you? You can say something like "2pm" or "the first one".`,
          newState,
        };
      }
  
      if (state.availableSlots && state.availableSlots.length > 0) {
        const selectedSlot = detectSlotSelection(userMessage, state.availableSlots);
  
        if (selectedSlot) {
          try {
            const { start, end } = parseSlotDateTime(selectedSlot.date, selectedSlot.time);
  
            console.log('✅ Parsed slot dates:', {
              start: start.toISOString(),
              end: end.toISOString(),
              isStartDate: start instanceof Date,
              isEndDate: end instanceof Date,
            });
  
            newState.stage = 'slot_selected';
            newState.selectedSlot = {
              id: selectedSlot.id,
              date: selectedSlot.date,
              time: selectedSlot.time,
              startTime: start,
              endTime: end,
              duration: 30,
            };
  
            const name = extractName(userMessage);
            if (name) newState.userName = name;
  
            const email = extractEmail(userMessage);
            if (email) {
              newState.userEmail = email;
              newState.stage = 'collecting_phone';
  
              return {
                response: `Perfect! I've got you down for ${selectedSlot.date} at ${selectedSlot.time.split(' - ')[0]}.\n\n${name ? `Thanks, ${name}!` : ''} Your confirmation will be sent to ${email}.\n\nWould you like to add a phone number? (You can skip this by saying "no" or "skip")`,
                newState,
              };
            }
  
            return {
              response: `Great choice! I'll book ${selectedSlot.date} at ${selectedSlot.time.split(' - ')[0]} for you.\n\nWhat's your email address so I can send you a confirmation?`,
              newState,
            };
          } catch (error: any) {
            console.error('❌ Date parsing error:', error);
            return {
              response: `Sorry, I had trouble parsing that time slot. Could you try selecting a different one?`,
              newState: { ...newState, stage: 'slots_presented' },
            };
          }
        }
  
        return {
          response: `I didn't catch which time you prefer. Could you tell me the time (like "2pm") or say "first one", "second one", etc.?`,
          newState,
        };
      }
    }
  
    if (state.stage === 'slot_selected' || state.stage === 'collecting_email') {
      const email = extractEmail(userMessage);
      const name = extractName(userMessage);
  
      if (name && !state.userName) newState.userName = name;
  
      if (email) {
        newState.userEmail = email;
        newState.stage = 'collecting_phone';
  
        return {
          response: `Perfect! ${newState.userName ? `${newState.userName}, ` : ''}Your confirmation will be sent to ${email}.\n\nWould you like to add a phone number? (Optional - you can skip this by saying "no" or "skip")`,
          newState,
        };
      }
  
      return {
        response: `I didn't catch your email address. Could you share it? (For example: john@example.com)`,
        newState,
      };
    }
  
    if (state.stage === 'collecting_phone') {
      if (normalized.match(/^(no|skip|nope|don't|dont|pass|none)$/i)) {
        newState.stage = 'confirming';
  
        try {
          const actionParams = createBookingParams(state);
  
          return {
            response: `No problem! Let me confirm your booking:\n\n📅 ${state.selectedSlot?.date}\n🕐 ${state.selectedSlot?.time.split(' - ')[0]}\n${state.userName ? `👤 ${state.userName}\n` : ''}📧 ${state.userEmail}\n\nShould I confirm this booking?`,
            newState,
            needsAction: 'create_booking',
            actionParams,
          };
        } catch (error: any) {
          console.error('❌ Error creating booking params:', error);
          return {
            response: `Sorry, there was an error preparing your booking. Please try again.`,
            newState: { ...newState, stage: 'initial', attempts: 0 },
          };
        }
      }
  
      const phone = extractPhone(userMessage);
  
      if (phone) {
        newState.userPhone = phone;
        newState.stage = 'confirming';
  
        try {
          const actionParams = createBookingParams(state, phone);
  
          return {
            response: `Great! Let me confirm your booking:\n\n📅 ${state.selectedSlot?.date}\n🕐 ${state.selectedSlot?.time.split(' - ')[0]}\n${state.userName ? `👤 ${state.userName}\n` : ''}📧 ${state.userEmail}\n📱 ${phone}\n\nShould I confirm this booking?`,
            newState,
            needsAction: 'create_booking',
            actionParams,
          };
        } catch (error: any) {
          console.error('❌ Error creating booking params:', error);
          return {
            response: `Sorry, there was an error preparing your booking. Please try again.`,
            newState: { ...newState, stage: 'initial', attempts: 0 },
          };
        }
      }
  
      return {
        response: `I didn't catch your phone number. You can share it (like +1 555-123-4567) or say "skip" to continue without it.`,
        newState,
      };
    }
  
    if (state.stage === 'confirming') {
      if (normalized.match(/^(yes|yeah|yep|sure|ok|okay|confirm|book it|do it|go ahead)$/i)) {
        newState.stage = 'complete';
        return {
          response: 'Creating your booking now...',
          newState,
          needsAction: 'create_booking',
        };
      }
  
      if (normalized.match(/^(no|nope|cancel|stop|wait|nevermind|never mind)$/i)) {
        return {
          response: `No problem! Your booking has not been created. Would you like to choose a different time slot?`,
          newState: { ...newState, stage: 'initial', attempts: 0 },
        };
      }
  
      return {
        response: `Should I go ahead and confirm this booking? Just say "yes" to confirm or "no" to cancel.`,
        newState,
      };
    }
  
    return {
      response: `I'm not sure how to help with that. Would you like to schedule a meeting? Just tell me when you'd like to meet!`,
      newState: { ...newState, stage: 'initial' },
    };
  }