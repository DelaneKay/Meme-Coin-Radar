import { CacheManager } from '../utils/cache';
import { TokenSummary, DexScreenerPair, SecurityReport, ScoringSignals, LeaderboardCategory } from '../types';
export declare class Scorer {
    private cache;
    private isRunning;
    private leaderboards;
    private priceHistory;
    private volumeHistory;
    constructor(cache: CacheManager);
    start(): Promise<void>;
    stop(): Promise<void>;
    private initializeLeaderboards;
    computeSignals(pair: DexScreenerPair, security: SecurityReport): ScoringSignals;
    private calculateVolumeSurge;
    private calculatePriceAcceleration;
    private calculateLiquidityQuality;
    private calculateAgeFactor;
    calculateScore(signals: ScoringSignals): {
        score: number;
        reasons: string[];
    };
    private normalizeToZScore;
    generateTokenSummary(pair: DexScreenerPair, security: SecurityReport, listingBoost?: number): TokenSummary;
    private mapChainId;
    private generateChartLink;
    updateLeaderboards(tokens: TokenSummary[]): Promise<void>;
    private generateNewMintsLeaderboard;
    private generateMomentum5mLeaderboard;
    private generateContinuation15mLeaderboard;
    private generateUnusualVolumeLeaderboard;
    getLeaderboard(category: LeaderboardCategory): Promise<TokenSummary[]>;
    getAllLeaderboards(): Promise<Record<LeaderboardCategory, TokenSummary[]>>;
    getTopTokens(limit?: number): Promise<TokenSummary[]>;
    getHealthStatus(): {
        status: 'up' | 'down' | 'degraded';
        lastCheck: number;
        error?: string;
    };
}
//# sourceMappingURL=scorer.d.ts.map