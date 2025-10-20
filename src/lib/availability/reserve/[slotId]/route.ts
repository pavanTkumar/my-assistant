/**
 * DELETE /api/availability/reserve/[slotId]
 * Release a slot reservation
 */

import { NextRequest } from 'next/server';
import { getAvailabilityEngineInstance } from '@/lib/availability/engine';
import {
  successResponse,
  internalErrorResponse,
  checkRateLimit,
  getClientIdentifier,
  handleOptionsRequest,
} from '@/lib/api/api-utils';

export async function OPTIONS() {
  return handleOptionsRequest();
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { slotId: string } }
) {
  try {
    // Rate limiting
    const clientId = getClientIdentifier(request);
    if (checkRateLimit(clientId, 30, 60000)) {
      return successResponse({ message: 'Rate limited but reservation will expire' });
    }

    // ==================================================================
    // RELEASE SLOT
    // ==================================================================

    const slotId = params.slotId;

    console.log(`🔓 Releasing slot reservation: ${slotId}`);

    const engine = getAvailabilityEngineInstance();
    await engine.releaseSlot(slotId);

    // ==================================================================
    // RETURN RESPONSE
    // ==================================================================

    return successResponse({
      released: true,
      slotId,
      message: 'Slot reservation released successfully',
    });
  } catch (error: any) {
    console.error('Release reservation API error:', error);
    return internalErrorResponse(error);
  }
}