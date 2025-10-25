/**
 * POST /api/bookings
 * Create a new booking
 */

import { NextRequest } from 'next/server';
import { createBooking } from '@/lib/booking/booking-service';
import {
  successResponse,
  errorResponse,
  validationError,
  internalErrorResponse,
  parseJsonBody,
  validateRequiredFields,
  parseDateParam,
} from '@/lib/api/api-utils';

export async function POST(request: NextRequest) {
  try {
    const body = await parseJsonBody(request);

    const requiredFields = ['userName', 'userEmail', 'slotId', 'startTime', 'endTime', 'duration'];
    const fieldErrors = validateRequiredFields(body, requiredFields);

    if (fieldErrors.length > 0) {
      return validationError(fieldErrors);
    }

    let startTime: Date;
    let endTime: Date;

    try {
      startTime = parseDateParam(body.startTime, 'startTime');
      endTime = parseDateParam(body.endTime, 'endTime');
    } catch (error: any) {
      return validationError([error.message]);
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.userEmail)) {
      return validationError(['Invalid email format']);
    }

    console.log('📅 Creating booking for:', body.userName);

    const result = await createBooking({
      userName: body.userName,
      userEmail: body.userEmail,
      userPhone: body.userPhone,
      slotId: body.slotId,
      startTime,
      endTime,
      duration: body.duration,
      meetingTypeId: body.meetingTypeId,
      title: body.title,
      description: body.description,
      notes: body.notes,
      timezone: body.timezone || 'Asia/Kolkata',
      source: 'api',
    });

    return successResponse(
      {
        ...result,
        message: 'Booking created successfully! Check your email for confirmation.',
      },
      201
    );
  } catch (error: any) {
    console.error('❌ Booking API error:', error);

    if (error.message.includes('no longer available') || error.message.includes('reserved')) {
      return errorResponse(error.message, 'SLOT_UNAVAILABLE', 409);
    }

    return internalErrorResponse(error);
  }
}