import { jwtVerify, SignJWT, type JWTPayload as JoseJWTPayload } from "jose";
import { env } from "@/lib/config";

const JWT_SECRET = new TextEncoder().encode(env.JWT_SECRET);
const COOKIE_NAME = env.COOKIE_NAME;

export interface TokenPayload extends JoseJWTPayload {
    sub: string; // user_id
    roles: string[];
    iss: string;
    aud: string;
}

/**
 * Verify a JWT token
 */
export async function verifyToken(token: string): Promise<TokenPayload> {
    try {
        const { payload } = await jwtVerify(token, JWT_SECRET, {
            issuer: "orbistrack",
            audience: "orbistrack-web",
        });
        return payload as TokenPayload;
    } catch (error) {
        throw new Error("Invalid or expired token");
    }
}

/**
 * Extract token from cookie string
 */
export function extractTokenFromCookie(cookieHeader: string | null): string | null {
    if (!cookieHeader) return null;

    const cookies = cookieHeader.split(";");
    for (const cookie of cookies) {
        const [name, value] = cookie.trim().split("=");
        if (name === COOKIE_NAME) {
            return decodeURIComponent(value);
        }
    }
    return null;
}

/**
 * Check if user has required role
 */
export function hasRole(payload: TokenPayload, requiredRoles: string[]): boolean {
    if (!requiredRoles.length) return true;
    const roles = payload.roles || [];
    return requiredRoles.some((role) => roles.includes(role));
}

/**
 * Create a new JWT token (for testing purposes)
 */
export async function createToken(
    userId: string,
    roles: string[] = ["user"],
    expiresIn: string = "24h"
): Promise<string> {
    const token = await new SignJWT({
        sub: userId,
        roles,
    })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setIssuer("orbistrack")
        .setAudience("orbistrack-web")
        .setExpirationTime(expiresIn)
        .sign(JWT_SECRET);

    return token;
}
