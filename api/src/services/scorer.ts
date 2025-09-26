import { scorerLogger as logger, logError, logPerformance } from '../utils/logger';
import { CacheManager } from '../utils/cache';
import { 
  TokenSummary, 
  DexScreenerPair, 
  SecurityReport, 
  ScoringSignals, 
  LeaderboardCategory,
  ChainId 
} from '../types';

interface TokenMetrics {
  pair: DexScreenerPair;
  security: SecurityReport;
  signals: ScoringSignals;
  score: number;
  reasons: string[];
}

interface LeaderboardEntry {
  category: LeaderboardCategory;
  tokens: TokenSummary[];
  lastUpdated: number;
}

export class Scorer {
  private cache: CacheManager;
  private isRunning: boolean = false;
  private leaderboards: Map<LeaderboardCategory, TokenSummary[]> = new Map();
  private priceHistory: Map<string, number[]> = new Map();
  private volumeHistory: Map<string, number[]> = new Map();

  constructor(cache: CacheManager) {
    this.cache = cache;
    this.initializeLeaderboards();
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    
    this.isRunning = true;
    logger.info('Scorer started');
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    logger.info('Scorer stopped');
  }

  private initializeLeaderboards(): void {
    const categories: LeaderboardCategory[] = ['new_mints', 'momentum_5m', 'continuation_15m', 'unusual_volume'];
    categories.forEach(category => {
      this.leaderboards.set(category, []);
    });
  }

  // =============================================================================
  // SIGNAL COMPUTATION
  // =============================================================================

  computeSignals(pair: DexScreenerPair, security: SecurityReport): ScoringSignals {
    const tokenKey = `${pair.chainId}:${pair.baseToken.address}`;
    
    // 1. Imbalance5 = (buys5 - sells5) / max(1, buys5+sells5)
    const buys5 = pair.txns.m5.buys || 0;
    const sells5 = pair.txns.m5.sells || 0;
    const imbalance5 = (buys5 - sells5) / Math.max(1, buys5 + sells5);

    // 2. Surge15 = vol15 / baseline(vol15 over prior 2-4h)
    const vol15 = pair.volume.m5 * 3; // Approximate 15min volume from 5min
    const surge15 = this.calculateVolumeSurge(tokenKey, vol15);

    // 3. PriceAccel = z-score of 1m/5m slope
    const priceAccel = this.calculatePriceAcceleration(tokenKey, parseFloat(pair.priceUsd));

    // 4. LiquidityQuality = log(liquidityUsd) + stability bonus
    const liquidityQuality = this.calculateLiquidityQuality(pair);

    // 5. AgeFactor = prefer 2-48h
    const ageFactor = this.calculateAgeFactor(pair);

    // 6. Security penalty
    const securityPenalty = security.penalty;

    // 7. Listing boost (applied by orchestrator)
    const listingBoost = 0; // Will be set by orchestrator for CEX listings

    return {
      imbalance5,
      surge15,
      priceAccel,
      liquidityQuality,
      ageFactor,
      securityPenalty,
      listingBoost,
    };
  }

  private calculateVolumeSurge(tokenKey: string, currentVolume: number): number {
    const history = this.volumeHistory.get(tokenKey) || [];
    
    // Add current volume to history
    history.push(currentVolume);
    
    // Keep only last 24 data points (2-4 hours of 5-minute intervals)
    if (history.length > 24) {
      history.shift();
    }
    
    this.volumeHistory.set(tokenKey, history);

    // Calculate baseline (average of historical volumes)
    if (history.length < 3) {
      return 1; // Not enough data
    }

    const baseline = history.slice(0, -1).reduce((sum, vol) => sum + vol, 0) / (history.length - 1);
    
    if (baseline === 0) {
      return currentVolume > 0 ? 10 : 1; // High surge if volume appears from nothing
    }

    return currentVolume / baseline;
  }

  private calculatePriceAcceleration(tokenKey: string, currentPrice: number): number {
    const history = this.priceHistory.get(tokenKey) || [];
    
    // Add current price to history
    history.push(currentPrice);
    
    // Keep only last 10 data points (for 1m and 5m slopes)
    if (history.length > 10) {
      history.shift();
    }
    
    this.priceHistory.set(tokenKey, history);

    if (history.length < 6) {
      return 0; // Not enough data for acceleration
    }

    // Calculate 1-minute slope (last 2 points)
    const slope1m = history.length >= 2 ? 
      (history[history.length - 1] - history[history.length - 2]) / history[history.length - 2] : 0;

    // Calculate 5-minute slope (last 6 points)
    const slope5m = history.length >= 6 ? 
      (history[history.length - 1] - history[history.length - 6]) / history[history.length - 6] : 0;

    // Simple acceleration metric (difference in slopes)
    const acceleration = slope1m - slope5m;

    // Convert to z-score-like metric (simplified)
    return Math.max(-3, Math.min(3, acceleration * 100));
  }

  private calculateLiquidityQuality(pair: DexScreenerPair): number {
    const liquidityUsd = pair.liquidity?.usd || 0;
    
    if (liquidityUsd <= 0) {
      return 0;
    }

    // Base score from log of liquidity
    let score = Math.log10(liquidityUsd);

    // Stability bonus (simplified - based on volume/liquidity ratio)
    const volume24h = pair.volume.h24 || 0;
    const turnoverRatio = volume24h / liquidityUsd;
    
    // Prefer moderate turnover (not too high, not too low)
    if (turnoverRatio > 0.1 && turnoverRatio < 5) {
      score += 1; // Stability bonus
    } else if (turnoverRatio > 10) {
      score -= 0.5; // Penalty for excessive turnover
    }

    return Math.max(0, score);
  }

  private calculateAgeFactor(pair: DexScreenerPair): number {
    if (!pair.pairCreatedAt) {
      return 0; // Unknown age
    }

    const ageMs = Date.now() - (pair.pairCreatedAt * 1000);
    const ageHours = ageMs / (1000 * 60 * 60);

    // Prefer tokens between 2-48 hours old
    if (ageHours < 2) {
      return Math.max(0, ageHours / 2); // Ramp up from 0 to 1
    } else if (ageHours <= 48) {
      return 1; // Optimal age range
    } else {
      return Math.max(0, 1 - (ageHours - 48) / 48); // Decay after 48h
    }
  }

  // =============================================================================
  // SCORE CALCULATION
  // =============================================================================

  calculateScore(signals: ScoringSignals): { score: number; reasons: string[] } {
    const reasons: string[] = [];
    
    // Normalize signals to z-scores for some components
    const zSurge15 = this.normalizeToZScore(signals.surge15, 1, 2); // Mean=1, StdDev=2
    const zPriceAccel = signals.priceAccel; // Already normalized

    // Score = 28*Imbalance5 + 28*Z(Surge15) + 16*Z(PriceAccel) + 18*LiquidityQuality + 10*AgeFactor - Penalties + ListingBoost
    let score = 0;

    // Imbalance component (28 points max)
    const imbalanceScore = 28 * Math.max(0, signals.imbalance5);
    score += imbalanceScore;
    if (signals.imbalance5 > 0.3) {
      reasons.push(`Strong buy pressure (${(signals.imbalance5 * 100).toFixed(1)}%)`);
    }

    // Volume surge component (28 points max)
    const surgeScore = 28 * Math.max(0, Math.min(1, zSurge15 / 3)); // Cap at 3 std devs
    score += surgeScore;
    if (signals.surge15 > 2) {
      reasons.push(`Volume surge ${signals.surge15.toFixed(1)}x`);
    }

    // Price acceleration component (16 points max)
    const accelScore = 16 * Math.max(0, Math.min(1, (zPriceAccel + 3) / 6)); // Normalize -3 to +3 range
    score += accelScore;
    if (signals.priceAccel > 1) {
      reasons.push('Price acceleration detected');
    }

    // Liquidity quality component (18 points max)
    const liquidityScore = 18 * Math.max(0, Math.min(1, signals.liquidityQuality / 6)); // Cap at log10(1M) = 6
    score += liquidityScore;
    if (signals.liquidityQuality > 4) {
      reasons.push('High liquidity quality');
    }

    // Age factor component (10 points max)
    const ageScore = 10 * signals.ageFactor;
    score += ageScore;
    if (signals.ageFactor > 0.8) {
      reasons.push('Optimal age range');
    }

    // Apply penalties
    score -= signals.securityPenalty;
    if (signals.securityPenalty > 0) {
      reasons.push(`Security penalty: -${signals.securityPenalty}`);
    }

    // Apply listing boost
    score += signals.listingBoost;
    if (signals.listingBoost > 0) {
      reasons.push(`CEX listing boost: +${signals.listingBoost}`);
    }

    // Ensure score is between 0-100
    const finalScore = Math.max(0, Math.min(100, score));

    return { score: finalScore, reasons };
  }

  private normalizeToZScore(value: number, mean: number, stdDev: number): number {
    return (value - mean) / stdDev;
  }

  // =============================================================================
  // TOKEN SUMMARY GENERATION
  // =============================================================================

  generateTokenSummary(pair: DexScreenerPair, security: SecurityReport, listingBoost: number = 0): TokenSummary {
    const signals = this.computeSignals(pair, security);
    signals.listingBoost = listingBoost; // Apply any listing boost
    
    const { score, reasons } = this.calculateScore(signals);

    const ageMinutes = pair.pairCreatedAt ? 
      Math.floor((Date.now() - pair.pairCreatedAt * 1000) / (1000 * 60)) : 0;

    return {
      chainId: this.mapChainId(pair.chainId),
      token: {
        address: pair.baseToken.address,
        symbol: pair.baseToken.symbol,
        name: pair.baseToken.name,
      },
      pairAddress: pair.pairAddress,
      priceUsd: parseFloat(pair.priceUsd),
      buys5: pair.txns.m5.buys,
      sells5: pair.txns.m5.sells,
      vol5Usd: pair.volume.m5,
      vol15Usd: pair.volume.m5 * 3, // Approximate
      liquidityUsd: pair.liquidity?.usd || 0,
      fdvUsd: pair.fdv,
      ageMinutes,
      score,
      reasons,
      security: {
        ok: security.security_ok,
        flags: security.flags,
      },
      links: {
        dexscreener: pair.url,
        chart: this.generateChartLink(pair),
      },
    };
  }

  private mapChainId(dexScreenerChainId: string): ChainId {
    const chainMap: Record<string, ChainId> = {
      'solana': 'sol',
      'ethereum': 'eth',
      'bsc': 'bsc',
      'base': 'base',
    };
    return chainMap[dexScreenerChainId] || 'eth';
  }

  private generateChartLink(pair: DexScreenerPair): string {
    // Generate appropriate chart links based on chain
    const chainId = this.mapChainId(pair.chainId);
    
    switch (chainId) {
      case 'sol':
        return `https://dexscreener.com/solana/${pair.pairAddress}`;
      case 'eth':
        return `https://dexscreener.com/ethereum/${pair.pairAddress}`;
      case 'bsc':
        return `https://dexscreener.com/bsc/${pair.pairAddress}`;
      case 'base':
        return `https://dexscreener.com/base/${pair.pairAddress}`;
      default:
        return pair.url;
    }
  }

  // =============================================================================
  // LEADERBOARD MANAGEMENT
  // =============================================================================

  async updateLeaderboards(tokens: TokenSummary[]): Promise<void> {
    const startTime = Date.now();

    try {
      // Filter tokens based on minimum criteria
      const minLiquidity = parseInt(process.env.MIN_LIQUIDITY_LIST || '12000');
      const maxAge = parseInt(process.env.MAX_AGE_HOURS || '48') * 60; // Convert to minutes
      const minScore = 55;

      const eligibleTokens = tokens.filter(token => 
        token.liquidityUsd >= minLiquidity &&
        token.ageMinutes <= maxAge &&
        token.score >= minScore &&
        token.security.ok
      );

      // Generate leaderboards
      await this.generateNewMintsLeaderboard(eligibleTokens);
      await this.generateMomentum5mLeaderboard(eligibleTokens);
      await this.generateContinuation15mLeaderboard(eligibleTokens);
      await this.generateUnusualVolumeLeaderboard(eligibleTokens);

      // Cache leaderboards
      for (const [category, tokens] of this.leaderboards.entries()) {
        await this.cache.cacheHotlist(category, tokens, 30);
      }

      const duration = Date.now() - startTime;
      logPerformance('updateLeaderboards', duration, { 
        totalTokens: tokens.length, 
        eligibleTokens: eligibleTokens.length 
      });

    } catch (error) {
      logError(error as Error, 'Failed to update leaderboards');
    }
  }

  private async generateNewMintsLeaderboard(tokens: TokenSummary[]): Promise<void> {
    // Sort by age (newest first) and score
    const newMints = tokens
      .filter(token => token.ageMinutes <= 120) // Last 2 hours
      .sort((a, b) => {
        // Primary sort: age (newer first)
        const ageDiff = a.ageMinutes - b.ageMinutes;
        if (Math.abs(ageDiff) > 30) return ageDiff; // If age difference > 30min, sort by age
        
        // Secondary sort: score (higher first)
        return b.score - a.score;
      })
      .slice(0, 50);

    this.leaderboards.set('new_mints', newMints);
  }

  private async generateMomentum5mLeaderboard(tokens: TokenSummary[]): Promise<void> {
    // Sort by 5-minute momentum indicators
    const momentum = tokens
      .filter(token => token.buys5 > token.sells5) // Only tokens with buy pressure
      .sort((a, b) => {
        const aImbalance = (a.buys5 - a.sells5) / Math.max(1, a.buys5 + a.sells5);
        const bImbalance = (b.buys5 - b.sells5) / Math.max(1, b.buys5 + b.sells5);
        
        // Primary sort: imbalance
        const imbalanceDiff = bImbalance - aImbalance;
        if (Math.abs(imbalanceDiff) > 0.1) return imbalanceDiff;
        
        // Secondary sort: volume
        return b.vol5Usd - a.vol5Usd;
      })
      .slice(0, 50);

    this.leaderboards.set('momentum_5m', momentum);
  }

  private async generateContinuation15mLeaderboard(tokens: TokenSummary[]): Promise<void> {
    // Sort by 15-minute continuation patterns
    const continuation = tokens
      .filter(token => token.vol15Usd > token.vol5Usd * 2) // Volume increasing
      .sort((a, b) => {
        const aRatio = a.vol15Usd / Math.max(1, a.vol5Usd);
        const bRatio = b.vol15Usd / Math.max(1, b.vol5Usd);
        
        // Primary sort: volume ratio
        const ratioDiff = bRatio - aRatio;
        if (Math.abs(ratioDiff) > 0.5) return ratioDiff;
        
        // Secondary sort: score
        return b.score - a.score;
      })
      .slice(0, 50);

    this.leaderboards.set('continuation_15m', continuation);
  }

  private async generateUnusualVolumeLeaderboard(tokens: TokenSummary[]): Promise<void> {
    // Sort by unusual volume patterns
    const unusual = tokens
      .filter(token => {
        const turnover = token.vol15Usd / Math.max(1, token.liquidityUsd);
        return turnover > 0.5 && turnover < 20; // Unusual but not excessive
      })
      .sort((a, b) => {
        const aTurnover = a.vol15Usd / Math.max(1, a.liquidityUsd);
        const bTurnover = b.vol15Usd / Math.max(1, b.liquidityUsd);
        
        return bTurnover - aTurnover;
      })
      .slice(0, 50);

    this.leaderboards.set('unusual_volume', unusual);
  }

  // =============================================================================
  // PUBLIC API METHODS
  // =============================================================================

  async getLeaderboard(category: LeaderboardCategory): Promise<TokenSummary[]> {
    // Try cache first
    const cached = await this.cache.getHotlist(category);
    if (cached) {
      return cached;
    }

    // Fall back to in-memory
    return this.leaderboards.get(category) || [];
  }

  async getAllLeaderboards(): Promise<Record<LeaderboardCategory, TokenSummary[]>> {
    const result: Record<LeaderboardCategory, TokenSummary[]> = {} as any;
    
    const categories: LeaderboardCategory[] = ['new_mints', 'momentum_5m', 'continuation_15m', 'unusual_volume'];
    
    for (const category of categories) {
      result[category] = await this.getLeaderboard(category);
    }

    return result;
  }

  async getTopTokens(limit: number = 20): Promise<TokenSummary[]> {
    const allCategories = await this.getAllLeaderboards();
    const allTokens: TokenSummary[] = [];

    // Combine all leaderboards
    Object.values(allCategories).forEach(tokens => {
      allTokens.push(...tokens);
    });

    // Remove duplicates and sort by score
    const uniqueTokens = allTokens.filter((token, index, self) => 
      index === self.findIndex(t => t.token.address === token.token.address)
    );

    return uniqueTokens
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  getHealthStatus(): { status: 'up' | 'down' | 'degraded'; lastCheck: number; error?: string } {
    return {
      status: this.isRunning ? 'up' : 'down',
      lastCheck: Date.now(),
    };
  }
}