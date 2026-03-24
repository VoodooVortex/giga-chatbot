/**
 * Metrics Endpoint
 * Expose metrics in Prometheus format
 */

import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { metrics } from "@/lib/observability/metrics";

/**
 * GET /api/metrics
 * Returns metrics in Prometheus format by default.
 * Add `?format=json` or send `Accept: application/json` for a JSON snapshot.
 */
export async function GET(request: NextRequest) {
    const format = request.nextUrl.searchParams.get("format")?.toLowerCase();
    const wantsJson =
        format === "json" ||
        format === "application/json" ||
        request.headers.get("accept")?.includes("application/json") === true;

    if (wantsJson) {
        return NextResponse.json(metrics.getJSONMetrics(), {
            headers: {
                "Cache-Control": "no-store",
            },
        });
    }

    const metricsData = metrics.getPrometheusMetrics();

    return new NextResponse(metricsData, {
        headers: {
            "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
            "Cache-Control": "no-store",
        },
    });
}
