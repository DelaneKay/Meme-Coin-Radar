"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logCacheEvent = exports.logCircuitBreaker = exports.logBusinessMetric = exports.logSecurityEvent = exports.logApiRequest = exports.logError = exports.logPerformance = exports.logRateLimit = exports.logHttpRequest = exports.orchestratorLogger = exports.sentinelLogger = exports.alerterLogger = exports.scorerLogger = exports.secAuditorLogger = exports.dataCollectorLogger = exports.logger = exports.RequestContext = void 0;
const winston_1 = __importDefault(require("winston"));
const crypto_1 = require("crypto");
const logLevel = process.env.LOG_LEVEL || 'info';
const isDevelopment = process.env.NODE_ENV !== 'production';
const serviceName = process.env.SERVICE_NAME || 'meme-coin-radar-api';
const serviceVersion = process.env.SERVICE_VERSION || '1.0.0';
class RequestContext {
    static setRequestId(requestId) {
        this.context.set('requestId', requestId);
    }
    static getRequestId() {
        return this.context.get('requestId');
    }
    static generateRequestId() {
        return (0, crypto_1.randomUUID)();
    }
    static clear() {
        this.context.clear();
    }
}
exports.RequestContext = RequestContext;
RequestContext.context = new Map();
const structuredFormat = winston_1.default.format.combine(winston_1.default.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }), winston_1.default.format.errors({ stack: true }), winston_1.default.format.json(), winston_1.default.format.printf((info) => {
    const baseLog = {
        timestamp: info.timestamp,
        level: info.level,
        service: serviceName,
        version: serviceVersion,
        message: info.message,
        requestId: RequestContext.getRequestId(),
        ...info
    };
    delete baseLog.timestamp;
    delete baseLog.level;
    delete baseLog.message;
    return JSON.stringify({
        timestamp: info.timestamp,
        level: info.level,
        service: serviceName,
        version: serviceVersion,
        message: info.message,
        requestId: RequestContext.getRequestId(),
        ...baseLog
    });
}));
const consoleFormat = winston_1.default.format.combine(winston_1.default.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston_1.default.format.errors({ stack: true }), winston_1.default.format.colorize(), winston_1.default.format.printf(({ timestamp, level, message, requestId, ...meta }) => {
    let log = `${timestamp} [${level}]`;
    if (requestId)
        log += ` [${requestId.slice(0, 8)}]`;
    log += `: ${message}`;
    if (Object.keys(meta).length > 0) {
        log += ` ${JSON.stringify(meta, null, 2)}`;
    }
    return log;
}));
const productionFormat = structuredFormat;
exports.logger = winston_1.default.createLogger({
    level: logLevel,
    exitOnError: false,
    defaultMeta: {
        service: serviceName,
        version: serviceVersion,
        environment: process.env.NODE_ENV || 'development'
    },
    transports: [
        new winston_1.default.transports.Console({
            format: isDevelopment ? consoleFormat : productionFormat,
            silent: false,
        }),
        ...(isDevelopment ? [] : [
            new winston_1.default.transports.File({
                filename: 'logs/error.log',
                level: 'error',
                format: productionFormat,
                maxsize: 10485760,
                maxFiles: 10,
            }),
            new winston_1.default.transports.File({
                filename: 'logs/combined.log',
                format: productionFormat,
                maxsize: 10485760,
                maxFiles: 10,
            })
        ]),
    ],
    exceptionHandlers: isDevelopment ? [] : [
        new winston_1.default.transports.File({
            filename: 'logs/exceptions.log',
            format: productionFormat
        })
    ],
    rejectionHandlers: isDevelopment ? [] : [
        new winston_1.default.transports.File({
            filename: 'logs/rejections.log',
            format: productionFormat
        })
    ],
});
exports.dataCollectorLogger = exports.logger.child({ component: 'DataCollector' });
exports.secAuditorLogger = exports.logger.child({ component: 'SecAuditor' });
exports.scorerLogger = exports.logger.child({ component: 'Scorer' });
exports.alerterLogger = exports.logger.child({ component: 'Alerter' });
exports.sentinelLogger = exports.logger.child({ component: 'Sentinel' });
exports.orchestratorLogger = exports.logger.child({ component: 'Orchestrator' });
const logHttpRequest = (req, res, duration) => {
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    exports.logger.log(level, `HTTP ${req.method} ${req.path}`, {
        type: 'http_request',
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
        userAgent: req.get('User-Agent'),
        ip: req.ip || req.connection.remoteAddress,
        contentLength: res.get('Content-Length'),
        requestId: RequestContext.getRequestId(),
    });
};
exports.logHttpRequest = logHttpRequest;
const logRateLimit = (service, remaining, resetTime, endpoint) => {
    const level = remaining <= 5 ? 'warn' : remaining <= 20 ? 'info' : 'debug';
    exports.logger.log(level, `Rate limit status for ${service}`, {
        type: 'rate_limit',
        service,
        endpoint,
        remaining,
        resetTime: new Date(resetTime).toISOString(),
        critical: remaining <= 5,
    });
};
exports.logRateLimit = logRateLimit;
const logPerformance = (operation, duration, metadata) => {
    const level = duration > 5000 ? 'warn' : duration > 2000 ? 'info' : 'debug';
    exports.logger.log(level, `Performance: ${operation}`, {
        type: 'performance',
        operation,
        duration,
        slow: duration > 2000,
        ...metadata,
    });
};
exports.logPerformance = logPerformance;
const logError = (error, context, metadata) => {
    exports.logger.error(`${context ? `[${context}] ` : ''}${error.message}`, {
        type: 'error',
        error: {
            name: error.name,
            message: error.message,
            stack: isDevelopment ? error.stack : undefined,
        },
        context,
        requestId: RequestContext.getRequestId(),
        ...metadata,
    });
};
exports.logError = logError;
const logApiRequest = (service, endpoint, duration, success, statusCode, rateLimitRemaining, metadata) => {
    const level = success ? 'debug' : 'warn';
    exports.logger.log(level, `External API: ${service} ${endpoint}`, {
        type: 'external_api',
        service,
        endpoint,
        duration,
        success,
        statusCode,
        rateLimitRemaining,
        requestId: RequestContext.getRequestId(),
        ...metadata,
    });
};
exports.logApiRequest = logApiRequest;
const logSecurityEvent = (event, severity, metadata) => {
    const level = severity === 'high' ? 'error' : severity === 'medium' ? 'warn' : 'info';
    exports.logger.log(level, `Security event: ${event}`, {
        type: 'security',
        event,
        severity,
        requestId: RequestContext.getRequestId(),
        ...metadata,
    });
};
exports.logSecurityEvent = logSecurityEvent;
const logBusinessMetric = (metric, value, unit, metadata) => {
    exports.logger.info(`Business metric: ${metric}`, {
        type: 'business_metric',
        metric,
        value,
        unit,
        ...metadata,
    });
};
exports.logBusinessMetric = logBusinessMetric;
const logCircuitBreaker = (service, state, metadata) => {
    const level = state === 'open' ? 'error' : 'info';
    exports.logger.log(level, `Circuit breaker ${state} for ${service}`, {
        type: 'circuit_breaker',
        service,
        state,
        ...metadata,
    });
};
exports.logCircuitBreaker = logCircuitBreaker;
const logCacheEvent = (operation, key, metadata) => {
    exports.logger.debug(`Cache ${operation}: ${key}`, {
        type: 'cache',
        operation,
        key: key.length > 50 ? key.substring(0, 50) + '...' : key,
        ...metadata,
    });
};
exports.logCacheEvent = logCacheEvent;
exports.default = exports.logger;
//# sourceMappingURL=logger.js.map