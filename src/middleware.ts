import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { extractTokenFromCookie, verifyToken } from "@/lib/auth/jwt";
import { env } from "@/lib/config";

const COOKIE_NAME = env.COOKIE_NAME;
const BASE_PATH = env.BASE_PATH;

// Paths that don't require authentication
const PUBLIC_PATHS = [
    "/api/healthz",
    "/api/auth/session",
];

// Check if path is public
function isPublicPath(path: string): boolean {
    return PUBLIC_PATHS.some((publicPath) =>
        path.startsWith(`${BASE_PATH}${publicPath}`)
    );
}

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Skip middleware for public paths
    if (isPublicPath(pathname)) {
        return NextResponse.next();
    }

    // Skip middleware for API routes (they handle auth separately)
    if (pathname.startsWith(`${BASE_PATH}/api/`)) {
        return NextResponse.next();
    }

    // Check for auth cookie
    const cookie = request.cookies.get(COOKIE_NAME)?.value;

    if (!cookie) {
        // Redirect to login page with return URL
        const loginUrl = new URL("/login", request.url);
        loginUrl.searchParams.set("next", pathname);
        return NextResponse.redirect(loginUrl);
    }

    try {
        // Verify the token
        await verifyToken(cookie);
        return NextResponse.next();
    } catch {
        // Token is invalid or expired, redirect to login
        const loginUrl = new URL("/login", request.url);
        loginUrl.searchParams.set("next", pathname);
        return NextResponse.redirect(loginUrl);
    }
}

export const config = {
    matcher: [
        // Match all paths under /chat except static files
        "/chat/:path*",
        // Exclude static files and _next
        "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    ],
};