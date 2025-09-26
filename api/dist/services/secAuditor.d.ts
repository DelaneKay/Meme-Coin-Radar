import { CacheManager } from '../utils/cache';
import { RateLimitManager } from '../utils/rateLimiter';
import { SecurityReport, ChainId } from '../types';
export declare class SecAuditor {
    private cache;
    private rateLimiter;
    private isRunning;
    private maxConcurrentChecks;
    constructor(cache: CacheManager, rateLimiter: RateLimitManager);
    start(): Promise<void>;
    stop(): Promise<void>;
    analyzeToken(address: string, chainId: ChainId): Promise<SecurityReport>;
    analyzeBatch(tokens: {
        address: string;
        chainId: ChainId;
    }[]): Promise<SecurityReport[]>;
    private getGoPlusSecurityData;
    private getHoneypotIsData;
    private getHoneypotChainId;
    private generateSecurityReport;
    private parseGoPlusFlags;
    getSecuritySummary(addresses: string[]): Promise<{
        safe: number;
        risky: number;
        unknown: number;
    }>;
    isTokenSafe(report: SecurityReport): boolean;
    getSecurityScore(report: SecurityReport): number;
    getHealthStatus(): {
        status: 'up' | 'down' | 'degraded';
        lastCheck: number;
        error?: string;
    };
    filterSafeTokens(tokens: {
        address: string;
        chainId: ChainId;
    }[]): Promise<{
        address: string;
        chainId: ChainId;
    }[]>;
    getSecurityFlags(address: string, chainId: ChainId): Promise<string[]>;
}
//# sourceMappingURL=secAuditor.d.ts.map