"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheManager = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const logger_1 = require("./logger");
class CacheManager {
    constructor() {
        this.redis = null;
        this.memoryCache = new Map();
        this.cleanupInterval = null;
        this.initializeRedis();
        this.startCleanupInterval();
    }
    initializeRedis() {
        const redisUrl = process.env.REDIS_URL;
        if (redisUrl) {
            try {
                this.redis = new ioredis_1.default(redisUrl, {
                    maxRetriesPerRequest: 3,
                    lazyConnect: true,
                });
                this.redis.on('connect', () => {
                    logger_1.logger.info('Connected to Redis cache');
                });
                this.redis.on('error', (error) => {
                    logger_1.logger.warn('Redis connection error, falling back to memory cache:', error);
                    this.redis = null;
                });
                this.redis.on('close', () => {
                    logger_1.logger.warn('Redis connection closed, using memory cache');
                });
            }
            catch (error) {
                logger_1.logger.warn('Failed to initialize Redis, using memory cache:', error);
                this.redis = null;
            }
        }
        else {
            logger_1.logger.info('No Redis URL provided, using memory cache');
        }
    }
    startCleanupInterval() {
        this.cleanupInterval = setInterval(() => {
            this.cleanupMemoryCache();
        }, 5 * 60 * 1000);
    }
    cleanupMemoryCache() {
        const now = Date.now();
        let cleaned = 0;
        for (const [key, entry] of this.memoryCache.entries()) {
            if (now > entry.timestamp + entry.ttl) {
                this.memoryCache.delete(key);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            logger_1.logger.debug(`Cleaned up ${cleaned} expired cache entries`);
        }
    }
    async get(key) {
        try {
            if (this.redis) {
                const value = await this.redis.get(key);
                if (value) {
                    const parsed = JSON.parse(value);
                    return parsed.data;
                }
            }
            const entry = this.memoryCache.get(key);
            if (entry) {
                const now = Date.now();
                if (now <= entry.timestamp + entry.ttl) {
                    return entry.data;
                }
                else {
                    this.memoryCache.delete(key);
                }
            }
            return null;
        }
        catch (error) {
            logger_1.logger.error('Cache get error:', error);
            return null;
        }
    }
    async set(key, value, ttlSeconds = 300) {
        try {
            const ttlMs = ttlSeconds * 1000;
            const entry = {
                data: value,
                timestamp: Date.now(),
                ttl: ttlMs,
            };
            if (this.redis) {
                await this.redis.setex(key, ttlSeconds, JSON.stringify(entry));
            }
            this.memoryCache.set(key, entry);
        }
        catch (error) {
            logger_1.logger.error('Cache set error:', error);
            const entry = {
                data: value,
                timestamp: Date.now(),
                ttl: ttlSeconds * 1000,
            };
            this.memoryCache.set(key, entry);
        }
    }
    async delete(key) {
        try {
            if (this.redis) {
                await this.redis.del(key);
            }
            this.memoryCache.delete(key);
        }
        catch (error) {
            logger_1.logger.error('Cache delete error:', error);
        }
    }
    async exists(key) {
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
                }
                else {
                    this.memoryCache.delete(key);
                }
            }
            return false;
        }
        catch (error) {
            logger_1.logger.error('Cache exists error:', error);
            return false;
        }
    }
    async clear() {
        try {
            if (this.redis) {
                await this.redis.flushdb();
            }
            this.memoryCache.clear();
            logger_1.logger.info('Cache cleared');
        }
        catch (error) {
            logger_1.logger.error('Cache clear error:', error);
        }
    }
    async getKeys(pattern) {
        try {
            if (this.redis) {
                return await this.redis.keys(pattern);
            }
            const keys = [];
            const regex = new RegExp(pattern.replace(/\*/g, '.*'));
            for (const key of this.memoryCache.keys()) {
                if (regex.test(key)) {
                    keys.push(key);
                }
            }
            return keys;
        }
        catch (error) {
            logger_1.logger.error('Cache getKeys error:', error);
            return [];
        }
    }
    async mget(keys) {
        const results = [];
        for (const key of keys) {
            const value = await this.get(key);
            results.push(value);
        }
        return results;
    }
    async mset(entries) {
        for (const entry of entries) {
            await this.set(entry.key, entry.value, entry.ttl);
        }
    }
    async cacheTokenData(chainId, address, data, ttlSeconds = 60) {
        const key = `token:${chainId}:${address}`;
        await this.set(key, data, ttlSeconds);
    }
    async getTokenData(chainId, address) {
        const key = `token:${chainId}:${address}`;
        return await this.get(key);
    }
    async cacheSecurityReport(address, report, ttlSeconds = 3600) {
        const key = `security:${address}`;
        await this.set(key, report, ttlSeconds);
    }
    async getSecurityReport(address) {
        const key = `security:${address}`;
        return await this.get(key);
    }
    async cacheHotlist(category, data, ttlSeconds = 30) {
        const key = `hotlist:${category}`;
        await this.set(key, data, ttlSeconds);
    }
    async getHotlist(category) {
        const key = `hotlist:${category}`;
        return await this.get(key);
    }
    async cacheRateLimit(service, remaining, resetTime) {
        const key = `ratelimit:${service}`;
        const data = { remaining, resetTime };
        const ttl = Math.max(1, Math.floor((resetTime - Date.now()) / 1000));
        await this.set(key, data, ttl);
    }
    async getRateLimit(service) {
        const key = `ratelimit:${service}`;
        return await this.get(key);
    }
    getStats() {
        return {
            memoryEntries: this.memoryCache.size,
            redisConnected: this.redis?.status === 'ready',
        };
    }
    async disconnect() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        if (this.redis) {
            await this.redis.quit();
        }
        this.memoryCache.clear();
        logger_1.logger.info('Cache manager disconnected');
    }
}
exports.CacheManager = CacheManager;
//# sourceMappingURL=cache.js.map