/**
 * Database utility functions
 * Hashing, encryption, and common operations
 */

import crypto from 'crypto';

// ============================================================================
// HASHING (For Privacy)
// ============================================================================

/**
 * Hash email for privacy-preserving storage
 * Uses SHA-256 for consistent, one-way hashing
 */
export function hashEmail(email: string): string {
  return crypto
    .createHash('sha256')
    .update(email.toLowerCase().trim())
    .digest('hex');
}

/**
 * Hash IP address for rate limiting
 */
export function hashIP(ip: string): string {
  return crypto
    .createHash('sha256')
    .update(ip)
    .digest('hex');
}

// ============================================================================
// CONFIRMATION CODES
// ============================================================================

/**
 * Generate unique confirmation code for bookings
 * Format: ABC-123-XYZ (easy to read/type)
 */
export function generateConfirmationCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed ambiguous chars
  const segments = 3;
  const segmentLength = 3;
  
  const code = Array.from({ length: segments }, () => {
    return Array.from({ length: segmentLength }, () => {
      return chars[Math.floor(Math.random() * chars.length)];
    }).join('');
  }).join('-');
  
  return code;
}

// ============================================================================
// SESSION IDS
// ============================================================================

/**
 * Generate unique session ID for conversations
 */
export function generateSessionId(): string {
  return `sess_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

// ============================================================================
// TIME UTILITIES
// ============================================================================

/**
 * Get start of week for a given date
 */
export function getStartOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday as first day
  return new Date(d.setDate(diff));
}

/**
 * Get end of week for a given date
 */
export function getEndOfWeek(date: Date): Date {
  const start = getStartOfWeek(date);
  return new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
}

/**
 * Check if date is within booking window
 */
export function isWithinBookingWindow(
  date: Date,
  minAdvanceHours: number,
  maxAdvanceDays: number
): boolean {
  const now = new Date();
  const minDate = new Date(now.getTime() + minAdvanceHours * 60 * 60 * 1000);
  const maxDate = new Date(now.getTime() + maxAdvanceDays * 24 * 60 * 60 * 1000);
  
  return date >= minDate && date <= maxDate;
}