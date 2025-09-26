"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseManager = void 0;
exports.getDatabase = getDatabase;
const logger_1 = require("../utils/logger");
class DatabaseManager {
    constructor() {
        this.tokens = new Map();
        this.tokenMetrics = [];
        this.tokenSecurity = new Map();
        this.cache = new Map();
        this.alertHistory = [];
        this.cexListings = [];
        this.healthMetrics = [];
        this.leaderboards = new Map();
        this.logger = logger_1.logger;
        this.logger.info('In-memory database initialized successfully');
    }
    initializeDatabase() {
        this.logger.info('Database schema initialized (in-memory)');
    }
    async upsertToken(tokenData) {
        const key = `${tokenData.address}_${tokenData.chain_id}`;
        const existing = this.tokens.get(key);
        if (existing) {
            existing.symbol = tokenData.symbol;
            existing.name = tokenData.name;
            existing.decimals = tokenData.decimals;
            existing.updated_at = new Date().toISOString();
            return existing.id;
        }
        else {
            const id = this.tokens.size + 1;
            const token = {
                id,
                ...tokenData,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };
            this.tokens.set(key, token);
            return id;
        }
    }
    async getTokenByAddress(address, chainId) {
        const key = `${address}_${chainId}`;
        return this.tokens.get(key) || null;
    }
    async insertTokenMetrics(metrics) {
        const record = {
            id: this.tokenMetrics.length + 1,
            ...metrics,
            created_at: new Date().toISOString(),
        };
        this.tokenMetrics.push(record);
    }
    async getLatestTokenMetrics(limit = 100) {
        const latestMetrics = new Map();
        for (const metric of this.tokenMetrics) {
            const existing = latestMetrics.get(metric.token_id);
            if (!existing || metric.created_at > existing.created_at) {
                latestMetrics.set(metric.token_id, metric);
            }
        }
        const results = [];
        for (const [tokenId, metric] of latestMetrics) {
            const token = Array.from(this.tokens.values()).find(t => t.id === tokenId);
            if (!token)
                continue;
            const security = this.tokenSecurity.get(tokenId);
            results.push({
                chainId: token.chain_id,
                token: {
                    address: token.address,
                    symbol: token.symbol,
                    name: token.name || token.symbol
                },
                pairAddress: token.address,
                priceUsd: metric.price_usd || 0,
                buys5: 0,
                sells5: 0,
                vol5Usd: metric.volume_usd_5m || 0,
                vol15Usd: metric.volume_usd_15m || 0,
                liquidityUsd: metric.liquidity_usd || 0,
                fdvUsd: metric.market_cap_usd || undefined,
                ageMinutes: metric.age_minutes || 0,
                score: metric.score || 0,
                reasons: [],
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
    async upsertTokenSecurity(tokenId, security) {
        const existing = this.tokenSecurity.get(tokenId);
        if (existing) {
            Object.assign(existing, security, { last_checked: new Date().toISOString() });
        }
        else {
            const record = {
                id: this.tokenSecurity.size + 1,
                token_id: tokenId,
                ...security,
                created_at: new Date().toISOString(),
            };
            this.tokenSecurity.set(tokenId, record);
        }
    }
    async setCache(key, value, ttlSeconds) {
        const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : null;
        const record = {
            id: this.cache.size + 1,
            cache_key: key,
            cache_value: JSON.stringify(value),
            expires_at: expiresAt?.toISOString() || '',
            created_at: new Date().toISOString(),
        };
        this.cache.set(key, record);
    }
    async getCache(key) {
        const record = this.cache.get(key);
        if (!record)
            return null;
        if (record.expires_at && new Date(record.expires_at) <= new Date()) {
            this.cache.delete(key);
            return null;
        }
        try {
            return JSON.parse(record.cache_value);
        }
        catch {
            return null;
        }
    }
    async deleteCache(key) {
        this.cache.delete(key);
    }
    async clearExpiredCache() {
        const now = new Date();
        for (const [key, record] of this.cache) {
            if (record.expires_at && new Date(record.expires_at) <= now) {
                this.cache.delete(key);
            }
        }
    }
    async insertAlertHistory(alert) {
        const record = {
            id: this.alertHistory.length + 1,
            ...alert,
            sent_at: new Date().toISOString(),
        };
        this.alertHistory.push(record);
    }
    async getRecentAlerts(limit = 50) {
        return this.alertHistory
            .sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime())
            .slice(0, limit);
    }
    async insertCEXListing(listing) {
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
    async insertHealthMetric(serviceName, metricName, value, status = 'ok', details) {
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
    async getHealthMetrics(serviceName, hours = 24) {
        const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
        return this.healthMetrics
            .filter(metric => {
            const isWithinTimeRange = new Date(metric.recorded_at) > cutoff;
            const matchesService = !serviceName || metric.service_name === serviceName;
            return isWithinTimeRange && matchesService;
        })
            .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());
    }
    async saveLeaderboardSnapshot(category, tokens) {
        this.leaderboards.set(category, tokens);
    }
    async getLeaderboardSnapshot(category) {
        return this.leaderboards.get(category) || null;
    }
    async cleanup() {
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        await this.clearExpiredCache();
        this.healthMetrics = this.healthMetrics.filter(metric => new Date(metric.recorded_at) > sevenDaysAgo);
        for (const [key, snapshots] of this.leaderboards) {
            this.leaderboards.set(key, snapshots);
        }
    }
    async getStats() {
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
    close() {
    }
}
exports.DatabaseManager = DatabaseManager;
let dbInstance = null;
function getDatabase() {
    if (!dbInstance) {
        dbInstance = new DatabaseManager();
    }
    return dbInstance;
}
//# sourceMappingURL=database.js.map