/**
 * API Utilities
 * Helper functions for Next.js API routes
 */

import { NextRequest, NextResponse } from 'next/server';

// ============================================================================
// RESPONSE HELPERS
// ============================================================================

/**
 * Success response
 */
export function successResponse(data: any, status: number = 200) {
  return NextResponse.json(
    {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    },
    { status }
  );
}

/**
 * Error response
 */
export function errorResponse(
  message: string,
  code: string = 'ERROR',
  status: number = 400,
  details?: any
) {
  return NextResponse.json(
    {
      success: false,
      error: {
        code,
        message,
        details,
      },
      timestamp: new Date().toISOString(),
    },
    { status }
  );
}

/**
 * Validation error response
 */
export function validationError(errors: string[]) {
  return errorResponse('Validation failed', 'VALIDATION_ERROR', 400, { errors });
}

/**
 * Not found response
 */
export function notFoundResponse(resource: string = 'Resource') {
  return errorResponse(`${resource} not found`, 'NOT_FOUND', 404);
}

/**
 * Rate limit response
 */
export function rateLimitResponse() {
  return errorResponse('Too many requests', 'RATE_LIMIT_EXCEEDED', 429);
}

/**
 * Internal error response
 */
export function internalErrorResponse(error?: any) {
  console.error('Internal server error:', error);
  return errorResponse(
    'Internal server error',
    'INTERNAL_ERROR',
    500,
    process.env.NODE_ENV === 'development' ? { error: error?.message } : undefined
  );
}

// ============================================================================
// REQUEST PARSING
// ============================================================================

/**
 * Parse JSON body safely
 */
export async function parseJsonBody(request: NextRequest): Promise<any> {
  try {
    return await request.json();
  } catch (error) {
    throw new Error('Invalid JSON body');
  }
}

/**
 * Get query parameter
 */
export function getQueryParam(
  request: NextRequest,
  param: string,
  defaultValue?: string
): string | undefined {
  return request.nextUrl.searchParams.get(param) || defaultValue;
}

/**
 * Get required query parameter
 */
export function getRequiredQueryParam(request: NextRequest, param: string): string {
  const value = getQueryParam(request, param);
  if (!value) {
    throw new Error(`Missing required parameter: ${param}`);
  }
  return value;
}

/**
 * Parse date from query parameter
 */
export function parseDateParam(dateStr: string, paramName: string = 'date'): Date {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format for ${paramName}: ${dateStr}`);
  }
  return date;
}

/**
 * Parse integer from query parameter
 */
export function parseIntParam(
  value: string | undefined,
  paramName: string,
  defaultValue?: number
): number {
  if (!value) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Missing required parameter: ${paramName}`);
  }

  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Invalid integer for ${paramName}: ${value}`);
  }

  return parsed;
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate required fields in body
 */
export function validateRequiredFields(body: any, fields: string[]): string[] {
  const errors: string[] = [];

  for (const field of fields) {
    if (!body[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  return errors;
}

/**
 * Validate date range
 */
export function validateDateRangeParams(startDate: Date, endDate: Date): string[] {
  const errors: string[] = [];

  if (startDate >= endDate) {
    errors.push('startDate must be before endDate');
  }

  const now = new Date();
  if (startDate < now) {
    errors.push('startDate cannot be in the past');
  }

  const maxDays = 90;
  const daysDiff = Math.ceil(
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysDiff > maxDays) {
    errors.push(`Date range cannot exceed ${maxDays} days`);
  }

  return errors;
}

// ============================================================================
// CORS
// ============================================================================

/**
 * Add CORS headers to response
 */
export function addCorsHeaders(response: NextResponse): NextResponse {
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return response;
}

/**
 * Handle OPTIONS request (CORS preflight)
 */
export function handleOptionsRequest(): NextResponse {
  const response = new NextResponse(null, { status: 204 });
  return addCorsHeaders(response);
}

// ============================================================================
// RATE LIMITING (Simple in-memory implementation)
// ============================================================================

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

/**
 * Simple rate limiting
 * Returns true if rate limit exceeded
 */
export function checkRateLimit(
  identifier: string,
  maxRequests: number = 60,
  windowMs: number = 60000
): boolean {
  const now = Date.now();
  const record = rateLimitStore.get(identifier);

  if (!record || now > record.resetAt) {
    // Create new record
    rateLimitStore.set(identifier, {
      count: 1,
      resetAt: now + windowMs,
    });
    return false;
  }

  if (record.count >= maxRequests) {
    return true; // Rate limit exceeded
  }

  // Increment count
  record.count++;
  rateLimitStore.set(identifier, record);
  return false;
}

/**
 * Get client identifier for rate limiting
 */
export function getClientIdentifier(request: NextRequest): string {
  // Try to get IP address
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0] : request.headers.get('x-real-ip') || 'unknown';

  // Could also use user ID if authenticated
  return ip;
}

// ============================================================================
// TIMEZONE HELPERS
// ============================================================================

/**
 * Get timezone from request headers
 */
export function getTimezoneFromRequest(request: NextRequest): string | undefined {
  return request.headers.get('X-Timezone') || request.headers.get('timezone') || undefined;
}