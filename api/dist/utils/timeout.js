"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancellableDelay = exports.delay = exports.withCacheTimeout = exports.withDbTimeout = exports.withHttpTimeout = exports.withTimeout = exports.timeoutConfigs = exports.TimeoutUtility = exports.TimeoutError = void 0;
const logger_1 = require("./logger");
const metrics_1 = require("./metrics");
class TimeoutError extends Error {
    constructor(message, timeoutMs) {
        super(message);
        this.timeoutMs = timeoutMs;
        this.name = 'TimeoutError';
    }
}
exports.TimeoutError = TimeoutError;
class TimeoutUtility {
    static async withTimeout(promise, options) {
        const { timeoutMs, name = 'unknown', onTimeout } = options;
        let timeoutId;
        let isResolved = false;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                if (!isResolved) {
                    isResolved = true;
                    if (onTimeout) {
                        try {
                            onTimeout();
                        }
                        catch (error) {
                            logger_1.logger.warn('Timeout callback failed', {
                                type: 'timeout_callback_error',
                                service: name,
                                error: error.message
                            });
                        }
                    }
                    logger_1.logger.warn(`Operation timed out after ${timeoutMs}ms`, {
                        type: 'operation_timeout',
                        service: name,
                        timeoutMs
                    });
                    metrics_1.metrics.incrementCounter('operation_timeout', 1, {
                        service: name,
                        timeout: timeoutMs.toString()
                    });
                    reject(new TimeoutError(`Operation '${name}' timed out after ${timeoutMs}ms`, timeoutMs));
                }
            }, timeoutMs);
        });
        try {
            const result = await Promise.race([promise, timeoutPromise]);
            isResolved = true;
            clearTimeout(timeoutId);
            metrics_1.metrics.incrementCounter('operation_completed', 1, {
                service: name,
                result: 'success'
            });
            return result;
        }
        catch (error) {
            isResolved = true;
            clearTimeout(timeoutId);
            if (error instanceof TimeoutError) {
                throw error;
            }
            metrics_1.metrics.incrementCounter('operation_completed', 1, {
                service: name,
                result: 'error'
            });
            throw error;
        }
    }
    static createTimeoutWrapper(fn, defaultTimeout, name) {
        return async (...args) => {
            return this.withTimeout(fn(...args), {
                timeoutMs: defaultTimeout,
                name: name || fn.name || 'wrapped_function'
            });
        };
    }
    static async withHttpTimeout(promise, timeoutMs, serviceName) {
        return this.withTimeout(promise, {
            timeoutMs,
            name: `http_${serviceName}`,
            onTimeout: () => {
                logger_1.logger.warn(`HTTP request to ${serviceName} timed out`, {
                    type: 'http_timeout',
                    service: serviceName,
                    timeoutMs
                });
            }
        });
    }
    static async withDbTimeout(promise, timeoutMs, operationName) {
        return this.withTimeout(promise, {
            timeoutMs,
            name: `db_${operationName}`,
            onTimeout: () => {
                logger_1.logger.warn(`Database operation '${operationName}' timed out`, {
                    type: 'db_timeout',
                    operation: operationName,
                    timeoutMs
                });
            }
        });
    }
    static async withCacheTimeout(promise, timeoutMs, operationName) {
        return this.withTimeout(promise, {
            timeoutMs,
            name: `cache_${operationName}`,
            onTimeout: () => {
                logger_1.logger.debug(`Cache operation '${operationName}' timed out`, {
                    type: 'cache_timeout',
                    operation: operationName,
                    timeoutMs
                });
            }
        });
    }
    static delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    static cancellableDelay(ms) {
        let timeoutId;
        let cancelled = false;
        const promise = new Promise((resolve, reject) => {
            timeoutId = setTimeout(() => {
                if (!cancelled) {
                    resolve();
                }
            }, ms);
        });
        const cancel = () => {
            cancelled = true;
            clearTimeout(timeoutId);
        };
        return { promise, cancel };
    }
    static async allWithTimeout(promises, options = {}) {
        const { failFast = false } = options;
        const wrappedPromises = promises.map(async ({ promise, timeout, name }, index) => {
            try {
                return await this.withTimeout(promise, {
                    timeoutMs: timeout,
                    name: name || `promise_${index}`
                });
            }
            catch (error) {
                if (failFast) {
                    throw error;
                }
                return error;
            }
        });
        if (failFast) {
            return Promise.all(wrappedPromises);
        }
        else {
            return Promise.allSettled(wrappedPromises).then(results => results.map(result => result.status === 'fulfilled' ? result.value : result.reason));
        }
    }
    static async raceWithTimeout(promises, globalTimeout) {
        const wrappedPromises = promises.map(({ promise, timeout, name }, index) => this.withTimeout(promise, {
            timeoutMs: timeout,
            name: name || `race_promise_${index}`
        }));
        if (globalTimeout) {
            return this.withTimeout(Promise.race(wrappedPromises), {
                timeoutMs: globalTimeout,
                name: 'race_global'
            });
        }
        return Promise.race(wrappedPromises);
    }
}
exports.TimeoutUtility = TimeoutUtility;
exports.timeoutConfigs = {
    dexscreener: {
        search: 10000,
        pairs: 8000,
        tokens: 8000
    },
    goplus: {
        security: 15000,
        batch: 20000
    },
    birdeye: {
        price: 12000,
        overview: 15000
    },
    coingecko: {
        search: 8000,
        price: 6000,
        markets: 10000
    },
    redis: {
        get: 2000,
        set: 3000,
        del: 2000,
        scan: 5000
    },
    database: {
        select: 5000,
        insert: 8000,
        update: 8000,
        delete: 5000
    },
    websocket: {
        connect: 10000,
        send: 5000,
        close: 3000
    }
};
exports.withTimeout = TimeoutUtility.withTimeout;
exports.withHttpTimeout = TimeoutUtility.withHttpTimeout;
exports.withDbTimeout = TimeoutUtility.withDbTimeout;
exports.withCacheTimeout = TimeoutUtility.withCacheTimeout;
exports.delay = TimeoutUtility.delay;
exports.cancellableDelay = TimeoutUtility.cancellableDelay;
//# sourceMappingURL=timeout.js.map