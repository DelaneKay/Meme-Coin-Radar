import { Request, Response, NextFunction } from 'express';
import { RequestContext, logHttpRequest, logSecurityEvent } from '../utils/logger';
import { trackHttpRequest } from '../utils/metrics';

// Extend Express Request type to include timing
declare global {
  namespace Express {
    interface Request {
      startTime?: number;
      requestId?: string;
    }
  }
}

// Request ID middleware
export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const requestId = req.headers['x-request-id'] as string || RequestContext.generateRequestId();
  
  req.requestId = requestId;
  RequestContext.setRequestId(requestId);
  
  // Add request ID to response headers
  res.setHeader('X-Request-ID', requestId);
  
  next();
};

// Request timing middleware
export const timingMiddleware = (req: Request, res: Response, next: NextFunction) => {
  req.startTime = Date.now();
  next();
};

// HTTP request logging middleware
export const httpLoggingMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Skip logging for health checks and static assets
  if (req.path === '/health' || req.path.startsWith('/static/')) {
    return next();
  }

  const originalSend = res.send;
  const originalJson = res.json;

  // Override response methods to capture when response is sent
  res.send = function(body) {
    logRequestCompletion();
    return originalSend.call(this, body);
  };

  res.json = function(body) {
    logRequestCompletion();
    return originalJson.call(this, body);
  };

  // Handle cases where response ends without send/json
  res.on('finish', () => {
    if (!res.headersSent) {
      logRequestCompletion();
    }
  });

  function logRequestCompletion() {
    const duration = req.startTime ? Date.now() - req.startTime : 0;
    
    // Log HTTP request
    logHttpRequest(req, res, duration);
    
    // Track metrics
    trackHttpRequest(req.method, req.path, res.statusCode, duration);
    
    // Log security events for suspicious requests
    if (res.statusCode === 401 || res.statusCode === 403) {
      logSecurityEvent('unauthorized_access', 'medium', {
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
    }
    
    // Log potential attacks
    if (req.path.includes('../') || req.path.includes('..\\')) {
      logSecurityEvent('path_traversal_attempt', 'high', {
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
    }
    
    // Clear request context
    RequestContext.clear();
  }

  next();
};

// Error logging middleware
export const errorLoggingMiddleware = (err: Error, req: Request, res: Response, next: NextFunction) => {
  const duration = req.startTime ? Date.now() - req.startTime : 0;
  
  // Log the error with request context
  logHttpRequest(req, res, duration);
  
  // Track error metrics
  trackHttpRequest(req.method, req.path, res.statusCode || 500, duration);
  
  // Log security event for potential attacks
  if (err.message.includes('ENOENT') && req.path.includes('../')) {
    logSecurityEvent('file_access_attempt', 'high', {
      error: err.message,
      method: req.method,
      path: req.path,
      ip: req.ip
    });
  }
  
  next(err);
};

// Rate limiting logging middleware
export const rateLimitLoggingMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const originalSend = res.send;
  
  res.send = function(body) {
    // Check if this is a rate limit response
    if (res.statusCode === 429) {
      logSecurityEvent('rate_limit_exceeded', 'medium', {
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

// Security headers middleware with logging
export const securityHeadersMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Set security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  
  // Log missing security headers in requests
  const suspiciousHeaders = ['x-forwarded-for', 'x-real-ip', 'x-originating-ip'];
  const presentHeaders = suspiciousHeaders.filter(header => req.headers[header]);
  
  if (presentHeaders.length > 1) {
    logSecurityEvent('multiple_forwarding_headers', 'low', {
      headers: presentHeaders,
      ip: req.ip,
      path: req.path
    });
  }
  
  next();
};

// Request size monitoring middleware
export const requestSizeMiddleware = (maxSize: number = 10 * 1024 * 1024) => { // 10MB default
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    
    if (contentLength > maxSize) {
      logSecurityEvent('large_request_blocked', 'medium', {
        contentLength,
        maxSize,
        method: req.method,
        path: req.path,
        ip: req.ip
      });
      
      res.status(413).json({ error: 'Request entity too large' });
      return;
    }
    
    // Log unusually large requests
    if (contentLength > maxSize * 0.8) {
      logSecurityEvent('large_request_warning', 'low', {
        contentLength,
        method: req.method,
        path: req.path,
        ip: req.ip
      });
    }
    
    next();
  };
};

// Combine all logging middleware
export const setupLoggingMiddleware = (app: any, options: {
  maxRequestSize?: number;
  skipPaths?: string[];
} = {}) => {
  const { maxRequestSize = 10 * 1024 * 1024, skipPaths = ['/health', '/metrics'] } = options;
  
  // Apply middleware in order
  app.use(requestIdMiddleware);
  app.use(timingMiddleware);
  app.use(securityHeadersMiddleware);
  app.use(requestSizeMiddleware(maxRequestSize));
  app.use(rateLimitLoggingMiddleware);
  app.use(httpLoggingMiddleware);
  
  // Error logging should be added after routes
  return {
    errorMiddleware: errorLoggingMiddleware
  };
};