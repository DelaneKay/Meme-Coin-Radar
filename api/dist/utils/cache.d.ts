export declare class CacheManager {
    private redis;
    private memoryCache;
    private cleanupInterval;
    constructor();
    private initializeRedis;
    private startCleanupInterval;
    private cleanupMemoryCache;
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
    delete(key: string): Promise<void>;
    exists(key: string): Promise<boolean>;
    clear(): Promise<void>;
    getKeys(pattern: string): Promise<string[]>;
    mget<T>(keys: string[]): Promise<(T | null)[]>;
    mset<T>(entries: {
        key: string;
        value: T;
        ttl?: number;
    }[]): Promise<void>;
    cacheTokenData(chainId: string, address: string, data: any, ttlSeconds?: number): Promise<void>;
    getTokenData(chainId: string, address: string): Promise<any | null>;
    cacheSecurityReport(address: string, report: any, ttlSeconds?: number): Promise<void>;
    getSecurityReport(address: string): Promise<any | null>;
    cacheHotlist(category: string, data: any, ttlSeconds?: number): Promise<void>;
    getHotlist(category: string): Promise<any | null>;
    cacheRateLimit(service: string, remaining: number, resetTime: number): Promise<void>;
    getRateLimit(service: string): Promise<{
        remaining: number;
        resetTime: number;
    } | null>;
    getStats(): {
        memoryEntries: number;
        redisConnected: boolean;
    };
    disconnect(): Promise<void>;
}
//# sourceMappingURL=cache.d.ts.map