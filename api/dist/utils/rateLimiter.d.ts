import { RateLimitStatus } from '../types';
interface RateLimitConfig {
    requestsPerSecond?: number;
    requestsPerMinute?: number;
    requestsPerHour?: number;
    burstSize?: number;
}
export declare class RateLimitManager {
    private limits;
    private states;
    private cleanupInterval;
    constructor();
    private initializeDefaults;
    private startCleanup;
    setLimit(service: string, config: RateLimitConfig): void;
    canMakeRequest(service: string): Promise<boolean>;
    recordRequest(service: string): Promise<void>;
    waitForAvailability(service: string, maxWaitMs?: number): Promise<boolean>;
    private calculateWaitTime;
    blockService(service: string, durationMs: number, reason?: string): void;
    unblockService(service: string): void;
    getStatus(service: string): RateLimitStatus | null;
    getAllStatuses(): RateLimitStatus[];
    handle429Response(service: string, retryAfterSeconds?: number): void;
    private getExponentialBackoff;
    shutdown(): void;
}
export {};
//# sourceMappingURL=rateLimiter.d.ts.map