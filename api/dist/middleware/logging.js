"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupLoggingMiddleware = exports.requestSizeMiddleware = exports.securityHeadersMiddleware = exports.rateLimitLoggingMiddleware = exports.errorLoggingMiddleware = exports.httpLoggingMiddleware = exports.timingMiddleware = exports.requestIdMiddleware = void 0;
const logger_1 = require("../utils/logger");
const metrics_1 = require("../utils/metrics");
const requestIdMiddleware = (req, res, next) => {
    const requestId = req.headers['x-request-id'] || logger_1.RequestContext.generateRequestId();
    req.requestId = requestId;
    logger_1.RequestContext.setRequestId(requestId);
    res.setHeader('X-Request-ID', requestId);
    next();
};
exports.requestIdMiddleware = requestIdMiddleware;
const timingMiddleware = (req, res, next) => {
    req.startTime = Date.now();
    next();
};
exports.timingMiddleware = timingMiddleware;
const httpLoggingMiddleware = (req, res, next) => {
    if (req.path === '/health' || req.path.startsWith('/static/')) {
        return next();
    }
    const originalSend = res.send;
    const originalJson = res.json;
    res.send = function (body) {
        logRequestCompletion();
        return originalSend.call(this, body);
    };
    res.json = function (body) {
        logRequestCompletion();
        return originalJson.call(this, body);
    };
    res.on('finish', () => {
        if (!res.headersSent) {
            logRequestCompletion();
        }
    });
    function logRequestCompletion() {
        const duration = req.startTime ? Date.now() - req.startTime : 0;
        (0, logger_1.logHttpRequest)(req, res, duration);
        (0, metrics_1.trackHttpRequest)(req.method, req.path, res.statusCode, duration);
        if (res.statusCode === 401 || res.statusCode === 403) {
            (0, logger_1.logSecurityEvent)('unauthorized_access', 'medium', {
                method: req.method,
                path: req.path,
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });
        }
        if (req.path.includes('../') || req.path.includes('..\\')) {
            (0, logger_1.logSecurityEvent)('path_traversal_attempt', 'high', {
                method: req.method,
                path: req.path,
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });
        }
        logger_1.RequestContext.clear();
    }
    next();
};
exports.httpLoggingMiddleware = httpLoggingMiddleware;
const errorLoggingMiddleware = (err, req, res, next) => {
    const duration = req.startTime ? Date.now() - req.startTime : 0;
    (0, logger_1.logHttpRequest)(req, res, duration);
    (0, metrics_1.trackHttpRequest)(req.method, req.path, res.statusCode || 500, duration);
    if (err.message.includes('ENOENT') && req.path.includes('../')) {
        (0, logger_1.logSecurityEvent)('file_access_attempt', 'high', {
            error: err.message,
            method: req.method,
            path: req.path,
            ip: req.ip
        });
    }
    next(err);
};
exports.errorLoggingMiddleware = errorLoggingMiddleware;
const rateLimitLoggingMiddleware = (req, res, next) => {
    const originalSend = res.send;
    res.send = function (body) {
        if (res.statusCode === 429) {
            (0, logger_1.logSecurityEvent)('rate_limit_exceeded', 'medium', {
                method: req.method,
                path: req.path,
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                retryAfter: res.get('Retry-After')
            });
        }
        return originalSend.call(this, body);
    };
    next();
};
exports.rateLimitLoggingMiddleware = rateLimitLoggingMiddleware;
const securityHeadersMiddleware = (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    const suspiciousHeaders = ['x-forwarded-for', 'x-real-ip', 'x-originating-ip'];
    const presentHeaders = suspiciousHeaders.filter(header => req.headers[header]);
    if (presentHeaders.length > 1) {
        (0, logger_1.logSecurityEvent)('multiple_forwarding_headers', 'low', {
            headers: presentHeaders,
            ip: req.ip,
            path: req.path
        });
    }
    next();
};
exports.securityHeadersMiddleware = securityHeadersMiddleware;
const requestSizeMiddleware = (maxSize = 10 * 1024 * 1024) => {
    return (req, res, next) => {
        const contentLength = parseInt(req.headers['content-length'] || '0', 10);
        if (contentLength > maxSize) {
            (0, logger_1.logSecurityEvent)('large_request_blocked', 'medium', {
                contentLength,
                maxSize,
                method: req.method,
                path: req.path,
                ip: req.ip
            });
            return res.status(413).json({ error: 'Request entity too large' });
        }
        if (contentLength > maxSize * 0.8) {
            (0, logger_1.logSecurityEvent)('large_request_warning', 'low', {
                contentLength,
                method: req.method,
                path: req.path,
                ip: req.ip
            });
        }
        next();
    };
};
exports.requestSizeMiddleware = requestSizeMiddleware;
const setupLoggingMiddleware = (app, options = {}) => {
    const { maxRequestSize = 10 * 1024 * 1024, skipPaths = ['/health', '/metrics'] } = options;
    app.use(exports.requestIdMiddleware);
    app.use(exports.timingMiddleware);
    app.use(exports.securityHeadersMiddleware);
    app.use((0, exports.requestSizeMiddleware)(maxRequestSize));
    app.use(exports.rateLimitLoggingMiddleware);
    app.use(exports.httpLoggingMiddleware);
    return {
        errorMiddleware: exports.errorLoggingMiddleware
    };
};
exports.setupLoggingMiddleware = setupLoggingMiddleware;
//# sourceMappingURL=logging.js.map