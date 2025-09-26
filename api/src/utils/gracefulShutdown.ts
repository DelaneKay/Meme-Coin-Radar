import { Server } from 'http';
import { logger } from './logger';
import { metrics } from './metrics';
import { CacheManager } from './cache';
import { circuitBreakerManager } from './circuitBreaker';

export interface ShutdownHandler {
  name: string;
  handler: () => Promise<void>;
  timeout?: number;
  priority?: number; // Lower numbers execute first
}

export class GracefulShutdown {
  private handlers: ShutdownHandler[] = [];
  private isShuttingDown = false;
  private shutdownTimeout = 30000; // 30 seconds default
  private server?: Server;

  constructor(server?: Server) {
    this.server = server;
    this.setupSignalHandlers();
  }

  private setupSignalHandlers(): void {
    // Handle different shutdown signals
    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM signal, starting graceful shutdown', {
        type: 'shutdown_signal',
        signal: 'SIGTERM'
      });
      this.shutdown('SIGTERM');
    });

    process.on('SIGINT', () => {
      logger.info('Received SIGINT signal, starting graceful shutdown', {
        type: 'shutdown_signal',
        signal: 'SIGINT'
      });
      this.shutdown('SIGINT');
    });

    process.on('SIGUSR2', () => {
      logger.info('Received SIGUSR2 signal, starting graceful shutdown', {
        type: 'shutdown_signal',
        signal: 'SIGUSR2'
      });
      this.shutdown('SIGUSR2');
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception, starting emergency shutdown', {
        type: 'uncaught_exception',
        error: error.message,
        stack: error.stack
      });
      this.emergencyShutdown(error);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled promise rejection, starting emergency shutdown', {
        type: 'unhandled_rejection',
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined
      });
      this.emergencyShutdown(new Error(`Unhandled rejection: ${reason}`));
    });
  }

  addHandler(handler: ShutdownHandler): void {
    this.handlers.push(handler);
    // Sort by priority (lower numbers first)
    this.handlers.sort((a, b) => (a.priority || 100) - (b.priority || 100));
    
    logger.debug(`Added shutdown handler: ${handler.name}`, {
      type: 'shutdown_handler_added',
      name: handler.name,
      priority: handler.priority || 100,
      totalHandlers: this.handlers.length
    });
  }

  removeHandler(name: string): void {
    const index = this.handlers.findIndex(h => h.name === name);
    if (index !== -1) {
      this.handlers.splice(index, 1);
      logger.debug(`Removed shutdown handler: ${name}`, {
        type: 'shutdown_handler_removed',
        name,
        totalHandlers: this.handlers.length
      });
    }
  }

  setShutdownTimeout(timeout: number): void {
    this.shutdownTimeout = timeout;
    logger.debug(`Shutdown timeout set to ${timeout}ms`, {
      type: 'shutdown_timeout_set',
      timeout
    });
  }

  async shutdown(signal?: string): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn('Shutdown already in progress, ignoring signal', {
        type: 'shutdown_already_in_progress',
        signal
      });
      return;
    }

    this.isShuttingDown = true;
    const startTime = Date.now();

    logger.info('Starting graceful shutdown', {
      type: 'shutdown_start',
      signal,
      handlersCount: this.handlers.length,
      timeout: this.shutdownTimeout
    });

    // Set overall timeout
    const timeoutId = setTimeout(() => {
      logger.error('Shutdown timeout exceeded, forcing exit', {
        type: 'shutdown_timeout',
        timeout: this.shutdownTimeout,
        elapsed: Date.now() - startTime
      });
      process.exit(1);
    }, this.shutdownTimeout);

    try {
      // Stop accepting new connections first
      if (this.server) {
        await this.stopServer();
      }

      // Execute shutdown handlers in priority order
      await this.executeHandlers();

      // Clear the timeout
      clearTimeout(timeoutId);

      const totalTime = Date.now() - startTime;
      logger.info('Graceful shutdown completed successfully', {
        type: 'shutdown_complete',
        totalTime,
        handlersExecuted: this.handlers.length
      });

      // Record shutdown metrics
      metrics.incrementCounter('shutdown_completed', 1, {
        signal: signal || 'unknown',
        success: 'true'
      });

      process.exit(0);

    } catch (error) {
      clearTimeout(timeoutId);
      
      logger.error('Error during graceful shutdown', {
        type: 'shutdown_error',
        error: (error as Error).message,
        elapsed: Date.now() - startTime
      });

      metrics.incrementCounter('shutdown_completed', 1, {
        signal: signal || 'unknown',
        success: 'false'
      });

      process.exit(1);
    }
  }

  private async stopServer(): Promise<void> {
    if (!this.server) return;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Server close timeout'));
      }, 10000); // 10 second timeout for server close

      this.server!.close((error) => {
        clearTimeout(timeout);
        if (error) {
          logger.error('Error closing server', {
            type: 'server_close_error',
            error: error.message
          });
          reject(error);
        } else {
          logger.info('Server closed successfully', {
            type: 'server_closed'
          });
          resolve();
        }
      });
    });
  }

  private async executeHandlers(): Promise<void> {
    const results: Array<{ name: string; success: boolean; duration: number; error?: string }> = [];

    for (const handler of this.handlers) {
      const startTime = Date.now();
      
      try {
        logger.debug(`Executing shutdown handler: ${handler.name}`, {
          type: 'shutdown_handler_start',
          name: handler.name
        });

        // Set timeout for individual handler
        const handlerTimeout = handler.timeout || 5000;
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Handler timeout: ${handler.name}`)), handlerTimeout);
        });

        await Promise.race([handler.handler(), timeoutPromise]);

        const duration = Date.now() - startTime;
        results.push({ name: handler.name, success: true, duration });

        logger.debug(`Shutdown handler completed: ${handler.name}`, {
          type: 'shutdown_handler_complete',
          name: handler.name,
          duration
        });

      } catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage = (error as Error).message;
        results.push({ name: handler.name, success: false, duration, error: errorMessage });

        logger.error(`Shutdown handler failed: ${handler.name}`, {
          type: 'shutdown_handler_error',
          name: handler.name,
          error: errorMessage,
          duration
        });
      }
    }

    // Log summary
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    logger.info('Shutdown handlers execution summary', {
      type: 'shutdown_handlers_summary',
      total: results.length,
      successful,
      failed,
      results
    });

    if (failed > 0) {
      throw new Error(`${failed} shutdown handlers failed`);
    }
  }

  private async emergencyShutdown(error: Error): Promise<void> {
    logger.error('Emergency shutdown initiated', {
      type: 'emergency_shutdown',
      error: error.message,
      stack: error.stack
    });

    metrics.incrementCounter('emergency_shutdown', 1, {
      reason: error.name || 'unknown'
    });

    // Try to close server quickly
    if (this.server) {
      try {
        this.server.close();
      } catch (closeError) {
        logger.error('Failed to close server during emergency shutdown', {
          type: 'emergency_server_close_error',
          error: (closeError as Error).message
        });
      }
    }

    // Try to flush logs
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch {
      // Ignore timeout errors
    }

    process.exit(1);
  }

  // Get shutdown status for health checks
  getStatus() {
    return {
      isShuttingDown: this.isShuttingDown,
      handlersCount: this.handlers.length,
      shutdownTimeout: this.shutdownTimeout,
      handlers: this.handlers.map(h => ({
        name: h.name,
        priority: h.priority || 100,
        timeout: h.timeout || 5000
      }))
    };
  }
}

// Create default shutdown handlers
export function createDefaultShutdownHandlers(gracefulShutdown: GracefulShutdown): void {
  // Close Redis connections
  gracefulShutdown.addHandler({
    name: 'redis_cache',
    priority: 10,
    timeout: 5000,
    handler: async () => {
      logger.info('Closing Redis cache connections');
      const cacheManager = new CacheManager();
      await cacheManager.disconnect();
    }
  });

  // Reset circuit breakers
  gracefulShutdown.addHandler({
    name: 'circuit_breakers',
    priority: 20,
    timeout: 2000,
    handler: async () => {
      logger.info('Resetting circuit breakers');
      circuitBreakerManager.resetAll();
    }
  });

  // Stop metrics reporting
  gracefulShutdown.addHandler({
    name: 'metrics',
    priority: 30,
    timeout: 3000,
    handler: async () => {
      logger.info('Stopping metrics collection');
      // Metrics cleanup would go here if needed
    }
  });

  // Final log flush
  gracefulShutdown.addHandler({
    name: 'log_flush',
    priority: 90,
    timeout: 2000,
    handler: async () => {
      logger.info('Flushing logs');
      // Winston will handle log flushing automatically
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  });
}

// Export singleton instance
let gracefulShutdownInstance: GracefulShutdown | null = null;

export function initializeGracefulShutdown(server?: Server): GracefulShutdown {
  if (gracefulShutdownInstance) {
    logger.warn('Graceful shutdown already initialized');
    return gracefulShutdownInstance;
  }

  gracefulShutdownInstance = new GracefulShutdown(server);
  createDefaultShutdownHandlers(gracefulShutdownInstance);

  logger.info('Graceful shutdown initialized', {
    type: 'graceful_shutdown_init',
    hasServer: !!server
  });

  return gracefulShutdownInstance;
}

export function getGracefulShutdown(): GracefulShutdown | null {
  return gracefulShutdownInstance;
}