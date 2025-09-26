import { AxiosRequestConfig, AxiosResponse } from 'axios';
import { defaultCircuitBreakerConfigs } from './circuitBreaker';
import { retryConfigs } from './retry';
export interface ResilientHttpConfig {
    serviceName: string;
    baseURL?: string;
    timeout?: number;
    retryConfig?: typeof retryConfigs[keyof typeof retryConfigs];
    circuitBreakerConfig?: typeof defaultCircuitBreakerConfigs[keyof typeof defaultCircuitBreakerConfigs];
    rateLimit?: {
        requestsPerSecond: number;
        burstSize?: number;
    };
    headers?: Record<string, string>;
    validateStatus?: (status: number) => boolean;
}
export interface RequestMetrics {
    startTime: number;
    endTime?: number;
    duration?: number;
    attempts: number;
    circuitBreakerState: string;
    success: boolean;
    statusCode?: number;
    error?: string;
}
export declare class ResilientHttpClient {
    private axiosInstance;
    private circuitBreaker;
    private config;
    private requestQueue;
    private isProcessingQueue;
    private lastRequestTime;
    constructor(config: ResilientHttpConfig);
    private setupInterceptors;
    private sanitizeHeaders;
    private enforceRateLimit;
    private executeRequest;
    private recordMetrics;
    get<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
    post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
    put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
    delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
    patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
    getJson<T = any>(url: string, config?: AxiosRequestConfig): Promise<T>;
    postJson<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T>;
    getHealthStatus(): {
        service: string;
        circuitBreaker: {
            name: string;
            state: import("./circuitBreaker").CircuitBreakerState;
            failureCount: number;
            successCount: number;
            failureThreshold: number;
            lastFailureTime: string | null;
            nextAttemptTime: string | null;
            healthy: boolean;
        };
        lastRequestTime: string | null;
        queueSize: number;
        rateLimit: {
            requestsPerSecond: number;
            burstSize?: number;
        } | undefined;
    };
    resetCircuitBreaker(): void;
    openCircuitBreaker(): void;
    closeCircuitBreaker(): void;
}
export declare class HttpClientFactory {
    private static clients;
    static createDexScreenerClient(): ResilientHttpClient;
    static createGoPlusClient(): ResilientHttpClient;
    static createBirdeyeClient(): ResilientHttpClient;
    static createCoinGeckoClient(): ResilientHttpClient;
    static getClient(serviceName: string): ResilientHttpClient | undefined;
    static getAllClients(): ResilientHttpClient[];
    static getHealthStatus(): {
        service: string;
        circuitBreaker: {
            name: string;
            state: import("./circuitBreaker").CircuitBreakerState;
            failureCount: number;
            successCount: number;
            failureThreshold: number;
            lastFailureTime: string | null;
            nextAttemptTime: string | null;
            healthy: boolean;
        };
        lastRequestTime: string | null;
        queueSize: number;
        rateLimit: {
            requestsPerSecond: number;
            burstSize?: number;
        } | undefined;
    }[];
}
export declare const dexScreenerClient: ResilientHttpClient;
export declare const goPlusClient: ResilientHttpClient;
export declare const birdeyeClient: ResilientHttpClient;
export declare const coinGeckoClient: ResilientHttpClient;
//# sourceMappingURL=resilientHttp.d.ts.map