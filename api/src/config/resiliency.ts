/**
 * Comprehensive resiliency configuration for the Meme Coin Radar API
 * 
 * This file centralizes all configuration for:
 * - Circuit breakers
 * - Retry policies
 * - Timeout settings
 * - Rate limiting
 * - Health check intervals
 */

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

// DEX Screener configuration
export const dexScreenerConfig: ServiceResiliencyConfig = {
  name: 'dexscreener',
  circuitBreaker: {
    failureThreshold: 5,
    resetTimeout: 60000, // 1 minute
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
    requestsPerSecond: 5, // 300 rpm = 5 rps
    burstSize: 10,
    queueSize: 50
  },
  healthCheck: {
    interval: 30000, // 30 seconds
    timeout: 5000,
    retries: 2
  }
};

// GoPlus Security configuration
export const goPlusConfig: ServiceResiliencyConfig = {
  name: 'goplus',
  circuitBreaker: {
    failureThreshold: 3,
    resetTimeout: 120000, // 2 minutes
    monitoringPeriod: 60000,
    expectedErrors: ['RateLimitError', 'TimeoutError', 'ECONNRESET']
  },
  retry: {
    maxAttempts: 2, // Lower due to strict rate limits
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
    requestsPerSecond: 0.5, // 30 rpm = 0.5 rps
    burstSize: 2,
    queueSize: 20
  },
  healthCheck: {
    interval: 60000, // 1 minute
    timeout: 8000,
    retries: 1
  }
};

// Birdeye configuration
export const birdeyeConfig: ServiceResiliencyConfig = {
  name: 'birdeye',
  circuitBreaker: {
    failureThreshold: 3,
    resetTimeout: 300000, // 5 minutes (stricter due to low rate limits)
    monitoringPeriod: 60000,
    expectedErrors: ['RateLimitError', 'TimeoutError', 'ECONNRESET']
  },
  retry: {
    maxAttempts: 2, // Very strict rate limits
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
    requestsPerSecond: 1, // 1 rps on free plan
    burstSize: 1,
    queueSize: 10
  },
  healthCheck: {
    interval: 120000, // 2 minutes
    timeout: 10000,
    retries: 1
  }
};

// CoinGecko configuration
export const coinGeckoConfig: ServiceResiliencyConfig = {
  name: 'coingecko',
  circuitBreaker: {
    failureThreshold: 5,
    resetTimeout: 180000, // 3 minutes
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
    requestsPerSecond: 2, // Conservative rate
    burstSize: 5,
    queueSize: 30
  },
  healthCheck: {
    interval: 45000, // 45 seconds
    timeout: 6000,
    retries: 2
  }
};

// Redis configuration
export const redisConfig: ServiceResiliencyConfig = {
  name: 'redis',
  circuitBreaker: {
    failureThreshold: 3,
    resetTimeout: 30000, // 30 seconds
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
    requestsPerSecond: 100, // High throughput for cache
    burstSize: 200,
    queueSize: 500
  },
  healthCheck: {
    interval: 15000, // 15 seconds
    timeout: 3000,
    retries: 3
  }
};

// Database configuration
export const databaseConfig: ServiceResiliencyConfig = {
  name: 'database',
  circuitBreaker: {
    failureThreshold: 3,
    resetTimeout: 60000, // 1 minute
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
    requestsPerSecond: 50, // Moderate throughput
    burstSize: 100,
    queueSize: 200
  },
  healthCheck: {
    interval: 20000, // 20 seconds
    timeout: 4000,
    retries: 2
  }
};

// WebSocket configuration
export const websocketConfig: ServiceResiliencyConfig = {
  name: 'websocket',
  circuitBreaker: {
    failureThreshold: 5,
    resetTimeout: 30000, // 30 seconds
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
    requestsPerSecond: 10, // Messages per second
    burstSize: 20,
    queueSize: 100
  },
  healthCheck: {
    interval: 30000, // 30 seconds
    timeout: 5000,
    retries: 2
  }
};

// Global resiliency settings
export const globalResiliencyConfig = {
  // Default settings for unknown services
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

  // Emergency settings (when system is under stress)
  emergency: {
    circuitBreaker: {
      failureThreshold: 2, // More sensitive
      resetTimeout: 300000, // 5 minutes
      monitoringPeriod: 30000
    },
    retry: {
      maxAttempts: 1, // No retries
      baseDelay: 5000,
      maxDelay: 5000,
      backoffMultiplier: 1,
      jitter: false
    },
    timeout: {
      multiplier: 0.5 // Reduce all timeouts by 50%
    },
    rateLimit: {
      multiplier: 0.3 // Reduce all rate limits by 70%
    }
  },

  // Performance settings (when system is healthy)
  performance: {
    circuitBreaker: {
      failureThreshold: 8, // Less sensitive
      resetTimeout: 30000, // 30 seconds
      monitoringPeriod: 60000
    },
    retry: {
      maxAttempts: 4, // More retries
      baseDelay: 500,
      maxDelay: 15000,
      backoffMultiplier: 2,
      jitter: true
    },
    timeout: {
      multiplier: 1.5 // Increase timeouts by 50%
    },
    rateLimit: {
      multiplier: 1.5 // Increase rate limits by 50%
    }
  }
};

// Service configuration map
export const serviceConfigs = {
  dexscreener: dexScreenerConfig,
  goplus: goPlusConfig,
  birdeye: birdeyeConfig,
  coingecko: coinGeckoConfig,
  redis: redisConfig,
  database: databaseConfig,
  websocket: websocketConfig
};

// Helper functions
export function getServiceConfig(serviceName: string): ServiceResiliencyConfig {
  return serviceConfigs[serviceName as keyof typeof serviceConfigs] || {
    name: serviceName,
    ...globalResiliencyConfig.defaults
  } as ServiceResiliencyConfig;
}

export function applyEmergencyMode(config: ServiceResiliencyConfig): ServiceResiliencyConfig {
  const emergency = globalResiliencyConfig.emergency;
  
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
      operations: Object.fromEntries(
        Object.entries(config.timeout.operations || {}).map(([key, value]) => [
          key,
          Math.round(value * emergency.timeout.multiplier)
        ])
      )
    },
    rateLimit: {
      ...config.rateLimit,
      requestsPerSecond: Math.max(0.1, config.rateLimit.requestsPerSecond * emergency.rateLimit.multiplier),
      burstSize: config.rateLimit.burstSize ? Math.max(1, Math.round(config.rateLimit.burstSize * emergency.rateLimit.multiplier)) : undefined,
      queueSize: config.rateLimit.queueSize ? Math.max(5, Math.round(config.rateLimit.queueSize * emergency.rateLimit.multiplier)) : undefined
    }
  };
}

export function applyPerformanceMode(config: ServiceResiliencyConfig): ServiceResiliencyConfig {
  const performance = globalResiliencyConfig.performance;
  
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
      operations: Object.fromEntries(
        Object.entries(config.timeout.operations || {}).map(([key, value]) => [
          key,
          Math.round(value * performance.timeout.multiplier)
        ])
      )
    },
    rateLimit: {
      ...config.rateLimit,
      requestsPerSecond: config.rateLimit.requestsPerSecond * performance.rateLimit.multiplier,
      burstSize: config.rateLimit.burstSize ? Math.round(config.rateLimit.burstSize * performance.rateLimit.multiplier) : undefined,
      queueSize: config.rateLimit.queueSize ? Math.round(config.rateLimit.queueSize * performance.rateLimit.multiplier) : undefined
    }
  };
}

// Environment-based configuration
export function getEnvironmentConfig(): 'emergency' | 'performance' | 'default' {
  const mode = process.env.RESILIENCY_MODE?.toLowerCase();
  
  if (mode === 'emergency') return 'emergency';
  if (mode === 'performance') return 'performance';
  
  // Auto-detect based on environment
  if (process.env.NODE_ENV === 'production') {
    return 'default';
  } else if (process.env.NODE_ENV === 'development') {
    return 'performance';
  }
  
  return 'default';
}

// Export all configurations
export default {
  services: serviceConfigs,
  global: globalResiliencyConfig,
  getServiceConfig,
  applyEmergencyMode,
  applyPerformanceMode,
  getEnvironmentConfig
};