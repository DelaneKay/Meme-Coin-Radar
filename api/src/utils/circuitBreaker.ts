import { logger, logCircuitBreaker } from './logger';
import { metrics } from './metrics';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeout: number;
  monitoringPeriod: number;
  expectedErrors?: string[];
  name: string;
}

export enum CircuitBreakerState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half-open'
}

export class CircuitBreakerError extends Error {
  constructor(message: string, public readonly state: CircuitBreakerState) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0;
  private nextAttemptTime = 0;
  private successCount = 0;

  constructor(private options: CircuitBreakerOptions) {
    this.logStateChange(CircuitBreakerState.CLOSED);
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitBreakerState.OPEN) {
      if (Date.now() < this.nextAttemptTime) {
        metrics.incrementCounter('circuit_breaker_rejected', 1, { 
          service: this.options.name,
          state: this.state 
        });
        throw new CircuitBreakerError(
          `Circuit breaker is OPEN for ${this.options.name}. Next attempt allowed at ${new Date(this.nextAttemptTime).toISOString()}`,
          this.state
        );
      } else {
        this.setState(CircuitBreakerState.HALF_OPEN);
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.successCount++;

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.setState(CircuitBreakerState.CLOSED);
      logger.info(`Circuit breaker ${this.options.name} recovered`, {
        type: 'circuit_breaker_recovery',
        service: this.options.name,
        successCount: this.successCount
      });
    }

    metrics.incrementCounter('circuit_breaker_success', 1, { 
      service: this.options.name,
      state: this.state 
    });
  }

  private onFailure(error: any): void {
    // Check if this is an expected error that shouldn't trigger the circuit breaker
    if (this.isExpectedError(error)) {
      metrics.incrementCounter('circuit_breaker_expected_error', 1, { 
        service: this.options.name,
        error: error.name || 'unknown'
      });
      return;
    }

    this.failureCount++;
    this.lastFailureTime = Date.now();

    metrics.incrementCounter('circuit_breaker_failure', 1, { 
      service: this.options.name,
      state: this.state,
      error: error.name || 'unknown'
    });

    logger.warn(`Circuit breaker failure for ${this.options.name}`, {
      type: 'circuit_breaker_failure',
      service: this.options.name,
      failureCount: this.failureCount,
      threshold: this.options.failureThreshold,
      error: error.message,
      state: this.state
    });

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.setState(CircuitBreakerState.OPEN);
    } else if (this.failureCount >= this.options.failureThreshold) {
      this.setState(CircuitBreakerState.OPEN);
    }
  }

  private isExpectedError(error: any): boolean {
    if (!this.options.expectedErrors) return false;
    
    const errorName = error.name || error.constructor.name;
    const errorMessage = error.message || '';
    
    return this.options.expectedErrors.some(expectedError => 
      errorName.includes(expectedError) || errorMessage.includes(expectedError)
    );
  }

  private setState(newState: CircuitBreakerState): void {
    if (this.state === newState) return;

    const oldState = this.state;
    this.state = newState;

    if (newState === CircuitBreakerState.OPEN) {
      this.nextAttemptTime = Date.now() + this.options.resetTimeout;
    }

    this.logStateChange(newState, oldState);
    metrics.setGauge('circuit_breaker_state', this.getStateValue(), { 
      service: this.options.name 
    });
  }

  private logStateChange(newState: CircuitBreakerState, oldState?: CircuitBreakerState): void {
    logCircuitBreaker(this.options.name, newState, {
      oldState,
      failureCount: this.failureCount,
      threshold: this.options.failureThreshold,
      nextAttemptTime: this.nextAttemptTime > 0 ? new Date(this.nextAttemptTime).toISOString() : undefined
    });
  }

  private getStateValue(): number {
    switch (this.state) {
      case CircuitBreakerState.CLOSED: return 0;
      case CircuitBreakerState.HALF_OPEN: return 1;
      case CircuitBreakerState.OPEN: return 2;
      default: return -1;
    }
  }

  // Public getters for monitoring
  getState(): CircuitBreakerState {
    return this.state;
  }

  getFailureCount(): number {
    return this.failureCount;
  }

  getSuccessCount(): number {
    return this.successCount;
  }

  getNextAttemptTime(): number {
    return this.nextAttemptTime;
  }

  // Manual control methods (for testing/emergency)
  forceOpen(): void {
    this.setState(CircuitBreakerState.OPEN);
    logger.warn(`Circuit breaker ${this.options.name} manually forced OPEN`, {
      type: 'circuit_breaker_manual_open',
      service: this.options.name
    });
  }

  forceClose(): void {
    this.failureCount = 0;
    this.setState(CircuitBreakerState.CLOSED);
    logger.info(`Circuit breaker ${this.options.name} manually forced CLOSED`, {
      type: 'circuit_breaker_manual_close',
      service: this.options.name
    });
  }

  reset(): void {
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
    this.nextAttemptTime = 0;
    this.setState(CircuitBreakerState.CLOSED);
    logger.info(`Circuit breaker ${this.options.name} reset`, {
      type: 'circuit_breaker_reset',
      service: this.options.name
    });
  }

  // Get status for health checks
  getStatus() {
    return {
      name: this.options.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      failureThreshold: this.options.failureThreshold,
      lastFailureTime: this.lastFailureTime > 0 ? new Date(this.lastFailureTime).toISOString() : null,
      nextAttemptTime: this.nextAttemptTime > 0 ? new Date(this.nextAttemptTime).toISOString() : null,
      healthy: this.state !== CircuitBreakerState.OPEN
    };
  }
}

// Circuit breaker manager for multiple services
export class CircuitBreakerManager {
  private breakers = new Map<string, CircuitBreaker>();

  createBreaker(name: string, options: Omit<CircuitBreakerOptions, 'name'>): CircuitBreaker {
    const breaker = new CircuitBreaker({ ...options, name });
    this.breakers.set(name, breaker);
    return breaker;
  }

  getBreaker(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  getAllBreakers(): CircuitBreaker[] {
    return Array.from(this.breakers.values());
  }

  getStatus() {
    return Array.from(this.breakers.values()).map(breaker => breaker.getStatus());
  }

  // Emergency controls
  openAll(): void {
    this.breakers.forEach(breaker => breaker.forceOpen());
    logger.warn('All circuit breakers manually opened', {
      type: 'circuit_breaker_emergency_open',
      count: this.breakers.size
    });
  }

  closeAll(): void {
    this.breakers.forEach(breaker => breaker.forceClose());
    logger.info('All circuit breakers manually closed', {
      type: 'circuit_breaker_emergency_close',
      count: this.breakers.size
    });
  }

  resetAll(): void {
    this.breakers.forEach(breaker => breaker.reset());
    logger.info('All circuit breakers reset', {
      type: 'circuit_breaker_reset_all',
      count: this.breakers.size
    });
  }
}

// Default circuit breaker configurations for different services
export const defaultCircuitBreakerConfigs = {
  dexscreener: {
    failureThreshold: 5,
    resetTimeout: 60000, // 1 minute
    monitoringPeriod: 60000,
    expectedErrors: ['RateLimitError', 'TimeoutError']
  },
  goplus: {
    failureThreshold: 3,
    resetTimeout: 120000, // 2 minutes
    monitoringPeriod: 60000,
    expectedErrors: ['RateLimitError', 'TimeoutError']
  },
  birdeye: {
    failureThreshold: 3,
    resetTimeout: 300000, // 5 minutes (stricter due to low rate limits)
    monitoringPeriod: 60000,
    expectedErrors: ['RateLimitError', 'TimeoutError']
  },
  coingecko: {
    failureThreshold: 5,
    resetTimeout: 180000, // 3 minutes
    monitoringPeriod: 60000,
    expectedErrors: ['RateLimitError', 'TimeoutError']
  },
  redis: {
    failureThreshold: 3,
    resetTimeout: 30000, // 30 seconds
    monitoringPeriod: 30000,
    expectedErrors: ['TimeoutError']
  }
};

// Global circuit breaker manager instance
export const circuitBreakerManager = new CircuitBreakerManager();