/**
 * Metrics Collection
 * Simple in-memory metrics for monitoring
 */

interface CounterMetric {
    name: string;
    value: number;
    labels: Record<string, string>;
}

interface HistogramMetric {
    name: string;
    labels: Record<string, string>;
    buckets: number[];
    values: number[];
    sum: number;
    count: number;
}

interface GaugeMetric {
    name: string;
    value: number;
    labels: Record<string, string>;
}

class MetricsCollector {
    private counters = new Map<string, CounterMetric>();
    private histograms = new Map<string, HistogramMetric>();
    private gauges = new Map<string, GaugeMetric>();

    /**
     * Increment a counter
     */
    counter(name: string, labels: Record<string, string> = {}, value = 1): void {
        const key = `${name}${JSON.stringify(labels)}`;
        const existing = this.counters.get(key);

        if (existing) {
            existing.value += value;
        } else {
            this.counters.set(key, { name, value, labels });
        }
    }

    /**
     * Record a histogram value (e.g., latency)
     */
    histogram(
        name: string,
        value: number,
        labels: Record<string, string> = {},
        buckets: number[] = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000]
    ): void {
        const key = `${name}${JSON.stringify(labels)}`;
        const existing = this.histograms.get(key);

        let metric: HistogramMetric;

        if (!existing) {
            metric = {
                name,
                labels,
                buckets,
                values: new Array(buckets.length).fill(0),
                sum: 0,
                count: 0,
            };
            this.histograms.set(key, metric);
        } else {
            metric = existing;
        }

        // Find bucket
        for (let i = 0; i < metric.buckets.length; i++) {
            if (value <= metric.buckets[i]) {
                metric.values[i]++;
                break;
            }
        }

        metric.sum += value;
        metric.count++;
    }

    /**
     * Set a gauge value
     */
    gauge(name: string, value: number, labels: Record<string, string> = {}): void {
        const key = `${name}${JSON.stringify(labels)}`;
        this.gauges.set(key, { name, value, labels });
    }

    /**
     * Get all metrics as Prometheus format
     */
    getPrometheusMetrics(): string {
        const lines: string[] = [];

        // Counters
        for (const [, metric] of this.counters) {
            const labelStr = Object.entries(metric.labels)
                .map(([k, v]) => `${k}="${v}"`)
                .join(",");
            lines.push(`# TYPE ${metric.name} counter`);
            lines.push(`${metric.name}{${labelStr}} ${metric.value}`);
        }

        // Gauges
        for (const [, metric] of this.gauges) {
            const labelStr = Object.entries(metric.labels)
                .map(([k, v]) => `${k}="${v}"`)
                .join(",");
            lines.push(`# TYPE ${metric.name} gauge`);
            lines.push(`${metric.name}{${labelStr}} ${metric.value}`);
        }

        // Histograms
        for (const [, metric] of this.histograms) {
            const labelStr = Object.entries(metric.labels)
                .map(([k, v]) => `${k}="${v}"`)
                .join(",");
            lines.push(`# TYPE ${metric.name} histogram`);

            // Buckets
            for (let i = 0; i < metric.buckets.length; i++) {
                const bucketLabels = labelStr
                    ? `${labelStr},le="${metric.buckets[i]}"`
                    : `le="${metric.buckets[i]}"`;
                lines.push(`${metric.name}_bucket{${bucketLabels}} ${metric.values[i]}`);
            }

            // +Inf bucket
            const infLabels = labelStr ? `${labelStr},le="+Inf"` : `le="+Inf"`;
            lines.push(`${metric.name}_bucket{${infLabels}} ${metric.count}`);

            lines.push(`${metric.name}_sum{${labelStr}} ${metric.sum}`);
            lines.push(`${metric.name}_count{${labelStr}} ${metric.count}`);
        }

        return lines.join("\n");
    }

    /**
     * Get metrics as JSON
     */
    getJSONMetrics(): {
        counters: CounterMetric[];
        gauges: GaugeMetric[];
        histograms: HistogramMetric[];
    } {
        return {
            counters: Array.from(this.counters.values()),
            gauges: Array.from(this.gauges.values()),
            histograms: Array.from(this.histograms.values()),
        };
    }

    /**
     * Reset all metrics
     */
    reset(): void {
        this.counters.clear();
        this.gauges.clear();
        this.histograms.clear();
    }
}

// Singleton instance
export const metrics = new MetricsCollector();

// Predefined metric names
export const METRIC_NAMES = {
    // API metrics
    API_REQUESTS_TOTAL: "api_requests_total",
    API_REQUEST_DURATION: "api_request_duration_ms",

    // Chat metrics
    CHAT_MESSAGES_TOTAL: "chat_messages_total",
    CHAT_ROOMS_ACTIVE: "chat_rooms_active",

    // RAG Worker metrics
    WORKER_JOBS_TOTAL: "worker_jobs_total",
    WORKER_JOBS_DURATION: "worker_jobs_duration_ms",
    WORKER_JOBS_FAILED: "worker_jobs_failed_total",
    WORKER_QUEUE_SIZE: "worker_queue_size",

    // AI metrics
    AI_REQUESTS_TOTAL: "ai_requests_total",
    AI_REQUEST_DURATION: "ai_request_duration_ms",
    AI_TOKENS_USED: "ai_tokens_used_total",
} as const;
