import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/config";
import {
  buildCookieHeaderFromToken,
  extractTokenFromAuthorizationHeader,
  extractTokenFromCookie,
} from "@/lib/auth/jwt";
import { getApiSession } from "@/lib/auth/session";

const MAIN_APP_URL = env.MAIN_APP_URL;

function getForwardCookieHeader(request: NextRequest): string | null {
  const cookieHeader = request.headers.get("cookie");
  const authorizationHeader = request.headers.get("authorization");

  if (cookieHeader && extractTokenFromCookie(cookieHeader)) {
    return cookieHeader;
  }

  const token = extractTokenFromAuthorizationHeader(authorizationHeader);
  if (token) {
    return buildCookieHeaderFromToken(token);
  }

  return cookieHeader;
}

async function buildUnauthenticatedResponse() {
  return NextResponse.json(
    {
      error: "Unauthorized",
      code: "UNAUTHENTICATED",
      message: "No valid session found",
    },
    { status: 401 },
  );
}

function buildUpstreamFailureResponse(
  endpoint: string,
  error: unknown,
  status = 502,
) {
  const message =
    error instanceof Error && error.message
      ? error.message
      : "Failed to contact notifications service";

  return NextResponse.json(
    {
      error: "Notifications proxy request failed",
      code: "UPSTREAM_UNAVAILABLE",
      message,
      endpoint,
    },
    {
      status,
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}

export async function proxyNotificationsRequest(
  request: NextRequest,
  endpoint: string,
  init: {
    method?: string;
    body?: string | null;
  } = {},
) {
  const cookieHeader = request.headers.get("cookie");
  const authorizationHeader = request.headers.get("authorization");
  const session = await getApiSession(cookieHeader, authorizationHeader);

  if (!session) {
    return buildUnauthenticatedResponse();
  }

  const headers = new Headers();
  headers.set("Accept", "application/json");

  const forwardCookie = getForwardCookieHeader(request);
  if (forwardCookie) {
    headers.set("Cookie", forwardCookie);
  }

  if (authorizationHeader) {
    headers.set("Authorization", authorizationHeader);
  }

  if (init.body) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`${MAIN_APP_URL}${endpoint}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body ?? undefined,
      cache: "no-store",
    });
  } catch (error) {
    return buildUpstreamFailureResponse(endpoint, error);
  }

  const responseHeaders = new Headers();
  const contentType = response.headers.get("content-type");
  if (contentType && response.ok) {
    responseHeaders.set("content-type", contentType);
  }
  responseHeaders.set("cache-control", "no-store");

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    return NextResponse.json(
      {
        error: "Notifications upstream returned an error",
        code: "UPSTREAM_HTTP_ERROR",
        message: `Notifications service returned HTTP ${response.status}`,
        endpoint,
        upstreamStatus: response.status,
        details: details ? details.slice(0, 500) : undefined,
      },
      {
        status: response.status,
        headers: responseHeaders,
      },
    );
  }

  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: responseHeaders,
  });
}
