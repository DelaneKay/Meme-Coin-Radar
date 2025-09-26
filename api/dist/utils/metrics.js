"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startMetricsReporting = exports.trackCircuitBreaker = exports.trackTokenProcessing = exports.trackActiveConnections = exports.trackQueueSize = exports.trackCacheOperation = exports.trackRateLimit = exports.trackHttpRequest = exports.trackApiCall = exports.metrics = void 0;
const logger_1 = require("./logger");
class MetricsRegistry {
    constructor() {
        this.counters = new Map();
        this.histograms = new Map();
        this.gauges = new Map();
        this.maxHistogramSize = 1000;
    }
    incrementCounter(name, value = 1, tags) {
        const key = this.getKey(name, tags);
        const existing = this.counters.get(key) || { count: 0, lastUpdated: 0 };
        this.counters.set(key, {
            count: existing.count + value,
            lastUpdated: Date.now()
        });
        if (value > 1 || name.includes('error') || name.includes('alert')) {
            (0, logger_1.logBusinessMetric)(name, existing.count + value, 'count', { tags, increment: value });
        }
    }
    getCounter(name, tags) {
        const key = this.getKey(name, tags);
        return this.counters.get(key)?.count || 0;
    }
    recordHistogram(name, value, tags) {
        const key = this.getKey(name, tags);
        const existing = this.histograms.get(key) || {
            values: [],
            count: 0,
            sum: 0,
            min: Infinity,
            max: -Infinity,
            lastUpdated: 0
        };
        existing.values.push(value);
        existing.count++;
        existing.sum += value;
        existing.min = Math.min(existing.min, value);
        existing.max = Math.max(existing.max, value);
        existing.lastUpdated = Date.now();
        if (existing.values.length > this.maxHistogramSize) {
            const removed = existing.values.shift();
            existing.sum -= removed;
            existing.count--;
        }
        this.histograms.set(key, existing);
        if (name.includes('duration') && value > 2000) {
            (0, logger_1.logBusinessMetric)(`${name}_slow`, value, 'ms', { tags });
        }
    }
    getHistogramStats(name, tags) {
        const key = this.getKey(name, tags);
        const histogram = this.histograms.get(key);
        if (!histogram || histogram.values.length === 0) {
            return null;
        }
        const sorted = [...histogram.values].sort((a, b) => a - b);
        const len = sorted.length;
        return {
            count: histogram.count,
            sum: histogram.sum,
            avg: histogram.sum / histogram.count,
            min: histogram.min,
            max: histogram.max,
            p50: sorted[Math.floor(len * 0.5)],
            p95: sorted[Math.floor(len * 0.95)],
            p99: sorted[Math.floor(len * 0.99)],
            lastUpdated: histogram.lastUpdated
        };
    }
    setGauge(name, value, tags) {
        const key = this.getKey(name, tags);
        this.gauges.set(key, {
            value,
            lastUpdated: Date.now()
        });
        if (name.includes('queue_size') && value > 100) {
            (0, logger_1.logBusinessMetric)(`${name}_high`, value, 'items', { tags });
        }
    }
    getGauge(name, tags) {
        const key = this.getKey(name, tags);
        return this.gauges.get(key)?.value || null;
    }
    getKey(name, tags) {
        if (!tags || Object.keys(tags).length === 0) {
            return name;
        }
        const tagString = Object.entries(tags)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}=${v}`)
            .join(',');
        return `${name}{${tagString}}`;
    }
    getAllMetrics() {
        const now = Date.now();
        const fiveMinutesAgo = now - 5 * 60 * 1000;
        return {
            counters: Array.from(this.counters.entries()).map(([key, metric]) => ({
                name: key,
                value: metric.count,
                lastUpdated: metric.lastUpdated
            })),
            histograms: Array.from(this.histograms.entries()).map(([key, metric]) => ({
                name: key,
                stats: this.getHistogramStats(key.split('{')[0], this.parseTagsFromKey(key)),
                lastUpdated: metric.lastUpdated
            })),
            gauges: Array.from(this.gauges.entries()).map(([key, metric]) => ({
                name: key,
                value: metric.value,
                lastUpdated: metric.lastUpdated
            }))
        };
    }
    parseTagsFromKey(key) {
        const match = key.match(/\{(.+)\}$/);
        if (!match)
            return undefined;
        const tags = {};
        match[1].split(',').forEach(pair => {
            const [k, v] = pair.split('=');
            tags[k] = v;
        });
        return tags;
    }
    reset() {
        this.counters.clear();
        this.histograms.clear();
        this.gauges.clear();
    }
    cleanup(maxAge = 24 * 60 * 60 * 1000) {
        const cutoff = Date.now() - maxAge;
        for (const [key, metric] of this.counters.entries()) {
            if (metric.lastUpdated < cutoff) {
                this.counters.delete(key);
            }
        }
        for (const [key, metric] of this.histograms.entries()) {
            if (metric.lastUpdated < cutoff) {
                this.histograms.delete(key);
            }
        }
        for (const [key, metric] of this.gauges.entries()) {
            if (metric.lastUpdated < cutoff) {
                this.gauges.delete(key);
            }
        }
    }
}
exports.metrics = new MetricsRegistry();
const trackApiCall = (service, endpoint, duration, success, statusCode) => {
    const tags = { service, endpoint };
    exports.metrics.incrementCounter('api_calls_total', 1, tags);
    exports.metrics.recordHistogram('api_duration_ms', duration, tags);
    if (success) {
        exports.metrics.incrementCounter('api_calls_success', 1, tags);
    }
    else {
        exports.metrics.incrementCounter('api_calls_error', 1, tags);
    }
    if (statusCode) {
        exports.metrics.incrementCounter('api_calls_by_status', 1, { ...tags, status: statusCode.toString() });
    }
};
exports.trackApiCall = trackApiCall;
const trackHttpRequest = (method, path, statusCode, duration) => {
    const tags = { method, path: path.replace(/\/\d+/g, '/:id') };
    exports.metrics.incrementCounter('http_requests_total', 1, tags);
    exports.metrics.recordHistogram('http_duration_ms', duration, tags);
    const statusClass = Math.floor(statusCode / 100);
    exports.metrics.incrementCounter('http_requests_by_status', 1, { ...tags, status_class: `${statusClass}xx` });
    if (statusCode >= 400) {
        exports.metrics.incrementCounter('http_requests_error', 1, tags);
    }
};
exports.trackHttpRequest = trackHttpRequest;
const trackRateLimit = (service, remaining, limit) => {
    const tags = { service };
    exports.metrics.setGauge('rate_limit_remaining', remaining, tags);
    exports.metrics.setGauge('rate_limit_total', limit, tags);
    const utilizationPercent = ((limit - remaining) / limit) * 100;
    exports.metrics.setGauge('rate_limit_utilization_percent', utilizationPercent, tags);
    if (remaining <= 5) {
        exports.metrics.incrementCounter('rate_limit_warnings', 1, tags);
    }
};
exports.trackRateLimit = trackRateLimit;
const trackCacheOperation = (operation, key) => {
    const tags = { operation };
    exports.metrics.incrementCounter('cache_operations_total', 1, tags);
    if (operation === 'hit' || operation === 'miss') {
        exports.metrics.incrementCounter(`cache_${operation}`, 1);
    }
};
exports.trackCacheOperation = trackCacheOperation;
const trackQueueSize = (queueName, size) => {
    exports.metrics.setGauge('queue_size', size, { queue: queueName });
};
exports.trackQueueSize = trackQueueSize;
const trackActiveConnections = (type, count) => {
    exports.metrics.setGauge('active_connections', count, { type });
};
exports.trackActiveConnections = trackActiveConnections;
const trackTokenProcessing = (chainId, tokensProcessed, alertsGenerated) => {
    const tags = { chain: chainId };
    exports.metrics.incrementCounter('tokens_processed', tokensProcessed, tags);
    exports.metrics.incrementCounter('alerts_generated', alertsGenerated, tags);
};
exports.trackTokenProcessing = trackTokenProcessing;
const trackCircuitBreaker = (service, state) => {
    exports.metrics.setGauge('circuit_breaker_state', state === 'open' ? 1 : 0, { service });
    exports.metrics.incrementCounter('circuit_breaker_state_changes', 1, { service, state });
};
exports.trackCircuitBreaker = trackCircuitBreaker;
const startMetricsReporting = (intervalMs = 60000) => {
    setInterval(() => {
        try {
            const allMetrics = exports.metrics.getAllMetrics();
            logger_1.logger.info('Metrics summary', {
                type: 'metrics_summary',
                counters_count: allMetrics.counters.length,
                histograms_count: allMetrics.histograms.length,
                gauges_count: allMetrics.gauges.length,
                timestamp: Date.now()
            });
            exports.metrics.cleanup();
        }
        catch (error) {
            logger_1.logger.error('Failed to report metrics', { error });
        }
    }, intervalMs);
};
exports.startMetricsReporting = startMetricsReporting;
exports.default = exports.metrics;
//# sourceMappingURL=metrics.js.map