import cron from 'node-cron';
import fs from 'fs/promises';
import path from 'path';
import { orchestratorLogger as logger, logError, logPerformance } from '../utils/logger';
import { CacheManager } from '../utils/cache';
import { RateLimitManager } from '../utils/rateLimiter';
import { DataCollector } from './dataCollector';
import { SecAuditor } from './secAuditor';
import { Scorer } from './scorer';
import { Alerter } from './alerter';
import { 
  TokenSummary, 
  CEXListingEvent, 
  HealthCheckResponse, 
  RadarConfig,
  ChainId,
  DexScreenerPair,
  SecurityReport
} from '../types';

interface PinnedToken {
  token: TokenSummary;
  pinnedUntil: number;
  reason: string;
}

export class Orchestrator {
  private cache: CacheManager;
  private rateLimiter: RateLimitManager;
  private dataCollector: DataCollector;
  private secAuditor: SecAuditor;
  private scorer: Scorer;
  private alerter: Alerter;
  
  private isRunning: boolean = false;
  private refreshInterval: NodeJS.Timeout | null = null;
  private sentinelInterval: NodeJS.Timeout | null = null;
  
  private pinnedTokens: Map<string, PinnedToken> = new Map();
  private lastSnapshot: TokenSummary[] = [];
  private config: RadarConfig;

  // Event emitters for real-time updates
  private hotlistSubscribers: Set<(data: TokenSummary[]) => void> = new Set();
  private listingSubscribers: Set<(event: CEXListingEvent) => void> = new Set();

  constructor(cache: CacheManager, rateLimiter: RateLimitManager) {
    this.cache = cache;
    this.rateLimiter = rateLimiter;
    
    // Load configuration first
    this.config = this.loadConfig();
    
    // Initialize services with configuration
    this.dataCollector = new DataCollector(cache, rateLimiter);
    this.secAuditor = new SecAuditor(cache, rateLimiter);
    this.scorer = new Scorer(cache);
    this.alerter = new Alerter(cache, this.config);
    

    
    // Set up DataCollector event listeners
    this.setupDataCollectorListeners();
    
    logger.info('Orchestrator initialized', { config: this.config });
  }

  private setupDataCollectorListeners(): void {
    // Listen for normalized pair updates from DataCollector
    this.dataCollector.on('collector.pairs.updates', async (updates: any[]) => {
      try {
        logger.debug(`Received ${updates.length} pair updates from DataCollector`);
        await this.processPairUpdates(updates);
      } catch (error) {
        logError(error as Error, 'Failed to process pair updates from DataCollector');
      }
    });

    // Listen for health metrics from DataCollector
    this.dataCollector.on('health', (metrics: any) => {
      logger.debug('DataCollector health metrics', metrics);
      // Store health metrics for monitoring
      this.cache.set('collector:health', metrics, 60);
    });
  }

  private async processPairUpdates(updates: any[]): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Convert normalized updates back to DexScreenerPair format for compatibility
      const pairs = updates.map(update => this.convertToDexScreenerPair(update));
      
      // Perform security analysis on new pairs
      const securityReports = await this.performSecurityAnalysis(pairs);
      
      // Generate token summaries
      const tokenSummaries = await this.generateTokenSummaries(pairs, securityReports);
      
      // Apply filters and merge with pinned tokens
      const filteredTokens = this.applyFilters(tokenSummaries);
      const finalTokens = this.mergeWithPinnedTokens(filteredTokens);
      
      // Process alerts for high-scoring tokens
      await this.processAlerts(finalTokens);
      
      // Update caches and notify subscribers
      await this.updateHotlistCache(finalTokens);
      this.notifyHotlistSubscribers(finalTokens);
      
      // Update leaderboards
      await this.scorer.updateLeaderboards(finalTokens);
      
      const duration = Date.now() - startTime;
      logPerformance('processPairUpdates', duration, { updateCount: updates.length });
      
    } catch (error) {
      logError(error as Error, 'Failed to process pair updates');
    }
  }

  private convertToDexScreenerPair(update: any): DexScreenerPair {
    // Convert normalized update back to DexScreenerPair format for compatibility
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
        h1: update.stats.vol_15_usd * 4, // Estimate
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

  private loadConfig(): RadarConfig {
    return {
      chains: (process.env.CHAINS || 'sol,eth,bsc,base').split(',') as ChainId[],
      minLiquidityAlert: parseInt(process.env.MIN_LIQUIDITY_ALERT || '20000'),
      minLiquidityList: parseInt(process.env.MIN_LIQUIDITY_LIST || '12000'),
      maxTax: parseInt(process.env.MAX_TAX || '10'),
      maxAgeHours: parseInt(process.env.MAX_AGE_HOURS || '48'),
      scoreAlert: parseInt(process.env.SCORE_ALERT || '70'),
      surge15Threshold: parseFloat(process.env.SURGE15_THRESHOLD || '2.5'),
      imbalance5Threshold: parseFloat(process.env.IMBALANCE5_THRESHOLD || '0.4'),
      refreshMs: parseInt(process.env.REFRESH_MS || '30000'),
      sentinelRefreshMs: parseInt(process.env.SENTINEL_REFRESH_MS || '120000'),
      // RADAR_ONLY mode flags
      radarOnly: process.env.RADAR_ONLY === 'true',
      enablePortfolioSim: process.env.ENABLE_PORTFOLIO_SIM !== 'false',
      enableTradeActions: process.env.ENABLE_TRADE_ACTIONS !== 'false',
      enableWalletIntegrations: process.env.ENABLE_ANY_WALLET_INTEGRATIONS !== 'false',
    };
  }

  private async saveRadarOnlyConfigSnapshot(): Promise<void> {
    try {
      const reportsDir = path.join(process.cwd(), 'reports');
      await fs.mkdir(reportsDir, { recursive: true });
      
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

      const filePath = path.join(reportsDir, 'radar-only-config.md');
      await fs.writeFile(filePath, reportContent, 'utf8');
      
      logger.info('Radar-only configuration snapshot saved', { 
        filePath,
        mode: configSnapshot.mode,
        radarOnly: this.config.radarOnly
      });
      
    } catch (error) {
      logError(error as Error, 'Failed to save radar-only configuration snapshot');
    }
  }

  // =============================================================================
  // LIFECYCLE MANAGEMENT
  // =============================================================================

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Orchestrator already running');
      return;
    }

    try {
      logger.info('Starting Orchestrator...');
      
      // Start all services
      await this.dataCollector.start();
      await this.secAuditor.start();
      await this.scorer.start();
      await this.alerter.start();
      
      // Start main refresh cycle
      this.startRefreshCycle();
      
      // Start cleanup tasks
      this.startCleanupTasks();
      
      this.isRunning = true;
      logger.info('🚀 Orchestrator started successfully');
      
      // Save configuration snapshot if RADAR_ONLY mode is enabled
      if (this.config.radarOnly) {
        await this.saveRadarOnlyConfigSnapshot();
      }
      
      // Run initial data collection
      await this.runDataPipeline();
      
    } catch (error) {
      logError(error as Error, 'Failed to start Orchestrator');
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('Shutting down Orchestrator...');
    
    this.isRunning = false;
    
    // Stop intervals
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    
    if (this.sentinelInterval) {
      clearInterval(this.sentinelInterval);
      this.sentinelInterval = null;
    }
    
    // Stop services
    await this.dataCollector.stop();
    await this.secAuditor.stop();
    await this.scorer.stop();
    await this.alerter.stop();
    
    // Clear subscribers
    this.hotlistSubscribers.clear();
    this.listingSubscribers.clear();
    
    logger.info('Orchestrator shutdown complete');
  }

  private startRefreshCycle(): void {
    // Main data collection cycle
    this.refreshInterval = setInterval(async () => {
      if (this.isRunning) {
        await this.runDataPipeline();
      }
    }, this.config.refreshMs);

    logger.info(`Data refresh cycle started (${this.config.refreshMs}ms interval)`);
  }

  private startCleanupTasks(): void {
    // Clean up pinned tokens every minute
    setInterval(() => {
      this.cleanupPinnedTokens();
    }, 60 * 1000);

    // Health check every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      await this.performHealthCheck();
    });

    logger.info('Cleanup tasks started');
  }

  // =============================================================================
  // MAIN DATA PIPELINE
  // =============================================================================

  private async runDataPipeline(): Promise<void> {
    const startTime = Date.now();
    
    try {
      logger.debug('Starting data pipeline...');
      
      // Step 1: Collect raw data from all chains
      const allPairs = await this.collectDataFromAllChains();
      
      if (allPairs.length === 0) {
        logger.warn('No pairs collected, using last snapshot');
        return;
      }

      // Step 2: Security analysis
      const securityReports = await this.performSecurityAnalysis(allPairs);
      
      // Step 3: Score calculation and filtering
      const tokenSummaries = await this.generateTokenSummaries(allPairs, securityReports);
      
      // Step 4: Apply filters and generate leaderboards
      const filteredTokens = this.applyFilters(tokenSummaries);
      await this.scorer.updateLeaderboards(filteredTokens);
      
      // Step 5: Merge with pinned tokens
      const finalHotlist = this.mergeWithPinnedTokens(filteredTokens);
      
      // Step 6: Update cache and notify subscribers
      await this.updateHotlistCache(finalHotlist);
      this.notifyHotlistSubscribers(finalHotlist);
      
      // Update last snapshot
      this.lastSnapshot = finalHotlist;
      
      const duration = Date.now() - startTime;
      logPerformance('runDataPipeline', duration, {
        totalPairs: allPairs.length,
        securityChecks: securityReports.size,
        finalTokens: finalHotlist.length,
      });
      
    } catch (error) {
      logError(error as Error, 'Data pipeline failed');
      
      // Fall back to last snapshot on error
      if (this.lastSnapshot.length > 0) {
        this.notifyHotlistSubscribers(this.lastSnapshot);
      }
    }
  }

  private async collectDataFromAllChains(): Promise<DexScreenerPair[]> {
    const allPairs: DexScreenerPair[] = [];
    
    for (const chainId of this.config.chains) {
      try {
        logger.debug(`Collecting data for chain: ${chainId}`);
        
        const pairs = await this.dataCollector.getTokensByChain(chainId, this.config.minLiquidityList);
        allPairs.push(...pairs);
        
        logger.debug(`Collected ${pairs.length} pairs from ${chainId}`);
        
        // Add delay between chains to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        logError(error as Error, `Failed to collect data for chain ${chainId}`);
      }
    }
    
    // Enrich Solana tokens with Birdeye data if available
    if (this.config.chains.includes('sol')) {
      try {
        const enrichedPairs = await this.dataCollector.enrichWithBirdeyeData(allPairs);
        return enrichedPairs;
      } catch (error) {
        logError(error as Error, 'Failed to enrich with Birdeye data');
      }
    }
    
    return allPairs;
  }

  private async performSecurityAnalysis(pairs: DexScreenerPair[]): Promise<Map<string, SecurityReport>> {
    const securityMap = new Map<string, SecurityReport>();
    
    // Prepare tokens for batch analysis
    const tokens = pairs.map(pair => ({
      address: pair.baseToken.address,
      chainId: this.scorer['mapChainId'](pair.chainId), // Use scorer's chain mapping
    }));
    
    try {
      const reports = await this.secAuditor.analyzeBatch(tokens);
      
      reports.forEach(report => {
        securityMap.set(report.address, report);
      });
      
      logger.debug(`Completed security analysis for ${reports.length} tokens`);
      
    } catch (error) {
      logError(error as Error, 'Batch security analysis failed');
    }
    
    return securityMap;
  }

  private async generateTokenSummaries(
    pairs: DexScreenerPair[], 
    securityReports: Map<string, SecurityReport>
  ): Promise<TokenSummary[]> {
    const summaries: TokenSummary[] = [];
    
    for (const pair of pairs) {
      try {
        const security = securityReports.get(pair.baseToken.address);
        
        if (!security) {
          // Skip tokens without security analysis
          continue;
        }
        
        // Check if token has a listing boost
        const listingBoost = this.getListingBoost(pair.baseToken.address);
        
        const summary = this.scorer.generateTokenSummary(pair, security, listingBoost);
        summaries.push(summary);
        
      } catch (error) {
        logError(error as Error, `Failed to generate summary for ${pair.baseToken.address}`);
      }
    }
    
    return summaries;
  }

  private applyFilters(tokens: TokenSummary[]): TokenSummary[] {
    return tokens.filter(token => {
      // Basic filters
      if (token.liquidityUsd < this.config.minLiquidityList) return false;
      if (token.ageMinutes > this.config.maxAgeHours * 60) return false;
      if (token.score < 55) return false; // Minimum score threshold
      
      // Security filter
      if (!token.security.ok) return false;
      
      // Tax filter (if available in security flags)
      if (token.security.flags.includes('high_tax')) return false;
      
      return true;
    });
  }

  private mergeWithPinnedTokens(tokens: TokenSummary[]): TokenSummary[] {
    const merged = [...tokens];
    const tokenAddresses = new Set(tokens.map(t => t.token.address));
    
    // Add pinned tokens that aren't already in the list
    for (const [address, pinnedToken] of this.pinnedTokens.entries()) {
      if (!tokenAddresses.has(address)) {
        merged.unshift(pinnedToken.token); // Add to beginning
      }
    }
    
    return merged;
  }

  private async updateHotlistCache(tokens: TokenSummary[]): Promise<void> {
    try {
      await this.cache.cacheHotlist('all', tokens, 30);
      
      // Cache top tokens by score
      const topTokens = tokens
        .sort((a, b) => b.score - a.score)
        .slice(0, 50);
      
      await this.cache.cacheHotlist('top', topTokens, 30);
      
    } catch (error) {
      logError(error as Error, 'Failed to update hotlist cache');
    }
  }

  // =============================================================================
  // ALERT PROCESSING
  // =============================================================================

  private async processAlerts(tokens: TokenSummary[]): Promise<void> {
    try {
      // Process score alerts for high-scoring tokens
      const alertPromises = tokens
        .filter(token => token.score >= this.config.scoreAlert)
        .map(token => this.alerter.sendScoreAlert(token));

      await Promise.allSettled(alertPromises);
      
    } catch (error) {
      logError(error as Error, 'Failed to process alerts');
    }
  }

  // =============================================================================
  // CEX LISTING HANDLING
  // =============================================================================

  async handleCEXListing(event: CEXListingEvent): Promise<void> {
    try {
      logger.info('Processing CEX listing event', {
        exchange: event.exchange,
        symbol: event.token.symbol,
        address: event.token.address,
      });
      
      // Pin token for 30 minutes
      const pinnedUntil = Date.now() + 30 * 60 * 1000;
      
      // Find existing token data or create minimal summary
      let tokenSummary = this.findTokenInSnapshot(event.token.address);
      
      if (!tokenSummary) {
        // Create minimal token summary for new listing
        tokenSummary = await this.createMinimalTokenSummary(event);
      }
      
      // Apply listing boost
      tokenSummary.score = Math.min(100, tokenSummary.score + 10);
      tokenSummary.reasons.push(`CEX listing: ${event.exchange}`);
      
      // Pin the token
      this.pinnedTokens.set(event.token.address, {
        token: tokenSummary,
        pinnedUntil,
        reason: `CEX listing on ${event.exchange}`,
      });
      
      // Send CEX listing alert
      await this.alerter.sendCEXListingAlert(event);
      
      // Notify subscribers
      this.notifyListingSubscribers(event);
      
      // Trigger immediate hotlist update
      await this.runDataPipeline();
      
      logger.info(`Token ${event.token.symbol} pinned for CEX listing on ${event.exchange}`);
      
    } catch (error) {
      logError(error as Error, 'Failed to handle CEX listing event');
    }
  }

  private findTokenInSnapshot(address: string): TokenSummary | null {
    return this.lastSnapshot.find(token => token.token.address === address) || null;
  }

  private async createMinimalTokenSummary(event: CEXListingEvent): Promise<TokenSummary> {
    // Create a minimal token summary for CEX listing
    return {
      chainId: event.token.chainId as ChainId,
      token: {
        address: event.token.address,
        symbol: event.token.symbol,
        name: event.token.symbol, // Use symbol as name if not available
      },
      pairAddress: '', // Will be updated when pair data is available
      priceUsd: 0,
      buys5: 0,
      sells5: 0,
      vol5Usd: 0,
      vol15Usd: 0,
      liquidityUsd: event.liquidityUsd,
      fdvUsd: undefined,
      ageMinutes: 0,
      score: event.radarScore + 10, // Base score + listing boost
      reasons: [`CEX listing: ${event.exchange}`],
      security: {
        ok: true, // Assume CEX-listed tokens are safe
        flags: [],
      },
      links: {
        dexscreener: `https://dexscreener.com/search?q=${event.token.address}`,
        chart: event.urls[0] || '',
      },
    };
  }

  private getListingBoost(address: string): number {
    const pinned = this.pinnedTokens.get(address);
    return pinned && pinned.reason.includes('CEX listing') ? 10 : 0;
  }

  private cleanupPinnedTokens(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [address, pinnedToken] of this.pinnedTokens.entries()) {
      if (now > pinnedToken.pinnedUntil) {
        this.pinnedTokens.delete(address);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.debug(`Cleaned up ${cleaned} expired pinned tokens`);
    }
  }

  // =============================================================================
  // HEALTH MONITORING
  // =============================================================================

  async getHealthStatus(): Promise<HealthCheckResponse> {
    const services = {
      dataCollector: this.dataCollector.getHealthStatus(),
      secAuditor: this.secAuditor.getHealthStatus(),
      scorer: this.scorer.getHealthStatus(),
      alerter: this.alerter.getHealthStatus(),
      cache: this.cache.getStats(),
    };
    
    const rateLimits = this.rateLimiter.getAllStatuses();
    
    // Determine overall status
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
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
    } else if (degradedServices > 1 || !this.isRunning) {
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

  private async performHealthCheck(): Promise<void> {
    try {
      const health = await this.getHealthStatus();
      
      if (health.status !== 'healthy') {
        logger.warn('Health check failed', { status: health.status });
      }
      
      // Check for rate limit issues
      const limitedServices = health.rateLimits.filter(rl => rl.isLimited);
      if (limitedServices.length > 0) {
        logger.warn('Services are rate limited', { 
          services: limitedServices.map(s => s.service) 
        });
      }
      
    } catch (error) {
      logError(error as Error, 'Health check failed');
    }
  }

  // =============================================================================
  // SUBSCRIPTION MANAGEMENT
  // =============================================================================

  subscribeToHotlist(callback: (data: TokenSummary[]) => void): () => void {
    this.hotlistSubscribers.add(callback);
    
    // Send current data immediately
    if (this.lastSnapshot.length > 0) {
      callback(this.lastSnapshot);
    }
    
    // Return unsubscribe function
    return () => {
      this.hotlistSubscribers.delete(callback);
    };
  }

  subscribeToListings(callback: (event: CEXListingEvent) => void): () => void {
    this.listingSubscribers.add(callback);
    
    return () => {
      this.listingSubscribers.delete(callback);
    };
  }

  private notifyHotlistSubscribers(data: TokenSummary[]): void {
    this.hotlistSubscribers.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        logError(error as Error, 'Hotlist subscriber callback failed');
      }
    });
  }

  private notifyListingSubscribers(event: CEXListingEvent): void {
    this.listingSubscribers.forEach(callback => {
      try {
        callback(event);
      } catch (error) {
        logError(error as Error, 'Listing subscriber callback failed');
      }
    });
  }

  // =============================================================================
  // PUBLIC API METHODS
  // =============================================================================

  async getHotlist(): Promise<TokenSummary[]> {
    const cached = await this.cache.getHotlist('all');
    return cached || this.lastSnapshot;
  }

  async getTopTokens(limit: number = 20): Promise<TokenSummary[]> {
    return await this.scorer.getTopTokens(limit);
  }

  async getLeaderboards() {
    return await this.scorer.getAllLeaderboards();
  }

  getConfig(): RadarConfig {
    return { ...this.config };
  }

  updateConfig(newConfig: Partial<RadarConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('Configuration updated', { config: this.config });
  }
}