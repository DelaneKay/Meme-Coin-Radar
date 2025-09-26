import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import { CircuitBreaker, circuitBreakerManager, defaultCircuitBreakerConfigs } from './circuitBreaker';
import { RetryUtility, retryConfigs } from './retry';
import { withHttpTimeout, timeoutConfigs } from './timeout';
import { logger } from './logger';
import { metrics } from './metrics';

// Extend AxiosRequestConfig to include metadata
declare module 'axios' {
  interface AxiosRequestConfig {
    metadata?: {
      startTime: number;
    };
  }
}

export interface ResilientHttpConfig {
  serviceName: string;
  baseURL?: string;
  timeout?: number;
  retryConfig?: typeof retryConfigs[keyof typeof retryConfigs];
  circuitBreakerConfig?: typeof defaultCircuitBreakerConfigs[keyof typeof defaultCircuitBreakerConfigs];
  rateLimit?: {
    requestsPerSecond: number;
    burstSize?: number;
  };
  headers?: Record<string, string>;
  validateStatus?: (status: number) => boolean;
}

export interface RequestMetrics {
  startTime: number;
  endTime?: number;
  duration?: number;
  attempts: number;
  circuitBreakerState: string;
  success: boolean;
  statusCode?: number;
  error?: string;
}

export class ResilientHttpClient {
  private axiosInstance: AxiosInstance;
  private circuitBreaker: CircuitBreaker;
  private config: ResilientHttpConfig;
  private requestQueue: Array<{ resolve: Function; reject: Function; request: () => Promise<any> }> = [];
  private isProcessingQueue = false;
  private lastRequestTime = 0;

  constructor(config: ResilientHttpConfig) {
    this.config = config;
    
    // Create axios instance
    this.axiosInstance = axios.create({
      baseURL: config.baseURL,
      timeout: config.timeout || timeoutConfigs.dexscreener.search,
      headers: {
        'User-Agent': 'MemeRadar/1.0',
        ...config.headers
      },
      validateStatus: config.validateStatus || ((status) => status < 500)
    });

    // Setup request/response interceptors
    this.setupInterceptors();

    // Create circuit breaker
    const cbConfig = config.circuitBreakerConfig || defaultCircuitBreakerConfigs.dexscreener;
    this.circuitBreaker = circuitBreakerManager.createBreaker(config.serviceName, cbConfig);

    logger.info(`ResilientHttpClient created for ${config.serviceName}`, {
      type: 'http_client_created',
      service: config.serviceName,
      baseURL: config.baseURL,
      timeout: config.timeout,
      rateLimit: config.rateLimit
    });
  }

  private setupInterceptors(): void {
    // Request interceptor
    this.axiosInstance.interceptors.request.use(
      (config) => {
        config.metadata = { startTime: Date.now() };
        
        logger.debug(`HTTP request starting`, {
          type: 'http_request_start',
          service: this.config.serviceName,
          method: config.method?.toUpperCase(),
          url: config.url,
          headers: this.sanitizeHeaders(config.headers)
        });

        return config;
      },
      (error) => {
        logger.error(`HTTP request setup failed`, {
          type: 'http_request_setup_error',
          service: this.config.serviceName,
          error: error.message
        });
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.axiosInstance.interceptors.response.use(
      (response) => {
        const duration = Date.now() - (response.config.metadata?.startTime || Date.now());
        
        logger.debug(`HTTP request completed`, {
          type: 'http_request_success',
          service: this.config.serviceName,
          method: response.config.method?.toUpperCase(),
          url: response.config.url,
          status: response.status,
          duration
        });

        metrics.recordHistogram('http_request_duration', duration, {
          service: this.config.serviceName,
          method: response.config.method?.toUpperCase() || 'unknown',
          status: response.status.toString()
        });

        return response;
      },
      (error: AxiosError) => {
        const duration = error.config?.metadata?.startTime 
          ? Date.now() - error.config.metadata.startTime 
          : 0;

        logger.warn(`HTTP request failed`, {
          type: 'http_request_error',
          service: this.config.serviceName,
          method: error.config?.method?.toUpperCase(),
          url: error.config?.url,
          status: error.response?.status,
          error: error.message,
          duration
        });

        metrics.recordHistogram('http_request_duration', duration, {
          service: this.config.serviceName,
          method: error.config?.method?.toUpperCase() || 'unknown',
          status: error.response?.status?.toString() || 'error'
        });

        return Promise.reject(error);
      }
    );
  }

  private sanitizeHeaders(headers: any): any {
    if (!headers) return {};
    
    const sanitized = { ...headers };
    const sensitiveKeys = ['authorization', 'x-api-key', 'api-key', 'token'];
    
    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        sanitized[key] = '[REDACTED]';
      }
    }
    
    return sanitized;
  }

  private async enforceRateLimit(): Promise<void> {
    if (!this.config.rateLimit) return;

    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const minInterval = 1000 / this.config.rateLimit.requestsPerSecond;

    if (timeSinceLastRequest < minInterval) {
      const delay = minInterval - timeSinceLastRequest;
      
      logger.debug(`Rate limiting: waiting ${delay}ms`, {
        type: 'rate_limit_delay',
        service: this.config.serviceName,
        delay,
        requestsPerSecond: this.config.rateLimit.requestsPerSecond
      });

      await new Promise(resolve => setTimeout(resolve, delay));
    }

    this.lastRequestTime = Date.now();
  }

  private async executeRequest<T>(
    requestFn: () => Promise<AxiosResponse<T>>
  ): Promise<AxiosResponse<T>> {
    const metrics: RequestMetrics = {
      startTime: Date.now(),
      attempts: 0,
      circuitBreakerState: this.circuitBreaker.getState(),
      success: false
    };

    try {
      // Enforce rate limiting
      await this.enforceRateLimit();

      // Execute with circuit breaker and retry
      const retryConfig = this.config.retryConfig || retryConfigs.dexscreener;
      
      const result = await RetryUtility.execute(
        async () => {
          metrics.attempts++;
          return await this.circuitBreaker.execute(async () => {
            return await withHttpTimeout(
              requestFn(),
              this.config.timeout || timeoutConfigs.dexscreener.search,
              this.config.serviceName
            );
          });
        },
        {
          ...retryConfig,
          name: this.config.serviceName,
          onRetry: (error, attempt) => {
            logger.warn(`Retrying HTTP request`, {
              type: 'http_retry',
              service: this.config.serviceName,
              attempt,
              error: error.message,
              maxAttempts: retryConfig.maxAttempts
            });
          }
        }
      );

      metrics.endTime = Date.now();
      metrics.duration = metrics.endTime - metrics.startTime;
      metrics.success = true;
      metrics.statusCode = result.result.status;

      this.recordMetrics(metrics);
      return result.result;

    } catch (error) {
      metrics.endTime = Date.now();
      metrics.duration = metrics.endTime - metrics.startTime;
      metrics.success = false;
      metrics.error = (error as Error).message;
      
      if (error instanceof Error && 'response' in error) {
        metrics.statusCode = (error as any).response?.status;
      }

      this.recordMetrics(metrics);
      throw error;
    }
  }

  private recordMetrics(requestMetrics: RequestMetrics): void {
    metrics.recordHistogram('http_total_duration', requestMetrics.duration || 0, {
      service: this.config.serviceName,
      success: requestMetrics.success.toString(),
      attempts: requestMetrics.attempts.toString()
    });

    metrics.incrementCounter('http_requests_total', 1, {
      service: this.config.serviceName,
      success: requestMetrics.success.toString(),
      status: requestMetrics.statusCode?.toString() || 'unknown'
    });

    if (!requestMetrics.success) {
      metrics.incrementCounter('http_requests_failed', 1, {
        service: this.config.serviceName,
        error: requestMetrics.error || 'unknown'
      });
    }
  }

  // Public HTTP methods
  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.executeRequest(() => this.axiosInstance.get<T>(url, config));
  }

  async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.executeRequest(() => this.axiosInstance.post<T>(url, data, config));
  }

  async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.executeRequest(() => this.axiosInstance.put<T>(url, data, config));
  }

  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.executeRequest(() => this.axiosInstance.delete<T>(url, config));
  }

  async patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.executeRequest(() => this.axiosInstance.patch<T>(url, data, config));
  }

  // Convenience methods for common patterns
  async getJson<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.get<T>(url, config);
    return response.data;
  }

  async postJson<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.post<T>(url, data, config);
    return response.data;
  }

  // Health check method
  getHealthStatus() {
    return {
      service: this.config.serviceName,
      circuitBreaker: this.circuitBreaker.getStatus(),
      lastRequestTime: this.lastRequestTime > 0 ? new Date(this.lastRequestTime).toISOString() : null,
      queueSize: this.requestQueue.length,
      rateLimit: this.config.rateLimit
    };
  }

  // Manual controls
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
    logger.info(`Circuit breaker reset for ${this.config.serviceName}`, {
      type: 'circuit_breaker_manual_reset',
      service: this.config.serviceName
    });
  }

  openCircuitBreaker(): void {
    this.circuitBreaker.forceOpen();
    logger.warn(`Circuit breaker manually opened for ${this.config.serviceName}`, {
      type: 'circuit_breaker_manual_open',
      service: this.config.serviceName
    });
  }

  closeCircuitBreaker(): void {
    this.circuitBreaker.forceClose();
    logger.info(`Circuit breaker manually closed for ${this.config.serviceName}`, {
      type: 'circuit_breaker_manual_close',
      service: this.config.serviceName
    });
  }
}

// Factory function for creating pre-configured clients
export class HttpClientFactory {
  private static clients = new Map<string, ResilientHttpClient>();

  static createDexScreenerClient(): ResilientHttpClient {
    if (!this.clients.has('dexscreener')) {
      this.clients.set('dexscreener', new ResilientHttpClient({
        serviceName: 'dexscreener',
        baseURL: 'https://api.dexscreener.com/latest',
        timeout: timeoutConfigs.dexscreener.search,
        retryConfig: retryConfigs.dexscreener,
        circuitBreakerConfig: defaultCircuitBreakerConfigs.dexscreener,
        rateLimit: { requestsPerSecond: 5 }, // 300 rpm = 5 rps
        headers: {
          'Accept': 'application/json'
        }
      }));
    }
    return this.clients.get('dexscreener')!;
  }

  static createGoPlusClient(): ResilientHttpClient {
    if (!this.clients.has('goplus')) {
      this.clients.set('goplus', new ResilientHttpClient({
        serviceName: 'goplus',
        baseURL: 'https://api.gopluslabs.io/api/v1',
        timeout: timeoutConfigs.goplus.security,
        retryConfig: retryConfigs.goplus,
        circuitBreakerConfig: defaultCircuitBreakerConfigs.goplus,
        rateLimit: { requestsPerSecond: 0.5 }, // 30 rpm = 0.5 rps
        headers: {
          'Accept': 'application/json'
        }
      }));
    }
    return this.clients.get('goplus')!;
  }

  static createBirdeyeClient(): ResilientHttpClient {
    if (!this.clients.has('birdeye')) {
      this.clients.set('birdeye', new ResilientHttpClient({
        serviceName: 'birdeye',
        baseURL: 'https://public-api.birdeye.so',
        timeout: timeoutConfigs.birdeye.price,
        retryConfig: retryConfigs.birdeye,
        circuitBreakerConfig: defaultCircuitBreakerConfigs.birdeye,
        rateLimit: { requestsPerSecond: 1 }, // 1 rps on free plan
        headers: {
          'Accept': 'application/json',
          'X-API-KEY': process.env.BIRDEYE_API_KEY || ''
        }
      }));
    }
    return this.clients.get('birdeye')!;
  }

  static createCoinGeckoClient(): ResilientHttpClient {
    if (!this.clients.has('coingecko')) {
      this.clients.set('coingecko', new ResilientHttpClient({
        serviceName: 'coingecko',
        baseURL: 'https://api.coingecko.com/api/v3',
        timeout: timeoutConfigs.coingecko.search,
        retryConfig: retryConfigs.coingecko,
        circuitBreakerConfig: defaultCircuitBreakerConfigs.coingecko,
        rateLimit: { requestsPerSecond: 2 }, // Conservative rate
        headers: {
          'Accept': 'application/json'
        }
      }));
    }
    return this.clients.get('coingecko')!;
  }

  static getClient(serviceName: string): ResilientHttpClient | undefined {
    return this.clients.get(serviceName);
  }

  static getAllClients(): ResilientHttpClient[] {
    return Array.from(this.clients.values());
  }

  static getHealthStatus() {
    return Array.from(this.clients.values()).map(client => client.getHealthStatus());
  }
}

// Export convenience instances
export const dexScreenerClient = HttpClientFactory.createDexScreenerClient();
export const goPlusClient = HttpClientFactory.createGoPlusClient();
export const birdeyeClient = HttpClientFactory.createBirdeyeClient();
export const coinGeckoClient = HttpClientFactory.createCoinGeckoClient();