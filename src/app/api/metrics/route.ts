/**
 * Metrics Endpoint
 * Expose metrics in Prometheus format
 */

import { NextResponse } from "next/server";
import { metrics } from "@/lib/observability/metrics";

/**
 * GET /api/metrics
 * Returns metrics in Prometheus format
 */
export async function GET() {
    const metricsData = metrics.getPrometheusMetrics();

    return new NextResponse(metricsData, {
        headers: {
            "Content-Type": "text/plain; version=0.0.4",
        },
    });
}
