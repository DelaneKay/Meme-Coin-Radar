import { Request, Response, NextFunction } from 'express';
import { body, query, param, validationResult, ValidationChain } from 'express-validator';
import * as DOMPurify from 'isomorphic-dompurify';
import { logger, logSecurityEvent } from './logger';
import { metrics } from './metrics';

// Validation error interface
export interface ValidationError {
  field: string;
  message: string;
  value: any;
  code: string;
}

// Sanitization options
export interface SanitizationOptions {
  allowHtml?: boolean;
  maxLength?: number;
  trimWhitespace?: boolean;
  removeSpecialChars?: boolean;
  allowedChars?: RegExp;
}

// Chain ID validation
export const SUPPORTED_CHAINS = ['sol', 'eth', 'bsc', 'base', 'polygon', 'arbitrum', 'optimism'] as const;
export type ChainId = typeof SUPPORTED_CHAINS[number];

// Token address patterns for different chains
export const ADDRESS_PATTERNS = {
  sol: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, // Solana base58
  eth: /^0x[a-fA-F0-9]{40}$/, // Ethereum hex
  bsc: /^0x[a-fA-F0-9]{40}$/, // BSC hex
  base: /^0x[a-fA-F0-9]{40}$/, // Base hex
  polygon: /^0x[a-fA-F0-9]{40}$/, // Polygon hex
  arbitrum: /^0x[a-fA-F0-9]{40}$/, // Arbitrum hex
  optimism: /^0x[a-fA-F0-9]{40}$/ // Optimism hex
};

// Common validation patterns
export const VALIDATION_PATTERNS = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  url: /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  alphanumeric: /^[a-zA-Z0-9]+$/,
  slug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  hexColor: /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/,
  ipAddress: /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/
};

// Dangerous patterns to detect
export const DANGEROUS_PATTERNS = [
  // XSS patterns
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /javascript:/gi,
  /vbscript:/gi,
  /onload\s*=/gi,
  /onerror\s*=/gi,
  /onclick\s*=/gi,
  
  // SQL injection patterns
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b)/gi,
  /(\b(OR|AND)\s+\d+\s*=\s*\d+)/gi,
  /('|(\\')|(;)|(--)|(\|)|(\*)|(%27)|(%3D)|(%3B)|(%2D%2D)|(%7C)|(%2A))/gi,
  
  // Path traversal patterns
  /\.\.[\/\\]/g,
  /\/etc\/passwd/gi,
  /\/proc\//gi,
  /\\windows\\system32/gi,
  
  // Command injection patterns
  /(\||&|;|\$\(|\`)/g,
  /(rm\s|del\s|format\s)/gi,
  
  // LDAP injection patterns
  /(\(|\)|&|\||!|=|\*|<|>|~)/g
];

export class ValidationService {
  private static instance: ValidationService;

  static getInstance(): ValidationService {
    if (!ValidationService.instance) {
      ValidationService.instance = new ValidationService();
    }
    return ValidationService.instance;
  }

  // Sanitize string input
  sanitizeString(input: string, options: SanitizationOptions = {}): string {
    if (typeof input !== 'string') {
      return '';
    }

    let sanitized = input;

    // Trim whitespace
    if (options.trimWhitespace !== false) {
      sanitized = sanitized.trim();
    }

    // Remove HTML if not allowed
    if (!options.allowHtml) {
      sanitized = DOMPurify.sanitize(sanitized, { ALLOWED_TAGS: [] });
    } else {
      sanitized = DOMPurify.sanitize(sanitized);
    }

    // Remove special characters
    if (options.removeSpecialChars) {
      sanitized = sanitized.replace(/[<>\"'%;()&+]/g, '');
    }

    // Apply allowed characters filter
    if (options.allowedChars) {
      sanitized = sanitized.replace(new RegExp(`[^${options.allowedChars.source}]`, 'g'), '');
    }

    // Limit length
    if (options.maxLength && sanitized.length > options.maxLength) {
      sanitized = sanitized.substring(0, options.maxLength);
    }

    return sanitized;
  }

  // Sanitize object recursively
  sanitizeObject(obj: any, depth: number = 0): any {
    if (depth > 10) {
      logger.warn('Maximum sanitization depth reached', {
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
      const sanitized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        const sanitizedKey = this.sanitizeString(key, { maxLength: 100, removeSpecialChars: true });
        sanitized[sanitizedKey] = this.sanitizeObject(value, depth + 1);
      }
      return sanitized;
    }

    return obj;
  }

  // Detect dangerous patterns
  detectDangerousPatterns(input: string): string[] {
    const detected: string[] = [];

    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(input)) {
        detected.push(pattern.source);
      }
    }

    return detected;
  }

  // Validate token address for specific chain
  validateTokenAddress(address: string, chainId: ChainId): boolean {
    const pattern = ADDRESS_PATTERNS[chainId];
    return pattern ? pattern.test(address) : false;
  }

  // Validate webhook URL
  validateWebhookUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      
      // Only allow HTTP/HTTPS
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return false;
      }

      // Block localhost and private IPs in production
      if (process.env.NODE_ENV === 'production') {
        const hostname = parsed.hostname;
        
        // Block localhost
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
          return false;
        }

        // Block private IP ranges
        const privateRanges = [
          /^10\./,
          /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
          /^192\.168\./,
          /^169\.254\./ // Link-local
        ];

        if (privateRanges.some(range => range.test(hostname))) {
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  // Validate pagination parameters
  validatePagination(page?: string, limit?: string): { page: number; limit: number; errors: string[] } {
    const errors: string[] = [];
    let validPage = 1;
    let validLimit = 20;

    if (page) {
      const pageNum = parseInt(page, 10);
      if (isNaN(pageNum) || pageNum < 1 || pageNum > 10000) {
        errors.push('Page must be between 1 and 10000');
      } else {
        validPage = pageNum;
      }
    }

    if (limit) {
      const limitNum = parseInt(limit, 10);
      if (isNaN(limitNum) || limitNum < 1 || limitNum > 1000) {
        errors.push('Limit must be between 1 and 1000');
      } else {
        validLimit = limitNum;
      }
    }

    return { page: validPage, limit: validLimit, errors };
  }

  // Validate time range
  validateTimeRange(timeRange?: string): { valid: boolean; error?: string } {
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

  // Validate numeric range
  validateNumericRange(value: string, min: number, max: number, fieldName: string): { valid: boolean; value?: number; error?: string } {
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

// Validation rules for common use cases
export const validationRules = {
  // Chain validation
  chainId: (field: string = 'chainId') => 
    query(field)
      .optional()
      .isIn(SUPPORTED_CHAINS)
      .withMessage(`Chain ID must be one of: ${SUPPORTED_CHAINS.join(', ')}`),

  // Token address validation
  tokenAddress: (chainField: string = 'chainId', addressField: string = 'address') =>
    param(addressField)
      .custom(async (value: any, { req }: any) => {
        const chainId = req.query[chainField] || req.params[chainField] || 'eth';
        const validationService = ValidationService.getInstance();
        
        if (!validationService.validateTokenAddress(value, chainId as ChainId)) {
          throw new Error(`Invalid token address format for chain ${chainId}`);
        }
        
        return true;
      }),

  // Pagination validation
  pagination: [
    query('page')
      .optional()
      .isInt({ min: 1, max: 10000 })
      .withMessage('Page must be between 1 and 10000'),
    
    query('limit')
      .optional()
      .isInt({ min: 1, max: 1000 })
      .withMessage('Limit must be between 1 and 1000')
  ],

  // Search query validation
  searchQuery: (field: string = 'q') =>
    query(field)
      .optional()
      .isLength({ min: 1, max: 200 })
      .trim()
      .custom(async (value: any) => {
        const validationService = ValidationService.getInstance();
        const dangerous = validationService.detectDangerousPatterns(value);
        
        if (dangerous.length > 0) {
          throw new Error('Search query contains potentially dangerous patterns');
        }
        
        return true;
      }),

  // Email validation
  email: (field: string = 'email') =>
    body(field)
      .isEmail()
      .normalizeEmail()
      .withMessage('Invalid email format'),

  // Password validation
  password: (field: string = 'password') =>
    body(field)
      .isLength({ min: 8, max: 128 })
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage('Password must be 8-128 characters with uppercase, lowercase, number, and special character'),

  // Webhook URL validation
  webhookUrl: (field: string = 'webhookUrl') =>
    body(field)
      .optional()
      .custom(async (value: any) => {
        const validationService = ValidationService.getInstance();
        
        if (!validationService.validateWebhookUrl(value)) {
          throw new Error('Invalid webhook URL');
        }
        
        return true;
      }),

  // Numeric range validation
  numericRange: (field: string, min: number, max: number) =>
    query(field)
      .optional()
      .isFloat({ min, max })
      .withMessage(`${field} must be between ${min} and ${max}`),

  // Time range validation
  timeRange: (field: string = 'timeRange') =>
    query(field)
      .optional()
      .custom(async (value: any) => {
        const validationService = ValidationService.getInstance();
        const result = validationService.validateTimeRange(value);
        
        if (!result.valid) {
          throw new Error(result.error);
        }
        
        return true;
      }),

  // UUID validation
  uuid: (field: string) =>
    param(field)
      .isUUID()
      .withMessage('Invalid UUID format'),

  // Alphanumeric validation
  alphanumeric: (field: string, minLength: number = 1, maxLength: number = 100) =>
    body(field)
      .isAlphanumeric()
      .isLength({ min: minLength, max: maxLength })
      .withMessage(`${field} must be alphanumeric and ${minLength}-${maxLength} characters`),

  // Array validation
  stringArray: (field: string, maxItems: number = 100, maxItemLength: number = 100) =>
    body(field)
      .optional()
      .isArray({ max: maxItems })
      .custom(async (value: any) => {
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

// Validation middleware
export const validateRequest = (validations: ValidationChain[]) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Run all validations
    await Promise.all(validations.map(validation => validation.run(req)));

    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
      const validationErrors: ValidationError[] = errors.array().map((error: any) => ({
        field: error.param || 'unknown',
        message: error.msg,
        value: error.value,
        code: 'VALIDATION_ERROR'
      }));

      logSecurityEvent('input_validation_failed', 'medium', {
        ip: req.ip,
        path: req.path,
        method: req.method,
        errors: validationErrors,
        userAgent: req.get('User-Agent')
      });

      metrics.incrementCounter('validation_errors', 1, {
        path: req.path,
        errorCount: validationErrors.length.toString()
      });

      res.status(400).json({
        error: 'Input validation failed',
        code: 'VALIDATION_ERROR',
        details: validationErrors
      });
      return;
    }

    next();
  };
};

// Sanitization middleware
export const sanitizeRequest = (req: Request, res: Response, next: NextFunction): void => {
  const validationService = ValidationService.getInstance();

  try {
    // Sanitize query parameters
    if (req.query) {
      req.query = validationService.sanitizeObject(req.query);
    }

    // Sanitize request body
    if (req.body) {
      req.body = validationService.sanitizeObject(req.body);
    }

    // Sanitize route parameters
    if (req.params) {
      req.params = validationService.sanitizeObject(req.params);
    }

    next();
  } catch (error) {
    logger.error('Request sanitization failed', {
      type: 'sanitization_error',
      error: (error as Error).message,
      path: req.path
    });

    res.status(400).json({
      error: 'Request processing failed',
      code: 'SANITIZATION_ERROR'
    });
    return;
  }
};

// Export singleton instance
export const validationService = ValidationService.getInstance();

export default {
  ValidationService,
  validationService,
  validationRules,
  validateRequest,
  sanitizeRequest,
  SUPPORTED_CHAINS,
  ADDRESS_PATTERNS,
  VALIDATION_PATTERNS,
  DANGEROUS_PATTERNS
};