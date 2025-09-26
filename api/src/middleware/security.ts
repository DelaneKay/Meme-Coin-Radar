import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import slowDown from 'express-slow-down';
import helmet from 'helmet';
import cors from 'cors';
import { body, query, param, validationResult } from 'express-validator';
import { logger, logSecurityEvent } from '../utils/logger';
import { metrics } from '../utils/metrics';
import { cache } from '../utils/cache';

// Security configuration
export const securityConfig = {
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
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 1000, // limit each IP to 1000 requests per windowMs
      message: 'Too many requests from this IP, please try again later',
      standardHeaders: true,
      legacyHeaders: false
    },
    api: {
      windowMs: 1 * 60 * 1000, // 1 minute
      max: 100, // limit each IP to 100 API requests per minute
      message: 'API rate limit exceeded, please try again later',
      standardHeaders: true,
      legacyHeaders: false
    },
    auth: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 5, // limit each IP to 5 auth attempts per 15 minutes
      message: 'Too many authentication attempts, please try again later',
      standardHeaders: true,
      legacyHeaders: false
    }
  }
};

// API Key validation middleware
export const validateApiKey = (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers['x-api-key'] as string;
  const validApiKeys = process.env.API_KEYS?.split(',') || [];

  // Skip API key validation for health checks and public endpoints
  const publicPaths = ['/health', '/metrics', '/'];
  if (publicPaths.some(path => req.path.startsWith(path))) {
    return next();
  }

  if (!apiKey) {
    logSecurityEvent('missing_api_key', 'medium', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path,
      method: req.method
    });

    metrics.incrementCounter('security_violations', 1, {
      type: 'missing_api_key',
      path: req.path
    });

    return res.status(401).json({
      error: 'API key required',
      code: 'MISSING_API_KEY'
    });
  }

  if (!validApiKeys.includes(apiKey)) {
    logSecurityEvent('invalid_api_key', 'high', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path,
      method: req.method,
      apiKey: apiKey.substring(0, 8) + '...' // Log partial key for debugging
    });

    metrics.incrementCounter('security_violations', 1, {
      type: 'invalid_api_key',
      path: req.path
    });

    return res.status(401).json({
      error: 'Invalid API key',
      code: 'INVALID_API_KEY'
    });
  }

  // Log successful API key validation
  logger.debug('API key validated successfully', {
    type: 'api_key_validated',
    ip: req.ip,
    path: req.path,
    method: req.method
  });

  next();
};

// Input validation middleware
export const validateInput = (validations: any[]) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void | Response> => {
    // Run all validations
    await Promise.all(validations.map(validation => validation.run(req)));

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logSecurityEvent('input_validation_failed', 'medium', {
        ip: req.ip,
        path: req.path,
        method: req.method,
        errors: errors.array(),
        body: req.body,
        query: req.query,
        params: req.params
      });

      metrics.incrementCounter('security_violations', 1, {
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

// Common validation rules
export const validationRules = {
  // Chain ID validation
  chainId: query('chainId')
    .optional()
    .isIn(['sol', 'eth', 'bsc', 'base', 'polygon'])
    .withMessage('Invalid chain ID'),

  // Token address validation
  tokenAddress: param('address')
    .isLength({ min: 32, max: 44 })
    .matches(/^[A-Za-z0-9]+$/)
    .withMessage('Invalid token address format'),

  // Pagination validation
  page: query('page')
    .optional()
    .isInt({ min: 1, max: 1000 })
    .withMessage('Page must be between 1 and 1000'),

  limit: query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),

  // Search query validation
  searchQuery: query('q')
    .optional()
    .isLength({ min: 1, max: 100 })
    .trim()
    .escape()
    .withMessage('Search query must be 1-100 characters'),

  // Webhook URL validation
  webhookUrl: body('webhookUrl')
    .optional()
    .isURL({ protocols: ['http', 'https'] })
    .withMessage('Invalid webhook URL'),

  // Time range validation
  timeRange: query('timeRange')
    .optional()
    .isIn(['5m', '15m', '1h', '4h', '24h'])
    .withMessage('Invalid time range'),

  // Minimum liquidity validation
  minLiquidity: query('minLiquidity')
    .optional()
    .isFloat({ min: 0, max: 10000000 })
    .withMessage('Minimum liquidity must be between 0 and 10M'),

  // Score threshold validation
  minScore: query('minScore')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Minimum score must be between 0 and 100')
};

// Request sanitization middleware
export const sanitizeRequest = (req: Request, res: Response, next: NextFunction) => {
  // Remove potentially dangerous characters from query parameters
  for (const key in req.query) {
    if (typeof req.query[key] === 'string') {
      req.query[key] = (req.query[key] as string)
        .replace(/[<>\"'%;()&+]/g, '') // Remove dangerous characters
        .trim()
        .substring(0, 1000); // Limit length
    }
  }

  // Sanitize request body
  if (req.body && typeof req.body === 'object') {
    sanitizeObject(req.body);
  }

  next();
};

function sanitizeObject(obj: any, depth = 0): void {
  if (depth > 10) return; // Prevent deep recursion

  for (const key in obj) {
    if (typeof obj[key] === 'string') {
      obj[key] = obj[key]
        .replace(/[<>\"'%;()&+]/g, '')
        .trim()
        .substring(0, 1000);
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      sanitizeObject(obj[key], depth + 1);
    }
  }
}

// IP whitelist/blacklist middleware
export const ipFilter = (req: Request, res: Response, next: NextFunction): void | Response => {
  const clientIp = req.ip || 'unknown';
  const blacklistedIps = process.env.BLACKLISTED_IPS?.split(',') || [];
  const whitelistedIps = process.env.WHITELISTED_IPS?.split(',') || [];

  // Check blacklist
  if (blacklistedIps.includes(clientIp)) {
    logSecurityEvent('ip_blacklisted', 'high', {
      ip: clientIp,
      userAgent: req.get('User-Agent'),
      path: req.path,
      method: req.method
    });

    metrics.incrementCounter('security_violations', 1, {
      type: 'ip_blacklisted',
      ip: clientIp
    });

    return res.status(403).json({
      error: 'Access denied',
      code: 'IP_BLACKLISTED'
    });
  }

  // Check whitelist (if configured)
  if (whitelistedIps.length > 0 && !whitelistedIps.includes(clientIp)) {
    logSecurityEvent('ip_not_whitelisted', 'high', {
      ip: clientIp,
      userAgent: req.get('User-Agent'),
      path: req.path,
      method: req.method
    });

    metrics.incrementCounter('security_violations', 1, {
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

// Suspicious activity detection
export const detectSuspiciousActivity = async (req: Request, res: Response, next: NextFunction): Promise<void | Response> => {
  const clientIp = req.ip || 'unknown';
  const userAgent = req.get('User-Agent') || '';
  const path = req.path;

  try {
    // Check for suspicious patterns
    const suspiciousPatterns = [
      /\.\./,                    // Path traversal
      /\/etc\/passwd/,           // System file access
      /\/proc\//,                // Process information
      /<script/i,                // XSS attempts
      /union.*select/i,          // SQL injection
      /javascript:/i,            // JavaScript injection
      /data:text\/html/i,        // Data URI XSS
      /vbscript:/i              // VBScript injection
    ];

    const isSuspicious = suspiciousPatterns.some(pattern => 
      pattern.test(path) || 
      pattern.test(userAgent) || 
      pattern.test(JSON.stringify(req.query)) ||
      pattern.test(JSON.stringify(req.body))
    );

    if (isSuspicious) {
      logSecurityEvent('suspicious_activity', 'medium', {
        ip: clientIp,
        userAgent,
        path,
        method: req.method,
        query: req.query,
        body: req.body
      });

      metrics.incrementCounter('security_violations', 1, {
        type: 'suspicious_activity',
        ip: clientIp
      });

      // Increment suspicious activity counter for this IP
      const key = `suspicious:${clientIp}`;
      const count = await cache.increment(key, 1, 3600); // 1 hour TTL

      if (count > 5) {
        logSecurityEvent('suspicious_activity_threshold', 'high', {
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
  } catch (error) {
    logger.error('Error in suspicious activity detection', {
      type: 'suspicious_activity_detection_error',
      error: (error as Error).message,
      ip: clientIp
    });
    next(); // Continue on error
  }
};

// Rate limiting with Redis store
export const createRateLimiter = (options: any) => {
  return rateLimit({
    ...options,
    store: new (require('express-rate-limit-redis'))({
      client: cache.getClient(),
      prefix: 'rl:'
    }),
    handler: (req: Request, res: Response) => {
      logSecurityEvent('rate_limit_exceeded', 'medium', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        path: req.path,
        method: req.method,
        limit: options.max,
        window: options.windowMs
      });

      metrics.incrementCounter('rate_limit_exceeded', 1, {
        type: 'global',
        ip: req.ip || 'unknown',
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

// Speed limiting (progressive delays)
export const createSpeedLimiter = (options: any) => {
  return slowDown({
    ...options,
    store: new (require('express-rate-limit-redis'))({
      client: cache.getClient(),
      prefix: 'sl:'
    }),
    onLimitReached: (req: Request) => {
      logSecurityEvent('speed_limit_reached', 'medium', {
        ip: req.ip || 'unknown',
        userAgent: req.get('User-Agent'),
        path: req.path,
        method: req.method
      });

      metrics.incrementCounter('speed_limit_reached', 1, {
        ip: req.ip || 'unknown',
        path: req.path
      });
    }
  });
};

// Security headers middleware
export const securityHeaders = helmet(securityConfig.helmet);

// CORS middleware
export const corsMiddleware = cors(securityConfig.cors);

// Combined security middleware setup
export const setupSecurityMiddleware = (app: any) => {
  // Trust proxy (for accurate IP addresses behind load balancers)
  app.set('trust proxy', 1);

  // Security headers
  app.use(securityHeaders);

  // CORS
  app.use(corsMiddleware);

  // IP filtering
  app.use(ipFilter);

  // Request sanitization
  app.use(sanitizeRequest);

  // Suspicious activity detection
  app.use(detectSuspiciousActivity);

  // Global rate limiting
  app.use(createRateLimiter(securityConfig.rateLimit.global));

  // API-specific rate limiting
  app.use('/api', createRateLimiter(securityConfig.rateLimit.api));

  // Speed limiting for API endpoints
  app.use('/api', createSpeedLimiter({
    windowMs: 1 * 60 * 1000, // 1 minute
    delayAfter: 50, // allow 50 requests per minute at full speed
    delayMs: 100, // add 100ms delay per request after delayAfter
    maxDelayMs: 2000 // max delay of 2 seconds
  }));

  logger.info('Security middleware configured', {
    type: 'security_middleware_setup',
    corsOrigins: securityConfig.cors.origin,
    rateLimits: {
      global: securityConfig.rateLimit.global.max,
      api: securityConfig.rateLimit.api.max
    }
  });
};

export default {
  setupSecurityMiddleware,
  validateApiKey,
  validateInput,
  validationRules,
  createRateLimiter,
  createSpeedLimiter,
  securityConfig
};