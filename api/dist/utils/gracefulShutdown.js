"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GracefulShutdown = void 0;
exports.createDefaultShutdownHandlers = createDefaultShutdownHandlers;
exports.initializeGracefulShutdown = initializeGracefulShutdown;
exports.getGracefulShutdown = getGracefulShutdown;
const logger_1 = require("./logger");
const metrics_1 = require("./metrics");
const cache_1 = require("./cache");
const circuitBreaker_1 = require("./circuitBreaker");
class GracefulShutdown {
    constructor(server) {
        this.handlers = [];
        this.isShuttingDown = false;
        this.shutdownTimeout = 30000;
        this.server = server;
        this.setupSignalHandlers();
    }
    setupSignalHandlers() {
        process.on('SIGTERM', () => {
            logger_1.logger.info('Received SIGTERM signal, starting graceful shutdown', {
                type: 'shutdown_signal',
                signal: 'SIGTERM'
            });
            this.shutdown('SIGTERM');
        });
        process.on('SIGINT', () => {
            logger_1.logger.info('Received SIGINT signal, starting graceful shutdown', {
                type: 'shutdown_signal',
                signal: 'SIGINT'
            });
            this.shutdown('SIGINT');
        });
        process.on('SIGUSR2', () => {
            logger_1.logger.info('Received SIGUSR2 signal, starting graceful shutdown', {
                type: 'shutdown_signal',
                signal: 'SIGUSR2'
            });
            this.shutdown('SIGUSR2');
        });
        process.on('uncaughtException', (error) => {
            logger_1.logger.error('Uncaught exception, starting emergency shutdown', {
                type: 'uncaught_exception',
                error: error.message,
                stack: error.stack
            });
            this.emergencyShutdown(error);
        });
        process.on('unhandledRejection', (reason, promise) => {
            logger_1.logger.error('Unhandled promise rejection, starting emergency shutdown', {
                type: 'unhandled_rejection',
                reason: reason instanceof Error ? reason.message : String(reason),
                stack: reason instanceof Error ? reason.stack : undefined
            });
            this.emergencyShutdown(new Error(`Unhandled rejection: ${reason}`));
        });
    }
    addHandler(handler) {
        this.handlers.push(handler);
        this.handlers.sort((a, b) => (a.priority || 100) - (b.priority || 100));
        logger_1.logger.debug(`Added shutdown handler: ${handler.name}`, {
            type: 'shutdown_handler_added',
            name: handler.name,
            priority: handler.priority || 100,
            totalHandlers: this.handlers.length
        });
    }
    removeHandler(name) {
        const index = this.handlers.findIndex(h => h.name === name);
        if (index !== -1) {
            this.handlers.splice(index, 1);
            logger_1.logger.debug(`Removed shutdown handler: ${name}`, {
                type: 'shutdown_handler_removed',
                name,
                totalHandlers: this.handlers.length
            });
        }
    }
    setShutdownTimeout(timeout) {
        this.shutdownTimeout = timeout;
        logger_1.logger.debug(`Shutdown timeout set to ${timeout}ms`, {
            type: 'shutdown_timeout_set',
            timeout
        });
    }
    async shutdown(signal) {
        if (this.isShuttingDown) {
            logger_1.logger.warn('Shutdown already in progress, ignoring signal', {
                type: 'shutdown_already_in_progress',
                signal
            });
            return;
        }
        this.isShuttingDown = true;
        const startTime = Date.now();
        logger_1.logger.info('Starting graceful shutdown', {
            type: 'shutdown_start',
            signal,
            handlersCount: this.handlers.length,
            timeout: this.shutdownTimeout
        });
        const timeoutId = setTimeout(() => {
            logger_1.logger.error('Shutdown timeout exceeded, forcing exit', {
                type: 'shutdown_timeout',
                timeout: this.shutdownTimeout,
                elapsed: Date.now() - startTime
            });
            process.exit(1);
        }, this.shutdownTimeout);
        try {
            if (this.server) {
                await this.stopServer();
            }
            await this.executeHandlers();
            clearTimeout(timeoutId);
            const totalTime = Date.now() - startTime;
            logger_1.logger.info('Graceful shutdown completed successfully', {
                type: 'shutdown_complete',
                totalTime,
                handlersExecuted: this.handlers.length
            });
            metrics_1.metrics.incrementCounter('shutdown_completed', 1, {
                signal: signal || 'unknown',
                success: 'true'
            });
            process.exit(0);
        }
        catch (error) {
            clearTimeout(timeoutId);
            logger_1.logger.error('Error during graceful shutdown', {
                type: 'shutdown_error',
                error: error.message,
                elapsed: Date.now() - startTime
            });
            metrics_1.metrics.incrementCounter('shutdown_completed', 1, {
                signal: signal || 'unknown',
                success: 'false'
            });
            process.exit(1);
        }
    }
    async stopServer() {
        if (!this.server)
            return;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Server close timeout'));
            }, 10000);
            this.server.close((error) => {
                clearTimeout(timeout);
                if (error) {
                    logger_1.logger.error('Error closing server', {
                        type: 'server_close_error',
                        error: error.message
                    });
                    reject(error);
                }
                else {
                    logger_1.logger.info('Server closed successfully', {
                        type: 'server_closed'
                    });
                    resolve();
                }
            });
        });
    }
    async executeHandlers() {
        const results = [];
        for (const handler of this.handlers) {
            const startTime = Date.now();
            try {
                logger_1.logger.debug(`Executing shutdown handler: ${handler.name}`, {
                    type: 'shutdown_handler_start',
                    name: handler.name
                });
                const handlerTimeout = handler.timeout || 5000;
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error(`Handler timeout: ${handler.name}`)), handlerTimeout);
                });
                await Promise.race([handler.handler(), timeoutPromise]);
                const duration = Date.now() - startTime;
                results.push({ name: handler.name, success: true, duration });
                logger_1.logger.debug(`Shutdown handler completed: ${handler.name}`, {
                    type: 'shutdown_handler_complete',
                    name: handler.name,
                    duration
                });
            }
            catch (error) {
                const duration = Date.now() - startTime;
                const errorMessage = error.message;
                results.push({ name: handler.name, success: false, duration, error: errorMessage });
                logger_1.logger.error(`Shutdown handler failed: ${handler.name}`, {
                    type: 'shutdown_handler_error',
                    name: handler.name,
                    error: errorMessage,
                    duration
                });
            }
        }
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        logger_1.logger.info('Shutdown handlers execution summary', {
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
    async emergencyShutdown(error) {
        logger_1.logger.error('Emergency shutdown initiated', {
            type: 'emergency_shutdown',
            error: error.message,
            stack: error.stack
        });
        metrics_1.metrics.incrementCounter('emergency_shutdown', 1, {
            reason: error.name || 'unknown'
        });
        if (this.server) {
            try {
                this.server.close();
            }
            catch (closeError) {
                logger_1.logger.error('Failed to close server during emergency shutdown', {
                    type: 'emergency_server_close_error',
                    error: closeError.message
                });
            }
        }
        try {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        catch {
        }
        process.exit(1);
    }
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
exports.GracefulShutdown = GracefulShutdown;
function createDefaultShutdownHandlers(gracefulShutdown) {
    gracefulShutdown.addHandler({
        name: 'redis_cache',
        priority: 10,
        timeout: 5000,
        handler: async () => {
            logger_1.logger.info('Closing Redis cache connections');
            await cache_1.cache.disconnect();
        }
    });
    gracefulShutdown.addHandler({
        name: 'circuit_breakers',
        priority: 20,
        timeout: 2000,
        handler: async () => {
            logger_1.logger.info('Resetting circuit breakers');
            circuitBreaker_1.circuitBreakerManager.resetAll();
        }
    });
    gracefulShutdown.addHandler({
        name: 'metrics',
        priority: 30,
        timeout: 3000,
        handler: async () => {
            logger_1.logger.info('Stopping metrics collection');
        }
    });
    gracefulShutdown.addHandler({
        name: 'log_flush',
        priority: 90,
        timeout: 2000,
        handler: async () => {
            logger_1.logger.info('Flushing logs');
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    });
}
let gracefulShutdownInstance = null;
function initializeGracefulShutdown(server) {
    if (gracefulShutdownInstance) {
        logger_1.logger.warn('Graceful shutdown already initialized');
        return gracefulShutdownInstance;
    }
    gracefulShutdownInstance = new GracefulShutdown(server);
    createDefaultShutdownHandlers(gracefulShutdownInstance);
    logger_1.logger.info('Graceful shutdown initialized', {
        type: 'graceful_shutdown_init',
        hasServer: !!server
    });
    return gracefulShutdownInstance;
}
function getGracefulShutdown() {
    return gracefulShutdownInstance;
}
//# sourceMappingURL=gracefulShutdown.js.map