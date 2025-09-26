"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupRoutes = setupRoutes;
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const logger_1 = require("../utils/logger");
const auth_1 = require("./auth");
const security_1 = require("./security");
function getChainName(chainId) {
    const nameMap = {
        'solana': 'sol',
        'ethereum': 'eth',
        'bsc': 'bsc',
        'base': 'base'
    };
    return nameMap[chainId] || 'eth';
}
const apiLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: {
        success: false,
        error: 'Too many requests, please try again later',
        timestamp: Date.now(),
    },
});
const strictLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 10,
    message: {
        success: false,
        error: 'Rate limit exceeded for this endpoint',
        timestamp: Date.now(),
    },
});
function setupRoutes(app, orchestrator, cache) {
    const router = (0, express_1.Router)();
    router.use('/api', apiLimiter);
    const radarOnlyMiddleware = (req, res, next) => {
        const config = orchestrator.getConfig();
        if (config.radarOnly) {
            const allowedPaths = [
                '/api/config',
                '/api/signals',
                '/api/search',
                '/api/health',
                '/api/listings/recent',
                '/api/tokens',
                '/api/webhooks/cex-listing'
            ];
            const isAllowed = allowedPaths.some(path => req.path.startsWith(path));
            if (!isAllowed) {
                return res.status(404).json({
                    success: false,
                    error: 'Endpoint not available in RADAR_ONLY mode',
                    timestamp: Date.now(),
                });
            }
        }
        next();
    };
    router.use('/api', radarOnlyMiddleware);
    router.get('/api/signals/top', async (req, res) => {
        try {
            const limit = parseInt(req.query.limit) || 20;
            const tokens = await orchestrator.getTopTokens(limit);
            const response = {
                success: true,
                data: tokens,
                timestamp: Date.now(),
            };
            res.json(response);
        }
        catch (error) {
            logger_1.logger.error('Failed to get top tokens:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch top tokens',
                timestamp: Date.now(),
            });
        }
    });
    router.get('/api/signals/hotlist', async (req, res) => {
        try {
            const tokens = await orchestrator.getHotlist();
            const response = {
                success: true,
                data: tokens,
                timestamp: Date.now(),
            };
            res.json(response);
        }
        catch (error) {
            logger_1.logger.error('Failed to get hotlist:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch hotlist',
                timestamp: Date.now(),
            });
        }
    });
    router.get('/api/signals/leaderboards', async (req, res) => {
        try {
            const leaderboards = await orchestrator.getLeaderboards();
            const response = {
                success: true,
                data: leaderboards,
                timestamp: Date.now(),
            };
            res.json(response);
        }
        catch (error) {
            logger_1.logger.error('Failed to get leaderboards:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch leaderboards',
                timestamp: Date.now(),
            });
        }
    });
    router.get('/api/signals/leaderboards/:category', async (req, res) => {
        try {
            const { category } = req.params;
            const validCategories = ['new_mints', 'momentum_5m', 'continuation_15m', 'unusual_volume'];
            if (!validCategories.includes(category)) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid leaderboard category',
                    timestamp: Date.now(),
                });
                return;
            }
            const leaderboards = await orchestrator.getLeaderboards();
            const tokens = leaderboards[category] || [];
            const response = {
                success: true,
                data: tokens,
                timestamp: Date.now(),
            };
            res.json(response);
        }
        catch (error) {
            logger_1.logger.error('Failed to get leaderboard category:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch leaderboard',
                timestamp: Date.now(),
            });
        }
    });
    router.get('/api/tokens/:chain/:address', strictLimiter, async (req, res) => {
        try {
            const { chain, address } = req.params;
            const validChains = ['sol', 'eth', 'bsc', 'base'];
            if (!validChains.includes(chain)) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid chain ID',
                    timestamp: Date.now(),
                });
                return;
            }
            const hotlist = await orchestrator.getHotlist();
            const token = hotlist.find(t => t.token.address.toLowerCase() === address.toLowerCase() &&
                t.chainId === chain);
            if (!token) {
                res.status(404).json({
                    success: false,
                    error: 'Token not found in current hotlist',
                    timestamp: Date.now(),
                });
                return;
            }
            const response = {
                success: true,
                data: token,
                timestamp: Date.now(),
            };
            res.json(response);
        }
        catch (error) {
            logger_1.logger.error('Failed to get token details:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch token details',
                timestamp: Date.now(),
            });
        }
    });
    router.get('/api/listings/recent', async (req, res) => {
        try {
            const limit = parseInt(req.query.limit) || 10;
            const listings = (await cache.get('recent_listings')) || [];
            const response = {
                success: true,
                data: listings.slice(0, limit),
                timestamp: Date.now(),
            };
            res.json(response);
        }
        catch (error) {
            logger_1.logger.error('Failed to get recent listings:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch recent listings',
                timestamp: Date.now(),
            });
        }
    });
    router.get('/api/config', async (req, res) => {
        try {
            const config = orchestrator.getConfig();
            const response = {
                success: true,
                data: config,
                timestamp: Date.now(),
            };
            res.json(response);
        }
        catch (error) {
            logger_1.logger.error('Failed to get config:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch configuration',
                timestamp: Date.now(),
            });
        }
    });
    router.post('/api/config', strictLimiter, async (req, res) => {
        try {
            const updates = req.body;
            if (updates.chains) {
                const validChains = ['sol', 'eth', 'bsc', 'base'];
                const invalidChains = updates.chains.filter((chain) => !validChains.includes(chain));
                if (invalidChains.length > 0) {
                    res.status(400).json({ error: `Invalid chains: ${invalidChains.join(', ')}` });
                    return;
                }
            }
            await orchestrator.updateConfig(updates);
            const newConfig = await orchestrator.getConfig();
            res.json({
                success: true,
                config: newConfig,
                timestamp: Date.now()
            });
        }
        catch (error) {
            logger_1.logger.error('Error updating config:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    router.get('/api/health/detailed', async (req, res) => {
        try {
            const health = await orchestrator.getHealthStatus();
            res.status(health.status === 'healthy' ? 200 : 503).json(health);
        }
        catch (error) {
            logger_1.logger.error('Detailed health check failed:', error);
            res.status(503).json({
                status: 'unhealthy',
                timestamp: Date.now(),
                error: 'Health check failed',
            });
        }
    });
    router.get('/api/status/cache', async (req, res) => {
        try {
            const stats = cache.getStats();
            const response = {
                success: true,
                data: stats,
                timestamp: Date.now(),
            };
            res.json(response);
        }
        catch (error) {
            logger_1.logger.error('Failed to get cache stats:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch cache statistics',
                timestamp: Date.now(),
            });
        }
    });
    router.get('/api/search', strictLimiter, async (req, res) => {
        try {
            const { q, chain, limit = '10' } = req.query;
            if (!q || typeof q !== 'string') {
                res.status(400).json({ error: 'Query parameter required' });
                return;
            }
            const hotlist = await orchestrator.getHotlist();
            const query = q.toLowerCase();
            const maxResults = Math.min(parseInt(limit) || 10, 50);
            const results = hotlist
                .filter(token => {
                const matchesQuery = token.token.symbol.toLowerCase().includes(query) ||
                    token.token.name.toLowerCase().includes(query) ||
                    token.token.address.toLowerCase().includes(query);
                const matchesChain = !chain || getChainName(token.chainId) === chain;
                return matchesQuery && matchesChain;
            })
                .slice(0, maxResults);
            res.json({
                success: true,
                data: results,
                count: results.length,
                timestamp: Date.now()
            });
        }
        catch (error) {
            logger_1.logger.error('Error searching tokens:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    router.post('/api/webhooks/cex-listing', async (req, res) => {
        try {
            const event = req.body;
            if (!event.source) {
                res.status(400).json({ error: 'Invalid event format' });
                return;
            }
            try {
                await orchestrator.handleCEXListing(event);
                res.json({ success: true, message: 'Event processed' });
            }
            catch (error) {
                logger_1.logger.error('Error processing CEX listing event:', error);
                res.status(500).json({ error: 'Failed to process event' });
            }
        }
        catch (error) {
            logger_1.logger.error('Error in CEX listing webhook:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    router.use('/api/auth', auth_1.authRouter);
    router.use('/api/security', security_1.securityRouter);
    app.use(router);
    logger_1.logger.info('API routes configured');
}
//# sourceMappingURL=index.js.map