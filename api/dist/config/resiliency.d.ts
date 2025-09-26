export interface ServiceResiliencyConfig {
    name: string;
    circuitBreaker: {
        failureThreshold: number;
        resetTimeout: number;
        monitoringPeriod: number;
        expectedErrors: string[];
    };
    retry: {
        maxAttempts: number;
        baseDelay: number;
        maxDelay: number;
        backoffMultiplier: number;
        jitter: boolean;
    };
    timeout: {
        default: number;
        operations: Record<string, number>;
    };
    rateLimit: {
        requestsPerSecond: number;
        burstSize?: number;
        queueSize?: number;
    };
    healthCheck: {
        interval: number;
        timeout: number;
        retries: number;
    };
}
export declare const dexScreenerConfig: ServiceResiliencyConfig;
export declare const goPlusConfig: ServiceResiliencyConfig;
export declare const birdeyeConfig: ServiceResiliencyConfig;
export declare const coinGeckoConfig: ServiceResiliencyConfig;
export declare const redisConfig: ServiceResiliencyConfig;
export declare const databaseConfig: ServiceResiliencyConfig;
export declare const websocketConfig: ServiceResiliencyConfig;
export declare const globalResiliencyConfig: {
    defaults: {
        circuitBreaker: {
            failureThreshold: number;
            resetTimeout: number;
            monitoringPeriod: number;
            expectedErrors: string[];
        };
        retry: {
            maxAttempts: number;
            baseDelay: number;
            maxDelay: number;
            backoffMultiplier: number;
            jitter: boolean;
        };
        timeout: {
            default: number;
        };
        rateLimit: {
            requestsPerSecond: number;
            burstSize: number;
            queueSize: number;
        };
        healthCheck: {
            interval: number;
            timeout: number;
            retries: number;
        };
    };
    emergency: {
        circuitBreaker: {
            failureThreshold: number;
            resetTimeout: number;
            monitoringPeriod: number;
        };
        retry: {
            maxAttempts: number;
            baseDelay: number;
            maxDelay: number;
            backoffMultiplier: number;
            jitter: boolean;
        };
        timeout: {
            multiplier: number;
        };
        rateLimit: {
            multiplier: number;
        };
    };
    performance: {
        circuitBreaker: {
            failureThreshold: number;
            resetTimeout: number;
            monitoringPeriod: number;
        };
        retry: {
            maxAttempts: number;
            baseDelay: number;
            maxDelay: number;
            backoffMultiplier: number;
            jitter: boolean;
        };
        timeout: {
            multiplier: number;
        };
        rateLimit: {
            multiplier: number;
        };
    };
};
export declare const serviceConfigs: {
    dexscreener: ServiceResiliencyConfig;
    goplus: ServiceResiliencyConfig;
    birdeye: ServiceResiliencyConfig;
    coingecko: ServiceResiliencyConfig;
    redis: ServiceResiliencyConfig;
    database: ServiceResiliencyConfig;
    websocket: ServiceResiliencyConfig;
};
export declare function getServiceConfig(serviceName: string): ServiceResiliencyConfig;
export declare function applyEmergencyMode(config: ServiceResiliencyConfig): ServiceResiliencyConfig;
export declare function applyPerformanceMode(config: ServiceResiliencyConfig): ServiceResiliencyConfig;
export declare function getEnvironmentConfig(): 'emergency' | 'performance' | 'default';
declare const _default: {
    services: {
        dexscreener: ServiceResiliencyConfig;
        goplus: ServiceResiliencyConfig;
        birdeye: ServiceResiliencyConfig;
        coingecko: ServiceResiliencyConfig;
        redis: ServiceResiliencyConfig;
        database: ServiceResiliencyConfig;
        websocket: ServiceResiliencyConfig;
    };
    global: {
        defaults: {
            circuitBreaker: {
                failureThreshold: number;
                resetTimeout: number;
                monitoringPeriod: number;
                expectedErrors: string[];
            };
            retry: {
                maxAttempts: number;
                baseDelay: number;
                maxDelay: number;
                backoffMultiplier: number;
                jitter: boolean;
            };
            timeout: {
                default: number;
            };
            rateLimit: {
                requestsPerSecond: number;
                burstSize: number;
                queueSize: number;
            };
            healthCheck: {
                interval: number;
                timeout: number;
                retries: number;
            };
        };
        emergency: {
            circuitBreaker: {
                failureThreshold: number;
                resetTimeout: number;
                monitoringPeriod: number;
            };
            retry: {
                maxAttempts: number;
                baseDelay: number;
                maxDelay: number;
                backoffMultiplier: number;
                jitter: boolean;
            };
            timeout: {
                multiplier: number;
            };
            rateLimit: {
                multiplier: number;
            };
        };
        performance: {
            circuitBreaker: {
                failureThreshold: number;
                resetTimeout: number;
                monitoringPeriod: number;
            };
            retry: {
                maxAttempts: number;
                baseDelay: number;
                maxDelay: number;
                backoffMultiplier: number;
                jitter: boolean;
            };
            timeout: {
                multiplier: number;
            };
            rateLimit: {
                multiplier: number;
            };
        };
    };
    getServiceConfig: typeof getServiceConfig;
    applyEmergencyMode: typeof applyEmergencyMode;
    applyPerformanceMode: typeof applyPerformanceMode;
    getEnvironmentConfig: typeof getEnvironmentConfig;
};
export default _default;
//# sourceMappingURL=resiliency.d.ts.map