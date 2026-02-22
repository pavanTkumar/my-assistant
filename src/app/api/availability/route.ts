export const dynamic = 'force-dynamic';
/**
 * GET /api/availability
 * Main availability endpoint - returns available slots for date range
 */

import { NextRequest } from 'next/server';
import { getAvailabilityEngineInstance } from '@/lib/availability/engine';
import {
  successResponse,
  errorResponse,
  validationError,
  internalErrorResponse,
  getQueryParam,
  parseDateParam,
  parseIntParam,
  validateDateRangeParams,
  checkRateLimit,
  getClientIdentifier,
  getTimezoneFromRequest,
  handleOptionsRequest,
} from '@/lib/api/api-utils';
import { AvailabilityRequest } from '@/lib/availability/types';

// ============================================================================
// HANDLE OPTIONS (CORS)
// ============================================================================

export async function OPTIONS() {
  return handleOptionsRequest();
}

// ============================================================================
// GET /api/availability
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const clientId = getClientIdentifier(request);
    if (checkRateLimit(clientId, 60, 60000)) {
      // 60 requests per minute
      return errorResponse('Too many requests', 'RATE_LIMIT_EXCEEDED', 429);
    }

    // ==================================================================
    // PARSE QUERY PARAMETERS
    // ==================================================================

    const startDateStr = getQueryParam(request, 'startDate');
    const endDateStr = getQueryParam(request, 'endDate');
    const durationStr = getQueryParam(request, 'duration');

    // Validate required parameters
    const errors: string[] = [];

    if (!startDateStr) errors.push('Missing required parameter: startDate');
    if (!endDateStr) errors.push('Missing required parameter: endDate');
    if (!durationStr) errors.push('Missing required parameter: duration');

    if (errors.length > 0) {
      return validationError(errors);
    }

    // Parse dates
    let startDate: Date;
    let endDate: Date;
    let duration: number;

    try {
      startDate = parseDateParam(startDateStr!, 'startDate');
      endDate = parseDateParam(endDateStr!, 'endDate');
      duration = parseIntParam(durationStr, 'duration');
    } catch (error: any) {
      return validationError([error.message]);
    }

    // Validate date range
    const dateErrors = validateDateRangeParams(startDate, endDate);
    if (dateErrors.length > 0) {
      return validationError(dateErrors);
    }

    // Validate duration
    if (duration < 15 || duration > 480) {
      return validationError(['Duration must be between 15 and 480 minutes']);
    }

    if (duration % 15 !== 0) {
      return validationError(['Duration must be a multiple of 15 minutes']);
    }

    // Optional parameters
    const includeWeekends = getQueryParam(request, 'includeWeekends') === 'true';
    const maxSlotsPerDay = parseIntParam(
      getQueryParam(request, 'maxSlotsPerDay'),
      'maxSlotsPerDay',
      16
    );
    const timezone = getTimezoneFromRequest(request);
    const timeOfDayPref = getQueryParam(request, 'timeOfDay')?.split(',');
    const urgency = getQueryParam(request, 'urgency') as 'urgent' | 'flexible' | undefined;

    // ==================================================================
    // BUILD REQUEST
    // ==================================================================

    const availabilityRequest: AvailabilityRequest = {
      startDate,
      endDate,
      duration,
      includeWeekends,
      maxSlotsPerDay,
      preferences: {
        timezone,
        timeOfDay: timeOfDayPref as any,
        urgency,
      },
    };

    // ==================================================================
    // QUERY AVAILABILITY
    // ==================================================================

    console.log('🔍 Availability query:', {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      duration,
      timezone: timezone || 'default',
    });

    const engine = getAvailabilityEngineInstance();
    const response = await engine.getAvailability(availabilityRequest);

    // ==================================================================
    // RETURN RESPONSE
    // ==================================================================

    return successResponse({
      ...response,
      apiVersion: '1.0',
      documentation: '/api/docs/availability',
    });
  } catch (error: any) {
    console.error('Availability API error:', error);
    return internalErrorResponse(error);
  }
}