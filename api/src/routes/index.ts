import { Router, Express } from 'express';
import rateLimit from 'express-rate-limit';
import { body, query, param } from 'express-validator';
import { validateRequest } from '../utils/validation';
import { Orchestrator } from '../services/orchestrator';
import { CacheManager } from '../utils/cache';
import { logger } from '../utils/logger';
import { ApiResponse } from '../types';
import { authRouter } from './auth';
import { securityRouter } from './security';
import { radarOnlyMiddleware } from '../middleware/radarOnly';

// Helper functions
function getChainName(chainId: string): string {
  const nameMap: Record<string, string> = {
    'solana': 'sol',
    'ethereum': 'eth',
    'bsc': 'bsc', 
    'base': 'base'
  };
  return nameMap[chainId] || 'eth';
}

// Rate limiting for API endpoints
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error: 'Too many requests, please try again later',
    timestamp: Date.now(),
  },
});

const strictLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 requests per minute for expensive endpoints
  message: {
    success: false,
    error: 'Rate limit exceeded for this endpoint',
    timestamp: Date.now(),
  },
});

export function setupRoutes(app: Express, orchestrator: Orchestrator, cache: CacheManager): void {
  const router = Router();

  // Apply rate limiting to all API routes
  router.use('/api', apiLimiter);

  // Apply RADAR_ONLY middleware to all API routes
  router.use('/api', radarOnlyMiddleware);

  // =============================================================================
  // SIGNALS & HOTLIST ENDPOINTS
  // =============================================================================

  // Get top tokens across all categories
  router.get('/api/signals/top', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const tokens = await orchestrator.getTopTokens(limit);
      
      const response: ApiResponse<typeof tokens> = {
        success: true,
        data: tokens,
        timestamp: Date.now(),
      };
      
      res.json(response);
    } catch (error) {
      logger.error('Failed to get top tokens:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch top tokens',
        timestamp: Date.now(),
      });
    }
  });

  // Get hotlist (all filtered tokens)
  router.get('/api/signals/hotlist', async (req, res) => {
    try {
      const tokens = await orchestrator.getHotlist();
      
      const response: ApiResponse<typeof tokens> = {
        success: true,
        data: tokens,
        timestamp: Date.now(),
      };
      
      res.json(response);
    } catch (error) {
      logger.error('Failed to get hotlist:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch hotlist',
        timestamp: Date.now(),
      });
    }
  });

  // Get leaderboards by category
  router.get('/api/signals/leaderboards', async (req, res) => {
    try {
      const leaderboards = await orchestrator.getLeaderboards();
      
      const response: ApiResponse<typeof leaderboards> = {
        success: true,
        data: leaderboards,
        timestamp: Date.now(),
      };
      
      res.json(response);
    } catch (error) {
      logger.error('Failed to get leaderboards:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch leaderboards',
        timestamp: Date.now(),
      });
    }
  });

  // Get specific leaderboard category
  router.get('/api/signals/leaderboards/:category', async (req, res): Promise<void> => {
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
      const tokens = leaderboards[category as keyof typeof leaderboards] || [];
      
      const response: ApiResponse<typeof tokens> = {
        success: true,
        data: tokens,
        timestamp: Date.now(),
      };
      
      res.json(response);
    } catch (error) {
      logger.error('Failed to get leaderboard category:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch leaderboard',
        timestamp: Date.now(),
      });
    }
  });

  // =============================================================================
  // TOKEN DETAILS ENDPOINTS
  // =============================================================================

  // Get specific token details
  router.get('/api/tokens/:chain/:address', strictLimiter, async (req, res): Promise<void> => {
    try {
      const { chain, address } = req.params;
      
      // Validate chain
      const validChains = ['sol', 'eth', 'bsc', 'base'];
      if (!validChains.includes(chain)) {
        res.status(400).json({
          success: false,
          error: 'Invalid chain ID',
          timestamp: Date.now(),
        });
        return;
      }

      // Try to find token in current hotlist
      const hotlist = await orchestrator.getHotlist();
      const token = hotlist.find(t => 
        t.token.address.toLowerCase() === address.toLowerCase() && 
        t.chainId === chain
      );

      if (!token) {
        res.status(404).json({
          success: false,
          error: 'Token not found in current hotlist',
          timestamp: Date.now(),
        });
        return;
      }

      const response: ApiResponse<typeof token> = {
        success: true,
        data: token,
        timestamp: Date.now(),
      };
      
      res.json(response);
    } catch (error) {
      logger.error('Failed to get token details:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch token details',
        timestamp: Date.now(),
      });
    }
  });

  // =============================================================================
  // CEX LISTINGS ENDPOINTS
  // =============================================================================

  // Get recent CEX listings
  router.get('/api/listings/recent', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      
      // Get recent listings from cache
      const listings = (await cache.get('recent_listings')) as any[] || [];
      
      const response: ApiResponse<typeof listings> = {
        success: true,
        data: listings.slice(0, limit),
        timestamp: Date.now(),
      };
      
      res.json(response);
    } catch (error) {
      logger.error('Failed to get recent listings:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch recent listings',
        timestamp: Date.now(),
      });
    }
  });

  // =============================================================================
  // CONFIGURATION ENDPOINTS
  // =============================================================================

  // Get current configuration
  router.get('/api/config', async (req, res) => {
    try {
      const config = orchestrator.getConfig();
      
      // Add radar-only configuration flags
      const enhancedConfig = {
        ...config,
        radarOnly: process.env.RADAR_ONLY === 'true',
        enablePortfolioSim: process.env.ENABLE_PORTFOLIO_SIM === 'true',
        enableTradeActions: process.env.ENABLE_TRADE_ACTIONS === 'true',
        enableWalletIntegrations: process.env.ENABLE_ANY_WALLET_INTEGRATIONS === 'true',
        allowedRoutes: (process.env.PUBLIC_ROUTES || 'config,signals,search,health,listings').split(','),
        alertTypesEnabled: (process.env.ALERT_TYPES_ENABLED || 'RADAR_MOMENTUM,CEX_LISTING').split(','),
        environment: process.env.NODE_ENV || 'development'
      };
      
      const response: ApiResponse<typeof enhancedConfig> = {
        success: true,
        data: enhancedConfig,
        timestamp: Date.now(),
      };
      
      res.json(response);
    } catch (error) {
      logger.error('Failed to get config:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch configuration',
        timestamp: Date.now(),
      });
    }
  });

  // Update configuration (admin endpoint)
  router.post('/api/config', strictLimiter, async (req, res): Promise<void> => {
    try {
      const updates = req.body;
      
      // Validate chain updates
      if (updates.chains) {
        const validChains = ['sol', 'eth', 'bsc', 'base'];
        const invalidChains = updates.chains.filter((chain: string) => !validChains.includes(chain));
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
    } catch (error) {
      logger.error('Error updating config:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // =============================================================================
  // HEALTH & STATUS ENDPOINTS
  // =============================================================================

  // Health check endpoint (already defined in main index.ts, but adding detailed version)
  router.get('/api/health/detailed', async (req, res) => {
    try {
      const health = await orchestrator.getHealthStatus();
      res.status(health.status === 'healthy' ? 200 : 503).json(health);
    } catch (error) {
      logger.error('Detailed health check failed:', error);
      res.status(503).json({
        status: 'unhealthy',
        timestamp: Date.now(),
        error: 'Health check failed',
      });
    }
  });

  // Get cache statistics
  router.get('/api/status/cache', async (req, res) => {
    try {
      const stats = cache.getStats();
      
      const response: ApiResponse<typeof stats> = {
        success: true,
        data: stats,
        timestamp: Date.now(),
      };
      
      res.json(response);
    } catch (error) {
      logger.error('Failed to get cache stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch cache statistics',
        timestamp: Date.now(),
      });
    }
  });

  // =============================================================================
  // SEARCH ENDPOINTS
  // =============================================================================

  // Search tokens
  router.get('/api/search', strictLimiter, async (req, res): Promise<void> => {
    try {
      const { q, chain, limit = '10' } = req.query;
      
      if (!q || typeof q !== 'string') {
        res.status(400).json({ error: 'Query parameter required' });
        return;
      }
      
      const hotlist = await orchestrator.getHotlist();
      const query = q.toLowerCase();
      const maxResults = Math.min(parseInt(limit as string) || 10, 50);
      
      const results = hotlist
        .filter(token => {
          const matchesQuery = 
            token.token.symbol.toLowerCase().includes(query) ||
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
    } catch (error) {
      logger.error('Error searching tokens:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // =============================================================================
  // WEBHOOK ENDPOINTS (for CEX Sentinel)
  // =============================================================================

  // Webhook for CEX listing events
  router.post('/api/webhooks/cex-listing', async (req, res): Promise<void> => {
    try {
      const event = req.body;
      
      // Basic validation
      if (!event.source) {
        res.status(400).json({ error: 'Invalid event format' });
        return;
      }
      
      try {
        await orchestrator.handleCEXListing(event);
        res.json({ success: true, message: 'Event processed' });
      } catch (error) {
        logger.error('Error processing CEX listing event:', error);
        res.status(500).json({ error: 'Failed to process event' });
      }
    } catch (error) {
      logger.error('Error in CEX listing webhook:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Authentication and security routes
  router.use('/api/auth', authRouter);
  router.use('/api/security', securityRouter);

  // Mount the router
  app.use(router);

  logger.info('API routes configured');
}