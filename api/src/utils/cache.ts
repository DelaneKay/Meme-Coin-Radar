import Redis from 'ioredis';
import { logger } from './logger';
import { CacheEntry } from '../types';

export class CacheManager {
  private redis: Redis | null = null;
  private memoryCache: Map<string, CacheEntry<any>> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.initializeRedis();
    this.startCleanupInterval();
  }

  private initializeRedis() {
    const redisUrl = process.env.REDIS_URL;
    
    if (redisUrl) {
      try {
        this.redis = new Redis(redisUrl, {
          maxRetriesPerRequest: 3,
          lazyConnect: true,
        });

        this.redis.on('connect', () => {
          logger.info('Connected to Redis cache');
        });

        this.redis.on('error', (error) => {
          logger.warn('Redis connection error, falling back to memory cache:', error);
          this.redis = null;
        });

        this.redis.on('close', () => {
          logger.warn('Redis connection closed, using memory cache');
        });
      } catch (error) {
        logger.warn('Failed to initialize Redis, using memory cache:', error);
        this.redis = null;
      }
    } else {
      logger.info('No Redis URL provided, using memory cache');
    }
  }

  private startCleanupInterval() {
    // Clean up expired memory cache entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupMemoryCache();
    }, 5 * 60 * 1000);
  }

  private cleanupMemoryCache() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of Array.from(this.memoryCache.entries())) {
      if (now > entry.timestamp + entry.ttl) {
        this.memoryCache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cleaned up ${cleaned} expired cache entries`);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      // Try Redis first
      if (this.redis) {
        const value = await this.redis.get(key);
        if (value) {
          const parsed = JSON.parse(value);
          return parsed.data;
        }
      }

      // Fall back to memory cache
      const entry = this.memoryCache.get(key);
      if (entry) {
        const now = Date.now();
        if (now <= entry.timestamp + entry.ttl) {
          return entry.data;
        } else {
          this.memoryCache.delete(key);
        }
      }

      return null;
    } catch (error) {
      logger.error('Cache get error:', error);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number = 300): Promise<void> {
    try {
      const ttlMs = ttlSeconds * 1000;
      const entry: CacheEntry<T> = {
        data: value,
        timestamp: Date.now(),
        ttl: ttlMs,
      };

      // Try Redis first
      if (this.redis) {
        await this.redis.setex(key, ttlSeconds, JSON.stringify(entry));
      }

      // Always store in memory cache as backup
      this.memoryCache.set(key, entry);
    } catch (error) {
      logger.error('Cache set error:', error);
      // Still store in memory cache if Redis fails
      const entry: CacheEntry<T> = {
        data: value,
        timestamp: Date.now(),
        ttl: ttlSeconds * 1000,
      };
      this.memoryCache.set(key, entry);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      if (this.redis) {
        await this.redis.del(key);
      }
      this.memoryCache.delete(key);
    } catch (error) {
      logger.error('Cache delete error:', error);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      if (this.redis) {
        const exists = await this.redis.exists(key);
        return exists === 1;
      }

      const entry = this.memoryCache.get(key);
      if (entry) {
        const now = Date.now();
        if (now <= entry.timestamp + entry.ttl) {
          return true;
        } else {
          this.memoryCache.delete(key);
        }
      }

      return false;
    } catch (error) {
      logger.error('Cache exists error:', error);
      return false;
    }
  }

  async clear(): Promise<void> {
    try {
      if (this.redis) {
        await this.redis.flushdb();
      }
      this.memoryCache.clear();
      logger.info('Cache cleared');
    } catch (error) {
      logger.error('Cache clear error:', error);
    }
  }

  async getKeys(pattern: string): Promise<string[]> {
    try {
      if (this.redis) {
        return await this.redis.keys(pattern);
      }

      // For memory cache, do simple pattern matching
      const keys: string[] = [];
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      
      for (const key of Array.from(this.memoryCache.keys())) {
        if (regex.test(key)) {
          keys.push(key);
        }
      }

      return keys;
    } catch (error) {
      logger.error('Cache getKeys error:', error);
      return [];
    }
  }

  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    const results: (T | null)[] = [];

    for (const key of keys) {
      const value = await this.get<T>(key);
      results.push(value);
    }

    return results;
  }

  async mset<T>(entries: { key: string; value: T; ttl?: number }[]): Promise<void> {
    for (const entry of entries) {
      await this.set(entry.key, entry.value, entry.ttl);
    }
  }

  // Specialized cache methods for the radar system
  async cacheTokenData(chainId: string, address: string, data: any, ttlSeconds: number = 60): Promise<void> {
    const key = `token:${chainId}:${address}`;
    await this.set(key, data, ttlSeconds);
  }

  async getTokenData(chainId: string, address: string): Promise<any | null> {
    const key = `token:${chainId}:${address}`;
    return await this.get(key);
  }

  async cacheSecurityReport(address: string, report: any, ttlSeconds: number = 3600): Promise<void> {
    const key = `security:${address}`;
    await this.set(key, report, ttlSeconds);
  }

  async getSecurityReport(address: string): Promise<any | null> {
    const key = `security:${address}`;
    return await this.get(key);
  }

  async cacheHotlist(category: string, data: any, ttlSeconds: number = 30): Promise<void> {
    const key = `hotlist:${category}`;
    await this.set(key, data, ttlSeconds);
  }

  async getHotlist(category: string): Promise<any | null> {
    const key = `hotlist:${category}`;
    return await this.get(key);
  }

  async cacheRateLimit(service: string, remaining: number, resetTime: number): Promise<void> {
    const key = `ratelimit:${service}`;
    const data = { remaining, resetTime };
    const ttl = Math.max(1, Math.floor((resetTime - Date.now()) / 1000));
    await this.set(key, data, ttl);
  }

  async getRateLimit(service: string): Promise<{ remaining: number; resetTime: number } | null> {
    const key = `ratelimit:${service}`;
    return await this.get(key);
  }

  async increment(key: string, value: number = 1, ttlSeconds?: number): Promise<number> {
    try {
      if (this.redis) {
        const result = await this.redis.incr(key);
        if (ttlSeconds && result === 1) {
          // Set TTL only if this is the first increment
          await this.redis.expire(key, ttlSeconds);
        }
        return result;
      }

      // Fall back to memory cache
      const entry = this.memoryCache.get(key);
      let currentValue = 0;
      
      if (entry) {
        const now = Date.now();
        if (now <= entry.timestamp + entry.ttl) {
          currentValue = entry.data || 0;
        }
      }
      
      const newValue = currentValue + value;
      const ttlMs = ttlSeconds ? ttlSeconds * 1000 : 3600 * 1000; // Default 1 hour
      
      this.memoryCache.set(key, {
        data: newValue,
        timestamp: Date.now(),
        ttl: ttlMs,
      });
      
      return newValue;
    } catch (error) {
      logger.error('Cache increment error:', error);
      return 0;
    }
  }

  getClient(): Redis | null {
    return this.redis;
  }

  getStats(): { memoryEntries: number; redisConnected: boolean } {
    return {
      memoryEntries: this.memoryCache.size,
      redisConnected: this.redis?.status === 'ready',
    };
  }

  async disconnect(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    if (this.redis) {
      await this.redis.quit();
    }

    this.memoryCache.clear();
    logger.info('Cache manager disconnected');
  }
}

// Global cache instance
export const cache = new CacheManager();