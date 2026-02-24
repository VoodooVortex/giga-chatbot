import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyToken, extractTokenFromCookie, type TokenPayload } from "./jwt";
import { env } from "@/lib/config";

const COOKIE_NAME = env.COOKIE_NAME;

export interface Session {
    user: {
        id: string;
        roles: string[];
    };
    expiresAt: number;
}

/**
 * Get current session from cookies
 * Returns null if no valid session
 */
export async function getSession(): Promise<Session | null> {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get(COOKIE_NAME)?.value;

        if (!token) {
            return null;
        }

        const payload = await verifyToken(token);

        return {
            user: {
                id: payload.sub || "",
                roles: Array.isArray(payload.roles) ? payload.roles : [],
            },
            expiresAt: payload.exp || 0,
        };
    } catch {
        return null;
    }
}

/**
 * Require authentication - redirects to login if not authenticated
 */
export async function requireAuth(redirectUrl?: string): Promise<Session> {
    const session = await getSession();

    if (!session) {
        const currentPath = redirectUrl || "/chat";
        redirect(`/login?next=${encodeURIComponent(currentPath)}`);
    }

    return session;
}

/**
 * Check if user has required roles
 */
export function requireRoles(session: Session, requiredRoles: string[]): void {
    const hasRole = requiredRoles.some((role) => session.user.roles.includes(role));

    if (!hasRole) {
        throw new Error("Forbidden: Insufficient permissions");
    }
}

/**
 * Get session for API routes
 */
export async function getApiSession(cookieHeader: string | null): Promise<Session | null> {
    try {
        const token = extractTokenFromCookie(cookieHeader);
        if (!token) return null;

        const payload = await verifyToken(token);

        return {
            user: {
                id: payload.sub || "",
                roles: Array.isArray(payload.roles) ? payload.roles : [],
            },
            expiresAt: payload.exp || 0,
        };
    } catch {
        return null;
    }
}