import { NextRequest } from "next/server";
import { proxyNotificationsRequest } from "../_proxy";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  return proxyNotificationsRequest(request, "/api/v1/notifications/read-all", {
    method: "PATCH",
  });
}
