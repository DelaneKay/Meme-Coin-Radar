import axios, { AxiosResponse } from 'axios';
import { EventEmitter } from 'events';
import { dataCollectorLogger as logger, logApiRequest, logError } from '../utils/logger';
import { CacheManager } from '../utils/cache';
import { RateLimitManager } from '../utils/rateLimiter';
import { 
  DexScreenerPair, 
  BirdeyeTokenData, 
  GeckoTerminalOHLC, 
  ChainId,
  ApiResponse 
} from '../types';

// Enhanced interfaces for the new collector
interface NormalizedPairData {
  chainId: ChainId;
  token: {
    address: string;
    symbol: string;
    name: string;
  };
  pairAddress: string;
  stats: {
    buys_5: number;
    sells_5: number;
    vol_5_usd: number;
    vol_15_usd: number;
    price_usd: number;
    price_change_5m: number;
    liquidity_usd: number;
    fdv_usd: number;
    pair_created_at: number;
  };
  boosts_active: number;
  ts: number;
}

interface TokenBaseline {
  vol15Baseline: number;
  priceSlope1m: number;
  priceSlope5m: number;
  lastUpdated: number;
  priceHistory: Array<{ price: number; timestamp: number }>;
  volumeHistory: Array<{ volume: number; timestamp: number }>;
}

interface DiscoveryQueue {
  chainId: ChainId;
  pairAddresses: Set<string>;
  lastRefresh: number;
  cooldownPairs: Map<string, number>; // pairAddress -> cooldown until timestamp
}

interface HealthMetrics {
  callsPerMinute: Record<string, number>;
  statusCounts: Record<string, Record<number, number>>; // source -> status code -> count
  cacheHitRatio: number;
  queueSizes: Record<ChainId, number>;
  droppedPairs: Record<string, number>; // reason -> count
  lastTickTimestamps: Record<ChainId, number>;
}

interface RateLimitConfig {
  dexscreener: { rpm: number; burst: number };
  geckoterminal: { rpm: number; burst: number };
  birdeye: { rps: number; burst: number };
}

export class DataCollector extends EventEmitter {
  private cache: CacheManager;
  private rateLimiter: RateLimitManager;
  private baselines: Map<string, TokenBaseline> = new Map();
  private isRunning: boolean = false;
  
  // Discovery and polling infrastructure
  private discoveryQueues: Map<ChainId, DiscoveryQueue> = new Map();
  private seenPairs: Map<string, number> = new Map(); // pairAddress -> last seen timestamp
  private pollingInterval: NodeJS.Timeout | null = null;
  private discoveryInterval: NodeJS.Timeout | null = null;
  
  // Configuration
  private config = {
    chains: (process.env.CHAINS || 'sol,eth,bsc,base').split(',') as ChainId[],
    refreshMs: parseInt(process.env.REFRESH_MS || '30000'),
    minLiquidityUsd: parseInt(process.env.MIN_LIQ_USD || '12000'),
    maxAgeHours: parseInt(process.env.MAX_AGE_HOURS || '48'),
    useBirdeye: process.env.USE_BIRDEYE === 'true',
    dexscreenerBase: process.env.DEXSCREENER_BASE || 'https://api.dexscreener.com',
    geckoterminalBase: process.env.GECKOTERMINAL_BASE || 'https://api.geckoterminal.com',
    birdeyeBase: process.env.BIRDEYE_BASE || 'https://public-api.birdeye.so',
  };
  
  // Rate limiting configuration
  private rateLimits: RateLimitConfig = {
    dexscreener: { rpm: 280, burst: 10 }, // Stay well below 300 rpm
    geckoterminal: { rpm: 100, burst: 5 },
    birdeye: { rps: 0.9, burst: 3 }, // ~1 rps with safety margin
  };
  
  // Health and metrics
  private healthMetrics: HealthMetrics = {
    callsPerMinute: {},
    statusCounts: {},
    cacheHitRatio: 0,
    queueSizes: {} as Record<ChainId, number>,
    droppedPairs: {},
    lastTickTimestamps: {} as Record<ChainId, number>,
  };
  
  // Token buckets for rate limiting
  private tokenBuckets: Map<string, { tokens: number; lastRefill: number }> = new Map();

  constructor(cache: CacheManager, rateLimiter: RateLimitManager) {
    super();
    this.cache = cache;
    this.rateLimiter = rateLimiter;
    
    // Initialize discovery queues for each chain
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
    
    // Initialize token buckets
    Object.keys(this.rateLimits).forEach(source => {
      this.tokenBuckets.set(source, { tokens: 0, lastRefill: Date.now() });
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    
    this.isRunning = true;
    logger.info('Enhanced DataCollector starting...', { 
      chains: this.config.chains,
      refreshMs: this.config.refreshMs 
    });
    
    // Start discovery process
    await this.startDiscovery();
    
    // Start polling process
    this.startPolling();
    
    // Start health metrics collection
    this.startHealthMetrics();
    
    logger.info('✅ Enhanced DataCollector started successfully');
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = null;
    }
    
    logger.info('DataCollector stopped');
  }

  // =============================================================================
  // DISCOVERY SYSTEM
  // =============================================================================

  private async startDiscovery(): Promise<void> {
    // Run initial discovery for all chains
    await this.runDiscoveryForAllChains();
    
    // Set up periodic discovery refresh
    this.discoveryInterval = setInterval(async () => {
      if (this.isRunning) {
        await this.runDiscoveryForAllChains();
      }
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  private async runDiscoveryForAllChains(): Promise<void> {
    const startTime = Date.now();
    logger.debug('Starting discovery cycle for all chains');
    
    for (const chainId of this.config.chains) {
      try {
        await this.discoverPairsForChain(chainId);
        // Jitter between chains to spread load
        await this.sleep(1000 + Math.random() * 2000);
      } catch (error) {
        logError(error as Error, `Discovery failed for chain ${chainId}`);
      }
    }
    
    const duration = Date.now() - startTime;
    logger.debug(`Discovery cycle completed in ${duration}ms`);
  }

  private async discoverPairsForChain(chainId: ChainId): Promise<void> {
    const queue = this.discoveryQueues.get(chainId);
    if (!queue) return;
    
    const now = Date.now();
    const maxAge = this.config.maxAgeHours * 60 * 60 * 1000;
    
    try {
      // Discover new pairs via search queries for common quote tokens
      const quoteTokens = this.getQuoteTokensForChain(chainId);
      
      for (const quoteToken of quoteTokens) {
        if (!await this.canMakeRequest('dexscreener')) {
          logger.warn(`Rate limited during discovery for ${chainId}, skipping ${quoteToken}`);
          break;
        }
        
        const pairs = await this.searchNewPairs(chainId, quoteToken);
        
        pairs.forEach(pair => {
          const ageMs = now - (pair.pairCreatedAt || 0) * 1000;
          if (ageMs <= maxAge && (pair.liquidity?.usd ?? 0) >= this.config.minLiquidityUsd) {
            queue.pairAddresses.add(pair.pairAddress);
          }
        });
        
        // Small delay between searches
        await this.sleep(500);
      }
      
      // Clean up old pairs from queue
      this.cleanupDiscoveryQueue(queue);
      
      queue.lastRefresh = now;
      this.healthMetrics.queueSizes[chainId] = queue.pairAddresses.size;
      
      logger.debug(`Discovery for ${chainId}: ${queue.pairAddresses.size} pairs in queue`);
      
    } catch (error) {
      logError(error as Error, `Discovery error for chain ${chainId}`);
    }
  }

  private getQuoteTokensForChain(chainId: ChainId): string[] {
    const quoteTokenMap: Record<ChainId, string[]> = {
      'sol': ['trending', 'SOL', 'USDC', 'USDT'],
      'eth': ['trending', 'WETH', 'USDC', 'USDT', 'ETH'],
      'bsc': ['trending', 'WBNB', 'USDT', 'BUSD', 'BNB'],
      'base': ['trending', 'WETH', 'USDC', 'ETH'],
    };
    return quoteTokenMap[chainId] || ['trending', 'USDC'];
  }

  private async searchNewPairs(chainId: ChainId, quoteToken: string): Promise<DexScreenerPair[]> {
    const cacheKey = `discovery:${chainId}:${quoteToken}`;
    
    // Check cache first
    const cached = await this.cache.get<DexScreenerPair[]>(cacheKey);
    if (cached) {
      this.updateCacheHitRatio(true);
      return cached;
    }
    this.updateCacheHitRatio(false);
    
    try {
      const chainMap: Record<ChainId, string> = {
        'sol': 'solana',
        'eth': 'ethereum',
        'bsc': 'bsc',
        'base': 'base'
      };
      
      let pairs: DexScreenerPair[] = [];
      
      // Strategy 1: Search for trending tokens
      if (quoteToken === 'trending') {
        const trendingQueries = ['pump', 'moon', 'doge', 'pepe', 'shib'];
        for (const query of trendingQueries) {
          if (!await this.canMakeRequest('dexscreener')) break;
          
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
      } else {
        // Strategy 2: Search by quote token
        const url = `${this.config.dexscreenerBase}/latest/dex/search`;
        const response = await this.makeRequest('dexscreener', url, {
          params: { q: `${quoteToken} ${chainMap[chainId]}` },
          timeout: 10000,
        });
        
        if (response.data?.pairs) {
          pairs = response.data.pairs;
        }
      }
      
      // Strategy 3: Try to get pairs by chain directly if search fails
      if (pairs.length === 0) {
        try {
          const directPairs = await this.getDexScreenerPairs(chainId, 20);
          pairs = directPairs;
        } catch (error) {
          logger.debug(`Direct chain fetch failed for ${chainId}`, error);
        }
      }
      
      const validPairs = pairs
        .filter((pair: any) => this.isValidPair(pair))
        .slice(0, 20); // Limit to prevent overwhelming
      
      // Cache for 2 minutes
      await this.cache.set(cacheKey, validPairs, 120);
      
      logger.debug(`Discovery found ${validPairs.length} pairs for ${chainId}:${quoteToken}`);
      return validPairs;
      
    } catch (error) {
      logError(error as Error, `Search failed for ${chainId}:${quoteToken}`);
      return [];
    }
  }

  private cleanupDiscoveryQueue(queue: DiscoveryQueue): void {
    const now = Date.now();
    const maxAge = this.config.maxAgeHours * 60 * 60 * 1000;
    
    // Remove pairs that are too old or in cooldown
    const toRemove: string[] = [];
    
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

  // =============================================================================
  // BATCH POLLING SYSTEM
  // =============================================================================

  private startPolling(): void {
    this.pollingInterval = setInterval(async () => {
      if (this.isRunning) {
        await this.runPollingCycle();
      }
    }, this.config.refreshMs);
    
    // Run initial polling cycle
    setTimeout(() => this.runPollingCycle(), 1000);
  }

  private async runPollingCycle(): Promise<void> {
    const startTime = Date.now();
    logger.debug('Starting polling cycle');
    
    const allUpdates: NormalizedPairData[] = [];
    
    // Poll each chain with jitter
    for (const chainId of this.config.chains) {
      try {
        const updates = await this.pollChain(chainId);
        allUpdates.push(...updates);
        this.healthMetrics.lastTickTimestamps[chainId] = Date.now();
        
        // Jitter between chains
        await this.sleep(500 + Math.random() * 1000);
      } catch (error) {
        logError(error as Error, `Polling failed for chain ${chainId}`);
      }
    }
    
    // Emit updates if we have any
    if (allUpdates.length > 0) {
      this.emit('collector.pairs.updates', allUpdates);
      logger.debug(`Emitted ${allUpdates.length} pair updates`);
    }
    
    const duration = Date.now() - startTime;
    logger.debug(`Polling cycle completed in ${duration}ms, ${allUpdates.length} updates`);
  }

  private async pollChain(chainId: ChainId): Promise<NormalizedPairData[]> {
    const queue = this.discoveryQueues.get(chainId);
    if (!queue || queue.pairAddresses.size === 0) {
      return [];
    }
    
    const updates: NormalizedPairData[] = [];
    const batchSize = 10; // Small batches to respect rate limits
    const pairAddresses = Array.from(queue.pairAddresses);
    
    for (let i = 0; i < pairAddresses.length; i += batchSize) {
      if (!await this.canMakeRequest('dexscreener')) {
        logger.warn(`Rate limited during polling for ${chainId}, stopping batch`);
        break;
      }
      
      const batch = pairAddresses.slice(i, i + batchSize);
      const batchUpdates = await this.pollPairBatch(chainId, batch);
      updates.push(...batchUpdates);
      
      // Small delay between batches
      await this.sleep(200);
    }
    
    return updates;
  }

  private async pollPairBatch(chainId: ChainId, pairAddresses: string[]): Promise<NormalizedPairData[]> {
    const updates: NormalizedPairData[] = [];
    
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
      } catch (error) {
        if (this.isNotFoundError(error)) {
          // Put pair in cooldown for 2-5 minutes
          const queue = this.discoveryQueues.get(chainId);
          if (queue) {
            const cooldownMs = (2 + Math.random() * 3) * 60 * 1000;
            queue.cooldownPairs.set(pairAddress, Date.now() + cooldownMs);
            this.healthMetrics.droppedPairs['404_cooldown'] = (this.healthMetrics.droppedPairs['404_cooldown'] || 0) + 1;
          }
        } else {
          logError(error as Error, `Failed to poll pair ${pairAddress}`);
        }
      }
    }
    
    return updates;
  }

  // =============================================================================
  // DATA FETCHING AND NORMALIZATION
  // =============================================================================

  private async fetchPairData(chainId: ChainId, pairAddress: string): Promise<DexScreenerPair | null> {
    const cacheKey = `pair:${chainId}:${pairAddress}`;
    
    // Check cache first
    const cached = await this.cache.get<DexScreenerPair>(cacheKey);
    if (cached) {
      this.updateCacheHitRatio(true);
      return cached;
    }
    this.updateCacheHitRatio(false);
    
    const chainMap: Record<ChainId, string> = {
      'sol': 'solana',
      'eth': 'ethereum',
      'bsc': 'bsc',
      'base': 'base'
    };
    
    const url = `${this.config.dexscreenerBase}/latest/dex/pairs/${chainMap[chainId]}/${pairAddress}`;
    
    const response = await this.makeRequest('dexscreener', url, { timeout: 8000 });
    
    if (response.data?.pair) {
      const pair = response.data.pair;
      
      // Cache for 30 seconds
      await this.cache.set(cacheKey, pair, 30);
      return pair;
    }
    
    return null;
  }

  private async normalizePairData(pair: DexScreenerPair): Promise<NormalizedPairData | null> {
    if (!this.isValidPair(pair)) {
      return null;
    }
    
    const chainId = this.mapChainId(pair.chainId);
    if (!chainId) return null;
    
    const now = Date.now();
    const tokenKey = `${chainId}:${pair.baseToken.address}`;
    
    // Extract transaction data
    const txns5m = pair.txns?.m5 || { buys: 0, sells: 0 };
    const volume5m = pair.volume?.m5 || 0;
    const volume1h = pair.volume?.h1 || 0;
    
    // Calculate 15m volume (estimate from 1h since m15 is not available in DexScreener API)
    const volume15m = volume1h / 4;
    
    // Update baselines and calculate slopes
    await this.updateTokenBaseline(tokenKey, {
      price: parseFloat(pair.priceUsd || '0'),
      volume15m,
      timestamp: now,
    });
    
    const baseline = this.baselines.get(tokenKey);
    const priceChange5m = pair.priceChange?.m5 || 0;
    
    const normalized: NormalizedPairData = {
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

  private mapChainId(dexScreenerChainId: string): ChainId | null {
    const chainMap: Record<string, ChainId> = {
      'solana': 'sol',
      'ethereum': 'eth',
      'bsc': 'bsc',
      'base': 'base',
    };
    return chainMap[dexScreenerChainId] || null;
  }

  // =============================================================================
  // BASELINE CALCULATIONS AND ROLLING WINDOWS
  // =============================================================================

  private async updateTokenBaseline(tokenKey: string, data: { price: number; volume15m: number; timestamp: number }): Promise<void> {
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
    
    // Add to price history (keep last 10 minutes for 1m slope, 30 minutes for 5m slope)
    baseline.priceHistory.push({ price: data.price, timestamp: data.timestamp });
    baseline.volumeHistory.push({ volume: data.volume15m, timestamp: data.timestamp });
    
    // Clean old data (keep 30 minutes)
    const cutoff = data.timestamp - 30 * 60 * 1000;
    baseline.priceHistory = baseline.priceHistory.filter(p => p.timestamp > cutoff);
    baseline.volumeHistory = baseline.volumeHistory.filter(v => v.timestamp > cutoff);
    
    // Calculate price slopes
    baseline.priceSlope1m = this.calculatePriceSlope(baseline.priceHistory, 1);
    baseline.priceSlope5m = this.calculatePriceSlope(baseline.priceHistory, 5);
    
    // Update volume baseline with exponential moving average
    const alpha = 0.1;
    baseline.vol15Baseline = baseline.vol15Baseline * (1 - alpha) + data.volume15m * alpha;
    baseline.lastUpdated = data.timestamp;
    
    // If we don't have enough price history, try to backfill from GeckoTerminal
    if (baseline.priceHistory.length < 5 && this.config.geckoterminalBase) {
      await this.backfillPriceHistory(tokenKey, baseline);
    }
  }

  private calculatePriceSlope(priceHistory: Array<{ price: number; timestamp: number }>, minutes: number): number {
    const cutoff = Date.now() - minutes * 60 * 1000;
    const relevantPrices = priceHistory.filter(p => p.timestamp > cutoff);
    
    if (relevantPrices.length < 2) return 0;
    
    // Simple linear regression slope
    const n = relevantPrices.length;
    const sumX = relevantPrices.reduce((sum, p, i) => sum + i, 0);
    const sumY = relevantPrices.reduce((sum, p) => sum + p.price, 0);
    const sumXY = relevantPrices.reduce((sum, p, i) => sum + i * p.price, 0);
    const sumXX = relevantPrices.reduce((sum, p, i) => sum + i * i, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    return isFinite(slope) ? slope : 0;
  }

  private async backfillPriceHistory(tokenKey: string, baseline: TokenBaseline): Promise<void> {
    // This would fetch OHLC data from GeckoTerminal to backfill missing price history
    // Implementation would depend on having the pool address and respecting rate limits
    // For now, we'll skip this to avoid complexity
  }

  // =============================================================================
  // DE-DUPLICATION AND STABILITY CHECKS
  // =============================================================================

  private shouldEmitUpdate(normalized: NormalizedPairData): boolean {
    const key = `${normalized.chainId}:${normalized.pairAddress}`;
    const lastData = this.cache.get(`last_emit:${key}`);
    
    if (!lastData) {
      // First time seeing this pair, emit it
      this.cache.set(`last_emit:${key}`, normalized, 300);
      return true;
    }
    
    // Check if meaningful fields changed
    const threshold = 0.05; // 5% change threshold
    const priceChanged = Math.abs(normalized.stats.price_usd - (lastData as any).stats.price_usd) / (lastData as any).stats.price_usd > threshold;
    const volumeChanged = Math.abs(normalized.stats.vol_5_usd - (lastData as any).stats.vol_5_usd) / Math.max((lastData as any).stats.vol_5_usd, 1) > threshold;
    const liquidityChanged = Math.abs(normalized.stats.liquidity_usd - (lastData as any).stats.liquidity_usd) / (lastData as any).stats.liquidity_usd > threshold;
    
    // Emit every 5 minutes as heartbeat regardless
    const timeSinceLastEmit = normalized.ts - (lastData as any).ts;
    const heartbeat = timeSinceLastEmit > 5 * 60 * 1000;
    
    if (priceChanged || volumeChanged || liquidityChanged || heartbeat) {
      this.cache.set(`last_emit:${key}`, normalized, 300);
      return true;
    }
    
    return false;
  }

  // =============================================================================
  // RATE LIMITING AND REQUEST MANAGEMENT
  // =============================================================================

  private async canMakeRequest(source: string): Promise<boolean> {
    const bucket = this.tokenBuckets.get(source);
    if (!bucket) return false;
    
    const now = Date.now();
    const config = this.rateLimits[source as keyof RateLimitConfig];
    
    // Refill tokens based on time passed
    const timePassed = now - bucket.lastRefill;
    let tokensToAdd = 0;
    
    if ('rpm' in config) {
      tokensToAdd = (timePassed / 60000) * config.rpm;
    } else if ('rps' in config) {
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

  private async makeRequest(source: string, url: string, options: any = {}): Promise<AxiosResponse> {
    const startTime = Date.now();
    
    try {
      const response = await axios.get(url, {
        ...options,
        headers: {
          'User-Agent': 'Meme-Coin-Radar/1.0',
          ...options.headers,
        },
      });
      
      const duration = Date.now() - startTime;
      this.recordApiCall(source, response.status, duration, true);
      
      return response;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const status = error.response?.status || 0;
      this.recordApiCall(source, status, duration, false);
      
      if (status === 429) {
        await this.handleRateLimit(source, error.response?.headers['retry-after']);
      }
      
      throw error;
    }
  }

  private async handleRateLimit(source: string, retryAfter?: string): Promise<void> {
    const delay = retryAfter ? parseInt(retryAfter) * 1000 : Math.min(30000, Math.pow(2, 3) * 1000);
    logger.warn(`Rate limited by ${source}, backing off for ${delay}ms`);
    
    // Reset token bucket
    const bucket = this.tokenBuckets.get(source);
    if (bucket) {
      bucket.tokens = 0;
      bucket.lastRefill = Date.now() + delay;
    }
    
    await this.sleep(delay);
  }

  private recordApiCall(source: string, status: number, duration: number, success: boolean): void {
    // Update calls per minute
    this.healthMetrics.callsPerMinute[source] = (this.healthMetrics.callsPerMinute[source] || 0) + 1;
    
    // Update status counts
    if (!this.healthMetrics.statusCounts[source]) {
      this.healthMetrics.statusCounts[source] = {};
    }
    this.healthMetrics.statusCounts[source][status] = (this.healthMetrics.statusCounts[source][status] || 0) + 1;
    
    logApiRequest(source, 'request', duration, success, status);
  }

  // =============================================================================
  // HEALTH METRICS AND MONITORING
  // =============================================================================

  private startHealthMetrics(): void {
    // Reset metrics every minute
    setInterval(() => {
      this.healthMetrics.callsPerMinute = {};
    }, 60000);
    
    // Emit health metrics every 30 seconds
    setInterval(() => {
      this.emit('health', this.getHealthMetrics());
    }, 30000);
  }

  private updateCacheHitRatio(hit: boolean): void {
    // Simple moving average for cache hit ratio
    const alpha = 0.1;
    const hitValue = hit ? 1 : 0;
    this.healthMetrics.cacheHitRatio = this.healthMetrics.cacheHitRatio * (1 - alpha) + hitValue * alpha;
  }

  getHealthMetrics(): HealthMetrics {
    return { ...this.healthMetrics };
  }

  // =============================================================================
  // UTILITY METHODS
  // =============================================================================

  private isValidPair(pair: any): boolean {
    return (
      pair &&
      pair.baseToken &&
      pair.baseToken.address &&
      pair.baseToken.symbol &&
      pair.priceUsd &&
      parseFloat(pair.priceUsd) > 0 &&
      pair.liquidity &&
      pair.liquidity.usd &&
      parseFloat(pair.liquidity.usd) >= this.config.minLiquidityUsd &&
      pair.pairAddress
    );
  }

  private isNotFoundError(error: any): boolean {
    return error.response?.status === 404;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // =============================================================================
  // LEGACY COMPATIBILITY METHODS
  // =============================================================================

  async getDexScreenerPairs(chainId: ChainId, limit: number = 50): Promise<DexScreenerPair[]> {
    const cacheKey = `dexscreener:pairs:${chainId}:${limit}`;
    
    const cached = await this.cache.get<DexScreenerPair[]>(cacheKey);
    if (cached) {
      return cached;
    }

    if (!await this.canMakeRequest('dexscreener')) {
      logger.warn('DEX Screener rate limited, using cached data');
      return cached || [];
    }

    try {
      const chainMap: Record<ChainId, string> = {
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
          .filter((pair: any) => this.isValidPair(pair));

        await this.cache.set(cacheKey, pairs, 60);
        
        logger.debug(`Fetched ${pairs.length} pairs from DEX Screener for ${chainId}`);
        return pairs;
      }

      return [];
    } catch (error: any) {
      logError(error, 'DEX Screener API error');
      return cached || [];
    }
  }

  async searchDexScreenerTokens(query: string, chainId?: ChainId): Promise<DexScreenerPair[]> {
    const cacheKey = `dexscreener:search:${query}:${chainId || 'all'}`;
    
    const cached = await this.cache.get<DexScreenerPair[]>(cacheKey);
    if (cached) {
      return cached;
    }

    if (!await this.canMakeRequest('dexscreener')) {
      logger.warn('DEX Screener rate limited for search');
      return cached || [];
    }

    try {
      const url = `${this.config.dexscreenerBase}/latest/dex/search/?q=${encodeURIComponent(query)}`;
      
      const response = await this.makeRequest('dexscreener', url, { timeout: 10000 });

      if (response.data && response.data.pairs) {
        let pairs = response.data.pairs.filter((pair: any) => this.isValidPair(pair));
        
        if (chainId) {
          const chainMap: Record<ChainId, string> = {
            'sol': 'solana',
            'eth': 'ethereum', 
            'bsc': 'bsc',
            'base': 'base'
          };
          pairs = pairs.filter((pair: any) => pair.chainId === chainMap[chainId]);
        }

        await this.cache.set(cacheKey, pairs, 300);
        return pairs;
      }

      return [];
    } catch (error: any) {
      logError(error, 'DEX Screener search error');
      return cached || [];
    }
  }

  async getTokensByChain(chainId: ChainId, minLiquidity: number = 12000): Promise<DexScreenerPair[]> {
    try {
      const pairs = await this.getDexScreenerPairs(chainId, 100);
      
      return pairs.filter(pair => {
        const liquidity = pair.liquidity?.usd || 0;
        const age = pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt * 1000 : 0;
        const maxAge = this.config.maxAgeHours * 60 * 60 * 1000;
        
        return (
          liquidity >= minLiquidity &&
          age <= maxAge &&
          pair.txns.h24.buys + pair.txns.h24.sells > 10
        );
      });
    } catch (error) {
      logError(error as Error, `Failed to get tokens for chain ${chainId}`);
      return [];
    }
  }

  getHealthStatus(): { status: 'up' | 'down' | 'degraded'; lastCheck: number; error?: string } {
    const errorRate = this.calculateErrorRate();
    let status: 'up' | 'down' | 'degraded' = 'up';
    
    if (!this.isRunning) {
      status = 'down';
    } else if (errorRate > 0.1) { // More than 10% error rate
      status = 'degraded';
    }
    
    return {
      status,
      lastCheck: Date.now(),
    };
  }

  private calculateErrorRate(): number {
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

  // Placeholder methods for compatibility
  async getGeckoTerminalOHLC(): Promise<GeckoTerminalOHLC | null> { return null; }
  async getBirdeyeTrendingTokens(): Promise<BirdeyeTokenData[]> { return []; }
  async getBirdeyeTokenInfo(): Promise<BirdeyeTokenData | null> { return null; }
  updateBaseline(): void {}
  getBaseline(): any { return null; }
  async enrichWithBirdeyeData(pairs: DexScreenerPair[]): Promise<DexScreenerPair[]> { return pairs; }
}