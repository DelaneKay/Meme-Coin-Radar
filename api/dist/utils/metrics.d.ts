declare class MetricsRegistry {
    private counters;
    private histograms;
    private gauges;
    private maxHistogramSize;
    incrementCounter(name: string, value?: number, tags?: Record<string, string>): void;
    getCounter(name: string, tags?: Record<string, string>): number;
    recordHistogram(name: string, value: number, tags?: Record<string, string>): void;
    getHistogramStats(name: string, tags?: Record<string, string>): {
        count: number;
        sum: number;
        avg: number;
        min: number;
        max: number;
        p50: number;
        p95: number;
        p99: number;
        lastUpdated: number;
    } | null;
    setGauge(name: string, value: number, tags?: Record<string, string>): void;
    getGauge(name: string, tags?: Record<string, string>): number | null;
    private getKey;
    getAllMetrics(): {
        counters: {
            name: string;
            value: number;
            lastUpdated: number;
        }[];
        histograms: {
            name: string;
            stats: {
                count: number;
                sum: number;
                avg: number;
                min: number;
                max: number;
                p50: number;
                p95: number;
                p99: number;
                lastUpdated: number;
            } | null;
            lastUpdated: number;
        }[];
        gauges: {
            name: string;
            value: number;
            lastUpdated: number;
        }[];
    };
    private parseTagsFromKey;
    reset(): void;
    cleanup(maxAge?: number): void;
}
export declare const metrics: MetricsRegistry;
export declare const trackApiCall: (service: string, endpoint: string, duration: number, success: boolean, statusCode?: number) => void;
export declare const trackHttpRequest: (method: string, path: string, statusCode: number, duration: number) => void;
export declare const trackRateLimit: (service: string, remaining: number, limit: number) => void;
export declare const trackCacheOperation: (operation: "hit" | "miss" | "set" | "delete", key: string) => void;
export declare const trackQueueSize: (queueName: string, size: number) => void;
export declare const trackActiveConnections: (type: "websocket" | "http", count: number) => void;
export declare const trackTokenProcessing: (chainId: string, tokensProcessed: number, alertsGenerated: number) => void;
export declare const trackCircuitBreaker: (service: string, state: "open" | "closed" | "half-open") => void;
export declare const startMetricsReporting: (intervalMs?: number) => void;
export default metrics;
//# sourceMappingURL=metrics.d.ts.map