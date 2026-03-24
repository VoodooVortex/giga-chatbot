import { NextRequest } from "next/server";
import { proxyNotificationsRequest } from "./_proxy";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return proxyNotificationsRequest(request, `/api/v1/notifications${request.nextUrl.search}`);
}
