/**
 * CSRF Protection
 * Simple token-based CSRF protection for write operations
 */

import { randomBytes } from "crypto";

const CSRF_TOKEN_LENGTH = 32;
const TOKEN_HEADER = "x-csrf-token";

// In-memory token store (use Redis in production with TTL)
const tokenStore = new Map<string, { token: string; expires: number }>();

// Token expiration: 1 hour
const TOKEN_EXPIRY_MS = 60 * 60 * 1000;

/**
 * Generate a new CSRF token for a session
 */
export function generateCsrfToken(sessionId: string): string {
    const token = randomBytes(CSRF_TOKEN_LENGTH).toString("hex");
    const expires = Date.now() + TOKEN_EXPIRY_MS;

    tokenStore.set(sessionId, { token, expires });

    return token;
}

/**
 * Validate CSRF token
 */
export function validateCsrfToken(
    sessionId: string,
    providedToken: string
): boolean {
    const stored = tokenStore.get(sessionId);

    if (!stored) {
        return false;
    }

    // Check expiration
    if (Date.now() > stored.expires) {
        tokenStore.delete(sessionId);
        return false;
    }

    // Constant time comparison to prevent timing attacks
    return timingSafeEqual(stored.token, providedToken);
}

/**
 * Clear CSRF token (on logout)
 */
export function clearCsrfToken(sessionId: string): void {
    tokenStore.delete(sessionId);
}

/**
 * Get CSRF token from request headers
 */
export function getCsrfTokenFromRequest(req: Request): string | null {
    return req.headers.get(TOKEN_HEADER);
}

/**
 * Constant time string comparison
 */
function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
        return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }

    return result === 0;
}

/**
 * Cleanup expired tokens
 */
function cleanup(): void {
    const now = Date.now();
    for (const [key, value] of tokenStore.entries()) {
        if (now > value.expires) {
            tokenStore.delete(key);
        }
    }
}

// Cleanup every 10 minutes
setInterval(cleanup, 10 * 60 * 1000);
