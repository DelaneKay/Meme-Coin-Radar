import { TokenSummary, CEXListingEvent } from '../types';
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
    security_flags: string;
    risk_level: string;
    last_checked: string;
    created_at: string;
}
export interface CacheRecord {
    id: number;
    cache_key: string;
    cache_value: string;
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
    channels: string;
    metadata?: string;
    sent_at: string;
}
export declare class DatabaseManager {
    private tokens;
    private tokenMetrics;
    private tokenSecurity;
    private cache;
    private alertHistory;
    private cexListings;
    private healthMetrics;
    private leaderboards;
    private logger;
    constructor();
    private initializeDatabase;
    upsertToken(tokenData: Omit<TokenRecord, 'id' | 'created_at' | 'updated_at'>): Promise<number>;
    getTokenByAddress(address: string, chainId: string): Promise<TokenRecord | null>;
    insertTokenMetrics(metrics: Omit<TokenMetricsRecord, 'id' | 'created_at'>): Promise<void>;
    getLatestTokenMetrics(limit?: number): Promise<TokenSummary[]>;
    upsertTokenSecurity(tokenId: number, security: Omit<TokenSecurityRecord, 'id' | 'token_id' | 'created_at'>): Promise<void>;
    setCache(key: string, value: any, ttlSeconds?: number): Promise<void>;
    getCache<T>(key: string): Promise<T | null>;
    deleteCache(key: string): Promise<void>;
    clearExpiredCache(): Promise<void>;
    insertAlertHistory(alert: Omit<AlertHistoryRecord, 'id' | 'sent_at'>): Promise<void>;
    getRecentAlerts(limit?: number): Promise<AlertHistoryRecord[]>;
    insertCEXListing(listing: Omit<CEXListingEvent, 'id'>): Promise<void>;
    insertHealthMetric(serviceName: string, metricName: string, value: number, status?: string, details?: any): Promise<void>;
    getHealthMetrics(serviceName?: string, hours?: number): Promise<any[]>;
    saveLeaderboardSnapshot(category: string, tokens: TokenSummary[]): Promise<void>;
    getLeaderboardSnapshot(category: string): Promise<TokenSummary[] | null>;
    cleanup(): Promise<void>;
    getStats(): Promise<any>;
    close(): void;
}
export declare function getDatabase(): DatabaseManager;
//# sourceMappingURL=database.d.ts.map