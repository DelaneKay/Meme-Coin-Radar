import Redis from 'ioredis';
import { logger } from './logger';

// Redis configuration
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB || '0'),
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  keepAlive: 30000,
  connectTimeout: 10000,
  commandTimeout: 5000,
};

// Create Redis client instance
export const redisClient = new Redis(redisConfig);

// Redis connection event handlers
redisClient.on('connect', () => {
  logger.info('Redis client connected');
});

redisClient.on('ready', () => {
  logger.info('Redis client ready');
});

redisClient.on('error', (error) => {
  logger.error('Redis client error', { error: error.message });
});

redisClient.on('close', () => {
  logger.warn('Redis client connection closed');
});

redisClient.on('reconnecting', () => {
  logger.info('Redis client reconnecting');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Closing Redis connection...');
  await redisClient.quit();
});

process.on('SIGINT', async () => {
  logger.info('Closing Redis connection...');
  await redisClient.quit();
});

// Helper functions
export const setWithExpiry = async (key: string, value: string, ttlSeconds: number): Promise<void> => {
  await redisClient.setex(key, ttlSeconds, value);
};

export const getFromCache = async (key: string): Promise<string | null> => {
  return await redisClient.get(key);
};

export const deleteFromCache = async (key: string): Promise<void> => {
  await redisClient.del(key);
};

export const incrementCounter = async (key: string, increment: number = 1): Promise<number> => {
  return await redisClient.incrby(key, increment);
};

export const setHash = async (key: string, field: string, value: string): Promise<void> => {
  await redisClient.hset(key, field, value);
};

export const getHash = async (key: string, field: string): Promise<string | null> => {
  return await redisClient.hget(key, field);
};

export const getAllHash = async (key: string): Promise<Record<string, string>> => {
  return await redisClient.hgetall(key);
};

export const addToSet = async (key: string, member: string): Promise<void> => {
  await redisClient.sadd(key, member);
};

export const removeFromSet = async (key: string, member: string): Promise<void> => {
  await redisClient.srem(key, member);
};

export const isInSet = async (key: string, member: string): Promise<boolean> => {
  const result = await redisClient.sismember(key, member);
  return result === 1;
};

export const getSetMembers = async (key: string): Promise<string[]> => {
  return await redisClient.smembers(key);
};

export default redisClient;