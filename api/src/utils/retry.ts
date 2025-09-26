import { logger } from './logger';
import { metrics } from './metrics';

export interface RetryOptions {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
  retryCondition?: (error: any) => boolean;
  onRetry?: (error: any, attempt: number) => void;
  name?: string;
}

export interface RetryResult<T> {
  result: T;
  attempts: number;
  totalTime: number;
}

export class RetryError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastError: Error,
    public readonly allErrors: Error[]
  ) {
    super(message);
    this.name = 'RetryError';
  }
}

export class RetryUtility {
  private static defaultOptions: RetryOptions = {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    jitter: true,
    retryCondition: (error: any) => {
      // Default: retry on network errors, timeouts, and 5xx status codes
      if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
        return true;
      }
      if (error.response?.status >= 500) {
        return true;
      }
      if (error.name === 'TimeoutError') {
        return true;
      }
      // Don't retry on 4xx errors (except 429 rate limit)
      if (error.response?.status >= 400 && error.response?.status < 500) {
        return error.response?.status === 429;
      }
      return true;
    }
  };

  static async execute<T>(
    operation: () => Promise<T>,
    options: Partial<RetryOptions> = {}
  ): Promise<RetryResult<T>> {
    const config = { ...this.defaultOptions, ...options };
    const startTime = Date.now();
    const errors: Error[] = [];
    let lastError: Error;

    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      try {
        const result = await operation();
        const totalTime = Date.now() - startTime;

        // Log successful retry if it wasn't the first attempt
        if (attempt > 1) {
          logger.info(`Operation succeeded after ${attempt} attempts`, {
            type: 'retry_success',
            service: config.name || 'unknown',
            attempts: attempt,
            totalTime,
            previousErrors: errors.length
          });

          metrics.incrementCounter('retry_success', 1, {
            service: config.name || 'unknown',
            attempts: attempt.toString()
          });
        }

        metrics.recordHistogram('retry_attempts', attempt, {
          service: config.name || 'unknown',
          success: 'true'
        });

        return { result, attempts: attempt, totalTime };

      } catch (error) {
        lastError = error as Error;
        errors.push(lastError);

        // Check if we should retry this error
        const shouldRetry = config.retryCondition!(lastError);
        const isLastAttempt = attempt === config.maxAttempts;

        logger.warn(`Operation failed on attempt ${attempt}`, {
          type: 'retry_attempt_failed',
          service: config.name || 'unknown',
          attempt,
          maxAttempts: config.maxAttempts,
          error: lastError.message,
          shouldRetry: shouldRetry && !isLastAttempt,
          isLastAttempt
        });

        metrics.incrementCounter('retry_attempt_failed', 1, {
          service: config.name || 'unknown',
          attempt: attempt.toString(),
          error: lastError.name || 'unknown'
        });

        // If this is the last attempt or we shouldn't retry, throw
        if (isLastAttempt || !shouldRetry) {
          break;
        }

        // Call onRetry callback if provided
        if (config.onRetry) {
          try {
            config.onRetry(lastError, attempt);
          } catch (callbackError) {
            logger.warn('Retry callback failed', {
              type: 'retry_callback_error',
              service: config.name || 'unknown',
              error: (callbackError as Error).message
            });
          }
        }

        // Calculate delay for next attempt
        const delay = this.calculateDelay(attempt, config);
        
        logger.debug(`Retrying in ${delay}ms`, {
          type: 'retry_delay',
          service: config.name || 'unknown',
          attempt,
          delay
        });

        await this.sleep(delay);
      }
    }

    // All attempts failed
    const totalTime = Date.now() - startTime;
    const retryError = new RetryError(
      `Operation failed after ${config.maxAttempts} attempts. Last error: ${lastError!.message}`,
      config.maxAttempts,
      lastError!,
      errors
    );

    logger.error(`Operation failed after all retry attempts`, {
      type: 'retry_exhausted',
      service: config.name || 'unknown',
      attempts: config.maxAttempts,
      totalTime,
      lastError: lastError!.message,
      allErrors: errors.map(e => e.message)
    });

    metrics.incrementCounter('retry_exhausted', 1, {
      service: config.name || 'unknown',
      attempts: config.maxAttempts.toString()
    });

    metrics.recordHistogram('retry_attempts', config.maxAttempts, {
      service: config.name || 'unknown',
      success: 'false'
    });

    throw retryError;
  }

  private static calculateDelay(attempt: number, config: RetryOptions): number {
    // Calculate exponential backoff
    let delay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1);
    
    // Apply maximum delay cap
    delay = Math.min(delay, config.maxDelay);
    
    // Add jitter to prevent thundering herd
    if (config.jitter) {
      // Add random jitter of ±25%
      const jitterRange = delay * 0.25;
      const jitter = (Math.random() - 0.5) * 2 * jitterRange;
      delay = Math.max(0, delay + jitter);
    }
    
    return Math.round(delay);
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Convenience method for HTTP requests
  static async executeHttp<T>(
    operation: () => Promise<T>,
    serviceName: string,
    options: Partial<RetryOptions> = {}
  ): Promise<T> {
    const httpOptions: Partial<RetryOptions> = {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      backoffMultiplier: 2,
      jitter: true,
      name: serviceName,
      retryCondition: (error: any) => {
        // Retry on network errors
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
          return true;
        }
        // Retry on 5xx server errors
        if (error.response?.status >= 500) {
          return true;
        }
        // Retry on 429 rate limit (with longer delay)
        if (error.response?.status === 429) {
          return true;
        }
        // Don't retry on 4xx client errors (except 429)
        if (error.response?.status >= 400 && error.response?.status < 500) {
          return false;
        }
        return true;
      },
      onRetry: (error: any, attempt: number) => {
        // Special handling for rate limits
        if (error.response?.status === 429) {
          const retryAfter = error.response?.headers['retry-after'];
          if (retryAfter) {
            logger.warn(`Rate limited, retry after ${retryAfter}s`, {
              type: 'rate_limit_retry',
              service: serviceName,
              attempt,
              retryAfter
            });
          }
        }
      },
      ...options
    };

    const result = await this.execute(operation, httpOptions);
    return result.result;
  }

  // Convenience method for database operations
  static async executeDb<T>(
    operation: () => Promise<T>,
    operationName: string,
    options: Partial<RetryOptions> = {}
  ): Promise<T> {
    const dbOptions: Partial<RetryOptions> = {
      maxAttempts: 3,
      baseDelay: 500,
      maxDelay: 5000,
      backoffMultiplier: 2,
      jitter: true,
      name: `db_${operationName}`,
      retryCondition: (error: any) => {
        // Retry on connection errors
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
          return true;
        }
        // Retry on specific database errors
        if (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_LOCKED') {
          return true;
        }
        // Don't retry on constraint violations or syntax errors
        if (error.code === 'SQLITE_CONSTRAINT' || error.code === 'SQLITE_ERROR') {
          return false;
        }
        return true;
      },
      ...options
    };

    const result = await this.execute(operation, dbOptions);
    return result.result;
  }

  // Convenience method for cache operations
  static async executeCache<T>(
    operation: () => Promise<T>,
    operationName: string,
    options: Partial<RetryOptions> = {}
  ): Promise<T> {
    const cacheOptions: Partial<RetryOptions> = {
      maxAttempts: 2, // Fewer retries for cache operations
      baseDelay: 100,
      maxDelay: 1000,
      backoffMultiplier: 2,
      jitter: true,
      name: `cache_${operationName}`,
      retryCondition: (error: any) => {
        // Only retry on connection errors, not on data errors
        return error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT';
      },
      ...options
    };

    const result = await this.execute(operation, cacheOptions);
    return result.result;
  }
}

// Predefined retry configurations for different service types
export const retryConfigs = {
  dexscreener: {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2,
    jitter: true,
    name: 'dexscreener'
  },
  goplus: {
    maxAttempts: 2, // Lower attempts due to strict rate limits
    baseDelay: 2000,
    maxDelay: 15000,
    backoffMultiplier: 3,
    jitter: true,
    name: 'goplus'
  },
  birdeye: {
    maxAttempts: 2, // Very strict rate limits
    baseDelay: 5000,
    maxDelay: 30000,
    backoffMultiplier: 3,
    jitter: true,
    name: 'birdeye'
  },
  coingecko: {
    maxAttempts: 3,
    baseDelay: 1500,
    maxDelay: 12000,
    backoffMultiplier: 2,
    jitter: true,
    name: 'coingecko'
  },
  redis: {
    maxAttempts: 3,
    baseDelay: 100,
    maxDelay: 2000,
    backoffMultiplier: 2,
    jitter: true,
    name: 'redis'
  },
  database: {
    maxAttempts: 3,
    baseDelay: 200,
    maxDelay: 3000,
    backoffMultiplier: 2,
    jitter: true,
    name: 'database'
  }
};

// Export convenience functions
export const retry = RetryUtility.execute;
export const retryHttp = RetryUtility.executeHttp;
export const retryDb = RetryUtility.executeDb;
export const retryCache = RetryUtility.executeCache;