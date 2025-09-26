import { logger, logBusinessMetric } from './logger';

// Metrics storage interface
interface MetricValue {
  value: number;
  timestamp: number;
  tags?: Record<string, string>;
}

interface CounterMetric {
  count: number;
  lastUpdated: number;
}

interface HistogramMetric {
  values: number[];
  count: number;
  sum: number;
  min: number;
  max: number;
  lastUpdated: number;
}

interface GaugeMetric {
  value: number;
  lastUpdated: number;
}

// Metrics registry
class MetricsRegistry {
  private counters = new Map<string, CounterMetric>();
  private histograms = new Map<string, HistogramMetric>();
  private gauges = new Map<string, GaugeMetric>();
  private maxHistogramSize = 1000; // Keep last 1000 values

  // Counter methods
  incrementCounter(name: string, value: number = 1, tags?: Record<string, string>) {
    const key = this.getKey(name, tags);
    const existing = this.counters.get(key) || { count: 0, lastUpdated: 0 };
    
    this.counters.set(key, {
      count: existing.count + value,
      lastUpdated: Date.now()
    });

    // Log significant counter increments
    if (value > 1 || name.includes('error') || name.includes('alert')) {
      logBusinessMetric(name, existing.count + value, 'count', { tags, increment: value });
    }
  }

  getCounter(name: string, tags?: Record<string, string>): number {
    const key = this.getKey(name, tags);
    return this.counters.get(key)?.count || 0;
  }

  // Histogram methods (for tracking durations, sizes, etc.)
  recordHistogram(name: string, value: number, tags?: Record<string, string>) {
    const key = this.getKey(name, tags);
    const existing = this.histograms.get(key) || {
      values: [],
      count: 0,
      sum: 0,
      min: Infinity,
      max: -Infinity,
      lastUpdated: 0
    };

    // Add new value
    existing.values.push(value);
    existing.count++;
    existing.sum += value;
    existing.min = Math.min(existing.min, value);
    existing.max = Math.max(existing.max, value);
    existing.lastUpdated = Date.now();

    // Keep only recent values
    if (existing.values.length > this.maxHistogramSize) {
      const removed = existing.values.shift()!;
      existing.sum -= removed;
      existing.count--;
    }

    this.histograms.set(key, existing);

    // Log slow operations
    if (name.includes('duration') && value > 2000) {
      logBusinessMetric(`${name}_slow`, value, 'ms', { tags });
    }
  }

  getHistogramStats(name: string, tags?: Record<string, string>) {
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

  // Gauge methods (for current values like queue size, active connections)
  setGauge(name: string, value: number, tags?: Record<string, string>) {
    const key = this.getKey(name, tags);
    this.gauges.set(key, {
      value,
      lastUpdated: Date.now()
    });

    // Log critical gauge values
    if (name.includes('queue_size') && value > 100) {
      logBusinessMetric(`${name}_high`, value, 'items', { tags });
    }
  }

  getGauge(name: string, tags?: Record<string, string>): number | null {
    const key = this.getKey(name, tags);
    return this.gauges.get(key)?.value || null;
  }

  // Utility methods
  private getKey(name: string, tags?: Record<string, string>): string {
    if (!tags || Object.keys(tags).length === 0) {
      return name;
    }
    
    const tagString = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    
    return `${name}{${tagString}}`;
  }

  // Get all metrics for health endpoint
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

  private parseTagsFromKey(key: string): Record<string, string> | undefined {
    const match = key.match(/\{(.+)\}$/);
    if (!match) return undefined;

    const tags: Record<string, string> = {};
    match[1].split(',').forEach(pair => {
      const [k, v] = pair.split('=');
      tags[k] = v;
    });
    return tags;
  }

  // Reset metrics (useful for testing)
  reset() {
    this.counters.clear();
    this.histograms.clear();
    this.gauges.clear();
  }

  // Cleanup old metrics
  cleanup(maxAge: number = 24 * 60 * 60 * 1000) { // 24 hours default
    const cutoff = Date.now() - maxAge;

    // Clean counters
    for (const [key, metric] of Array.from(this.counters.entries())) {
      if (metric.lastUpdated < cutoff) {
        this.counters.delete(key);
      }
    }

    // Clean histograms
    for (const [key, metric] of Array.from(this.histograms.entries())) {
      if (metric.lastUpdated < cutoff) {
        this.histograms.delete(key);
      }
    }

    // Clean gauges
    for (const [key, metric] of Array.from(this.gauges.entries())) {
      if (metric.lastUpdated < cutoff) {
        this.gauges.delete(key);
      }
    }
  }
}

// Global metrics instance
export const metrics = new MetricsRegistry();

// Convenience functions for common metrics
export const trackApiCall = (service: string, endpoint: string, duration: number, success: boolean, statusCode?: number) => {
  const tags = { service, endpoint };
  
  metrics.incrementCounter('api_calls_total', 1, tags);
  metrics.recordHistogram('api_duration_ms', duration, tags);
  
  if (success) {
    metrics.incrementCounter('api_calls_success', 1, tags);
  } else {
    metrics.incrementCounter('api_calls_error', 1, tags);
  }

  if (statusCode) {
    metrics.incrementCounter('api_calls_by_status', 1, { ...tags, status: statusCode.toString() });
  }
};

export const trackHttpRequest = (method: string, path: string, statusCode: number, duration: number) => {
  const tags = { method, path: path.replace(/\/\d+/g, '/:id') }; // Normalize paths with IDs
  
  metrics.incrementCounter('http_requests_total', 1, tags);
  metrics.recordHistogram('http_duration_ms', duration, tags);
  
  const statusClass = Math.floor(statusCode / 100);
  metrics.incrementCounter('http_requests_by_status', 1, { ...tags, status_class: `${statusClass}xx` });
  
  if (statusCode >= 400) {
    metrics.incrementCounter('http_requests_error', 1, tags);
  }
};

export const trackRateLimit = (service: string, remaining: number, limit: number) => {
  const tags = { service };
  
  metrics.setGauge('rate_limit_remaining', remaining, tags);
  metrics.setGauge('rate_limit_total', limit, tags);
  
  const utilizationPercent = ((limit - remaining) / limit) * 100;
  metrics.setGauge('rate_limit_utilization_percent', utilizationPercent, tags);
  
  if (remaining <= 5) {
    metrics.incrementCounter('rate_limit_warnings', 1, tags);
  }
};

export const trackCacheOperation = (operation: 'hit' | 'miss' | 'set' | 'delete', key: string) => {
  const tags = { operation };
  
  metrics.incrementCounter('cache_operations_total', 1, tags);
  
  if (operation === 'hit' || operation === 'miss') {
    metrics.incrementCounter(`cache_${operation}`, 1);
  }
};

export const trackQueueSize = (queueName: string, size: number) => {
  metrics.setGauge('queue_size', size, { queue: queueName });
};

export const trackActiveConnections = (type: 'websocket' | 'http', count: number) => {
  metrics.setGauge('active_connections', count, { type });
};

export const trackTokenProcessing = (chainId: string, tokensProcessed: number, alertsGenerated: number) => {
  const tags = { chain: chainId };
  
  metrics.incrementCounter('tokens_processed', tokensProcessed, tags);
  metrics.incrementCounter('alerts_generated', alertsGenerated, tags);
};

export const trackCircuitBreaker = (service: string, state: 'open' | 'closed' | 'half-open') => {
  metrics.setGauge('circuit_breaker_state', state === 'open' ? 1 : 0, { service });
  metrics.incrementCounter('circuit_breaker_state_changes', 1, { service, state });
};

// Periodic metrics reporting
export const startMetricsReporting = (intervalMs: number = 60000) => {
  setInterval(() => {
    try {
      const allMetrics = metrics.getAllMetrics();
      
      // Log summary metrics
      logger.info('Metrics summary', {
        type: 'metrics_summary',
        counters_count: allMetrics.counters.length,
        histograms_count: allMetrics.histograms.length,
        gauges_count: allMetrics.gauges.length,
        timestamp: Date.now()
      });

      // Cleanup old metrics
      metrics.cleanup();
      
    } catch (error) {
      logger.error('Failed to report metrics', { error });
    }
  }, intervalMs);
};

export default metrics;