export const dynamic = 'force-dynamic';
/**
 * POST /api/availability/reserve
 * Reserve a slot temporarily (5 minutes)
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
  checkRateLimit,
  getClientIdentifier,
  handleOptionsRequest,
} from '@/lib/api/api-utils';

export async function OPTIONS() {
  return handleOptionsRequest();
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const clientId = getClientIdentifier(request);
    if (checkRateLimit(clientId, 10, 60000)) {
      // 10 reservations per minute
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
    const fieldErrors = validateRequiredFields(body, ['slotId', 'userId']);
    if (fieldErrors.length > 0) {
      return validationError(fieldErrors);
    }

    const { slotId, userId, slot } = body;

    // ==================================================================
    // RESERVE SLOT
    // ==================================================================

    console.log(`🔒 Reserving slot: ${slotId} for user: ${userId}`);

    const engine = getAvailabilityEngineInstance();
    const reserved = await engine.reserveSlot(slot, userId);

    if (!reserved) {
      return errorResponse(
        'Slot is already reserved or unavailable',
        'RESERVATION_FAILED',
        409
      );
    }

    // ==================================================================
    // RETURN RESPONSE
    // ==================================================================

    return successResponse(
      {
        reserved: true,
        slotId,
        userId,
        expiresIn: 300, // 5 minutes
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        message: 'Slot reserved successfully. Complete booking within 5 minutes.',
      },
      201
    );
  } catch (error: any) {
    console.error('Slot reservation API error:', error);
    return internalErrorResponse(error);
  }
}