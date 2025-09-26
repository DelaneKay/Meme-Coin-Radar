"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupSecurityMiddleware = exports.corsMiddleware = exports.securityHeaders = exports.createSpeedLimiter = exports.createRateLimiter = exports.detectSuspiciousActivity = exports.ipFilter = exports.sanitizeRequest = exports.validationRules = exports.validateInput = exports.validateApiKey = exports.securityConfig = void 0;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const express_slow_down_1 = __importDefault(require("express-slow-down"));
const helmet_1 = __importDefault(require("helmet"));
const cors_1 = __importDefault(require("cors"));
const express_validator_1 = require("express-validator");
const logger_1 = require("../utils/logger");
const metrics_1 = require("../utils/metrics");
const cache_1 = require("../utils/cache");
exports.securityConfig = {
    cors: {
        origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
        credentials: true,
        optionsSuccessStatus: 200,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID'],
        exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset']
    },
    helmet: {
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                scriptSrc: ["'self'"],
                imgSrc: ["'self'", "data:", "https:"],
                connectSrc: ["'self'", "wss:", "ws:"],
                fontSrc: ["'self'"],
                objectSrc: ["'none'"],
                mediaSrc: ["'self'"],
                frameSrc: ["'none'"]
            }
        },
        crossOriginEmbedderPolicy: false,
        hsts: {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true
        }
    },
    rateLimit: {
        global: {
            windowMs: 15 * 60 * 1000,
            max: 1000,
            message: 'Too many requests from this IP, please try again later',
            standardHeaders: true,
            legacyHeaders: false
        },
        api: {
            windowMs: 1 * 60 * 1000,
            max: 100,
            message: 'API rate limit exceeded, please try again later',
            standardHeaders: true,
            legacyHeaders: false
        },
        auth: {
            windowMs: 15 * 60 * 1000,
            max: 5,
            message: 'Too many authentication attempts, please try again later',
            standardHeaders: true,
            legacyHeaders: false
        }
    }
};
const validateApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    const validApiKeys = process.env.API_KEYS?.split(',') || [];
    const publicPaths = ['/health', '/metrics', '/'];
    if (publicPaths.some(path => req.path.startsWith(path))) {
        return next();
    }
    if (!apiKey) {
        (0, logger_1.logSecurityEvent)('missing_api_key', {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            path: req.path,
            method: req.method
        });
        metrics_1.metrics.incrementCounter('security_violations', 1, {
            type: 'missing_api_key',
            path: req.path
        });
        return res.status(401).json({
            error: 'API key required',
            code: 'MISSING_API_KEY'
        });
    }
    if (!validApiKeys.includes(apiKey)) {
        (0, logger_1.logSecurityEvent)('invalid_api_key', {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            path: req.path,
            method: req.method,
            apiKey: apiKey.substring(0, 8) + '...'
        });
        metrics_1.metrics.incrementCounter('security_violations', 1, {
            type: 'invalid_api_key',
            path: req.path
        });
        return res.status(401).json({
            error: 'Invalid API key',
            code: 'INVALID_API_KEY'
        });
    }
    logger_1.logger.debug('API key validated successfully', {
        type: 'api_key_validated',
        ip: req.ip,
        path: req.path,
        method: req.method
    });
    next();
};
exports.validateApiKey = validateApiKey;
const validateInput = (validations) => {
    return async (req, res, next) => {
        await Promise.all(validations.map(validation => validation.run(req)));
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            (0, logger_1.logSecurityEvent)('input_validation_failed', {
                ip: req.ip,
                path: req.path,
                method: req.method,
                errors: errors.array(),
                body: req.body,
                query: req.query,
                params: req.params
            });
            metrics_1.metrics.incrementCounter('security_violations', 1, {
                type: 'input_validation_failed',
                path: req.path
            });
            return res.status(400).json({
                error: 'Input validation failed',
                code: 'VALIDATION_ERROR',
                details: errors.array()
            });
        }
        next();
    };
};
exports.validateInput = validateInput;
exports.validationRules = {
    chainId: (0, express_validator_1.query)('chainId')
        .optional()
        .isIn(['sol', 'eth', 'bsc', 'base', 'polygon'])
        .withMessage('Invalid chain ID'),
    tokenAddress: (0, express_validator_1.param)('address')
        .isLength({ min: 32, max: 44 })
        .matches(/^[A-Za-z0-9]+$/)
        .withMessage('Invalid token address format'),
    page: (0, express_validator_1.query)('page')
        .optional()
        .isInt({ min: 1, max: 1000 })
        .withMessage('Page must be between 1 and 1000'),
    limit: (0, express_validator_1.query)('limit')
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage('Limit must be between 1 and 100'),
    searchQuery: (0, express_validator_1.query)('q')
        .optional()
        .isLength({ min: 1, max: 100 })
        .trim()
        .escape()
        .withMessage('Search query must be 1-100 characters'),
    webhookUrl: (0, express_validator_1.body)('webhookUrl')
        .optional()
        .isURL({ protocols: ['http', 'https'] })
        .withMessage('Invalid webhook URL'),
    timeRange: (0, express_validator_1.query)('timeRange')
        .optional()
        .isIn(['5m', '15m', '1h', '4h', '24h'])
        .withMessage('Invalid time range'),
    minLiquidity: (0, express_validator_1.query)('minLiquidity')
        .optional()
        .isFloat({ min: 0, max: 10000000 })
        .withMessage('Minimum liquidity must be between 0 and 10M'),
    minScore: (0, express_validator_1.query)('minScore')
        .optional()
        .isFloat({ min: 0, max: 100 })
        .withMessage('Minimum score must be between 0 and 100')
};
const sanitizeRequest = (req, res, next) => {
    for (const key in req.query) {
        if (typeof req.query[key] === 'string') {
            req.query[key] = req.query[key]
                .replace(/[<>\"'%;()&+]/g, '')
                .trim()
                .substring(0, 1000);
        }
    }
    if (req.body && typeof req.body === 'object') {
        sanitizeObject(req.body);
    }
    next();
};
exports.sanitizeRequest = sanitizeRequest;
function sanitizeObject(obj, depth = 0) {
    if (depth > 10)
        return;
    for (const key in obj) {
        if (typeof obj[key] === 'string') {
            obj[key] = obj[key]
                .replace(/[<>\"'%;()&+]/g, '')
                .trim()
                .substring(0, 1000);
        }
        else if (typeof obj[key] === 'object' && obj[key] !== null) {
            sanitizeObject(obj[key], depth + 1);
        }
    }
}
const ipFilter = (req, res, next) => {
    const clientIp = req.ip;
    const blacklistedIps = process.env.BLACKLISTED_IPS?.split(',') || [];
    const whitelistedIps = process.env.WHITELISTED_IPS?.split(',') || [];
    if (blacklistedIps.includes(clientIp)) {
        (0, logger_1.logSecurityEvent)('ip_blacklisted', {
            ip: clientIp,
            userAgent: req.get('User-Agent'),
            path: req.path,
            method: req.method
        });
        metrics_1.metrics.incrementCounter('security_violations', 1, {
            type: 'ip_blacklisted',
            ip: clientIp
        });
        return res.status(403).json({
            error: 'Access denied',
            code: 'IP_BLACKLISTED'
        });
    }
    if (whitelistedIps.length > 0 && !whitelistedIps.includes(clientIp)) {
        (0, logger_1.logSecurityEvent)('ip_not_whitelisted', {
            ip: clientIp,
            userAgent: req.get('User-Agent'),
            path: req.path,
            method: req.method
        });
        metrics_1.metrics.incrementCounter('security_violations', 1, {
            type: 'ip_not_whitelisted',
            ip: clientIp
        });
        return res.status(403).json({
            error: 'Access denied',
            code: 'IP_NOT_WHITELISTED'
        });
    }
    next();
};
exports.ipFilter = ipFilter;
const detectSuspiciousActivity = async (req, res, next) => {
    const clientIp = req.ip;
    const userAgent = req.get('User-Agent') || '';
    const path = req.path;
    try {
        const suspiciousPatterns = [
            /\.\./,
            /\/etc\/passwd/,
            /\/proc\//,
            /<script/i,
            /union.*select/i,
            /javascript:/i,
            /data:text\/html/i,
            /vbscript:/i
        ];
        const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(path) ||
            pattern.test(userAgent) ||
            pattern.test(JSON.stringify(req.query)) ||
            pattern.test(JSON.stringify(req.body)));
        if (isSuspicious) {
            (0, logger_1.logSecurityEvent)('suspicious_activity', {
                ip: clientIp,
                userAgent,
                path,
                method: req.method,
                query: req.query,
                body: req.body
            });
            metrics_1.metrics.incrementCounter('security_violations', 1, {
                type: 'suspicious_activity',
                ip: clientIp
            });
            const key = `suspicious:${clientIp}`;
            const count = await cache_1.cache.increment(key, 1, 3600);
            if (count > 5) {
                (0, logger_1.logSecurityEvent)('suspicious_activity_threshold', {
                    ip: clientIp,
                    count,
                    path,
                    method: req.method
                });
                return res.status(403).json({
                    error: 'Suspicious activity detected',
                    code: 'SUSPICIOUS_ACTIVITY'
                });
            }
        }
        next();
    }
    catch (error) {
        logger_1.logger.error('Error in suspicious activity detection', {
            type: 'suspicious_activity_detection_error',
            error: error.message,
            ip: clientIp
        });
        next();
    }
};
exports.detectSuspiciousActivity = detectSuspiciousActivity;
const createRateLimiter = (options) => {
    return (0, express_rate_limit_1.default)({
        ...options,
        store: new (require('express-rate-limit-redis'))({
            client: cache_1.cache.getClient(),
            prefix: 'rl:'
        }),
        handler: (req, res) => {
            (0, logger_1.logSecurityEvent)('rate_limit_exceeded', {
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                path: req.path,
                method: req.method,
                limit: options.max,
                window: options.windowMs
            });
            metrics_1.metrics.incrementCounter('rate_limit_exceeded', 1, {
                type: 'global',
                ip: req.ip,
                path: req.path
            });
            res.status(429).json({
                error: options.message || 'Too many requests',
                code: 'RATE_LIMIT_EXCEEDED',
                retryAfter: Math.ceil(options.windowMs / 1000)
            });
        }
    });
};
exports.createRateLimiter = createRateLimiter;
const createSpeedLimiter = (options) => {
    return (0, express_slow_down_1.default)({
        ...options,
        store: new (require('express-rate-limit-redis'))({
            client: cache_1.cache.getClient(),
            prefix: 'sl:'
        }),
        onLimitReached: (req) => {
            (0, logger_1.logSecurityEvent)('speed_limit_reached', {
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                path: req.path,
                method: req.method
            });
            metrics_1.metrics.incrementCounter('speed_limit_reached', 1, {
                ip: req.ip,
                path: req.path
            });
        }
    });
};
exports.createSpeedLimiter = createSpeedLimiter;
exports.securityHeaders = (0, helmet_1.default)(exports.securityConfig.helmet);
exports.corsMiddleware = (0, cors_1.default)(exports.securityConfig.cors);
const setupSecurityMiddleware = (app) => {
    app.set('trust proxy', 1);
    app.use(exports.securityHeaders);
    app.use(exports.corsMiddleware);
    app.use(exports.ipFilter);
    app.use(exports.sanitizeRequest);
    app.use(exports.detectSuspiciousActivity);
    app.use((0, exports.createRateLimiter)(exports.securityConfig.rateLimit.global));
    app.use('/api', (0, exports.createRateLimiter)(exports.securityConfig.rateLimit.api));
    app.use('/api', (0, exports.createSpeedLimiter)({
        windowMs: 1 * 60 * 1000,
        delayAfter: 50,
        delayMs: 100,
        maxDelayMs: 2000
    }));
    logger_1.logger.info('Security middleware configured', {
        type: 'security_middleware_setup',
        corsOrigins: exports.securityConfig.cors.origin,
        rateLimits: {
            global: exports.securityConfig.rateLimit.global.max,
            api: exports.securityConfig.rateLimit.api.max
        }
    });
};
exports.setupSecurityMiddleware = setupSecurityMiddleware;
exports.default = {
    setupSecurityMiddleware: exports.setupSecurityMiddleware,
    validateApiKey: exports.validateApiKey,
    validateInput: exports.validateInput,
    validationRules: exports.validationRules,
    createRateLimiter: exports.createRateLimiter,
    createSpeedLimiter: exports.createSpeedLimiter,
    securityConfig: exports.securityConfig
};
//# sourceMappingURL=security.js.map