"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.retryCache = exports.retryDb = exports.retryHttp = exports.retry = exports.retryConfigs = exports.RetryUtility = exports.RetryError = void 0;
const logger_1 = require("./logger");
const metrics_1 = require("./metrics");
class RetryError extends Error {
    constructor(message, attempts, lastError, allErrors) {
        super(message);
        this.attempts = attempts;
        this.lastError = lastError;
        this.allErrors = allErrors;
        this.name = 'RetryError';
    }
}
exports.RetryError = RetryError;
class RetryUtility {
    static async execute(operation, options = {}) {
        const config = { ...this.defaultOptions, ...options };
        const startTime = Date.now();
        const errors = [];
        let lastError;
        for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
            try {
                const result = await operation();
                const totalTime = Date.now() - startTime;
                if (attempt > 1) {
                    logger_1.logger.info(`Operation succeeded after ${attempt} attempts`, {
                        type: 'retry_success',
                        service: config.name || 'unknown',
                        attempts: attempt,
                        totalTime,
                        previousErrors: errors.length
                    });
                    metrics_1.metrics.incrementCounter('retry_success', 1, {
                        service: config.name || 'unknown',
                        attempts: attempt.toString()
                    });
                }
                metrics_1.metrics.recordHistogram('retry_attempts', attempt, {
                    service: config.name || 'unknown',
                    success: 'true'
                });
                return { result, attempts: attempt, totalTime };
            }
            catch (error) {
                lastError = error;
                errors.push(lastError);
                const shouldRetry = config.retryCondition(lastError);
                const isLastAttempt = attempt === config.maxAttempts;
                logger_1.logger.warn(`Operation failed on attempt ${attempt}`, {
                    type: 'retry_attempt_failed',
                    service: config.name || 'unknown',
                    attempt,
                    maxAttempts: config.maxAttempts,
                    error: lastError.message,
                    shouldRetry: shouldRetry && !isLastAttempt,
                    isLastAttempt
                });
                metrics_1.metrics.incrementCounter('retry_attempt_failed', 1, {
                    service: config.name || 'unknown',
                    attempt: attempt.toString(),
                    error: lastError.name || 'unknown'
                });
                if (isLastAttempt || !shouldRetry) {
                    break;
                }
                if (config.onRetry) {
                    try {
                        config.onRetry(lastError, attempt);
                    }
                    catch (callbackError) {
                        logger_1.logger.warn('Retry callback failed', {
                            type: 'retry_callback_error',
                            service: config.name || 'unknown',
                            error: callbackError.message
                        });
                    }
                }
                const delay = this.calculateDelay(attempt, config);
                logger_1.logger.debug(`Retrying in ${delay}ms`, {
                    type: 'retry_delay',
                    service: config.name || 'unknown',
                    attempt,
                    delay
                });
                await this.sleep(delay);
            }
        }
        const totalTime = Date.now() - startTime;
        const retryError = new RetryError(`Operation failed after ${config.maxAttempts} attempts. Last error: ${lastError.message}`, config.maxAttempts, lastError, errors);
        logger_1.logger.error(`Operation failed after all retry attempts`, {
            type: 'retry_exhausted',
            service: config.name || 'unknown',
            attempts: config.maxAttempts,
            totalTime,
            lastError: lastError.message,
            allErrors: errors.map(e => e.message)
        });
        metrics_1.metrics.incrementCounter('retry_exhausted', 1, {
            service: config.name || 'unknown',
            attempts: config.maxAttempts.toString()
        });
        metrics_1.metrics.recordHistogram('retry_attempts', config.maxAttempts, {
            service: config.name || 'unknown',
            success: 'false'
        });
        throw retryError;
    }
    static calculateDelay(attempt, config) {
        let delay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1);
        delay = Math.min(delay, config.maxDelay);
        if (config.jitter) {
            const jitterRange = delay * 0.25;
            const jitter = (Math.random() - 0.5) * 2 * jitterRange;
            delay = Math.max(0, delay + jitter);
        }
        return Math.round(delay);
    }
    static sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    static async executeHttp(operation, serviceName, options = {}) {
        const httpOptions = {
            maxAttempts: 3,
            baseDelay: 1000,
            maxDelay: 10000,
            backoffMultiplier: 2,
            jitter: true,
            name: serviceName,
            retryCondition: (error) => {
                if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
                    return true;
                }
                if (error.response?.status >= 500) {
                    return true;
                }
                if (error.response?.status === 429) {
                    return true;
                }
                if (error.response?.status >= 400 && error.response?.status < 500) {
                    return false;
                }
                return true;
            },
            onRetry: (error, attempt) => {
                if (error.response?.status === 429) {
                    const retryAfter = error.response?.headers['retry-after'];
                    if (retryAfter) {
                        logger_1.logger.warn(`Rate limited, retry after ${retryAfter}s`, {
                            type: 'rate_limit_retry',
                            service: serviceName,
                            attempt,
                            retryAfter
                        });
                    }
                }
            },
            ...options
        };
        const result = await this.execute(operation, httpOptions);
        return result.result;
    }
    static async executeDb(operation, operationName, options = {}) {
        const dbOptions = {
            maxAttempts: 3,
            baseDelay: 500,
            maxDelay: 5000,
            backoffMultiplier: 2,
            jitter: true,
            name: `db_${operationName}`,
            retryCondition: (error) => {
                if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
                    return true;
                }
                if (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_LOCKED') {
                    return true;
                }
                if (error.code === 'SQLITE_CONSTRAINT' || error.code === 'SQLITE_ERROR') {
                    return false;
                }
                return true;
            },
            ...options
        };
        const result = await this.execute(operation, dbOptions);
        return result.result;
    }
    static async executeCache(operation, operationName, options = {}) {
        const cacheOptions = {
            maxAttempts: 2,
            baseDelay: 100,
            maxDelay: 1000,
            backoffMultiplier: 2,
            jitter: true,
            name: `cache_${operationName}`,
            retryCondition: (error) => {
                return error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT';
            },
            ...options
        };
        const result = await this.execute(operation, cacheOptions);
        return result.result;
    }
}
exports.RetryUtility = RetryUtility;
RetryUtility.defaultOptions = {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    jitter: true,
    retryCondition: (error) => {
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
            return true;
        }
        if (error.response?.status >= 500) {
            return true;
        }
        if (error.name === 'TimeoutError') {
            return true;
        }
        if (error.response?.status >= 400 && error.response?.status < 500) {
            return error.response?.status === 429;
        }
        return true;
    }
};
exports.retryConfigs = {
    dexscreener: {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 10000,
        backoffMultiplier: 2,
        jitter: true,
        name: 'dexscreener'
    },
    goplus: {
        maxAttempts: 2,
        baseDelay: 2000,
        maxDelay: 15000,
        backoffMultiplier: 3,
        jitter: true,
        name: 'goplus'
    },
    birdeye: {
        maxAttempts: 2,
        baseDelay: 5000,
        maxDelay: 30000,
        backoffMultiplier: 3,
        jitter: true,
        name: 'birdeye'
    },
    coingecko: {
        maxAttempts: 3,
        baseDelay: 1500,
        maxDelay: 12000,
        backoffMultiplier: 2,
        jitter: true,
        name: 'coingecko'
    },
    redis: {
        maxAttempts: 3,
        baseDelay: 100,
        maxDelay: 2000,
        backoffMultiplier: 2,
        jitter: true,
        name: 'redis'
    },
    database: {
        maxAttempts: 3,
        baseDelay: 200,
        maxDelay: 3000,
        backoffMultiplier: 2,
        jitter: true,
        name: 'database'
    }
};
exports.retry = RetryUtility.execute;
exports.retryHttp = RetryUtility.executeHttp;
exports.retryDb = RetryUtility.executeDb;
exports.retryCache = RetryUtility.executeCache;
//# sourceMappingURL=retry.js.map