import * as winston from 'winston';
import { randomUUID } from 'crypto';

const logLevel = process.env.LOG_LEVEL || 'info';
const isDevelopment = process.env.NODE_ENV !== 'production';
const serviceName = process.env.SERVICE_NAME || 'meme-coin-radar-api';
const serviceVersion = process.env.SERVICE_VERSION || '1.0.0';

// Request ID context for tracing
export class RequestContext {
  private static context = new Map<string, string>();
  
  static setRequestId(requestId: string) {
    this.context.set('requestId', requestId);
  }
  
  static getRequestId(): string | undefined {
    return this.context.get('requestId');
  }
  
  static generateRequestId(): string {
    return randomUUID();
  }
  
  static clear() {
    this.context.clear();
  }
}

// Enhanced structured format for production
const structuredFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf((info: any) => {
    const baseLog = {
      timestamp: info.timestamp,
      level: info.level,
      service: serviceName,
      version: serviceVersion,
      message: info.message,
      requestId: RequestContext.getRequestId(),
      ...info
    };
    
    // Remove duplicate fields
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
  })
);

// Custom format for console output (development)
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, requestId, ...meta }: any) => {
    let log = `${timestamp} [${level}]`;
    if (requestId) log += ` [${requestId.slice(0, 8)}]`;
    log += `: ${message}`;
    
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta, null, 2)}`;
    }
    
    return log;
  })
);

// Production format (structured JSON)
const productionFormat = structuredFormat;

// Create logger instance
export const logger = winston.createLogger({
  level: logLevel,
  exitOnError: false, // Prevent exit on uncaught exceptions
  defaultMeta: { 
    service: serviceName,
    version: serviceVersion,
    environment: process.env.NODE_ENV || 'development'
  },
  transports: [
    // Console transport
    new winston.transports.Console({
      format: isDevelopment ? consoleFormat : productionFormat,
      silent: false,
    }),
    
    // File transport for errors (only in production)
    ...(isDevelopment ? [] : [
      new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error',
        format: productionFormat,
        maxsize: 10485760, // 10MB
        maxFiles: 10,
      }),
      
      // File transport for all logs (only in production)
      new winston.transports.File({
        filename: 'logs/combined.log',
        format: productionFormat,
        maxsize: 10485760, // 10MB
        maxFiles: 10,
      })
    ]),
  ],
  // Handle uncaught exceptions and rejections
  exceptionHandlers: isDevelopment ? [] : [
    new winston.transports.File({ 
      filename: 'logs/exceptions.log',
      format: productionFormat 
    })
  ],
  rejectionHandlers: isDevelopment ? [] : [
    new winston.transports.File({ 
      filename: 'logs/rejections.log',
      format: productionFormat 
    })
  ],
});

// Create specialized loggers for different components
export const dataCollectorLogger = logger.child({ component: 'DataCollector' });
export const secAuditorLogger = logger.child({ component: 'SecAuditor' });
export const scorerLogger = logger.child({ component: 'Scorer' });
export const alerterLogger = logger.child({ component: 'Alerter' });
export const sentinelLogger = logger.child({ component: 'Sentinel' });
export const orchestratorLogger = logger.child({ component: 'Orchestrator' });

// HTTP Request logging helper
export const logHttpRequest = (req: any, res: any, duration: number) => {
  const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
  
  logger.log(level, `HTTP ${req.method} ${req.path}`, {
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

// Rate limit logging helper
export const logRateLimit = (service: string, remaining: number, resetTime: number, endpoint?: string) => {
  const level = remaining <= 5 ? 'warn' : remaining <= 20 ? 'info' : 'debug';
  
  logger.log(level, `Rate limit status for ${service}`, {
    type: 'rate_limit',
    service,
    endpoint,
    remaining,
    resetTime: new Date(resetTime).toISOString(),
    critical: remaining <= 5,
  });
};

// Performance logging helper
export const logPerformance = (operation: string, duration: number, metadata?: any) => {
  const level = duration > 5000 ? 'warn' : duration > 2000 ? 'info' : 'debug';
  
  logger.log(level, `Performance: ${operation}`, {
    type: 'performance',
    operation,
    duration,
    slow: duration > 2000,
    ...metadata,
  });
};

// Error logging helper with context
export const logError = (error: Error, context?: string, metadata?: any) => {
  logger.error(`${context ? `[${context}] ` : ''}${error.message}`, {
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

// External API request logging helper
export const logApiRequest = (
  service: string,
  endpoint: string,
  duration: number,
  success: boolean,
  statusCode?: number,
  rateLimitRemaining?: number,
  metadata?: any
) => {
  const level = success ? 'debug' : 'warn';
  
  logger.log(level, `External API: ${service} ${endpoint}`, {
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

// Security event logging
export const logSecurityEvent = (event: string, severity: 'low' | 'medium' | 'high' | 'critical', metadata?: any) => {
  const level = severity === 'critical' || severity === 'high' ? 'error' : severity === 'medium' ? 'warn' : 'info';
  
  logger.log(level, `Security event: ${event}`, {
    type: 'security',
    event,
    severity,
    requestId: RequestContext.getRequestId(),
    ...metadata,
  });
};

// Business metrics logging
export const logBusinessMetric = (metric: string, value: number, unit?: string, metadata?: any) => {
  logger.info(`Business metric: ${metric}`, {
    type: 'business_metric',
    metric,
    value,
    unit,
    ...metadata,
  });
};

// Circuit breaker events
export const logCircuitBreaker = (service: string, state: 'open' | 'closed' | 'half-open', metadata?: any) => {
  const level = state === 'open' ? 'error' : 'info';
  
  logger.log(level, `Circuit breaker ${state} for ${service}`, {
    type: 'circuit_breaker',
    service,
    state,
    ...metadata,
  });
};

// Cache events
export const logCacheEvent = (operation: 'hit' | 'miss' | 'set' | 'delete', key: string, metadata?: any) => {
  logger.debug(`Cache ${operation}: ${key}`, {
    type: 'cache',
    operation,
    key: key.length > 50 ? key.substring(0, 50) + '...' : key,
    ...metadata,
  });
};

export default logger;