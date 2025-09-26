"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validationService = exports.sanitizeRequest = exports.validateRequest = exports.validationRules = exports.ValidationService = exports.DANGEROUS_PATTERNS = exports.VALIDATION_PATTERNS = exports.ADDRESS_PATTERNS = exports.SUPPORTED_CHAINS = void 0;
const express_validator_1 = require("express-validator");
const isomorphic_dompurify_1 = __importDefault(require("isomorphic-dompurify"));
const logger_1 = require("./logger");
const metrics_1 = require("./metrics");
exports.SUPPORTED_CHAINS = ['sol', 'eth', 'bsc', 'base', 'polygon', 'arbitrum', 'optimism'];
exports.ADDRESS_PATTERNS = {
    sol: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
    eth: /^0x[a-fA-F0-9]{40}$/,
    bsc: /^0x[a-fA-F0-9]{40}$/,
    base: /^0x[a-fA-F0-9]{40}$/,
    polygon: /^0x[a-fA-F0-9]{40}$/,
    arbitrum: /^0x[a-fA-F0-9]{40}$/,
    optimism: /^0x[a-fA-F0-9]{40}$/
};
exports.VALIDATION_PATTERNS = {
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    url: /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/,
    uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    alphanumeric: /^[a-zA-Z0-9]+$/,
    slug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    hexColor: /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/,
    ipAddress: /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/
};
exports.DANGEROUS_PATTERNS = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript:/gi,
    /vbscript:/gi,
    /onload\s*=/gi,
    /onerror\s*=/gi,
    /onclick\s*=/gi,
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b)/gi,
    /(\b(OR|AND)\s+\d+\s*=\s*\d+)/gi,
    /('|(\\')|(;)|(--)|(\|)|(\*)|(%27)|(%3D)|(%3B)|(%2D%2D)|(%7C)|(%2A))/gi,
    /\.\.[\/\\]/g,
    /\/etc\/passwd/gi,
    /\/proc\//gi,
    /\\windows\\system32/gi,
    /(\||&|;|\$\(|\`)/g,
    /(rm\s|del\s|format\s)/gi,
    /(\(|\)|&|\||!|=|\*|<|>|~)/g
];
class ValidationService {
    static getInstance() {
        if (!ValidationService.instance) {
            ValidationService.instance = new ValidationService();
        }
        return ValidationService.instance;
    }
    sanitizeString(input, options = {}) {
        if (typeof input !== 'string') {
            return '';
        }
        let sanitized = input;
        if (options.trimWhitespace !== false) {
            sanitized = sanitized.trim();
        }
        if (!options.allowHtml) {
            sanitized = isomorphic_dompurify_1.default.sanitize(sanitized, { ALLOWED_TAGS: [] });
        }
        else {
            sanitized = isomorphic_dompurify_1.default.sanitize(sanitized);
        }
        if (options.removeSpecialChars) {
            sanitized = sanitized.replace(/[<>\"'%;()&+]/g, '');
        }
        if (options.allowedChars) {
            sanitized = sanitized.replace(new RegExp(`[^${options.allowedChars.source}]`, 'g'), '');
        }
        if (options.maxLength && sanitized.length > options.maxLength) {
            sanitized = sanitized.substring(0, options.maxLength);
        }
        return sanitized;
    }
    sanitizeObject(obj, depth = 0) {
        if (depth > 10) {
            logger_1.logger.warn('Maximum sanitization depth reached', {
                type: 'sanitization_depth_limit',
                depth
            });
            return obj;
        }
        if (obj === null || obj === undefined) {
            return obj;
        }
        if (typeof obj === 'string') {
            return this.sanitizeString(obj, { maxLength: 10000 });
        }
        if (typeof obj === 'number' || typeof obj === 'boolean') {
            return obj;
        }
        if (Array.isArray(obj)) {
            return obj.map(item => this.sanitizeObject(item, depth + 1));
        }
        if (typeof obj === 'object') {
            const sanitized = {};
            for (const [key, value] of Object.entries(obj)) {
                const sanitizedKey = this.sanitizeString(key, { maxLength: 100, removeSpecialChars: true });
                sanitized[sanitizedKey] = this.sanitizeObject(value, depth + 1);
            }
            return sanitized;
        }
        return obj;
    }
    detectDangerousPatterns(input) {
        const detected = [];
        for (const pattern of exports.DANGEROUS_PATTERNS) {
            if (pattern.test(input)) {
                detected.push(pattern.source);
            }
        }
        return detected;
    }
    validateTokenAddress(address, chainId) {
        const pattern = exports.ADDRESS_PATTERNS[chainId];
        return pattern ? pattern.test(address) : false;
    }
    validateWebhookUrl(url) {
        try {
            const parsed = new URL(url);
            if (!['http:', 'https:'].includes(parsed.protocol)) {
                return false;
            }
            if (process.env.NODE_ENV === 'production') {
                const hostname = parsed.hostname;
                if (hostname === 'localhost' || hostname === '127.0.0.1') {
                    return false;
                }
                const privateRanges = [
                    /^10\./,
                    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
                    /^192\.168\./,
                    /^169\.254\./
                ];
                if (privateRanges.some(range => range.test(hostname))) {
                    return false;
                }
            }
            return true;
        }
        catch {
            return false;
        }
    }
    validatePagination(page, limit) {
        const errors = [];
        let validPage = 1;
        let validLimit = 20;
        if (page) {
            const pageNum = parseInt(page, 10);
            if (isNaN(pageNum) || pageNum < 1 || pageNum > 10000) {
                errors.push('Page must be between 1 and 10000');
            }
            else {
                validPage = pageNum;
            }
        }
        if (limit) {
            const limitNum = parseInt(limit, 10);
            if (isNaN(limitNum) || limitNum < 1 || limitNum > 1000) {
                errors.push('Limit must be between 1 and 1000');
            }
            else {
                validLimit = limitNum;
            }
        }
        return { page: validPage, limit: validLimit, errors };
    }
    validateTimeRange(timeRange) {
        const validRanges = ['5m', '15m', '30m', '1h', '4h', '12h', '24h', '7d', '30d'];
        if (!timeRange) {
            return { valid: true };
        }
        if (!validRanges.includes(timeRange)) {
            return {
                valid: false,
                error: `Invalid time range. Must be one of: ${validRanges.join(', ')}`
            };
        }
        return { valid: true };
    }
    validateNumericRange(value, min, max, fieldName) {
        const num = parseFloat(value);
        if (isNaN(num)) {
            return {
                valid: false,
                error: `${fieldName} must be a valid number`
            };
        }
        if (num < min || num > max) {
            return {
                valid: false,
                error: `${fieldName} must be between ${min} and ${max}`
            };
        }
        return { valid: true, value: num };
    }
}
exports.ValidationService = ValidationService;
exports.validationRules = {
    chainId: (field = 'chainId') => (0, express_validator_1.query)(field)
        .optional()
        .isIn(exports.SUPPORTED_CHAINS)
        .withMessage(`Chain ID must be one of: ${exports.SUPPORTED_CHAINS.join(', ')}`),
    tokenAddress: (chainField = 'chainId', addressField = 'address') => (0, express_validator_1.param)(addressField)
        .custom(async (value, { req }) => {
        const chainId = req.query[chainField] || req.params[chainField] || 'eth';
        const validationService = ValidationService.getInstance();
        if (!validationService.validateTokenAddress(value, chainId)) {
            throw new Error(`Invalid token address format for chain ${chainId}`);
        }
        return true;
    }),
    pagination: [
        (0, express_validator_1.query)('page')
            .optional()
            .isInt({ min: 1, max: 10000 })
            .withMessage('Page must be between 1 and 10000'),
        (0, express_validator_1.query)('limit')
            .optional()
            .isInt({ min: 1, max: 1000 })
            .withMessage('Limit must be between 1 and 1000')
    ],
    searchQuery: (field = 'q') => (0, express_validator_1.query)(field)
        .optional()
        .isLength({ min: 1, max: 200 })
        .trim()
        .custom(async (value) => {
        const validationService = ValidationService.getInstance();
        const dangerous = validationService.detectDangerousPatterns(value);
        if (dangerous.length > 0) {
            throw new Error('Search query contains potentially dangerous patterns');
        }
        return true;
    }),
    email: (field = 'email') => (0, express_validator_1.body)(field)
        .isEmail()
        .normalizeEmail()
        .withMessage('Invalid email format'),
    password: (field = 'password') => (0, express_validator_1.body)(field)
        .isLength({ min: 8, max: 128 })
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
        .withMessage('Password must be 8-128 characters with uppercase, lowercase, number, and special character'),
    webhookUrl: (field = 'webhookUrl') => (0, express_validator_1.body)(field)
        .optional()
        .custom(async (value) => {
        const validationService = ValidationService.getInstance();
        if (!validationService.validateWebhookUrl(value)) {
            throw new Error('Invalid webhook URL');
        }
        return true;
    }),
    numericRange: (field, min, max) => (0, express_validator_1.query)(field)
        .optional()
        .isFloat({ min, max })
        .withMessage(`${field} must be between ${min} and ${max}`),
    timeRange: (field = 'timeRange') => (0, express_validator_1.query)(field)
        .optional()
        .custom(async (value) => {
        const validationService = ValidationService.getInstance();
        const result = validationService.validateTimeRange(value);
        if (!result.valid) {
            throw new Error(result.error);
        }
        return true;
    }),
    uuid: (field) => (0, express_validator_1.param)(field)
        .isUUID()
        .withMessage('Invalid UUID format'),
    alphanumeric: (field, minLength = 1, maxLength = 100) => (0, express_validator_1.body)(field)
        .isAlphanumeric()
        .isLength({ min: minLength, max: maxLength })
        .withMessage(`${field} must be alphanumeric and ${minLength}-${maxLength} characters`),
    stringArray: (field, maxItems = 100, maxItemLength = 100) => (0, express_validator_1.body)(field)
        .optional()
        .isArray({ max: maxItems })
        .custom(async (value) => {
        if (!Array.isArray(value)) {
            throw new Error(`${field} must be an array`);
        }
        for (const item of value) {
            if (typeof item !== 'string' || item.length > maxItemLength) {
                throw new Error(`${field} items must be strings with max length ${maxItemLength}`);
            }
        }
        return true;
    })
};
const validateRequest = (validations) => {
    return async (req, res, next) => {
        await Promise.all(validations.map(validation => validation.run(req)));
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            const validationErrors = errors.array().map(error => ({
                field: error.param || 'unknown',
                message: error.msg,
                value: error.value,
                code: 'VALIDATION_ERROR'
            }));
            (0, logger_1.logSecurityEvent)('input_validation_failed', 'medium', {
                ip: req.ip,
                path: req.path,
                method: req.method,
                errors: validationErrors,
                userAgent: req.get('User-Agent')
            });
            metrics_1.metrics.incrementCounter('validation_errors', 1, {
                path: req.path,
                errorCount: validationErrors.length.toString()
            });
            return res.status(400).json({
                error: 'Input validation failed',
                code: 'VALIDATION_ERROR',
                details: validationErrors
            });
        }
        next();
    };
};
exports.validateRequest = validateRequest;
const sanitizeRequest = (req, res, next) => {
    const validationService = ValidationService.getInstance();
    try {
        if (req.query) {
            req.query = validationService.sanitizeObject(req.query);
        }
        if (req.body) {
            req.body = validationService.sanitizeObject(req.body);
        }
        if (req.params) {
            req.params = validationService.sanitizeObject(req.params);
        }
        next();
    }
    catch (error) {
        logger_1.logger.error('Request sanitization failed', {
            type: 'sanitization_error',
            error: error.message,
            path: req.path
        });
        return res.status(400).json({
            error: 'Request processing failed',
            code: 'SANITIZATION_ERROR'
        });
    }
};
exports.sanitizeRequest = sanitizeRequest;
exports.validationService = ValidationService.getInstance();
exports.default = {
    ValidationService,
    validationService: exports.validationService,
    validationRules: exports.validationRules,
    validateRequest: exports.validateRequest,
    sanitizeRequest: exports.sanitizeRequest,
    SUPPORTED_CHAINS: exports.SUPPORTED_CHAINS,
    ADDRESS_PATTERNS: exports.ADDRESS_PATTERNS,
    VALIDATION_PATTERNS: exports.VALIDATION_PATTERNS,
    DANGEROUS_PATTERNS: exports.DANGEROUS_PATTERNS
};
//# sourceMappingURL=validation.js.map