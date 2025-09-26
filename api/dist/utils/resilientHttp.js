"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.coinGeckoClient = exports.birdeyeClient = exports.goPlusClient = exports.dexScreenerClient = exports.HttpClientFactory = exports.ResilientHttpClient = void 0;
const axios_1 = __importDefault(require("axios"));
const circuitBreaker_1 = require("./circuitBreaker");
const retry_1 = require("./retry");
const timeout_1 = require("./timeout");
const logger_1 = require("./logger");
const metrics_1 = require("./metrics");
class ResilientHttpClient {
    constructor(config) {
        this.requestQueue = [];
        this.isProcessingQueue = false;
        this.lastRequestTime = 0;
        this.config = config;
        this.axiosInstance = axios_1.default.create({
            baseURL: config.baseURL,
            timeout: config.timeout || timeout_1.timeoutConfigs.dexscreener.search,
            headers: {
                'User-Agent': 'MemeRadar/1.0',
                ...config.headers
            },
            validateStatus: config.validateStatus || ((status) => status < 500)
        });
        this.setupInterceptors();
        const cbConfig = config.circuitBreakerConfig || circuitBreaker_1.defaultCircuitBreakerConfigs.dexscreener;
        this.circuitBreaker = circuitBreaker_1.circuitBreakerManager.createBreaker(config.serviceName, cbConfig);
        logger_1.logger.info(`ResilientHttpClient created for ${config.serviceName}`, {
            type: 'http_client_created',
            service: config.serviceName,
            baseURL: config.baseURL,
            timeout: config.timeout,
            rateLimit: config.rateLimit
        });
    }
    setupInterceptors() {
        this.axiosInstance.interceptors.request.use((config) => {
            config.metadata = { startTime: Date.now() };
            logger_1.logger.debug(`HTTP request starting`, {
                type: 'http_request_start',
                service: this.config.serviceName,
                method: config.method?.toUpperCase(),
                url: config.url,
                headers: this.sanitizeHeaders(config.headers)
            });
            return config;
        }, (error) => {
            logger_1.logger.error(`HTTP request setup failed`, {
                type: 'http_request_setup_error',
                service: this.config.serviceName,
                error: error.message
            });
            return Promise.reject(error);
        });
        this.axiosInstance.interceptors.response.use((response) => {
            const duration = Date.now() - response.config.metadata.startTime;
            logger_1.logger.debug(`HTTP request completed`, {
                type: 'http_request_success',
                service: this.config.serviceName,
                method: response.config.method?.toUpperCase(),
                url: response.config.url,
                status: response.status,
                duration
            });
            metrics_1.metrics.recordHistogram('http_request_duration', duration, {
                service: this.config.serviceName,
                method: response.config.method?.toUpperCase() || 'unknown',
                status: response.status.toString()
            });
            return response;
        }, (error) => {
            const duration = error.config?.metadata?.startTime
                ? Date.now() - error.config.metadata.startTime
                : 0;
            logger_1.logger.warn(`HTTP request failed`, {
                type: 'http_request_error',
                service: this.config.serviceName,
                method: error.config?.method?.toUpperCase(),
                url: error.config?.url,
                status: error.response?.status,
                error: error.message,
                duration
            });
            metrics_1.metrics.recordHistogram('http_request_duration', duration, {
                service: this.config.serviceName,
                method: error.config?.method?.toUpperCase() || 'unknown',
                status: error.response?.status?.toString() || 'error'
            });
            return Promise.reject(error);
        });
    }
    sanitizeHeaders(headers) {
        if (!headers)
            return {};
        const sanitized = { ...headers };
        const sensitiveKeys = ['authorization', 'x-api-key', 'api-key', 'token'];
        for (const key of Object.keys(sanitized)) {
            if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
                sanitized[key] = '[REDACTED]';
            }
        }
        return sanitized;
    }
    async enforceRateLimit() {
        if (!this.config.rateLimit)
            return;
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        const minInterval = 1000 / this.config.rateLimit.requestsPerSecond;
        if (timeSinceLastRequest < minInterval) {
            const delay = minInterval - timeSinceLastRequest;
            logger_1.logger.debug(`Rate limiting: waiting ${delay}ms`, {
                type: 'rate_limit_delay',
                service: this.config.serviceName,
                delay,
                requestsPerSecond: this.config.rateLimit.requestsPerSecond
            });
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        this.lastRequestTime = Date.now();
    }
    async executeRequest(requestFn) {
        const metrics = {
            startTime: Date.now(),
            attempts: 0,
            circuitBreakerState: this.circuitBreaker.getState(),
            success: false
        };
        try {
            await this.enforceRateLimit();
            const retryConfig = this.config.retryConfig || retry_1.retryConfigs.dexscreener;
            const result = await retry_1.RetryUtility.execute(async () => {
                metrics.attempts++;
                return await this.circuitBreaker.execute(async () => {
                    return await (0, timeout_1.withHttpTimeout)(requestFn(), this.config.timeout || timeout_1.timeoutConfigs.dexscreener.search, this.config.serviceName);
                });
            }, {
                ...retryConfig,
                name: this.config.serviceName,
                onRetry: (error, attempt) => {
                    logger_1.logger.warn(`Retrying HTTP request`, {
                        type: 'http_retry',
                        service: this.config.serviceName,
                        attempt,
                        error: error.message,
                        maxAttempts: retryConfig.maxAttempts
                    });
                }
            });
            metrics.endTime = Date.now();
            metrics.duration = metrics.endTime - metrics.startTime;
            metrics.success = true;
            metrics.statusCode = result.result.status;
            this.recordMetrics(metrics);
            return result.result;
        }
        catch (error) {
            metrics.endTime = Date.now();
            metrics.duration = metrics.endTime - metrics.startTime;
            metrics.success = false;
            metrics.error = error.message;
            if (error instanceof Error && 'response' in error) {
                metrics.statusCode = error.response?.status;
            }
            this.recordMetrics(metrics);
            throw error;
        }
    }
    recordMetrics(requestMetrics) {
        metrics_1.metrics.recordHistogram('http_total_duration', requestMetrics.duration || 0, {
            service: this.config.serviceName,
            success: requestMetrics.success.toString(),
            attempts: requestMetrics.attempts.toString()
        });
        metrics_1.metrics.incrementCounter('http_requests_total', 1, {
            service: this.config.serviceName,
            success: requestMetrics.success.toString(),
            status: requestMetrics.statusCode?.toString() || 'unknown'
        });
        if (!requestMetrics.success) {
            metrics_1.metrics.incrementCounter('http_requests_failed', 1, {
                service: this.config.serviceName,
                error: requestMetrics.error || 'unknown'
            });
        }
    }
    async get(url, config) {
        return this.executeRequest(() => this.axiosInstance.get(url, config));
    }
    async post(url, data, config) {
        return this.executeRequest(() => this.axiosInstance.post(url, data, config));
    }
    async put(url, data, config) {
        return this.executeRequest(() => this.axiosInstance.put(url, data, config));
    }
    async delete(url, config) {
        return this.executeRequest(() => this.axiosInstance.delete(url, config));
    }
    async patch(url, data, config) {
        return this.executeRequest(() => this.axiosInstance.patch(url, data, config));
    }
    async getJson(url, config) {
        const response = await this.get(url, config);
        return response.data;
    }
    async postJson(url, data, config) {
        const response = await this.post(url, data, config);
        return response.data;
    }
    getHealthStatus() {
        return {
            service: this.config.serviceName,
            circuitBreaker: this.circuitBreaker.getStatus(),
            lastRequestTime: this.lastRequestTime > 0 ? new Date(this.lastRequestTime).toISOString() : null,
            queueSize: this.requestQueue.length,
            rateLimit: this.config.rateLimit
        };
    }
    resetCircuitBreaker() {
        this.circuitBreaker.reset();
        logger_1.logger.info(`Circuit breaker reset for ${this.config.serviceName}`, {
            type: 'circuit_breaker_manual_reset',
            service: this.config.serviceName
        });
    }
    openCircuitBreaker() {
        this.circuitBreaker.forceOpen();
        logger_1.logger.warn(`Circuit breaker manually opened for ${this.config.serviceName}`, {
            type: 'circuit_breaker_manual_open',
            service: this.config.serviceName
        });
    }
    closeCircuitBreaker() {
        this.circuitBreaker.forceClose();
        logger_1.logger.info(`Circuit breaker manually closed for ${this.config.serviceName}`, {
            type: 'circuit_breaker_manual_close',
            service: this.config.serviceName
        });
    }
}
exports.ResilientHttpClient = ResilientHttpClient;
class HttpClientFactory {
    static createDexScreenerClient() {
        if (!this.clients.has('dexscreener')) {
            this.clients.set('dexscreener', new ResilientHttpClient({
                serviceName: 'dexscreener',
                baseURL: 'https://api.dexscreener.com/latest',
                timeout: timeout_1.timeoutConfigs.dexscreener.search,
                retryConfig: retry_1.retryConfigs.dexscreener,
                circuitBreakerConfig: circuitBreaker_1.defaultCircuitBreakerConfigs.dexscreener,
                rateLimit: { requestsPerSecond: 5 },
                headers: {
                    'Accept': 'application/json'
                }
            }));
        }
        return this.clients.get('dexscreener');
    }
    static createGoPlusClient() {
        if (!this.clients.has('goplus')) {
            this.clients.set('goplus', new ResilientHttpClient({
                serviceName: 'goplus',
                baseURL: 'https://api.gopluslabs.io/api/v1',
                timeout: timeout_1.timeoutConfigs.goplus.security,
                retryConfig: retry_1.retryConfigs.goplus,
                circuitBreakerConfig: circuitBreaker_1.defaultCircuitBreakerConfigs.goplus,
                rateLimit: { requestsPerSecond: 0.5 },
                headers: {
                    'Accept': 'application/json'
                }
            }));
        }
        return this.clients.get('goplus');
    }
    static createBirdeyeClient() {
        if (!this.clients.has('birdeye')) {
            this.clients.set('birdeye', new ResilientHttpClient({
                serviceName: 'birdeye',
                baseURL: 'https://public-api.birdeye.so',
                timeout: timeout_1.timeoutConfigs.birdeye.price,
                retryConfig: retry_1.retryConfigs.birdeye,
                circuitBreakerConfig: circuitBreaker_1.defaultCircuitBreakerConfigs.birdeye,
                rateLimit: { requestsPerSecond: 1 },
                headers: {
                    'Accept': 'application/json',
                    'X-API-KEY': process.env.BIRDEYE_API_KEY || ''
                }
            }));
        }
        return this.clients.get('birdeye');
    }
    static createCoinGeckoClient() {
        if (!this.clients.has('coingecko')) {
            this.clients.set('coingecko', new ResilientHttpClient({
                serviceName: 'coingecko',
                baseURL: 'https://api.coingecko.com/api/v3',
                timeout: timeout_1.timeoutConfigs.coingecko.search,
                retryConfig: retry_1.retryConfigs.coingecko,
                circuitBreakerConfig: circuitBreaker_1.defaultCircuitBreakerConfigs.coingecko,
                rateLimit: { requestsPerSecond: 2 },
                headers: {
                    'Accept': 'application/json'
                }
            }));
        }
        return this.clients.get('coingecko');
    }
    static getClient(serviceName) {
        return this.clients.get(serviceName);
    }
    static getAllClients() {
        return Array.from(this.clients.values());
    }
    static getHealthStatus() {
        return Array.from(this.clients.values()).map(client => client.getHealthStatus());
    }
}
exports.HttpClientFactory = HttpClientFactory;
HttpClientFactory.clients = new Map();
exports.dexScreenerClient = HttpClientFactory.createDexScreenerClient();
exports.goPlusClient = HttpClientFactory.createGoPlusClient();
exports.birdeyeClient = HttpClientFactory.createBirdeyeClient();
exports.coinGeckoClient = HttpClientFactory.createCoinGeckoClient();
//# sourceMappingURL=resilientHttp.js.map