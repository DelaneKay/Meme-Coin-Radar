"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Orchestrator = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const logger_1 = require("../utils/logger");
const dataCollector_1 = require("./dataCollector");
const secAuditor_1 = require("./secAuditor");
const scorer_1 = require("./scorer");
const alerter_1 = require("./alerter");
class Orchestrator {
    constructor(cache, rateLimiter) {
        this.isRunning = false;
        this.refreshInterval = null;
        this.sentinelInterval = null;
        this.pinnedTokens = new Map();
        this.lastSnapshot = [];
        this.hotlistSubscribers = new Set();
        this.listingSubscribers = new Set();
        this.cache = cache;
        this.rateLimiter = rateLimiter;
        this.config = this.loadConfig();
        this.dataCollector = new dataCollector_1.DataCollector(cache, rateLimiter);
        this.secAuditor = new secAuditor_1.SecAuditor(cache, rateLimiter);
        this.scorer = new scorer_1.Scorer(cache);
        this.alerter = new alerter_1.Alerter(cache, this.config);
        this.setupDataCollectorListeners();
        logger_1.orchestratorLogger.info('Orchestrator initialized', { config: this.config });
    }
    setupDataCollectorListeners() {
        this.dataCollector.on('collector.pairs.updates', async (updates) => {
            try {
                logger_1.orchestratorLogger.debug(`Received ${updates.length} pair updates from DataCollector`);
                await this.processPairUpdates(updates);
            }
            catch (error) {
                (0, logger_1.logError)(error, 'Failed to process pair updates from DataCollector');
            }
        });
        this.dataCollector.on('health', (metrics) => {
            logger_1.orchestratorLogger.debug('DataCollector health metrics', metrics);
            this.cache.set('collector:health', metrics, 60);
        });
    }
    async processPairUpdates(updates) {
        const startTime = Date.now();
        try {
            const pairs = updates.map(update => this.convertToDexScreenerPair(update));
            const securityReports = await this.performSecurityAnalysis(pairs);
            const tokenSummaries = await this.generateTokenSummaries(pairs, securityReports);
            const filteredTokens = this.applyFilters(tokenSummaries);
            const finalTokens = this.mergeWithPinnedTokens(filteredTokens);
            await this.processAlerts(finalTokens);
            await this.updateHotlistCache(finalTokens);
            this.notifyHotlistSubscribers(finalTokens);
            await this.scorer.updateLeaderboards(finalTokens);
            const duration = Date.now() - startTime;
            (0, logger_1.logPerformance)('processPairUpdates', duration, { updateCount: updates.length });
        }
        catch (error) {
            (0, logger_1.logError)(error, 'Failed to process pair updates');
        }
    }
    convertToDexScreenerPair(update) {
        return {
            chainId: update.chainId === 'sol' ? 'solana' :
                update.chainId === 'eth' ? 'ethereum' :
                    update.chainId === 'bsc' ? 'bsc' : 'base',
            dexId: 'unknown',
            url: '',
            pairAddress: update.pairAddress,
            baseToken: {
                address: update.token.address,
                name: update.token.name,
                symbol: update.token.symbol,
            },
            quoteToken: {
                address: '',
                name: 'Unknown',
                symbol: 'UNKNOWN',
            },
            priceNative: '0',
            priceUsd: update.stats.price_usd.toString(),
            txns: {
                m5: { buys: update.stats.buys_5, sells: update.stats.sells_5 },
                h1: { buys: 0, sells: 0 },
                h6: { buys: 0, sells: 0 },
                h24: { buys: 0, sells: 0 },
            },
            volume: {
                m5: update.stats.vol_5_usd,
                h1: update.stats.vol_15_usd * 4,
                h6: 0,
                h24: 0,
            },
            priceChange: {
                m5: update.stats.price_change_5m,
                h1: 0,
                h6: 0,
                h24: 0,
            },
            liquidity: {
                usd: update.stats.liquidity_usd,
                base: 0,
                quote: 0,
            },
            fdv: update.stats.fdv_usd,
            pairCreatedAt: update.stats.pair_created_at,
            boosts: {
                active: update.boosts_active,
            },
            info: {
                imageUrl: '',
                websites: [],
                socials: [],
            },
        };
    }
    loadConfig() {
        return {
            chains: (process.env.CHAINS || 'sol,eth,bsc,base').split(','),
            minLiquidityAlert: parseInt(process.env.MIN_LIQUIDITY_ALERT || '20000'),
            minLiquidityList: parseInt(process.env.MIN_LIQUIDITY_LIST || '12000'),
            maxTax: parseInt(process.env.MAX_TAX || '10'),
            maxAgeHours: parseInt(process.env.MAX_AGE_HOURS || '48'),
            scoreAlert: parseInt(process.env.SCORE_ALERT || '70'),
            surge15Threshold: parseFloat(process.env.SURGE15_THRESHOLD || '2.5'),
            imbalance5Threshold: parseFloat(process.env.IMBALANCE5_THRESHOLD || '0.4'),
            refreshMs: parseInt(process.env.REFRESH_MS || '30000'),
            sentinelRefreshMs: parseInt(process.env.SENTINEL_REFRESH_MS || '120000'),
            radarOnly: process.env.RADAR_ONLY === 'true',
            enablePortfolioSim: process.env.ENABLE_PORTFOLIO_SIM !== 'false',
            enableTradeActions: process.env.ENABLE_TRADE_ACTIONS !== 'false',
            enableWalletIntegrations: process.env.ENABLE_ANY_WALLET_INTEGRATIONS !== 'false',
        };
    }
    async saveRadarOnlyConfigSnapshot() {
        try {
            const reportsDir = path_1.default.join(process.cwd(), 'reports');
            await promises_1.default.mkdir(reportsDir, { recursive: true });
            const configSnapshot = {
                timestamp: new Date().toISOString(),
                mode: 'RADAR_ONLY',
                configuration: {
                    ...this.config,
                    environment: {
                        NODE_ENV: process.env.NODE_ENV,
                        RADAR_ONLY: process.env.RADAR_ONLY,
                        ENABLE_PORTFOLIO_SIM: process.env.ENABLE_PORTFOLIO_SIM,
                        ENABLE_TRADE_ACTIONS: process.env.ENABLE_TRADE_ACTIONS,
                        ENABLE_ANY_WALLET_INTEGRATIONS: process.env.ENABLE_ANY_WALLET_INTEGRATIONS,
                    }
                },
                allowedEndpoints: [
                    'GET /api/config',
                    'GET /api/signals/leaderboards/:category',
                    'GET /api/search',
                    'GET /api/health',
                    'GET /api/listings/recent',
                    'WS topics: hotlist, listings, health'
                ],
                disabledFeatures: [
                    'Portfolio simulation',
                    'Trade actions',
                    'Wallet integrations',
                    'Simulation API endpoints (/api/sim/*)',
                    'Tuning API endpoints (/api/tuning/*)'
                ]
            };
            const reportContent = `# Radar-Only Configuration Snapshot

Generated: ${configSnapshot.timestamp}
Mode: ${configSnapshot.mode}

## Configuration Settings

\`\`\`json
${JSON.stringify(configSnapshot.configuration, null, 2)}
\`\`\`

## Allowed API Endpoints

${configSnapshot.allowedEndpoints.map(endpoint => `- ${endpoint}`).join('\n')}

## Disabled Features

${configSnapshot.disabledFeatures.map(feature => `- ${feature}`).join('\n')}

## Status

✅ RADAR_ONLY mode is active
✅ Only radar and CEX listing alerts are enabled
✅ All trading and simulation features are disabled
✅ Configuration snapshot saved successfully
`;
            const filePath = path_1.default.join(reportsDir, 'radar-only-config.md');
            await promises_1.default.writeFile(filePath, reportContent, 'utf8');
            logger_1.orchestratorLogger.info('Radar-only configuration snapshot saved', {
                filePath,
                mode: configSnapshot.mode,
                radarOnly: this.config.radarOnly
            });
        }
        catch (error) {
            (0, logger_1.logError)(error, 'Failed to save radar-only configuration snapshot');
        }
    }
    async start() {
        if (this.isRunning) {
            logger_1.orchestratorLogger.warn('Orchestrator already running');
            return;
        }
        try {
            logger_1.orchestratorLogger.info('Starting Orchestrator...');
            await this.dataCollector.start();
            await this.secAuditor.start();
            await this.scorer.start();
            await this.alerter.start();
            this.startRefreshCycle();
            this.startCleanupTasks();
            this.isRunning = true;
            logger_1.orchestratorLogger.info('🚀 Orchestrator started successfully');
            if (this.config.radarOnly) {
                await this.saveRadarOnlyConfigSnapshot();
            }
            await this.runDataPipeline();
        }
        catch (error) {
            (0, logger_1.logError)(error, 'Failed to start Orchestrator');
            throw error;
        }
    }
    async shutdown() {
        if (!this.isRunning)
            return;
        logger_1.orchestratorLogger.info('Shutting down Orchestrator...');
        this.isRunning = false;
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
        if (this.sentinelInterval) {
            clearInterval(this.sentinelInterval);
            this.sentinelInterval = null;
        }
        await this.dataCollector.stop();
        await this.secAuditor.stop();
        await this.scorer.stop();
        await this.alerter.stop();
        this.hotlistSubscribers.clear();
        this.listingSubscribers.clear();
        logger_1.orchestratorLogger.info('Orchestrator shutdown complete');
    }
    startRefreshCycle() {
        this.refreshInterval = setInterval(async () => {
            if (this.isRunning) {
                await this.runDataPipeline();
            }
        }, this.config.refreshMs);
        logger_1.orchestratorLogger.info(`Data refresh cycle started (${this.config.refreshMs}ms interval)`);
    }
    startCleanupTasks() {
        setInterval(() => {
            this.cleanupPinnedTokens();
        }, 60 * 1000);
        node_cron_1.default.schedule('*/5 * * * *', async () => {
            await this.performHealthCheck();
        });
        logger_1.orchestratorLogger.info('Cleanup tasks started');
    }
    async runDataPipeline() {
        const startTime = Date.now();
        try {
            logger_1.orchestratorLogger.debug('Starting data pipeline...');
            const allPairs = await this.collectDataFromAllChains();
            if (allPairs.length === 0) {
                logger_1.orchestratorLogger.warn('No pairs collected, using last snapshot');
                return;
            }
            const securityReports = await this.performSecurityAnalysis(allPairs);
            const tokenSummaries = await this.generateTokenSummaries(allPairs, securityReports);
            const filteredTokens = this.applyFilters(tokenSummaries);
            await this.scorer.updateLeaderboards(filteredTokens);
            const finalHotlist = this.mergeWithPinnedTokens(filteredTokens);
            await this.updateHotlistCache(finalHotlist);
            this.notifyHotlistSubscribers(finalHotlist);
            this.lastSnapshot = finalHotlist;
            const duration = Date.now() - startTime;
            (0, logger_1.logPerformance)('runDataPipeline', duration, {
                totalPairs: allPairs.length,
                securityChecks: securityReports.size,
                finalTokens: finalHotlist.length,
            });
        }
        catch (error) {
            (0, logger_1.logError)(error, 'Data pipeline failed');
            if (this.lastSnapshot.length > 0) {
                this.notifyHotlistSubscribers(this.lastSnapshot);
            }
        }
    }
    async collectDataFromAllChains() {
        const allPairs = [];
        for (const chainId of this.config.chains) {
            try {
                logger_1.orchestratorLogger.debug(`Collecting data for chain: ${chainId}`);
                const pairs = await this.dataCollector.getTokensByChain(chainId, this.config.minLiquidityList);
                allPairs.push(...pairs);
                logger_1.orchestratorLogger.debug(`Collected ${pairs.length} pairs from ${chainId}`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            catch (error) {
                (0, logger_1.logError)(error, `Failed to collect data for chain ${chainId}`);
            }
        }
        if (this.config.chains.includes('sol')) {
            try {
                const enrichedPairs = await this.dataCollector.enrichWithBirdeyeData(allPairs);
                return enrichedPairs;
            }
            catch (error) {
                (0, logger_1.logError)(error, 'Failed to enrich with Birdeye data');
            }
        }
        return allPairs;
    }
    async performSecurityAnalysis(pairs) {
        const securityMap = new Map();
        const tokens = pairs.map(pair => ({
            address: pair.baseToken.address,
            chainId: this.scorer['mapChainId'](pair.chainId),
        }));
        try {
            const reports = await this.secAuditor.analyzeBatch(tokens);
            reports.forEach(report => {
                securityMap.set(report.address, report);
            });
            logger_1.orchestratorLogger.debug(`Completed security analysis for ${reports.length} tokens`);
        }
        catch (error) {
            (0, logger_1.logError)(error, 'Batch security analysis failed');
        }
        return securityMap;
    }
    async generateTokenSummaries(pairs, securityReports) {
        const summaries = [];
        for (const pair of pairs) {
            try {
                const security = securityReports.get(pair.baseToken.address);
                if (!security) {
                    continue;
                }
                const listingBoost = this.getListingBoost(pair.baseToken.address);
                const summary = this.scorer.generateTokenSummary(pair, security, listingBoost);
                summaries.push(summary);
            }
            catch (error) {
                (0, logger_1.logError)(error, `Failed to generate summary for ${pair.baseToken.address}`);
            }
        }
        return summaries;
    }
    applyFilters(tokens) {
        return tokens.filter(token => {
            if (token.liquidityUsd < this.config.minLiquidityList)
                return false;
            if (token.ageMinutes > this.config.maxAgeHours * 60)
                return false;
            if (token.score < 55)
                return false;
            if (!token.security.ok)
                return false;
            if (token.security.flags.includes('high_tax'))
                return false;
            return true;
        });
    }
    mergeWithPinnedTokens(tokens) {
        const merged = [...tokens];
        const tokenAddresses = new Set(tokens.map(t => t.token.address));
        for (const [address, pinnedToken] of this.pinnedTokens.entries()) {
            if (!tokenAddresses.has(address)) {
                merged.unshift(pinnedToken.token);
            }
        }
        return merged;
    }
    async updateHotlistCache(tokens) {
        try {
            await this.cache.cacheHotlist('all', tokens, 30);
            const topTokens = tokens
                .sort((a, b) => b.score - a.score)
                .slice(0, 50);
            await this.cache.cacheHotlist('top', topTokens, 30);
        }
        catch (error) {
            (0, logger_1.logError)(error, 'Failed to update hotlist cache');
        }
    }
    async processAlerts(tokens) {
        try {
            const alertPromises = tokens
                .filter(token => token.score >= this.config.scoreAlert)
                .map(token => this.alerter.sendScoreAlert(token));
            await Promise.allSettled(alertPromises);
        }
        catch (error) {
            (0, logger_1.logError)(error, 'Failed to process alerts');
        }
    }
    async handleCEXListing(event) {
        try {
            logger_1.orchestratorLogger.info('Processing CEX listing event', {
                exchange: event.exchange,
                symbol: event.token.symbol,
                address: event.token.address,
            });
            const pinnedUntil = Date.now() + 30 * 60 * 1000;
            let tokenSummary = this.findTokenInSnapshot(event.token.address);
            if (!tokenSummary) {
                tokenSummary = await this.createMinimalTokenSummary(event);
            }
            tokenSummary.score = Math.min(100, tokenSummary.score + 10);
            tokenSummary.reasons.push(`CEX listing: ${event.exchange}`);
            this.pinnedTokens.set(event.token.address, {
                token: tokenSummary,
                pinnedUntil,
                reason: `CEX listing on ${event.exchange}`,
            });
            await this.alerter.sendCEXListingAlert(event);
            this.notifyListingSubscribers(event);
            await this.runDataPipeline();
            logger_1.orchestratorLogger.info(`Token ${event.token.symbol} pinned for CEX listing on ${event.exchange}`);
        }
        catch (error) {
            (0, logger_1.logError)(error, 'Failed to handle CEX listing event');
        }
    }
    findTokenInSnapshot(address) {
        return this.lastSnapshot.find(token => token.token.address === address) || null;
    }
    async createMinimalTokenSummary(event) {
        return {
            chainId: event.token.chainId,
            token: {
                address: event.token.address,
                symbol: event.token.symbol,
                name: event.token.symbol,
            },
            pairAddress: '',
            priceUsd: 0,
            buys5: 0,
            sells5: 0,
            vol5Usd: 0,
            vol15Usd: 0,
            liquidityUsd: event.liquidityUsd,
            fdvUsd: undefined,
            ageMinutes: 0,
            score: event.radarScore + 10,
            reasons: [`CEX listing: ${event.exchange}`],
            security: {
                ok: true,
                flags: [],
            },
            links: {
                dexscreener: `https://dexscreener.com/search?q=${event.token.address}`,
                chart: event.urls[0] || '',
            },
        };
    }
    getListingBoost(address) {
        const pinned = this.pinnedTokens.get(address);
        return pinned && pinned.reason.includes('CEX listing') ? 10 : 0;
    }
    cleanupPinnedTokens() {
        const now = Date.now();
        let cleaned = 0;
        for (const [address, pinnedToken] of this.pinnedTokens.entries()) {
            if (now > pinnedToken.pinnedUntil) {
                this.pinnedTokens.delete(address);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            logger_1.orchestratorLogger.debug(`Cleaned up ${cleaned} expired pinned tokens`);
        }
    }
    async getHealthStatus() {
        const services = {
            dataCollector: this.dataCollector.getHealthStatus(),
            secAuditor: this.secAuditor.getHealthStatus(),
            scorer: this.scorer.getHealthStatus(),
            alerter: this.alerter.getHealthStatus(),
            cache: this.cache.getStats(),
        };
        const rateLimits = this.rateLimiter.getAllStatuses();
        let status = 'healthy';
        const serviceStatuses = [
            services.dataCollector,
            services.secAuditor,
            services.scorer,
            services.alerter
        ];
        const downServices = serviceStatuses.filter(s => s.status === 'down').length;
        const degradedServices = serviceStatuses.filter(s => s.status === 'degraded').length;
        if (downServices > 0) {
            status = 'unhealthy';
        }
        else if (degradedServices > 1 || !this.isRunning) {
            status = 'degraded';
        }
        return {
            status,
            timestamp: Date.now(),
            services: {
                orchestrator: {
                    status: this.isRunning ? 'up' : 'down',
                    lastCheck: Date.now(),
                },
                dataCollector: services.dataCollector,
                secAuditor: services.secAuditor,
                scorer: services.scorer,
                alerter: services.alerter,
                cache: {
                    status: services.cache.redisConnected ? 'up' : 'degraded',
                    lastCheck: Date.now(),
                },
            },
            rateLimits,
        };
    }
    async performHealthCheck() {
        try {
            const health = await this.getHealthStatus();
            if (health.status !== 'healthy') {
                logger_1.orchestratorLogger.warn('Health check failed', { status: health.status });
            }
            const limitedServices = health.rateLimits.filter(rl => rl.isLimited);
            if (limitedServices.length > 0) {
                logger_1.orchestratorLogger.warn('Services are rate limited', {
                    services: limitedServices.map(s => s.service)
                });
            }
        }
        catch (error) {
            (0, logger_1.logError)(error, 'Health check failed');
        }
    }
    subscribeToHotlist(callback) {
        this.hotlistSubscribers.add(callback);
        if (this.lastSnapshot.length > 0) {
            callback(this.lastSnapshot);
        }
        return () => {
            this.hotlistSubscribers.delete(callback);
        };
    }
    subscribeToListings(callback) {
        this.listingSubscribers.add(callback);
        return () => {
            this.listingSubscribers.delete(callback);
        };
    }
    notifyHotlistSubscribers(data) {
        this.hotlistSubscribers.forEach(callback => {
            try {
                callback(data);
            }
            catch (error) {
                (0, logger_1.logError)(error, 'Hotlist subscriber callback failed');
            }
        });
    }
    notifyListingSubscribers(event) {
        this.listingSubscribers.forEach(callback => {
            try {
                callback(event);
            }
            catch (error) {
                (0, logger_1.logError)(error, 'Listing subscriber callback failed');
            }
        });
    }
    async getHotlist() {
        const cached = await this.cache.getHotlist('all');
        return cached || this.lastSnapshot;
    }
    async getTopTokens(limit = 20) {
        return await this.scorer.getTopTokens(limit);
    }
    async getLeaderboards() {
        return await this.scorer.getAllLeaderboards();
    }
    getConfig() {
        return { ...this.config };
    }
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        logger_1.orchestratorLogger.info('Configuration updated', { config: this.config });
    }
}
exports.Orchestrator = Orchestrator;
//# sourceMappingURL=orchestrator.js.map