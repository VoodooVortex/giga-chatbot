/**
 * Metrics Collection
 * Simple in-memory metrics with Prometheus and JSON snapshots.
 */

import { logger } from "./logger";

export interface CounterMetric {
    name: string;
    value: number;
    labels: Record<string, string>;
}

export interface HistogramMetric {
    name: string;
    labels: Record<string, string>;
    buckets: number[];
    values: number[];
    sum: number;
    count: number;
}

export interface GaugeMetric {
    name: string;
    value: number;
    labels: Record<string, string>;
}

export interface MetricSnapshot {
    generatedAt: string;
    counters: CounterMetric[];
    gauges: GaugeMetric[];
    histograms: HistogramMetric[];
}

export const METRIC_NAMES = Object.freeze({
    // API metrics
    API_REQUESTS_TOTAL: "api_requests_total",
    API_REQUEST_DURATION: "api_request_duration_ms",

    // Chat metrics
    CHAT_MESSAGES_TOTAL: "chat_messages_total",
    CHAT_ROOMS_ACTIVE: "chat_rooms_active",

    // RAG metrics
    RAG_REQUESTS_TOTAL: "rag_requests_total",
    RAG_REQUEST_DURATION: "rag_request_duration_ms",
    RAG_CONTEXTS_RETRIEVED: "rag_contexts_retrieved_total",
    RAG_ZERO_HIT_TOTAL: "rag_zero_hit_total",

    // Worker metrics
    WORKER_JOBS_TOTAL: "worker_jobs_total",
    WORKER_JOBS_DURATION: "worker_jobs_duration_ms",
    WORKER_JOBS_FAILED: "worker_jobs_failed_total",
    WORKER_QUEUE_SIZE: "worker_queue_size",

    // AI metrics
    AI_REQUESTS_TOTAL: "ai_requests_total",
    AI_REQUEST_DURATION: "ai_request_duration_ms",
    AI_TOKENS_USED: "ai_tokens_used_total",
} as const);

export const METRIC_HELP = Object.freeze({
    API_REQUESTS_TOTAL: "Total number of API requests processed",
    API_REQUEST_DURATION: "API request duration in milliseconds",
    CHAT_MESSAGES_TOTAL: "Total number of chat messages processed",
    CHAT_ROOMS_ACTIVE: "Current number of active chat rooms",
    RAG_REQUESTS_TOTAL: "Total number of RAG retrieval requests",
    RAG_REQUEST_DURATION: "RAG retrieval duration in milliseconds",
    RAG_CONTEXTS_RETRIEVED: "Total number of retrieved RAG contexts",
    RAG_ZERO_HIT_TOTAL: "Total number of RAG requests with zero hits",
    WORKER_JOBS_TOTAL: "Total number of worker jobs processed",
    WORKER_JOBS_DURATION: "Worker job duration in milliseconds",
    WORKER_JOBS_FAILED: "Total number of failed worker jobs",
    WORKER_QUEUE_SIZE: "Current worker queue depth",
    AI_REQUESTS_TOTAL: "Total number of AI requests processed",
    AI_REQUEST_DURATION: "AI request duration in milliseconds",
    AI_TOKENS_USED: "Total number of AI tokens consumed",
} as const);

const DEFAULT_HISTOGRAM_BUCKETS_MS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

type MetricKind = "counter" | "gauge" | "histogram";

interface MetricMeta {
    kind: MetricKind;
    help: string;
}

function sanitizeMetricName(name: string): string {
    const cleaned = String(name ?? "")
        .trim()
        .replace(/[^a-zA-Z0-9_:]/g, "_");
    if (!cleaned) return "metric_unknown";
    if (!/^[a-zA-Z_:]/.test(cleaned)) {
        return `metric_${cleaned}`;
    }
    return cleaned;
}

function sanitizeLabelName(name: string): string {
    const cleaned = String(name ?? "")
        .trim()
        .replace(/[^a-zA-Z0-9_]/g, "_");
    if (!cleaned) return "label_unknown";
    if (!/^[a-zA-Z_]/.test(cleaned)) {
        return `label_${cleaned}`;
    }
    return cleaned;
}

function escapeLabelValue(value: string): string {
    return value
        .replace(/\\/g, "\\\\")
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/"/g, '\\"');
}

function isFiniteNumber(value: number): boolean {
    return Number.isFinite(value) && !Number.isNaN(value);
}

function toSortedLabelEntries(labels: Record<string, string>): Array<[string, string]> {
    return Object.entries(labels)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => [sanitizeLabelName(key), String(value)] as [string, string])
        .sort(([a], [b]) => a.localeCompare(b));
}

function normalizeLabels(labels: Record<string, string> = {}): Record<string, string> {
    const normalized: Record<string, string> = {};
    for (const [key, value] of toSortedLabelEntries(labels)) {
        normalized[key] = value;
    }
    return normalized;
}

function metricKey(name: string, labels: Record<string, string>): string {
    return `${name}|${JSON.stringify(toSortedLabelEntries(labels))}`;
}

function formatLabelSet(labels: Record<string, string>): string {
    const entries = toSortedLabelEntries(labels);
    if (entries.length === 0) return "";

    const rendered = entries
        .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
        .join(",");
    return `{${rendered}}`;
}

function normalizeBuckets(buckets: number[]): number[] {
    const cleaned = buckets
        .filter((bucket) => isFiniteNumber(bucket))
        .map((bucket) => Number(bucket))
        .sort((a, b) => a - b);

    return Array.from(new Set(cleaned));
}

function defaultHelpForMetric(kind: MetricKind, name: string): string {
    const prefix = kind === "counter" ? "Counter" : kind === "gauge" ? "Gauge" : "Histogram";
    return `${prefix} metric for ${name}`;
}

function getMetricHelp(name: string, kind: MetricKind, help?: string): string {
    return help || defaultHelpForMetric(kind, name);
}

class MetricsCollector {
    private counters = new Map<string, CounterMetric>();
    private histograms = new Map<string, HistogramMetric>();
    private gauges = new Map<string, GaugeMetric>();
    private meta = new Map<string, MetricMeta>();

    private registerMetric(name: string, kind: MetricKind, help?: string): string {
        const metricName = sanitizeMetricName(name);
        const existing = this.meta.get(metricName);
        const nextMeta: MetricMeta = {
            kind,
            help: getMetricHelp(metricName, kind, help),
        };

        if (existing && existing.kind !== kind) {
            logger.warn("Metric kind mismatch", {
                metricName,
                existingKind: existing.kind,
                requestedKind: kind,
            });
        }

        if (!existing || existing.kind === kind) {
            this.meta.set(metricName, nextMeta);
        }

        return metricName;
    }

    /**
     * Increment a counter.
     */
    counter(
        name: string,
        labels: Record<string, string> = {},
        value = 1,
        help?: string,
    ): void {
        if (!isFiniteNumber(value)) return;

        const metricName = this.registerMetric(name, "counter", help);
        const normalizedLabels = normalizeLabels(labels);
        const key = metricKey(metricName, normalizedLabels);
        const existing = this.counters.get(key);

        if (existing) {
            existing.value += value;
            return;
        }

        this.counters.set(key, {
            name: metricName,
            value,
            labels: normalizedLabels,
        });
    }

    /**
     * Record a histogram value (for latency or duration).
     */
    histogram(
        name: string,
        value: number,
        labels: Record<string, string> = {},
        buckets: number[] = DEFAULT_HISTOGRAM_BUCKETS_MS,
        help?: string,
    ): void {
        if (!isFiniteNumber(value)) return;

        const metricName = this.registerMetric(name, "histogram", help);
        const normalizedLabels = normalizeLabels(labels);
        const normalizedBuckets = normalizeBuckets(buckets);
        const key = metricKey(metricName, normalizedLabels);
        const existing = this.histograms.get(key);

        let metric: HistogramMetric;

        if (!existing) {
            metric = {
                name: metricName,
                labels: normalizedLabels,
                buckets: normalizedBuckets,
                values: new Array(normalizedBuckets.length).fill(0),
                sum: 0,
                count: 0,
            };
            this.histograms.set(key, metric);
        } else {
            metric = existing;
            if (metric.buckets.length !== normalizedBuckets.length) {
                logger.warn("Histogram buckets changed for existing metric", {
                    metricName,
                    labels: normalizedLabels,
                });
            }
        }

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
     * Set a gauge value.
     */
    gauge(name: string, value: number, labels: Record<string, string> = {}, help?: string): void {
        if (!isFiniteNumber(value)) return;

        const metricName = this.registerMetric(name, "gauge", help);
        const normalizedLabels = normalizeLabels(labels);
        const key = metricKey(metricName, normalizedLabels);
        this.gauges.set(key, {
            name: metricName,
            value,
            labels: normalizedLabels,
        });
    }

    increment(name: string, labels: Record<string, string> = {}, value = 1, help?: string): void {
        this.counter(name, labels, value, help);
    }

    observe(name: string, value: number, labels: Record<string, string> = {}, help?: string): void {
        this.histogram(name, value, labels, DEFAULT_HISTOGRAM_BUCKETS_MS, help);
    }

    set(name: string, value: number, labels: Record<string, string> = {}, help?: string): void {
        this.gauge(name, value, labels, help);
    }

    /**
     * Get all metrics in Prometheus exposition format.
     */
    getPrometheusMetrics(): string {
        const lines: string[] = [];
        const renderedMeta = new Set<string>();

        const renderHeader = (name: string, kind: MetricKind): void => {
            if (renderedMeta.has(name)) return;
            const meta = this.meta.get(name);
            const help = meta?.help || defaultHelpForMetric(kind, name);
            lines.push(`# HELP ${name} ${help}`);
            lines.push(`# TYPE ${name} ${kind}`);
            renderedMeta.add(name);
        };

        const counterSeries = Array.from(this.counters.values()).sort((a, b) =>
            a.name.localeCompare(b.name) || JSON.stringify(a.labels).localeCompare(JSON.stringify(b.labels)),
        );
        const gaugeSeries = Array.from(this.gauges.values()).sort((a, b) =>
            a.name.localeCompare(b.name) || JSON.stringify(a.labels).localeCompare(JSON.stringify(b.labels)),
        );
        const histogramSeries = Array.from(this.histograms.values()).sort((a, b) =>
            a.name.localeCompare(b.name) || JSON.stringify(a.labels).localeCompare(JSON.stringify(b.labels)),
        );

        for (const metric of counterSeries) {
            renderHeader(metric.name, "counter");
            const labelSet = formatLabelSet(metric.labels);
            lines.push(`${metric.name}${labelSet} ${metric.value}`);
        }

        for (const metric of gaugeSeries) {
            renderHeader(metric.name, "gauge");
            const labelSet = formatLabelSet(metric.labels);
            lines.push(`${metric.name}${labelSet} ${metric.value}`);
        }

        for (const metric of histogramSeries) {
            renderHeader(metric.name, "histogram");

            let cumulative = 0;
            for (let i = 0; i < metric.buckets.length; i++) {
                cumulative += metric.values[i] ?? 0;
                const bucketLabels = {
                    ...metric.labels,
                    le: String(metric.buckets[i]),
                };
                lines.push(`${metric.name}_bucket${formatLabelSet(bucketLabels)} ${cumulative}`);
            }

            lines.push(`${metric.name}_bucket${formatLabelSet({ ...metric.labels, le: "+Inf" })} ${metric.count}`);
            lines.push(`${metric.name}_sum${formatLabelSet(metric.labels)} ${metric.sum}`);
            lines.push(`${metric.name}_count${formatLabelSet(metric.labels)} ${metric.count}`);
        }

        return lines.join("\n");
    }

    /**
     * Get metrics as JSON snapshot.
     */
    getJSONMetrics(): MetricSnapshot {
        return {
            generatedAt: new Date().toISOString(),
            counters: Array.from(this.counters.values()),
            gauges: Array.from(this.gauges.values()),
            histograms: Array.from(this.histograms.values()),
        };
    }

    /**
     * Reset all metrics.
     */
    reset(): void {
        this.counters.clear();
        this.gauges.clear();
        this.histograms.clear();
        this.meta.clear();
    }
}

export const metrics = new MetricsCollector();

export function incrementMetric(
    name: string,
    value = 1,
    labels: Record<string, string> = {},
    help?: string,
): void {
    metrics.counter(name, labels, value, help);
}

export function observeMetric(
    name: string,
    value: number,
    labels: Record<string, string> = {},
    buckets: number[] = DEFAULT_HISTOGRAM_BUCKETS_MS,
    help?: string,
): void {
    metrics.histogram(name, value, labels, buckets, help);
}

export function setMetric(
    name: string,
    value: number,
    labels: Record<string, string> = {},
    help?: string,
): void {
    metrics.gauge(name, value, labels, help);
}

export function recordRequestMetric(
    metricBaseName: string,
    latencyMs: number,
    labels: Record<string, string> = {},
): void {
    incrementMetric(metricBaseName, 1, labels);
    observeMetric(metricBaseName.replace(/_total$/, "_duration_ms"), latencyMs, labels);
}
