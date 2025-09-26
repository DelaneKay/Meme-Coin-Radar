"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataCollector = void 0;
const axios_1 = __importDefault(require("axios"));
const events_1 = __importDefault(require("events"));
const logger_1 = require("../utils/logger");
class DataCollector extends events_1.default {
    constructor(cache, rateLimiter) {
        super();
        this.baselines = new Map();
        this.isRunning = false;
        this.discoveryQueues = new Map();
        this.seenPairs = new Map();
        this.pollingInterval = null;
        this.discoveryInterval = null;
        this.config = {
            chains: (process.env.CHAINS || 'sol,eth,bsc,base').split(','),
            refreshMs: parseInt(process.env.REFRESH_MS || '30000'),
            minLiquidityUsd: parseInt(process.env.MIN_LIQ_USD || '12000'),
            maxAgeHours: parseInt(process.env.MAX_AGE_HOURS || '48'),
            useBirdeye: process.env.USE_BIRDEYE === 'true',
            dexscreenerBase: process.env.DEXSCREENER_BASE || 'https://api.dexscreener.com',
            geckoterminalBase: process.env.GECKOTERMINAL_BASE || 'https://api.geckoterminal.com',
            birdeyeBase: process.env.BIRDEYE_BASE || 'https://public-api.birdeye.so',
        };
        this.rateLimits = {
            dexscreener: { rpm: 280, burst: 10 },
            geckoterminal: { rpm: 100, burst: 5 },
            birdeye: { rps: 0.9, burst: 3 },
        };
        this.healthMetrics = {
            callsPerMinute: {},
            statusCounts: {},
            cacheHitRatio: 0,
            queueSizes: {},
            droppedPairs: {},
            lastTickTimestamps: {},
        };
        this.tokenBuckets = new Map();
        this.cache = cache;
        this.rateLimiter = rateLimiter;
        this.config.chains.forEach(chainId => {
            this.discoveryQueues.set(chainId, {
                chainId,
                pairAddresses: new Set(),
                lastRefresh: 0,
                cooldownPairs: new Map(),
            });
            this.healthMetrics.queueSizes[chainId] = 0;
            this.healthMetrics.lastTickTimestamps[chainId] = 0;
        });
        Object.keys(this.rateLimits).forEach(source => {
            this.tokenBuckets.set(source, { tokens: 0, lastRefill: Date.now() });
        });
    }
    async start() {
        if (this.isRunning)
            return;
        this.isRunning = true;
        logger_1.dataCollectorLogger.info('Enhanced DataCollector starting...', {
            chains: this.config.chains,
            refreshMs: this.config.refreshMs
        });
        await this.startDiscovery();
        this.startPolling();
        this.startHealthMetrics();
        logger_1.dataCollectorLogger.info('✅ Enhanced DataCollector started successfully');
    }
    async stop() {
        this.isRunning = false;
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
        if (this.discoveryInterval) {
            clearInterval(this.discoveryInterval);
            this.discoveryInterval = null;
        }
        logger_1.dataCollectorLogger.info('DataCollector stopped');
    }
    async startDiscovery() {
        await this.runDiscoveryForAllChains();
        this.discoveryInterval = setInterval(async () => {
            if (this.isRunning) {
                await this.runDiscoveryForAllChains();
            }
        }, 5 * 60 * 1000);
    }
    async runDiscoveryForAllChains() {
        const startTime = Date.now();
        logger_1.dataCollectorLogger.debug('Starting discovery cycle for all chains');
        for (const chainId of this.config.chains) {
            try {
                await this.discoverPairsForChain(chainId);
                await this.sleep(1000 + Math.random() * 2000);
            }
            catch (error) {
                (0, logger_1.logError)(error, `Discovery failed for chain ${chainId}`);
            }
        }
        const duration = Date.now() - startTime;
        logger_1.dataCollectorLogger.debug(`Discovery cycle completed in ${duration}ms`);
    }
    async discoverPairsForChain(chainId) {
        const queue = this.discoveryQueues.get(chainId);
        if (!queue)
            return;
        const now = Date.now();
        const maxAge = this.config.maxAgeHours * 60 * 60 * 1000;
        try {
            const quoteTokens = this.getQuoteTokensForChain(chainId);
            for (const quoteToken of quoteTokens) {
                if (!await this.canMakeRequest('dexscreener')) {
                    logger_1.dataCollectorLogger.warn(`Rate limited during discovery for ${chainId}, skipping ${quoteToken}`);
                    break;
                }
                const pairs = await this.searchNewPairs(chainId, quoteToken);
                pairs.forEach(pair => {
                    const ageMs = now - (pair.pairCreatedAt || 0) * 1000;
                    if (ageMs <= maxAge && pair.liquidity?.usd >= this.config.minLiquidityUsd) {
                        queue.pairAddresses.add(pair.pairAddress);
                    }
                });
                await this.sleep(500);
            }
            this.cleanupDiscoveryQueue(queue);
            queue.lastRefresh = now;
            this.healthMetrics.queueSizes[chainId] = queue.pairAddresses.size;
            logger_1.dataCollectorLogger.debug(`Discovery for ${chainId}: ${queue.pairAddresses.size} pairs in queue`);
        }
        catch (error) {
            (0, logger_1.logError)(error, `Discovery error for chain ${chainId}`);
        }
    }
    getQuoteTokensForChain(chainId) {
        const quoteTokenMap = {
            'sol': ['trending', 'SOL', 'USDC', 'USDT'],
            'eth': ['trending', 'WETH', 'USDC', 'USDT', 'ETH'],
            'bsc': ['trending', 'WBNB', 'USDT', 'BUSD', 'BNB'],
            'base': ['trending', 'WETH', 'USDC', 'ETH'],
        };
        return quoteTokenMap[chainId] || ['trending', 'USDC'];
    }
    async searchNewPairs(chainId, quoteToken) {
        const cacheKey = `discovery:${chainId}:${quoteToken}`;
        const cached = await this.cache.get(cacheKey);
        if (cached) {
            this.updateCacheHitRatio(true);
            return cached;
        }
        this.updateCacheHitRatio(false);
        try {
            const chainMap = {
                'sol': 'solana',
                'eth': 'ethereum',
                'bsc': 'bsc',
                'base': 'base'
            };
            let pairs = [];
            if (quoteToken === 'trending') {
                const trendingQueries = ['pump', 'moon', 'doge', 'pepe', 'shib'];
                for (const query of trendingQueries) {
                    if (!await this.canMakeRequest('dexscreener'))
                        break;
                    const url = `${this.config.dexscreenerBase}/latest/dex/search`;
                    const response = await this.makeRequest('dexscreener', url, {
                        params: { q: `${query} ${chainMap[chainId]}` },
                        timeout: 10000,
                    });
                    if (response.data?.pairs) {
                        pairs.push(...response.data.pairs.slice(0, 5));
                    }
                    await this.sleep(200);
                }
            }
            else {
                const url = `${this.config.dexscreenerBase}/latest/dex/search`;
                const response = await this.makeRequest('dexscreener', url, {
                    params: { q: `${quoteToken} ${chainMap[chainId]}` },
                    timeout: 10000,
                });
                if (response.data?.pairs) {
                    pairs = response.data.pairs;
                }
            }
            if (pairs.length === 0) {
                try {
                    const directPairs = await this.getDexScreenerPairs(chainId, 20);
                    pairs = directPairs;
                }
                catch (error) {
                    logger_1.dataCollectorLogger.debug(`Direct chain fetch failed for ${chainId}`, error);
                }
            }
            const validPairs = pairs
                .filter((pair) => this.isValidPair(pair))
                .slice(0, 20);
            await this.cache.set(cacheKey, validPairs, 120);
            logger_1.dataCollectorLogger.debug(`Discovery found ${validPairs.length} pairs for ${chainId}:${quoteToken}`);
            return validPairs;
        }
        catch (error) {
            (0, logger_1.logError)(error, `Search failed for ${chainId}:${quoteToken}`);
            return [];
        }
    }
    cleanupDiscoveryQueue(queue) {
        const now = Date.now();
        const maxAge = this.config.maxAgeHours * 60 * 60 * 1000;
        const toRemove = [];
        queue.pairAddresses.forEach(pairAddress => {
            const lastSeen = this.seenPairs.get(pairAddress) || 0;
            const cooldownUntil = queue.cooldownPairs.get(pairAddress) || 0;
            if (now - lastSeen > maxAge || now < cooldownUntil) {
                toRemove.push(pairAddress);
            }
        });
        toRemove.forEach(pairAddress => {
            queue.pairAddresses.delete(pairAddress);
            queue.cooldownPairs.delete(pairAddress);
        });
    }
    startPolling() {
        this.pollingInterval = setInterval(async () => {
            if (this.isRunning) {
                await this.runPollingCycle();
            }
        }, this.config.refreshMs);
        setTimeout(() => this.runPollingCycle(), 1000);
    }
    async runPollingCycle() {
        const startTime = Date.now();
        logger_1.dataCollectorLogger.debug('Starting polling cycle');
        const allUpdates = [];
        for (const chainId of this.config.chains) {
            try {
                const updates = await this.pollChain(chainId);
                allUpdates.push(...updates);
                this.healthMetrics.lastTickTimestamps[chainId] = Date.now();
                await this.sleep(500 + Math.random() * 1000);
            }
            catch (error) {
                (0, logger_1.logError)(error, `Polling failed for chain ${chainId}`);
            }
        }
        if (allUpdates.length > 0) {
            this.emit('collector.pairs.updates', allUpdates);
            logger_1.dataCollectorLogger.debug(`Emitted ${allUpdates.length} pair updates`);
        }
        const duration = Date.now() - startTime;
        logger_1.dataCollectorLogger.debug(`Polling cycle completed in ${duration}ms, ${allUpdates.length} updates`);
    }
    async pollChain(chainId) {
        const queue = this.discoveryQueues.get(chainId);
        if (!queue || queue.pairAddresses.size === 0) {
            return [];
        }
        const updates = [];
        const batchSize = 10;
        const pairAddresses = Array.from(queue.pairAddresses);
        for (let i = 0; i < pairAddresses.length; i += batchSize) {
            if (!await this.canMakeRequest('dexscreener')) {
                logger_1.dataCollectorLogger.warn(`Rate limited during polling for ${chainId}, stopping batch`);
                break;
            }
            const batch = pairAddresses.slice(i, i + batchSize);
            const batchUpdates = await this.pollPairBatch(chainId, batch);
            updates.push(...batchUpdates);
            await this.sleep(200);
        }
        return updates;
    }
    async pollPairBatch(chainId, pairAddresses) {
        const updates = [];
        for (const pairAddress of pairAddresses) {
            try {
                const pairData = await this.fetchPairData(chainId, pairAddress);
                if (pairData) {
                    const normalized = await this.normalizePairData(pairData);
                    if (normalized && this.shouldEmitUpdate(normalized)) {
                        updates.push(normalized);
                        this.seenPairs.set(pairAddress, Date.now());
                    }
                }
            }
            catch (error) {
                if (this.isNotFoundError(error)) {
                    const queue = this.discoveryQueues.get(chainId);
                    if (queue) {
                        const cooldownMs = (2 + Math.random() * 3) * 60 * 1000;
                        queue.cooldownPairs.set(pairAddress, Date.now() + cooldownMs);
                        this.healthMetrics.droppedPairs['404_cooldown'] = (this.healthMetrics.droppedPairs['404_cooldown'] || 0) + 1;
                    }
                }
                else {
                    (0, logger_1.logError)(error, `Failed to poll pair ${pairAddress}`);
                }
            }
        }
        return updates;
    }
    async fetchPairData(chainId, pairAddress) {
        const cacheKey = `pair:${chainId}:${pairAddress}`;
        const cached = await this.cache.get(cacheKey);
        if (cached) {
            this.updateCacheHitRatio(true);
            return cached;
        }
        this.updateCacheHitRatio(false);
        const chainMap = {
            'sol': 'solana',
            'eth': 'ethereum',
            'bsc': 'bsc',
            'base': 'base'
        };
        const url = `${this.config.dexscreenerBase}/latest/dex/pairs/${chainMap[chainId]}/${pairAddress}`;
        const response = await this.makeRequest('dexscreener', url, { timeout: 8000 });
        if (response.data?.pair) {
            const pair = response.data.pair;
            await this.cache.set(cacheKey, pair, 30);
            return pair;
        }
        return null;
    }
    async normalizePairData(pair) {
        if (!this.isValidPair(pair)) {
            return null;
        }
        const chainId = this.mapChainId(pair.chainId);
        if (!chainId)
            return null;
        const now = Date.now();
        const tokenKey = `${chainId}:${pair.baseToken.address}`;
        const txns5m = pair.txns?.m5 || { buys: 0, sells: 0 };
        const volume5m = pair.volume?.m5 || 0;
        const volume1h = pair.volume?.h1 || 0;
        const volume15m = pair.volume?.m15 || (volume1h / 4);
        await this.updateTokenBaseline(tokenKey, {
            price: parseFloat(pair.priceUsd || '0'),
            volume15m,
            timestamp: now,
        });
        const baseline = this.baselines.get(tokenKey);
        const priceChange5m = pair.priceChange?.m5 || 0;
        const normalized = {
            chainId,
            token: {
                address: pair.baseToken.address,
                symbol: pair.baseToken.symbol,
                name: pair.baseToken.name || pair.baseToken.symbol,
            },
            pairAddress: pair.pairAddress,
            stats: {
                buys_5: txns5m.buys,
                sells_5: txns5m.sells,
                vol_5_usd: volume5m,
                vol_15_usd: volume15m,
                price_usd: parseFloat(pair.priceUsd || '0'),
                price_change_5m: priceChange5m,
                liquidity_usd: pair.liquidity?.usd || 0,
                fdv_usd: pair.fdv || 0,
                pair_created_at: pair.pairCreatedAt || 0,
            },
            boosts_active: pair.boosts?.active || 0,
            ts: now,
        };
        return normalized;
    }
    mapChainId(dexScreenerChainId) {
        const chainMap = {
            'solana': 'sol',
            'ethereum': 'eth',
            'bsc': 'bsc',
            'base': 'base',
        };
        return chainMap[dexScreenerChainId] || null;
    }
    async updateTokenBaseline(tokenKey, data) {
        let baseline = this.baselines.get(tokenKey);
        if (!baseline) {
            baseline = {
                vol15Baseline: data.volume15m,
                priceSlope1m: 0,
                priceSlope5m: 0,
                lastUpdated: data.timestamp,
                priceHistory: [],
                volumeHistory: [],
            };
            this.baselines.set(tokenKey, baseline);
        }
        baseline.priceHistory.push({ price: data.price, timestamp: data.timestamp });
        baseline.volumeHistory.push({ volume: data.volume15m, timestamp: data.timestamp });
        const cutoff = data.timestamp - 30 * 60 * 1000;
        baseline.priceHistory = baseline.priceHistory.filter(p => p.timestamp > cutoff);
        baseline.volumeHistory = baseline.volumeHistory.filter(v => v.timestamp > cutoff);
        baseline.priceSlope1m = this.calculatePriceSlope(baseline.priceHistory, 1);
        baseline.priceSlope5m = this.calculatePriceSlope(baseline.priceHistory, 5);
        const alpha = 0.1;
        baseline.vol15Baseline = baseline.vol15Baseline * (1 - alpha) + data.volume15m * alpha;
        baseline.lastUpdated = data.timestamp;
        if (baseline.priceHistory.length < 5 && this.config.geckoterminalBase) {
            await this.backfillPriceHistory(tokenKey, baseline);
        }
    }
    calculatePriceSlope(priceHistory, minutes) {
        const cutoff = Date.now() - minutes * 60 * 1000;
        const relevantPrices = priceHistory.filter(p => p.timestamp > cutoff);
        if (relevantPrices.length < 2)
            return 0;
        const n = relevantPrices.length;
        const sumX = relevantPrices.reduce((sum, p, i) => sum + i, 0);
        const sumY = relevantPrices.reduce((sum, p) => sum + p.price, 0);
        const sumXY = relevantPrices.reduce((sum, p, i) => sum + i * p.price, 0);
        const sumXX = relevantPrices.reduce((sum, p, i) => sum + i * i, 0);
        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        return isFinite(slope) ? slope : 0;
    }
    async backfillPriceHistory(tokenKey, baseline) {
    }
    shouldEmitUpdate(normalized) {
        const key = `${normalized.chainId}:${normalized.pairAddress}`;
        const lastData = this.cache.get(`last_emit:${key}`);
        if (!lastData) {
            this.cache.set(`last_emit:${key}`, normalized, 300);
            return true;
        }
        const threshold = 0.05;
        const priceChanged = Math.abs(normalized.stats.price_usd - lastData.stats.price_usd) / lastData.stats.price_usd > threshold;
        const volumeChanged = Math.abs(normalized.stats.vol_5_usd - lastData.stats.vol_5_usd) / Math.max(lastData.stats.vol_5_usd, 1) > threshold;
        const liquidityChanged = Math.abs(normalized.stats.liquidity_usd - lastData.stats.liquidity_usd) / lastData.stats.liquidity_usd > threshold;
        const timeSinceLastEmit = normalized.ts - lastData.ts;
        const heartbeat = timeSinceLastEmit > 5 * 60 * 1000;
        if (priceChanged || volumeChanged || liquidityChanged || heartbeat) {
            this.cache.set(`last_emit:${key}`, normalized, 300);
            return true;
        }
        return false;
    }
    async canMakeRequest(source) {
        const bucket = this.tokenBuckets.get(source);
        if (!bucket)
            return false;
        const now = Date.now();
        const config = this.rateLimits[source];
        const timePassed = now - bucket.lastRefill;
        let tokensToAdd = 0;
        if ('rpm' in config) {
            tokensToAdd = (timePassed / 60000) * config.rpm;
        }
        else if ('rps' in config) {
            tokensToAdd = (timePassed / 1000) * config.rps;
        }
        bucket.tokens = Math.min(config.burst, bucket.tokens + tokensToAdd);
        bucket.lastRefill = now;
        if (bucket.tokens >= 1) {
            bucket.tokens -= 1;
            return true;
        }
        return false;
    }
    async makeRequest(source, url, options = {}) {
        const startTime = Date.now();
        try {
            const response = await axios_1.default.get(url, {
                ...options,
                headers: {
                    'User-Agent': 'Meme-Coin-Radar/1.0',
                    ...options.headers,
                },
            });
            const duration = Date.now() - startTime;
            this.recordApiCall(source, response.status, duration, true);
            return response;
        }
        catch (error) {
            const duration = Date.now() - startTime;
            const status = error.response?.status || 0;
            this.recordApiCall(source, status, duration, false);
            if (status === 429) {
                await this.handleRateLimit(source, error.response?.headers['retry-after']);
            }
            throw error;
        }
    }
    async handleRateLimit(source, retryAfter) {
        const delay = retryAfter ? parseInt(retryAfter) * 1000 : Math.min(30000, Math.pow(2, 3) * 1000);
        logger_1.dataCollectorLogger.warn(`Rate limited by ${source}, backing off for ${delay}ms`);
        const bucket = this.tokenBuckets.get(source);
        if (bucket) {
            bucket.tokens = 0;
            bucket.lastRefill = Date.now() + delay;
        }
        await this.sleep(delay);
    }
    recordApiCall(source, status, duration, success) {
        this.healthMetrics.callsPerMinute[source] = (this.healthMetrics.callsPerMinute[source] || 0) + 1;
        if (!this.healthMetrics.statusCounts[source]) {
            this.healthMetrics.statusCounts[source] = {};
        }
        this.healthMetrics.statusCounts[source][status] = (this.healthMetrics.statusCounts[source][status] || 0) + 1;
        (0, logger_1.logApiRequest)(source, 'request', duration, success, status);
    }
    startHealthMetrics() {
        setInterval(() => {
            this.healthMetrics.callsPerMinute = {};
        }, 60000);
        setInterval(() => {
            this.emit('health', this.getHealthMetrics());
        }, 30000);
    }
    updateCacheHitRatio(hit) {
        const alpha = 0.1;
        const hitValue = hit ? 1 : 0;
        this.healthMetrics.cacheHitRatio = this.healthMetrics.cacheHitRatio * (1 - alpha) + hitValue * alpha;
    }
    getHealthMetrics() {
        return { ...this.healthMetrics };
    }
    isValidPair(pair) {
        return (pair &&
            pair.baseToken &&
            pair.baseToken.address &&
            pair.baseToken.symbol &&
            pair.priceUsd &&
            parseFloat(pair.priceUsd) > 0 &&
            pair.liquidity &&
            pair.liquidity.usd &&
            parseFloat(pair.liquidity.usd) >= this.config.minLiquidityUsd &&
            pair.pairAddress);
    }
    isNotFoundError(error) {
        return error.response?.status === 404;
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    async getDexScreenerPairs(chainId, limit = 50) {
        const cacheKey = `dexscreener:pairs:${chainId}:${limit}`;
        const cached = await this.cache.get(cacheKey);
        if (cached) {
            return cached;
        }
        if (!await this.canMakeRequest('dexscreener')) {
            logger_1.dataCollectorLogger.warn('DEX Screener rate limited, using cached data');
            return cached || [];
        }
        try {
            const chainMap = {
                'sol': 'solana',
                'eth': 'ethereum',
                'bsc': 'bsc',
                'base': 'base'
            };
            const url = `${this.config.dexscreenerBase}/latest/dex/pairs/${chainMap[chainId]}`;
            const response = await this.makeRequest('dexscreener', url, { timeout: 10000 });
            if (response.data && response.data.pairs) {
                const pairs = response.data.pairs
                    .slice(0, limit)
                    .filter((pair) => this.isValidPair(pair));
                await this.cache.set(cacheKey, pairs, 60);
                logger_1.dataCollectorLogger.debug(`Fetched ${pairs.length} pairs from DEX Screener for ${chainId}`);
                return pairs;
            }
            return [];
        }
        catch (error) {
            (0, logger_1.logError)(error, 'DEX Screener API error');
            return cached || [];
        }
    }
    async searchDexScreenerTokens(query, chainId) {
        const cacheKey = `dexscreener:search:${query}:${chainId || 'all'}`;
        const cached = await this.cache.get(cacheKey);
        if (cached) {
            return cached;
        }
        if (!await this.canMakeRequest('dexscreener')) {
            logger_1.dataCollectorLogger.warn('DEX Screener rate limited for search');
            return cached || [];
        }
        try {
            const url = `${this.config.dexscreenerBase}/latest/dex/search/?q=${encodeURIComponent(query)}`;
            const response = await this.makeRequest('dexscreener', url, { timeout: 10000 });
            if (response.data && response.data.pairs) {
                let pairs = response.data.pairs.filter((pair) => this.isValidPair(pair));
                if (chainId) {
                    const chainMap = {
                        'sol': 'solana',
                        'eth': 'ethereum',
                        'bsc': 'bsc',
                        'base': 'base'
                    };
                    pairs = pairs.filter((pair) => pair.chainId === chainMap[chainId]);
                }
                await this.cache.set(cacheKey, pairs, 300);
                return pairs;
            }
            return [];
        }
        catch (error) {
            (0, logger_1.logError)(error, 'DEX Screener search error');
            return cached || [];
        }
    }
    async getTokensByChain(chainId, minLiquidity = 12000) {
        try {
            const pairs = await this.getDexScreenerPairs(chainId, 100);
            return pairs.filter(pair => {
                const liquidity = pair.liquidity?.usd || 0;
                const age = pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt * 1000 : 0;
                const maxAge = this.config.maxAgeHours * 60 * 60 * 1000;
                return (liquidity >= minLiquidity &&
                    age <= maxAge &&
                    pair.txns.h24.buys + pair.txns.h24.sells > 10);
            });
        }
        catch (error) {
            (0, logger_1.logError)(error, `Failed to get tokens for chain ${chainId}`);
            return [];
        }
    }
    getHealthStatus() {
        const errorRate = this.calculateErrorRate();
        let status = 'up';
        if (!this.isRunning) {
            status = 'down';
        }
        else if (errorRate > 0.1) {
            status = 'degraded';
        }
        return {
            status,
            lastCheck: Date.now(),
        };
    }
    calculateErrorRate() {
        let totalCalls = 0;
        let errorCalls = 0;
        Object.values(this.healthMetrics.statusCounts).forEach(statusCounts => {
            Object.entries(statusCounts).forEach(([status, count]) => {
                totalCalls += count;
                if (parseInt(status) >= 400) {
                    errorCalls += count;
                }
            });
        });
        return totalCalls > 0 ? errorCalls / totalCalls : 0;
    }
    async getGeckoTerminalOHLC() { return null; }
    async getBirdeyeTrendingTokens() { return []; }
    async getBirdeyeTokenInfo() { return null; }
    updateBaseline() { }
    getBaseline() { return null; }
    async enrichWithBirdeyeData(pairs) { return pairs; }
}
exports.DataCollector = DataCollector;
//# sourceMappingURL=dataCollector.js.map