/**
 * Rate Limiter
 * IP-based and user-based rate limiting using in-memory storage
 * Can be upgraded to Redis for production
 */

interface RateLimitEntry {
    count: number;
    resetTime: number;
}

interface RateLimitOptions {
    windowMs: number;
    maxRequests: number;
}

// In-memory store (use Redis in production)
const ipStore = new Map<string, RateLimitEntry>();
const userStore = new Map<string, RateLimitEntry>();

// Default limits
const DEFAULT_OPTIONS: RateLimitOptions = {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 30, // 30 requests per minute
};

const STRICT_OPTIONS: RateLimitOptions = {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 10, // 10 requests per minute for strict routes
};

/**
 * Check if request is within rate limit
 */
function checkLimit(
    store: Map<string, RateLimitEntry>,
    key: string,
    options: RateLimitOptions
): { allowed: boolean; remaining: number; resetTime: number } {
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || now > entry.resetTime) {
        // New window
        const resetTime = now + options.windowMs;
        store.set(key, { count: 1, resetTime });
        return {
            allowed: true,
            remaining: options.maxRequests - 1,
            resetTime,
        };
    }

    if (entry.count >= options.maxRequests) {
        // Limit exceeded
        return {
            allowed: false,
            remaining: 0,
            resetTime: entry.resetTime,
        };
    }

    // Increment count
    entry.count++;
    return {
        allowed: true,
        remaining: options.maxRequests - entry.count,
        resetTime: entry.resetTime,
    };
}

/**
 * Clean up expired entries periodically
 */
function cleanup(store: Map<string, RateLimitEntry>): void {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
        if (now > entry.resetTime) {
            store.delete(key);
        }
    }
}

// Cleanup every 5 minutes
setInterval(() => {
    cleanup(ipStore);
    cleanup(userStore);
}, 5 * 60 * 1000);

/**
 * Rate limit by IP address
 */
export function rateLimitByIp(
    ip: string,
    options: Partial<RateLimitOptions> = {}
): { allowed: boolean; remaining: number; resetTime: number } {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    return checkLimit(ipStore, ip, opts);
}

/**
 * Rate limit by user ID
 */
export function rateLimitByUser(
    userId: string,
    options: Partial<RateLimitOptions> = {}
): { allowed: boolean; remaining: number; resetTime: number } {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    return checkLimit(userStore, userId, opts);
}

/**
 * Combined rate limit - checks both IP and user
 * Returns the more restrictive limit
 */
export function rateLimit(
    ip: string,
    userId?: string,
    options: Partial<RateLimitOptions> = {}
): {
    allowed: boolean;
    remaining: number;
    resetTime: number;
    limitType: "ip" | "user";
} {
    const ipResult = rateLimitByIp(ip, options);

    if (!ipResult.allowed) {
        return { ...ipResult, limitType: "ip" };
    }

    if (userId) {
        const userResult = rateLimitByUser(userId, options);
        if (!userResult.allowed) {
            return { ...userResult, limitType: "user" };
        }

        // Return the more restrictive limit
        if (userResult.remaining < ipResult.remaining) {
            return { ...userResult, limitType: "user" };
        }
    }

    return { ...ipResult, limitType: "ip" };
}

/**
 * Get client IP from request
 */
export function getClientIp(req: Request): string {
    // Check for forwarded IP (behind proxy)
    const forwarded = req.headers.get("x-forwarded-for");
    if (forwarded) {
        return forwarded.split(",")[0].trim();
    }

    const realIp = req.headers.get("x-real-ip");
    if (realIp) {
        return realIp;
    }

    // Fallback - this won't work well in production
    return "unknown";
}
