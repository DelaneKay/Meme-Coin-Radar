"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.circuitBreakerManager = exports.defaultCircuitBreakerConfigs = exports.CircuitBreakerManager = exports.CircuitBreaker = exports.CircuitBreakerError = exports.CircuitBreakerState = void 0;
const logger_1 = require("./logger");
const metrics_1 = require("./metrics");
var CircuitBreakerState;
(function (CircuitBreakerState) {
    CircuitBreakerState["CLOSED"] = "closed";
    CircuitBreakerState["OPEN"] = "open";
    CircuitBreakerState["HALF_OPEN"] = "half-open";
})(CircuitBreakerState || (exports.CircuitBreakerState = CircuitBreakerState = {}));
class CircuitBreakerError extends Error {
    constructor(message, state) {
        super(message);
        this.state = state;
        this.name = 'CircuitBreakerError';
    }
}
exports.CircuitBreakerError = CircuitBreakerError;
class CircuitBreaker {
    constructor(options) {
        this.options = options;
        this.state = CircuitBreakerState.CLOSED;
        this.failureCount = 0;
        this.lastFailureTime = 0;
        this.nextAttemptTime = 0;
        this.successCount = 0;
        this.logStateChange(CircuitBreakerState.CLOSED);
    }
    async execute(operation) {
        if (this.state === CircuitBreakerState.OPEN) {
            if (Date.now() < this.nextAttemptTime) {
                metrics_1.metrics.incrementCounter('circuit_breaker_rejected', 1, {
                    service: this.options.name,
                    state: this.state
                });
                throw new CircuitBreakerError(`Circuit breaker is OPEN for ${this.options.name}. Next attempt allowed at ${new Date(this.nextAttemptTime).toISOString()}`, this.state);
            }
            else {
                this.setState(CircuitBreakerState.HALF_OPEN);
            }
        }
        try {
            const result = await operation();
            this.onSuccess();
            return result;
        }
        catch (error) {
            this.onFailure(error);
            throw error;
        }
    }
    onSuccess() {
        this.failureCount = 0;
        this.successCount++;
        if (this.state === CircuitBreakerState.HALF_OPEN) {
            this.setState(CircuitBreakerState.CLOSED);
            logger_1.logger.info(`Circuit breaker ${this.options.name} recovered`, {
                type: 'circuit_breaker_recovery',
                service: this.options.name,
                successCount: this.successCount
            });
        }
        metrics_1.metrics.incrementCounter('circuit_breaker_success', 1, {
            service: this.options.name,
            state: this.state
        });
    }
    onFailure(error) {
        if (this.isExpectedError(error)) {
            metrics_1.metrics.incrementCounter('circuit_breaker_expected_error', 1, {
                service: this.options.name,
                error: error.name || 'unknown'
            });
            return;
        }
        this.failureCount++;
        this.lastFailureTime = Date.now();
        metrics_1.metrics.incrementCounter('circuit_breaker_failure', 1, {
            service: this.options.name,
            state: this.state,
            error: error.name || 'unknown'
        });
        logger_1.logger.warn(`Circuit breaker failure for ${this.options.name}`, {
            type: 'circuit_breaker_failure',
            service: this.options.name,
            failureCount: this.failureCount,
            threshold: this.options.failureThreshold,
            error: error.message,
            state: this.state
        });
        if (this.state === CircuitBreakerState.HALF_OPEN) {
            this.setState(CircuitBreakerState.OPEN);
        }
        else if (this.failureCount >= this.options.failureThreshold) {
            this.setState(CircuitBreakerState.OPEN);
        }
    }
    isExpectedError(error) {
        if (!this.options.expectedErrors)
            return false;
        const errorName = error.name || error.constructor.name;
        const errorMessage = error.message || '';
        return this.options.expectedErrors.some(expectedError => errorName.includes(expectedError) || errorMessage.includes(expectedError));
    }
    setState(newState) {
        if (this.state === newState)
            return;
        const oldState = this.state;
        this.state = newState;
        if (newState === CircuitBreakerState.OPEN) {
            this.nextAttemptTime = Date.now() + this.options.resetTimeout;
        }
        this.logStateChange(newState, oldState);
        metrics_1.metrics.setGauge('circuit_breaker_state', this.getStateValue(), {
            service: this.options.name
        });
    }
    logStateChange(newState, oldState) {
        (0, logger_1.logCircuitBreaker)(this.options.name, newState, {
            oldState,
            failureCount: this.failureCount,
            threshold: this.options.failureThreshold,
            nextAttemptTime: this.nextAttemptTime > 0 ? new Date(this.nextAttemptTime).toISOString() : undefined
        });
    }
    getStateValue() {
        switch (this.state) {
            case CircuitBreakerState.CLOSED: return 0;
            case CircuitBreakerState.HALF_OPEN: return 1;
            case CircuitBreakerState.OPEN: return 2;
            default: return -1;
        }
    }
    getState() {
        return this.state;
    }
    getFailureCount() {
        return this.failureCount;
    }
    getSuccessCount() {
        return this.successCount;
    }
    getNextAttemptTime() {
        return this.nextAttemptTime;
    }
    forceOpen() {
        this.setState(CircuitBreakerState.OPEN);
        logger_1.logger.warn(`Circuit breaker ${this.options.name} manually forced OPEN`, {
            type: 'circuit_breaker_manual_open',
            service: this.options.name
        });
    }
    forceClose() {
        this.failureCount = 0;
        this.setState(CircuitBreakerState.CLOSED);
        logger_1.logger.info(`Circuit breaker ${this.options.name} manually forced CLOSED`, {
            type: 'circuit_breaker_manual_close',
            service: this.options.name
        });
    }
    reset() {
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = 0;
        this.nextAttemptTime = 0;
        this.setState(CircuitBreakerState.CLOSED);
        logger_1.logger.info(`Circuit breaker ${this.options.name} reset`, {
            type: 'circuit_breaker_reset',
            service: this.options.name
        });
    }
    getStatus() {
        return {
            name: this.options.name,
            state: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
            failureThreshold: this.options.failureThreshold,
            lastFailureTime: this.lastFailureTime > 0 ? new Date(this.lastFailureTime).toISOString() : null,
            nextAttemptTime: this.nextAttemptTime > 0 ? new Date(this.nextAttemptTime).toISOString() : null,
            healthy: this.state !== CircuitBreakerState.OPEN
        };
    }
}
exports.CircuitBreaker = CircuitBreaker;
class CircuitBreakerManager {
    constructor() {
        this.breakers = new Map();
    }
    createBreaker(name, options) {
        const breaker = new CircuitBreaker({ ...options, name });
        this.breakers.set(name, breaker);
        return breaker;
    }
    getBreaker(name) {
        return this.breakers.get(name);
    }
    getAllBreakers() {
        return Array.from(this.breakers.values());
    }
    getStatus() {
        return Array.from(this.breakers.values()).map(breaker => breaker.getStatus());
    }
    openAll() {
        this.breakers.forEach(breaker => breaker.forceOpen());
        logger_1.logger.warn('All circuit breakers manually opened', {
            type: 'circuit_breaker_emergency_open',
            count: this.breakers.size
        });
    }
    closeAll() {
        this.breakers.forEach(breaker => breaker.forceClose());
        logger_1.logger.info('All circuit breakers manually closed', {
            type: 'circuit_breaker_emergency_close',
            count: this.breakers.size
        });
    }
    resetAll() {
        this.breakers.forEach(breaker => breaker.reset());
        logger_1.logger.info('All circuit breakers reset', {
            type: 'circuit_breaker_reset_all',
            count: this.breakers.size
        });
    }
}
exports.CircuitBreakerManager = CircuitBreakerManager;
exports.defaultCircuitBreakerConfigs = {
    dexscreener: {
        failureThreshold: 5,
        resetTimeout: 60000,
        monitoringPeriod: 60000,
        expectedErrors: ['RateLimitError', 'TimeoutError']
    },
    goplus: {
        failureThreshold: 3,
        resetTimeout: 120000,
        monitoringPeriod: 60000,
        expectedErrors: ['RateLimitError', 'TimeoutError']
    },
    birdeye: {
        failureThreshold: 3,
        resetTimeout: 300000,
        monitoringPeriod: 60000,
        expectedErrors: ['RateLimitError', 'TimeoutError']
    },
    coingecko: {
        failureThreshold: 5,
        resetTimeout: 180000,
        monitoringPeriod: 60000,
        expectedErrors: ['RateLimitError', 'TimeoutError']
    },
    redis: {
        failureThreshold: 3,
        resetTimeout: 30000,
        monitoringPeriod: 30000,
        expectedErrors: ['TimeoutError']
    }
};
exports.circuitBreakerManager = new CircuitBreakerManager();
//# sourceMappingURL=circuitBreaker.js.map