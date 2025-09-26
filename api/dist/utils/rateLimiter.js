"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimitManager = void 0;
const logger_1 = require("./logger");
class RateLimitManager {
    constructor() {
        this.limits = new Map();
        this.states = new Map();
        this.initializeDefaults();
        this.startCleanup();
    }
    initializeDefaults() {
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
    startCleanup() {
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            const oneHourAgo = now - 60 * 60 * 1000;
            for (const [service, state] of this.states.entries()) {
                state.requests = state.requests.filter(timestamp => timestamp > oneHourAgo);
                if (state.blocked && now > state.blockedUntil) {
                    state.blocked = false;
                    state.blockedUntil = 0;
                    logger_1.logger.info(`Rate limit unblocked for ${service}`);
                }
            }
        }, 60 * 1000);
    }
    setLimit(service, config) {
        this.limits.set(service, config);
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
    async canMakeRequest(service) {
        const config = this.limits.get(service);
        if (!config) {
            logger_1.logger.warn(`No rate limit config found for service: ${service}`);
            return true;
        }
        const state = this.states.get(service);
        if (!state) {
            logger_1.logger.warn(`No rate limit state found for service: ${service}`);
            return true;
        }
        const now = Date.now();
        if (state.blocked && now < state.blockedUntil) {
            return false;
        }
        if (state.blocked && now >= state.blockedUntil) {
            state.blocked = false;
            state.blockedUntil = 0;
        }
        if (config.requestsPerSecond && config.burstSize) {
            const timeSinceLastRefill = now - state.lastRefill;
            const tokensToAdd = (timeSinceLastRefill / 1000) * config.requestsPerSecond;
            state.tokens = Math.min(config.burstSize, state.tokens + tokensToAdd);
            state.lastRefill = now;
            if (state.tokens < 1) {
                return false;
            }
        }
        if (config.requestsPerMinute) {
            const oneMinuteAgo = now - 60 * 1000;
            const recentRequests = state.requests.filter(timestamp => timestamp > oneMinuteAgo);
            if (recentRequests.length >= config.requestsPerMinute) {
                return false;
            }
        }
        if (config.requestsPerHour) {
            const oneHourAgo = now - 60 * 60 * 1000;
            const recentRequests = state.requests.filter(timestamp => timestamp > oneHourAgo);
            if (recentRequests.length >= config.requestsPerHour) {
                return false;
            }
        }
        return true;
    }
    async recordRequest(service) {
        const state = this.states.get(service);
        if (!state)
            return;
        const now = Date.now();
        if (state.tokens >= 1) {
            state.tokens -= 1;
        }
        state.requests.push(now);
        const status = this.getStatus(service);
        if (status) {
            (0, logger_1.logRateLimit)(service, status.remaining, status.resetTime);
        }
    }
    async waitForAvailability(service, maxWaitMs = 30000) {
        const startTime = Date.now();
        while (Date.now() - startTime < maxWaitMs) {
            if (await this.canMakeRequest(service)) {
                return true;
            }
            const waitTime = this.calculateWaitTime(service);
            const actualWaitTime = Math.min(waitTime, 1000);
            await new Promise(resolve => setTimeout(resolve, actualWaitTime));
        }
        return false;
    }
    calculateWaitTime(service) {
        const config = this.limits.get(service);
        const state = this.states.get(service);
        if (!config || !state)
            return 1000;
        if (state.blocked) {
            return Math.max(0, state.blockedUntil - Date.now());
        }
        if (config.requestsPerSecond) {
            return Math.ceil(1000 / config.requestsPerSecond);
        }
        if (config.requestsPerMinute) {
            return Math.ceil(60000 / config.requestsPerMinute);
        }
        return 1000;
    }
    blockService(service, durationMs, reason) {
        const state = this.states.get(service);
        if (!state)
            return;
        state.blocked = true;
        state.blockedUntil = Date.now() + durationMs;
        logger_1.logger.warn(`Service ${service} blocked for ${durationMs}ms`, { reason });
    }
    unblockService(service) {
        const state = this.states.get(service);
        if (!state)
            return;
        state.blocked = false;
        state.blockedUntil = 0;
        logger_1.logger.info(`Service ${service} unblocked`);
    }
    getStatus(service) {
        const config = this.limits.get(service);
        const state = this.states.get(service);
        if (!config || !state)
            return null;
        const now = Date.now();
        let remaining = 0;
        let resetTime = now;
        if (config.requestsPerSecond) {
            remaining = Math.floor(state.tokens);
            resetTime = now + (1000 / config.requestsPerSecond);
        }
        else if (config.requestsPerMinute) {
            const oneMinuteAgo = now - 60 * 1000;
            const recentRequests = state.requests.filter(timestamp => timestamp > oneMinuteAgo);
            remaining = Math.max(0, config.requestsPerMinute - recentRequests.length);
            if (recentRequests.length > 0) {
                resetTime = recentRequests[0] + 60 * 1000;
            }
        }
        else if (config.requestsPerHour) {
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
    getAllStatuses() {
        const statuses = [];
        for (const service of this.limits.keys()) {
            const status = this.getStatus(service);
            if (status) {
                statuses.push(status);
            }
        }
        return statuses;
    }
    handle429Response(service, retryAfterSeconds) {
        const backoffTime = retryAfterSeconds
            ? retryAfterSeconds * 1000
            : this.getExponentialBackoff(service);
        this.blockService(service, backoffTime, '429 Too Many Requests');
        logger_1.logger.warn(`Received 429 from ${service}, backing off for ${backoffTime}ms`);
    }
    getExponentialBackoff(service) {
        const state = this.states.get(service);
        if (!state)
            return 60000;
        const baseDelay = 30000;
        const maxDelay = 300000;
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        const recentBlocks = state.requests.filter(timestamp => timestamp > oneHourAgo).length;
        const delay = Math.min(maxDelay, baseDelay * Math.pow(2, Math.min(recentBlocks, 4)));
        return delay;
    }
    shutdown() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.limits.clear();
        this.states.clear();
        logger_1.logger.info('Rate limit manager shutdown');
    }
}
exports.RateLimitManager = RateLimitManager;
//# sourceMappingURL=rateLimiter.js.map