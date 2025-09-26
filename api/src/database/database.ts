import { readFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger';
import { TokenSummary, CEXListingEvent, ChainId } from '../types';

export interface TokenRecord {
  id: number;
  address: string;
  chain_id: string;
  symbol: string;
  name?: string;
  decimals: number;
  created_at: string;
  updated_at: string;
}

export interface TokenMetricsRecord {
  id: number;
  token_id: number;
  price_usd?: number;
  price_change_5m: number;
  price_change_15m: number;
  price_change_1h: number;
  price_change_24h: number;
  volume_usd_5m: number;
  volume_usd_15m: number;
  volume_usd_1h: number;
  volume_usd_24h: number;
  liquidity_usd: number;
  market_cap_usd: number;
  holders_count: number;
  age_minutes: number;
  score: number;
  momentum_score: number;
  volume_score: number;
  liquidity_score: number;
  security_score: number;
  created_at: string;
}

export interface TokenSecurityRecord {
  id: number;
  token_id: number;
  is_honeypot: boolean;
  is_rugpull: boolean;
  is_scam: boolean;
  has_high_tax: boolean;
  has_mint_function: boolean;
  has_proxy: boolean;
  has_blacklist: boolean;
  buy_tax: number;
  sell_tax: number;
  security_flags: string; // JSON
  risk_level: string;
  last_checked: string;
  created_at: string;
}

export interface CacheRecord {
  id: number;
  cache_key: string;
  cache_value: string; // JSON
  expires_at: string;
  created_at: string;
}

export interface AlertHistoryRecord {
  id: number;
  token_id?: number;
  alert_type: string;
  title: string;
  message?: string;
  score?: number;
  exchange?: string;
  channels: string; // JSON
  metadata?: string; // JSON
  sent_at: string;
}

export class DatabaseManager {
  private tokens: Map<string, TokenRecord> = new Map();
  private tokenMetrics: TokenMetricsRecord[] = [];
  private tokenSecurity: Map<number, TokenSecurityRecord> = new Map();
  private cache: Map<string, CacheRecord> = new Map();
  private alertHistory: AlertHistoryRecord[] = [];
  private cexListings: any[] = [];
  private healthMetrics: any[] = [];
  private leaderboards: Map<string, TokenSummary[]> = new Map();
  private logger = logger;

  constructor() {
    this.logger.info('In-memory database initialized successfully');
  }

  private initializeDatabase(): void {
    // No-op for in-memory implementation
    this.logger.info('Database schema initialized (in-memory)');
  }

  // Token operations
  async upsertToken(tokenData: Omit<TokenRecord, 'id' | 'created_at' | 'updated_at'>): Promise<number> {
    const key = `${tokenData.address}_${tokenData.chain_id}`;
    const existing = this.tokens.get(key);
    
    if (existing) {
      existing.symbol = tokenData.symbol;
      existing.name = tokenData.name;
      existing.decimals = tokenData.decimals;
      existing.updated_at = new Date().toISOString();
      return existing.id;
    } else {
      const id = this.tokens.size + 1;
      const token: TokenRecord = {
        id,
        ...tokenData,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      this.tokens.set(key, token);
      return id;
    }
  }

  async getTokenByAddress(address: string, chainId: string): Promise<TokenRecord | null> {
    const key = `${address}_${chainId}`;
    return this.tokens.get(key) || null;
  }

  // Token metrics operations
  async insertTokenMetrics(metrics: Omit<TokenMetricsRecord, 'id' | 'created_at'>): Promise<void> {
    const record: TokenMetricsRecord = {
      id: this.tokenMetrics.length + 1,
      ...metrics,
      created_at: new Date().toISOString(),
    };
    this.tokenMetrics.push(record);
  }

  async getLatestTokenMetrics(limit: number = 100): Promise<TokenSummary[]> {
    // Get latest metrics for each token
    const latestMetrics = new Map<number, TokenMetricsRecord>();
    
    for (const metric of this.tokenMetrics) {
      const existing = latestMetrics.get(metric.token_id);
      if (!existing || metric.created_at > existing.created_at) {
        latestMetrics.set(metric.token_id, metric);
      }
    }
    
    const results: TokenSummary[] = [];
    
    for (const [tokenId, metric] of latestMetrics) {
      const token = Array.from(this.tokens.values()).find(t => t.id === tokenId);
      if (!token) continue;
      
      const security = this.tokenSecurity.get(tokenId);
      
      results.push({
        chainId: token.chain_id as ChainId,
        token: {
          address: token.address,
          symbol: token.symbol,
          name: token.name || token.symbol
        },
        pairAddress: token.address, // Using token address as pair address for now
        priceUsd: metric.price_usd || 0,
        buys5: 0, // Not available in in-memory implementation
        sells5: 0, // Not available in in-memory implementation
        vol5Usd: metric.volume_usd_5m || 0,
        vol15Usd: metric.volume_usd_15m || 0,
        liquidityUsd: metric.liquidity_usd || 0,
        fdvUsd: metric.market_cap_usd || undefined,
        ageMinutes: metric.age_minutes || 0,
        score: metric.score || 0,
        reasons: [], // Not available in in-memory implementation
        security: {
          ok: !security?.is_honeypot && !security?.is_rugpull && !security?.is_scam,
          flags: security?.security_flags ? JSON.parse(security.security_flags) : [],
        },
        links: {
          dexscreener: `https://dexscreener.com/${token.chain_id}/${token.address}`,
          chart: undefined,
        }
      });
    }
    
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // Security operations
  async upsertTokenSecurity(tokenId: number, security: Omit<TokenSecurityRecord, 'id' | 'token_id' | 'created_at'>): Promise<void> {
    const existing = this.tokenSecurity.get(tokenId);
    
    if (existing) {
      Object.assign(existing, security, { last_checked: new Date().toISOString() });
    } else {
      const record: TokenSecurityRecord = {
        id: this.tokenSecurity.size + 1,
        token_id: tokenId,
        ...security,
        created_at: new Date().toISOString(),
      };
      this.tokenSecurity.set(tokenId, record);
    }
  }

  // Cache operations
  async setCache(key: string, value: any, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : null;
    
    const record: CacheRecord = {
      id: this.cache.size + 1,
      cache_key: key,
      cache_value: JSON.stringify(value),
      expires_at: expiresAt?.toISOString() || '',
      created_at: new Date().toISOString(),
    };
    
    this.cache.set(key, record);
  }

  async getCache<T>(key: string): Promise<T | null> {
    const record = this.cache.get(key);
    
    if (!record) return null;
    
    // Check expiration
    if (record.expires_at && new Date(record.expires_at) <= new Date()) {
      this.cache.delete(key);
      return null;
    }
    
    try {
      return JSON.parse(record.cache_value) as T;
    } catch {
      return null;
    }
  }

  async deleteCache(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async clearExpiredCache(): Promise<void> {
    const now = new Date();
    for (const [key, record] of this.cache) {
      if (record.expires_at && new Date(record.expires_at) <= now) {
        this.cache.delete(key);
      }
    }
  }

  // Alert history operations
  async insertAlertHistory(alert: Omit<AlertHistoryRecord, 'id' | 'sent_at'>): Promise<void> {
    const record: AlertHistoryRecord = {
      id: this.alertHistory.length + 1,
      ...alert,
      sent_at: new Date().toISOString(),
    };
    this.alertHistory.push(record);
  }

  async getRecentAlerts(limit: number = 50): Promise<AlertHistoryRecord[]> {
    return this.alertHistory
      .sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime())
      .slice(0, limit);
  }

  // CEX listing operations
  async insertCEXListing(listing: Omit<CEXListingEvent, 'id'>): Promise<void> {
    // First get or create token
    const tokenId = await this.upsertToken({
      address: listing.token.address,
      chain_id: listing.token.chainId,
      symbol: listing.token.symbol,
      name: listing.token.symbol,
      decimals: 18
    });

    const record = {
      id: this.cexListings.length + 1,
      token_id: tokenId,
      exchange: listing.exchange,
      symbol: listing.token.symbol,
      announcement_url: listing.urls[0] || '',
      listing_date: listing.ts,
      created_at: new Date().toISOString(),
    };
    
    this.cexListings.push(record);
  }

  // Health metrics
  async insertHealthMetric(serviceName: string, metricName: string, value: number, status: string = 'ok', details?: any): Promise<void> {
    const record = {
      id: this.healthMetrics.length + 1,
      service_name: serviceName,
      metric_name: metricName,
      metric_value: value,
      status,
      details: details ? JSON.stringify(details) : null,
      recorded_at: new Date().toISOString(),
    };
    
    this.healthMetrics.push(record);
  }

  async getHealthMetrics(serviceName?: string, hours: number = 24): Promise<any[]> {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    return this.healthMetrics
      .filter(metric => {
        const isWithinTimeRange = new Date(metric.recorded_at) > cutoff;
        const matchesService = !serviceName || metric.service_name === serviceName;
        return isWithinTimeRange && matchesService;
      })
      .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());
  }

  // Leaderboard snapshots
  async saveLeaderboardSnapshot(category: string, tokens: TokenSummary[]): Promise<void> {
    this.leaderboards.set(category, tokens);
  }

  async getLeaderboardSnapshot(category: string): Promise<TokenSummary[] | null> {
    return this.leaderboards.get(category) || null;
  }

  // Utility methods
  async cleanup(): Promise<void> {
    // Manual cleanup of expired data
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    // Clear expired cache
    await this.clearExpiredCache();
    
    // Clean old health metrics
    this.healthMetrics = this.healthMetrics.filter(metric => 
      new Date(metric.recorded_at) > sevenDaysAgo
    );
    
    // Clean old leaderboard snapshots
    for (const [key, snapshots] of this.leaderboards) {
      // Keep only recent snapshots (this is a simplified cleanup)
      this.leaderboards.set(key, snapshots);
    }
  }

  async getStats(): Promise<any> {
    const now = new Date();
    const validCacheCount = Array.from(this.cache.values())
      .filter(record => !record.expires_at || new Date(record.expires_at) > now)
      .length;
    
    const stats = {
      tokens: { count: this.tokens.size },
      metrics: { count: this.tokenMetrics.length },
      alerts: { count: this.alertHistory.length },
      cache_entries: { count: validCacheCount },
      cex_listings: { count: this.cexListings.length }
    };

    return stats;
  }

  close(): void {
    // No-op for in-memory implementation
  }
}

// Singleton instance
let dbInstance: DatabaseManager | null = null;

export function getDatabase(): DatabaseManager {
  if (!dbInstance) {
    dbInstance = new DatabaseManager();
  }
  return dbInstance;
}