import { logger } from './logger';
import { metrics } from './metrics';

export class TimeoutError extends Error {
  constructor(message: string, public readonly timeoutMs: number) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export interface TimeoutOptions {
  timeoutMs: number;
  name?: string;
  onTimeout?: () => void;
}

export class TimeoutUtility {
  /**
   * Wraps a promise with a timeout
   */
  static async withTimeout<T>(
    promise: Promise<T>,
    options: TimeoutOptions
  ): Promise<T> {
    const { timeoutMs, name = 'unknown', onTimeout } = options;
    
    let timeoutId: NodeJS.Timeout | undefined;
    let isResolved = false;
    
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          
          // Call timeout callback if provided
          if (onTimeout) {
            try {
              onTimeout();
            } catch (error) {
              logger.warn('Timeout callback failed', {
                type: 'timeout_callback_error',
                service: name,
                error: (error as Error).message
              });
            }
          }
          
          logger.warn(`Operation timed out after ${timeoutMs}ms`, {
            type: 'operation_timeout',
            service: name,
            timeoutMs
          });
          
          metrics.incrementCounter('operation_timeout', 1, {
            service: name,
            timeout: timeoutMs.toString()
          });
          
          reject(new TimeoutError(
            `Operation '${name}' timed out after ${timeoutMs}ms`,
            timeoutMs
          ));
        }
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      isResolved = true;
      if (timeoutId) clearTimeout(timeoutId);
      
      metrics.incrementCounter('operation_completed', 1, {
        service: name,
        result: 'success'
      });
      
      return result;
    } catch (error) {
      isResolved = true;
      if (timeoutId) clearTimeout(timeoutId);
      
      if (error instanceof TimeoutError) {
        throw error;
      }
      
      metrics.incrementCounter('operation_completed', 1, {
        service: name,
        result: 'error'
      });
      
      throw error;
    }
  }

  /**
   * Creates a timeout wrapper function
   */
  static createTimeoutWrapper<T extends any[], R>(
    fn: (...args: T) => Promise<R>,
    defaultTimeout: number,
    name?: string
  ): (...args: T) => Promise<R> {
    return async (...args: T): Promise<R> => {
      return this.withTimeout(fn(...args), {
        timeoutMs: defaultTimeout,
        name: name || fn.name || 'wrapped_function'
      });
    };
  }

  /**
   * Creates a timeout for HTTP requests with specific handling
   */
  static async withHttpTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    serviceName: string
  ): Promise<T> {
    return this.withTimeout(promise, {
      timeoutMs,
      name: `http_${serviceName}`,
      onTimeout: () => {
        logger.warn(`HTTP request to ${serviceName} timed out`, {
          type: 'http_timeout',
          service: serviceName,
          timeoutMs
        });
      }
    });
  }

  /**
   * Creates a timeout for database operations
   */
  static async withDbTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operationName: string
  ): Promise<T> {
    return this.withTimeout(promise, {
      timeoutMs,
      name: `db_${operationName}`,
      onTimeout: () => {
        logger.warn(`Database operation '${operationName}' timed out`, {
          type: 'db_timeout',
          operation: operationName,
          timeoutMs
        });
      }
    });
  }

  /**
   * Creates a timeout for cache operations
   */
  static async withCacheTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operationName: string
  ): Promise<T> {
    return this.withTimeout(promise, {
      timeoutMs,
      name: `cache_${operationName}`,
      onTimeout: () => {
        logger.debug(`Cache operation '${operationName}' timed out`, {
          type: 'cache_timeout',
          operation: operationName,
          timeoutMs
        });
      }
    });
  }

  /**
   * Delays execution for a specified time
   */
  static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Creates a cancellable delay
   */
  static cancellableDelay(ms: number): { promise: Promise<void>; cancel: () => void } {
    let timeoutId: NodeJS.Timeout;
    let cancelled = false;

    const promise = new Promise<void>((resolve, reject) => {
      timeoutId = setTimeout(() => {
        if (!cancelled) {
          resolve();
        }
      }, ms);
    });

    const cancel = () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };

    return { promise, cancel };
  }

  /**
   * Executes multiple promises with individual timeouts
   */
  static async allWithTimeout<T>(
    promises: Array<{ promise: Promise<T>; timeout: number; name?: string }>,
    options: { failFast?: boolean } = {}
  ): Promise<Array<T | TimeoutError>> {
    const { failFast = false } = options;

    const wrappedPromises = promises.map(async ({ promise, timeout, name }, index) => {
      try {
        return await this.withTimeout(promise, {
          timeoutMs: timeout,
          name: name || `promise_${index}`
        });
      } catch (error) {
        if (failFast) {
          throw error;
        }
        return error as TimeoutError;
      }
    });

    if (failFast) {
      return Promise.all(wrappedPromises);
    } else {
      return Promise.allSettled(wrappedPromises).then(results =>
        results.map(result => 
          result.status === 'fulfilled' ? result.value : result.reason
        )
      );
    }
  }

  /**
   * Race multiple promises with timeout
   */
  static async raceWithTimeout<T>(
    promises: Array<{ promise: Promise<T>; timeout: number; name?: string }>,
    globalTimeout?: number
  ): Promise<T> {
    const wrappedPromises = promises.map(({ promise, timeout, name }, index) =>
      this.withTimeout(promise, {
        timeoutMs: timeout,
        name: name || `race_promise_${index}`
      })
    );

    if (globalTimeout) {
      return this.withTimeout(
        Promise.race(wrappedPromises),
        {
          timeoutMs: globalTimeout,
          name: 'race_global'
        }
      );
    }

    return Promise.race(wrappedPromises);
  }
}

// Default timeout configurations for different service types
export const timeoutConfigs = {
  dexscreener: {
    search: 10000,      // 10s for search operations
    pairs: 8000,        // 8s for pair data
    tokens: 8000        // 8s for token data
  },
  goplus: {
    security: 15000,    // 15s for security checks (can be slow)
    batch: 20000        // 20s for batch operations
  },
  birdeye: {
    price: 12000,       // 12s for price data
    overview: 15000     // 15s for token overview
  },
  coingecko: {
    search: 8000,       // 8s for search
    price: 6000,        // 6s for price data
    markets: 10000      // 10s for market data
  },
  redis: {
    get: 2000,          // 2s for get operations
    set: 3000,          // 3s for set operations
    del: 2000,          // 2s for delete operations
    scan: 5000          // 5s for scan operations
  },
  database: {
    select: 5000,       // 5s for select queries
    insert: 8000,       // 8s for insert operations
    update: 8000,       // 8s for update operations
    delete: 5000        // 5s for delete operations
  },
  websocket: {
    connect: 10000,     // 10s for connection
    send: 5000,         // 5s for sending messages
    close: 3000         // 3s for closing connection
  }
};

// Export convenience functions
export const withTimeout = TimeoutUtility.withTimeout;
export const withHttpTimeout = TimeoutUtility.withHttpTimeout;
export const withDbTimeout = TimeoutUtility.withDbTimeout;
export const withCacheTimeout = TimeoutUtility.withCacheTimeout;
export const delay = TimeoutUtility.delay;
export const cancellableDelay = TimeoutUtility.cancellableDelay;