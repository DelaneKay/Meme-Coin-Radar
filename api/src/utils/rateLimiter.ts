import { logger, logRateLimit } from './logger';
import { RateLimitStatus } from '../types';

interface RateLimitConfig {
  requestsPerSecond?: number;
  requestsPerMinute?: number;
  requestsPerHour?: number;
  burstSize?: number;
}

interface RateLimitState {
  tokens: number;
  lastRefill: number;
  requests: number[];
  blocked: boolean;
  blockedUntil: number;
}

export class RateLimitManager {
  private limits: Map<string, RateLimitConfig> = new Map();
  private states: Map<string, RateLimitState> = new Map();
  private cleanupInterval!: NodeJS.Timeout;

  constructor() {
    this.initializeDefaults();
    this.startCleanup();
  }

  private initializeDefaults() {
    // Set default rate limits based on API documentation
    this.setLimit('birdeye', {
      requestsPerSecond: parseFloat(process.env.BIRDEYE_RPS || '0.9'),
      burstSize: 3,
    });

    this.setLimit('goplus', {
      requestsPerMinute: parseInt(process.env.GOPLUS_RPM || '25'),
      burstSize: 5,
    });

    this.setLimit('dexscreener', {
      requestsPerSecond: parseFloat(process.env.DEXSCREENER_RPS || '2'),
      burstSize: 5,
    });

    this.setLimit('geckoterminal', {
      requestsPerSecond: parseFloat(process.env.GECKOTERMINAL_RPS || '1'),
      burstSize: 3,
    });

    this.setLimit('honeypot', {
      requestsPerSecond: 1,
      burstSize: 2,
    });

    this.setLimit('coingecko', {
      requestsPerMinute: 30,
      burstSize: 10,
    });
  }

  private startCleanup() {
    // Clean up old request timestamps every minute
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const oneHourAgo = now - 60 * 60 * 1000;

      for (const [service, state] of Array.from(this.states.entries())) {
        // Remove requests older than 1 hour
        state.requests = state.requests.filter(timestamp => timestamp > oneHourAgo);
        
        // Reset blocked state if time has passed
        if (state.blocked && now > state.blockedUntil) {
          state.blocked = false;
          state.blockedUntil = 0;
          logger.info(`Rate limit unblocked for ${service}`);
        }
      }
    }, 60 * 1000);
  }

  setLimit(service: string, config: RateLimitConfig): void {
    this.limits.set(service, config);
    
    // Initialize state if not exists
    if (!this.states.has(service)) {
      this.states.set(service, {
        tokens: config.burstSize || 1,
        lastRefill: Date.now(),
        requests: [],
        blocked: false,
        blockedUntil: 0,
      });
    }
  }

  async canMakeRequest(service: string): Promise<boolean> {
    const config = this.limits.get(service);
    if (!config) {
      logger.warn(`No rate limit config found for service: ${service}`);
      return true;
    }

    const state = this.states.get(service);
    if (!state) {
      logger.warn(`No rate limit state found for service: ${service}`);
      return true;
    }

    const now = Date.now();

    // Check if service is blocked
    if (state.blocked && now < state.blockedUntil) {
      return false;
    }

    // Reset blocked state if time has passed
    if (state.blocked && now >= state.blockedUntil) {
      state.blocked = false;
      state.blockedUntil = 0;
    }

    // Token bucket algorithm for burst handling
    if (config.requestsPerSecond && config.burstSize) {
      const timeSinceLastRefill = now - state.lastRefill;
      const tokensToAdd = (timeSinceLastRefill / 1000) * config.requestsPerSecond;
      
      state.tokens = Math.min(config.burstSize, state.tokens + tokensToAdd);
      state.lastRefill = now;

      if (state.tokens < 1) {
        return false;
      }
    }

    // Check per-minute limits
    if (config.requestsPerMinute) {
      const oneMinuteAgo = now - 60 * 1000;
      const recentRequests = state.requests.filter(timestamp => timestamp > oneMinuteAgo);
      
      if (recentRequests.length >= config.requestsPerMinute) {
        return false;
      }
    }

    // Check per-hour limits
    if (config.requestsPerHour) {
      const oneHourAgo = now - 60 * 60 * 1000;
      const recentRequests = state.requests.filter(timestamp => timestamp > oneHourAgo);
      
      if (recentRequests.length >= config.requestsPerHour) {
        return false;
      }
    }

    return true;
  }

  async recordRequest(service: string): Promise<void> {
    const state = this.states.get(service);
    if (!state) return;

    const now = Date.now();
    
    // Consume token if using token bucket
    if (state.tokens >= 1) {
      state.tokens -= 1;
    }

    // Record request timestamp
    state.requests.push(now);

    // Log rate limit status
    const status = this.getStatus(service);
    if (status) {
      logRateLimit(service, status.remaining, status.resetTime);
    }
  }

  async checkLimit(service: string, identifier?: string): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    const canMake = await this.canMakeRequest(service);
    
    if (canMake) {
      await this.recordRequest(service);
    }

    const status = this.getStatus(service);
    
    return {
      allowed: canMake,
      remaining: status?.remaining || 0,
      resetTime: status?.resetTime || Date.now()
    };
  }

  async waitForAvailability(service: string, maxWaitMs: number = 30000): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitMs) {
      if (await this.canMakeRequest(service)) {
        return true;
      }
      
      // Calculate wait time based on rate limit
      const waitTime = this.calculateWaitTime(service);
      const actualWaitTime = Math.min(waitTime, 1000); // Max 1 second per iteration
      
      await new Promise(resolve => setTimeout(resolve, actualWaitTime));
    }
    
    return false;
  }

  private calculateWaitTime(service: string): number {
    const config = this.limits.get(service);
    const state = this.states.get(service);
    
    if (!config || !state) return 1000;

    // If blocked, wait until unblocked
    if (state.blocked) {
      return Math.max(0, state.blockedUntil - Date.now());
    }

    // Calculate wait time based on rate limits
    if (config.requestsPerSecond) {
      return Math.ceil(1000 / config.requestsPerSecond);
    }

    if (config.requestsPerMinute) {
      return Math.ceil(60000 / config.requestsPerMinute);
    }

    return 1000; // Default 1 second
  }

  blockService(service: string, durationMs: number, reason?: string): void {
    const state = this.states.get(service);
    if (!state) return;

    state.blocked = true;
    state.blockedUntil = Date.now() + durationMs;

    logger.warn(`Service ${service} blocked for ${durationMs}ms`, { reason });
  }

  unblockService(service: string): void {
    const state = this.states.get(service);
    if (!state) return;

    state.blocked = false;
    state.blockedUntil = 0;

    logger.info(`Service ${service} unblocked`);
  }

  getStatus(service: string): RateLimitStatus | null {
    const config = this.limits.get(service);
    const state = this.states.get(service);
    
    if (!config || !state) return null;

    const now = Date.now();
    let remaining = 0;
    let resetTime = now;

    // Calculate remaining requests based on the most restrictive limit
    if (config.requestsPerSecond) {
      remaining = Math.floor(state.tokens);
      resetTime = now + (1000 / config.requestsPerSecond);
    } else if (config.requestsPerMinute) {
      const oneMinuteAgo = now - 60 * 1000;
      const recentRequests = state.requests.filter(timestamp => timestamp > oneMinuteAgo);
      remaining = Math.max(0, config.requestsPerMinute - recentRequests.length);
      
      if (recentRequests.length > 0) {
        resetTime = recentRequests[0] + 60 * 1000;
      }
    } else if (config.requestsPerHour) {
      const oneHourAgo = now - 60 * 60 * 1000;
      const recentRequests = state.requests.filter(timestamp => timestamp > oneHourAgo);
      remaining = Math.max(0, config.requestsPerHour - recentRequests.length);
      
      if (recentRequests.length > 0) {
        resetTime = recentRequests[0] + 60 * 60 * 1000;
      }
    }

    return {
      service,
      remaining,
      resetTime,
      isLimited: state.blocked || remaining === 0,
    };
  }

  getAllStatuses(): RateLimitStatus[] {
    const statuses: RateLimitStatus[] = [];
    
    for (const service of Array.from(this.limits.keys())) {
      const status = this.getStatus(service);
      if (status) {
        statuses.push(status);
      }
    }
    
    return statuses;
  }

  // Handle 429 responses from APIs
  handle429Response(service: string, retryAfterSeconds?: number): void {
    const backoffTime = retryAfterSeconds 
      ? retryAfterSeconds * 1000 
      : this.getExponentialBackoff(service);

    this.blockService(service, backoffTime, '429 Too Many Requests');
    
    logger.warn(`Received 429 from ${service}, backing off for ${backoffTime}ms`);
  }

  private getExponentialBackoff(service: string): number {
    const state = this.states.get(service);
    if (!state) return 60000; // 1 minute default

    // Simple exponential backoff based on recent blocks
    const baseDelay = 30000; // 30 seconds
    const maxDelay = 300000; // 5 minutes
    
    // Count recent blocks (last hour)
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentBlocks = state.requests.filter(timestamp => timestamp > oneHourAgo).length;
    
    const delay = Math.min(maxDelay, baseDelay * Math.pow(2, Math.min(recentBlocks, 4)));
    return delay;
  }

  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    this.limits.clear();
    this.states.clear();
    
    logger.info('Rate limit manager shutdown');
  }
}

// Global rate limiter instance
export const rateLimiterManager = new RateLimitManager();

// Initialize default rate limits
rateLimiterManager.setLimit('auth', {
  requestsPerMinute: 5, // 5 auth attempts per minute
  requestsPerHour: 20,  // 20 auth attempts per hour
  burstSize: 3,         // Allow 3 quick attempts
  requestsPerSecond: 0.1 // 1 request per 10 seconds
});

rateLimiterManager.setLimit('api', {
  requestsPerMinute: 60,
  requestsPerHour: 1000,
  burstSize: 10,
  requestsPerSecond: 2
});

rateLimiterManager.setLimit('external_api', {
  requestsPerMinute: 30,
  requestsPerHour: 500,
  burstSize: 5,
  requestsPerSecond: 1
});