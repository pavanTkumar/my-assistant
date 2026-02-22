export const dynamic = 'force-dynamic';
/**
 * POST /api/availability/check
 * Check if a specific time slot is available
 */

import { NextRequest } from 'next/server';
import { getAvailabilityEngineInstance } from '@/lib/availability/engine';
import {
  successResponse,
  errorResponse,
  validationError,
  internalErrorResponse,
  parseJsonBody,
  validateRequiredFields,
  parseDateParam,
  checkRateLimit,
  getClientIdentifier,
  handleOptionsRequest,
  getTimezoneFromRequest,
} from '@/lib/api/api-utils';

export async function OPTIONS() {
  return handleOptionsRequest();
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const clientId = getClientIdentifier(request);
    if (checkRateLimit(clientId, 30, 60000)) {
      // 30 requests per minute
      return errorResponse('Too many requests', 'RATE_LIMIT_EXCEEDED', 429);
    }

    // ==================================================================
    // PARSE BODY
    // ==================================================================

    let body: any;
    try {
      body = await parseJsonBody(request);
    } catch (error: any) {
      return validationError(['Invalid JSON body']);
    }

    // Validate required fields
    const fieldErrors = validateRequiredFields(body, ['start', 'end']);
    if (fieldErrors.length > 0) {
      return validationError(fieldErrors);
    }

    // Parse dates
    let start: Date;
    let end: Date;

    try {
      start = parseDateParam(body.start, 'start');
      end = parseDateParam(body.end, 'end');
    } catch (error: any) {
      return validationError([error.message]);
    }

    // Validate slot
    if (start >= end) {
      return validationError(['Start time must be before end time']);
    }

    const timezone = body.timezone || getTimezoneFromRequest(request);

    // ==================================================================
    // CHECK AVAILABILITY
    // ==================================================================

    console.log(`🔍 Checking slot: ${start.toISOString()} - ${end.toISOString()}`);

    const engine = getAvailabilityEngineInstance();
    const result = await engine.isSlotAvailable(start, end, timezone);

    // ==================================================================
    // RETURN RESPONSE
    // ==================================================================

    return successResponse({
      available: result.available,
      reason: result.reason,
      slot: {
        start: start.toISOString(),
        end: end.toISOString(),
        timezone: timezone || 'default',
      },
    });
  } catch (error: any) {
    console.error('Slot check API error:', error);
    return internalErrorResponse(error);
  }
}