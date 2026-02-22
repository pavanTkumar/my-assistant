export const dynamic = 'force-dynamic';
/**
 * GET /api/availability/[date]
 * Get availability for a specific date
 */

import { NextRequest } from 'next/server';
import { getAvailabilityEngineInstance } from '@/lib/availability/engine';
import {
  successResponse,
  errorResponse,
  validationError,
  internalErrorResponse,
  parseDateParam,
  parseIntParam,
  getQueryParam,
  getTimezoneFromRequest,
  checkRateLimit,
  getClientIdentifier,
  handleOptionsRequest,
} from '@/lib/api/api-utils';

export async function OPTIONS() {
  return handleOptionsRequest();
}

export async function GET(request: NextRequest, { params }: { params: { date: string } }) {
  try {
    // Rate limiting
    const clientId = getClientIdentifier(request);
    if (checkRateLimit(clientId, 60, 60000)) {
      return errorResponse('Too many requests', 'RATE_LIMIT_EXCEEDED', 429);
    }

    // ==================================================================
    // PARSE PARAMETERS
    // ==================================================================

    const dateStr = params.date;
    const durationStr = getQueryParam(request, 'duration');

    if (!durationStr) {
      return validationError(['Missing required parameter: duration']);
    }

    let date: Date;
    let duration: number;

    try {
      date = parseDateParam(dateStr, 'date');
      duration = parseIntParam(durationStr, 'duration');
    } catch (error: any) {
      return validationError([error.message]);
    }

    // Validate duration
    if (duration < 15 || duration > 480 || duration % 15 !== 0) {
      return validationError(['Duration must be between 15-480 minutes and a multiple of 15']);
    }

    // Get timezone
    const timezone = getTimezoneFromRequest(request);

    // ==================================================================
    // QUERY AVAILABILITY
    // ==================================================================

    console.log(`🔍 Availability query for date: ${dateStr}, duration: ${duration}min`);

    const engine = getAvailabilityEngineInstance();
    const slots = await engine.getAvailabilityForDate(date, duration, timezone);

    // ==================================================================
    // RETURN RESPONSE
    // ==================================================================

    return successResponse({
      date: dateStr,
      duration,
      timezone: timezone || 'default',
      slotsFound: slots.length,
      slots,
    });
  } catch (error: any) {
    console.error('Date availability API error:', error);
    return internalErrorResponse(error);
  }
}