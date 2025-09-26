"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serviceConfigs = exports.globalResiliencyConfig = exports.websocketConfig = exports.databaseConfig = exports.redisConfig = exports.coinGeckoConfig = exports.birdeyeConfig = exports.goPlusConfig = exports.dexScreenerConfig = void 0;
exports.getServiceConfig = getServiceConfig;
exports.applyEmergencyMode = applyEmergencyMode;
exports.applyPerformanceMode = applyPerformanceMode;
exports.getEnvironmentConfig = getEnvironmentConfig;
exports.dexScreenerConfig = {
    name: 'dexscreener',
    circuitBreaker: {
        failureThreshold: 5,
        resetTimeout: 60000,
        monitoringPeriod: 60000,
        expectedErrors: ['RateLimitError', 'TimeoutError', 'ECONNRESET']
    },
    retry: {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 10000,
        backoffMultiplier: 2,
        jitter: true
    },
    timeout: {
        default: 10000,
        operations: {
            search: 10000,
            pairs: 8000,
            tokens: 8000,
            latest: 6000
        }
    },
    rateLimit: {
        requestsPerSecond: 5,
        burstSize: 10,
        queueSize: 50
    },
    healthCheck: {
        interval: 30000,
        timeout: 5000,
        retries: 2
    }
};
exports.goPlusConfig = {
    name: 'goplus',
    circuitBreaker: {
        failureThreshold: 3,
        resetTimeout: 120000,
        monitoringPeriod: 60000,
        expectedErrors: ['RateLimitError', 'TimeoutError', 'ECONNRESET']
    },
    retry: {
        maxAttempts: 2,
        baseDelay: 2000,
        maxDelay: 15000,
        backoffMultiplier: 3,
        jitter: true
    },
    timeout: {
        default: 15000,
        operations: {
            security: 15000,
            batch: 20000,
            token_security: 12000
        }
    },
    rateLimit: {
        requestsPerSecond: 0.5,
        burstSize: 2,
        queueSize: 20
    },
    healthCheck: {
        interval: 60000,
        timeout: 8000,
        retries: 1
    }
};
exports.birdeyeConfig = {
    name: 'birdeye',
    circuitBreaker: {
        failureThreshold: 3,
        resetTimeout: 300000,
        monitoringPeriod: 60000,
        expectedErrors: ['RateLimitError', 'TimeoutError', 'ECONNRESET']
    },
    retry: {
        maxAttempts: 2,
        baseDelay: 5000,
        maxDelay: 30000,
        backoffMultiplier: 3,
        jitter: true
    },
    timeout: {
        default: 12000,
        operations: {
            price: 12000,
            overview: 15000,
            multi_price: 18000
        }
    },
    rateLimit: {
        requestsPerSecond: 1,
        burstSize: 1,
        queueSize: 10
    },
    healthCheck: {
        interval: 120000,
        timeout: 10000,
        retries: 1
    }
};
exports.coinGeckoConfig = {
    name: 'coingecko',
    circuitBreaker: {
        failureThreshold: 5,
        resetTimeout: 180000,
        monitoringPeriod: 60000,
        expectedErrors: ['RateLimitError', 'TimeoutError', 'ECONNRESET']
    },
    retry: {
        maxAttempts: 3,
        baseDelay: 1500,
        maxDelay: 12000,
        backoffMultiplier: 2,
        jitter: true
    },
    timeout: {
        default: 8000,
        operations: {
            search: 8000,
            price: 6000,
            markets: 10000,
            coins: 8000
        }
    },
    rateLimit: {
        requestsPerSecond: 2,
        burstSize: 5,
        queueSize: 30
    },
    healthCheck: {
        interval: 45000,
        timeout: 6000,
        retries: 2
    }
};
exports.redisConfig = {
    name: 'redis',
    circuitBreaker: {
        failureThreshold: 3,
        resetTimeout: 30000,
        monitoringPeriod: 30000,
        expectedErrors: ['TimeoutError', 'ECONNRESET']
    },
    retry: {
        maxAttempts: 3,
        baseDelay: 100,
        maxDelay: 2000,
        backoffMultiplier: 2,
        jitter: true
    },
    timeout: {
        default: 2000,
        operations: {
            get: 2000,
            set: 3000,
            del: 2000,
            scan: 5000,
            pipeline: 5000
        }
    },
    rateLimit: {
        requestsPerSecond: 100,
        burstSize: 200,
        queueSize: 500
    },
    healthCheck: {
        interval: 15000,
        timeout: 3000,
        retries: 3
    }
};
exports.databaseConfig = {
    name: 'database',
    circuitBreaker: {
        failureThreshold: 3,
        resetTimeout: 60000,
        monitoringPeriod: 30000,
        expectedErrors: ['SQLITE_BUSY', 'SQLITE_LOCKED', 'TimeoutError']
    },
    retry: {
        maxAttempts: 3,
        baseDelay: 200,
        maxDelay: 3000,
        backoffMultiplier: 2,
        jitter: true
    },
    timeout: {
        default: 5000,
        operations: {
            select: 5000,
            insert: 8000,
            update: 8000,
            delete: 5000,
            transaction: 10000
        }
    },
    rateLimit: {
        requestsPerSecond: 50,
        burstSize: 100,
        queueSize: 200
    },
    healthCheck: {
        interval: 20000,
        timeout: 4000,
        retries: 2
    }
};
exports.websocketConfig = {
    name: 'websocket',
    circuitBreaker: {
        failureThreshold: 5,
        resetTimeout: 30000,
        monitoringPeriod: 30000,
        expectedErrors: ['TimeoutError', 'ECONNRESET', 'ENOTFOUND']
    },
    retry: {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 5000,
        backoffMultiplier: 2,
        jitter: true
    },
    timeout: {
        default: 10000,
        operations: {
            connect: 10000,
            send: 5000,
            close: 3000,
            ping: 2000
        }
    },
    rateLimit: {
        requestsPerSecond: 10,
        burstSize: 20,
        queueSize: 100
    },
    healthCheck: {
        interval: 30000,
        timeout: 5000,
        retries: 2
    }
};
exports.globalResiliencyConfig = {
    defaults: {
        circuitBreaker: {
            failureThreshold: 5,
            resetTimeout: 60000,
            monitoringPeriod: 60000,
            expectedErrors: ['TimeoutError', 'ECONNRESET']
        },
        retry: {
            maxAttempts: 3,
            baseDelay: 1000,
            maxDelay: 10000,
            backoffMultiplier: 2,
            jitter: true
        },
        timeout: {
            default: 10000
        },
        rateLimit: {
            requestsPerSecond: 5,
            burstSize: 10,
            queueSize: 50
        },
        healthCheck: {
            interval: 30000,
            timeout: 5000,
            retries: 2
        }
    },
    emergency: {
        circuitBreaker: {
            failureThreshold: 2,
            resetTimeout: 300000,
            monitoringPeriod: 30000
        },
        retry: {
            maxAttempts: 1,
            baseDelay: 5000,
            maxDelay: 5000,
            backoffMultiplier: 1,
            jitter: false
        },
        timeout: {
            multiplier: 0.5
        },
        rateLimit: {
            multiplier: 0.3
        }
    },
    performance: {
        circuitBreaker: {
            failureThreshold: 8,
            resetTimeout: 30000,
            monitoringPeriod: 60000
        },
        retry: {
            maxAttempts: 4,
            baseDelay: 500,
            maxDelay: 15000,
            backoffMultiplier: 2,
            jitter: true
        },
        timeout: {
            multiplier: 1.5
        },
        rateLimit: {
            multiplier: 1.5
        }
    }
};
exports.serviceConfigs = {
    dexscreener: exports.dexScreenerConfig,
    goplus: exports.goPlusConfig,
    birdeye: exports.birdeyeConfig,
    coingecko: exports.coinGeckoConfig,
    redis: exports.redisConfig,
    database: exports.databaseConfig,
    websocket: exports.websocketConfig
};
function getServiceConfig(serviceName) {
    return exports.serviceConfigs[serviceName] || {
        name: serviceName,
        ...exports.globalResiliencyConfig.defaults
    };
}
function applyEmergencyMode(config) {
    const emergency = exports.globalResiliencyConfig.emergency;
    return {
        ...config,
        circuitBreaker: {
            ...config.circuitBreaker,
            ...emergency.circuitBreaker
        },
        retry: {
            ...config.retry,
            ...emergency.retry
        },
        timeout: {
            ...config.timeout,
            default: Math.round(config.timeout.default * emergency.timeout.multiplier),
            operations: Object.fromEntries(Object.entries(config.timeout.operations || {}).map(([key, value]) => [
                key,
                Math.round(value * emergency.timeout.multiplier)
            ]))
        },
        rateLimit: {
            ...config.rateLimit,
            requestsPerSecond: Math.max(0.1, config.rateLimit.requestsPerSecond * emergency.rateLimit.multiplier),
            burstSize: config.rateLimit.burstSize ? Math.max(1, Math.round(config.rateLimit.burstSize * emergency.rateLimit.multiplier)) : undefined,
            queueSize: config.rateLimit.queueSize ? Math.max(5, Math.round(config.rateLimit.queueSize * emergency.rateLimit.multiplier)) : undefined
        }
    };
}
function applyPerformanceMode(config) {
    const performance = exports.globalResiliencyConfig.performance;
    return {
        ...config,
        circuitBreaker: {
            ...config.circuitBreaker,
            ...performance.circuitBreaker
        },
        retry: {
            ...config.retry,
            ...performance.retry
        },
        timeout: {
            ...config.timeout,
            default: Math.round(config.timeout.default * performance.timeout.multiplier),
            operations: Object.fromEntries(Object.entries(config.timeout.operations || {}).map(([key, value]) => [
                key,
                Math.round(value * performance.timeout.multiplier)
            ]))
        },
        rateLimit: {
            ...config.rateLimit,
            requestsPerSecond: config.rateLimit.requestsPerSecond * performance.rateLimit.multiplier,
            burstSize: config.rateLimit.burstSize ? Math.round(config.rateLimit.burstSize * performance.rateLimit.multiplier) : undefined,
            queueSize: config.rateLimit.queueSize ? Math.round(config.rateLimit.queueSize * performance.rateLimit.multiplier) : undefined
        }
    };
}
function getEnvironmentConfig() {
    const mode = process.env.RESILIENCY_MODE?.toLowerCase();
    if (mode === 'emergency')
        return 'emergency';
    if (mode === 'performance')
        return 'performance';
    if (process.env.NODE_ENV === 'production') {
        return 'default';
    }
    else if (process.env.NODE_ENV === 'development') {
        return 'performance';
    }
    return 'default';
}
exports.default = {
    services: exports.serviceConfigs,
    global: exports.globalResiliencyConfig,
    getServiceConfig,
    applyEmergencyMode,
    applyPerformanceMode,
    getEnvironmentConfig
};
//# sourceMappingURL=resiliency.js.map