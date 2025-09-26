import axios from 'axios';
import * as cheerio from 'cheerio';
import cron from 'node-cron';
import { logger } from '../utils/logger';
import { ExchangeMonitor } from './exchangeMonitors';
import { CEXListingEvent, ExchangeAnnouncement } from '@shared/types';

interface SentinelConfig {
  exchanges: string[];
  checkInterval: number;
  apiWebhookUrl: string;
}

export class CEXSentinel {
  private config: SentinelConfig;
  private exchangeMonitors: Map<string, ExchangeMonitor> = new Map();
  private isRunning: boolean = false;
  private cronJobs: cron.ScheduledTask[] = [];
  private lastAnnouncementIds: Map<string, string> = new Map();

  constructor() {
    this.config = {
      exchanges: (process.env.MONITORED_EXCHANGES || 'kucoin,bybit,mexc,gate,lbank,bitmart').split(','),
      checkInterval: parseInt(process.env.SENTINEL_CHECK_INTERVAL || '120000'),
      apiWebhookUrl: process.env.API_BASE_URL ? `${process.env.API_BASE_URL}/api/webhooks/cex-listing` : 'http://localhost:3001/api/webhooks/cex-listing',
    };

    this.initializeExchangeMonitors();
  }

  private initializeExchangeMonitors(): void {
    // Initialize monitors for each exchange
    this.config.exchanges.forEach(exchange => {
      const monitor = new ExchangeMonitor(exchange);
      this.exchangeMonitors.set(exchange, monitor);
    });

    logger.info(`Initialized monitors for ${this.config.exchanges.length} exchanges`, {
      exchanges: this.config.exchanges,
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('CEX Sentinel already running');
      return;
    }

    try {
      this.isRunning = true;

      // Start monitoring each exchange with staggered schedule
      this.startStaggeredMonitoring();

      // Run initial check
      await this.runInitialCheck();

      logger.info('CEX Sentinel started successfully');
    } catch (error) {
      logger.error('Failed to start CEX Sentinel:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('Stopping CEX Sentinel...');
    
    this.isRunning = false;

    // Stop all cron jobs
    this.cronJobs.forEach(job => {
      job.stop();
    });
    this.cronJobs = [];

    logger.info('CEX Sentinel stopped');
  }

  private startStaggeredMonitoring(): void {
    const exchanges = this.config.exchanges;
    const intervalMinutes = Math.max(1, Math.floor(this.config.checkInterval / 60000));
    const staggerDelayMinutes = Math.max(1, Math.floor(intervalMinutes / exchanges.length));

    exchanges.forEach((exchange, index) => {
      const delayMinutes = index * staggerDelayMinutes;
      const cronExpression = `${delayMinutes}-59/${intervalMinutes} * * * *`;

      logger.info(`Scheduling ${exchange} monitoring`, {
        cronExpression,
        delayMinutes,
        intervalMinutes,
      });

      const job = cron.schedule(cronExpression, async () => {
        if (this.isRunning) {
          await this.checkExchange(exchange);
        }
      }, {
        scheduled: true,
        timezone: 'UTC',
      });

      this.cronJobs.push(job);
    });
  }

  private async runInitialCheck(): Promise<void> {
    logger.info('Running initial check for all exchanges...');
    
    for (const exchange of this.config.exchanges) {
      try {
        await this.checkExchange(exchange);
        // Add delay between exchanges to avoid overwhelming servers
        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (error) {
        logger.error(`Initial check failed for ${exchange}:`, error);
      }
    }
  }

  private async checkExchange(exchange: string): Promise<void> {
    const monitor = this.exchangeMonitors.get(exchange);
    if (!monitor) {
      logger.error(`No monitor found for exchange: ${exchange}`);
      return;
    }

    try {
      logger.debug(`Checking ${exchange} for new announcements...`);
      
      const announcements = await monitor.getLatestAnnouncements();
      
      if (announcements.length === 0) {
        logger.debug(`No announcements found for ${exchange}`);
        return;
      }

      // Filter new announcements
      const newAnnouncements = this.filterNewAnnouncements(exchange, announcements);
      
      if (newAnnouncements.length === 0) {
        logger.debug(`No new announcements for ${exchange}`);
        return;
      }

      logger.info(`Found ${newAnnouncements.length} new announcements for ${exchange}`);

      // Process each new announcement
      for (const announcement of newAnnouncements) {
        await this.processAnnouncement(exchange, announcement);
      }

      // Update last announcement ID
      if (announcements.length > 0) {
        const latestId = announcements[0].title + announcements[0].publishedAt;
        this.lastAnnouncementIds.set(exchange, latestId);
      }

    } catch (error) {
      logger.error(`Failed to check ${exchange}:`, error);
    }
  }

  private filterNewAnnouncements(exchange: string, announcements: ExchangeAnnouncement[]): ExchangeAnnouncement[] {
    const lastId = this.lastAnnouncementIds.get(exchange);
    
    if (!lastId) {
      // First run - only process the most recent announcement to avoid spam
      return announcements.slice(0, 1);
    }

    const newAnnouncements: ExchangeAnnouncement[] = [];
    
    for (const announcement of announcements) {
      const currentId = announcement.title + announcement.publishedAt;
      
      if (currentId === lastId) {
        break; // Found the last processed announcement
      }
      
      newAnnouncements.push(announcement);
    }

    return newAnnouncements;
  }

  private async processAnnouncement(exchange: string, announcement: ExchangeAnnouncement): Promise<void> {
    try {
      logger.info(`Processing announcement from ${exchange}`, {
        title: announcement.title,
        url: announcement.url,
      });

      // Analyze announcement for token listings
      const listingEvents = await this.analyzeAnnouncementForListings(exchange, announcement);

      if (listingEvents.length === 0) {
        logger.debug(`No token listings found in announcement: ${announcement.title}`);
        return;
      }

      // Send listing events to API
      for (const event of listingEvents) {
        await this.sendListingEvent(event);
      }

    } catch (error) {
      logger.error(`Failed to process announcement from ${exchange}:`, error);
    }
  }

  private async analyzeAnnouncementForListings(exchange: string, announcement: ExchangeAnnouncement): Promise<CEXListingEvent[]> {
    const events: CEXListingEvent[] = [];

    // Check if this is a listing announcement
    if (!this.isListingAnnouncement(announcement)) {
      return events;
    }

    // Extract token information from announcement
    const tokens = this.extractTokensFromAnnouncement(announcement);

    for (const token of tokens) {
      try {
        // Try to get additional token data
        const tokenData = await this.enrichTokenData(token);

        const event: CEXListingEvent = {
          source: 'cex_listing',
          exchange,
          markets: announcement.markets,
          urls: [announcement.url],
          token: {
            symbol: tokenData.symbol,
            address: tokenData.address || '',
            chainId: tokenData.chainId || 'eth',
          },
          confirmation: tokenData.address ? 'address' : 'coingecko',
          radarScore: 75, // Base score for CEX listings
          liquidityUsd: 0, // Will be updated by orchestrator
          ts: announcement.publishedAt,
        };

        events.push(event);

        logger.info(`Created CEX listing event`, {
          exchange,
          symbol: token.symbol,
          address: tokenData.address,
          confirmation: event.confirmation,
        });

      } catch (error) {
        logger.error(`Failed to create listing event for ${token.symbol}:`, error);
      }
    }

    return events;
  }

  private isListingAnnouncement(announcement: ExchangeAnnouncement): boolean {
    const title = announcement.title.toLowerCase();
    const content = announcement.content.toLowerCase();
    
    const listingKeywords = [
      'listing',
      'list',
      'added',
      'support',
      'launch',
      'available',
      'trading',
      'spot trading',
      'new token',
      'new coin',
    ];

    const excludeKeywords = [
      'delisting',
      'delist',
      'suspend',
      'maintenance',
      'withdrawal',
      'deposit',
      'upgrade',
      'migration',
    ];

    // Check for listing keywords
    const hasListingKeyword = listingKeywords.some(keyword => 
      title.includes(keyword) || content.includes(keyword)
    );

    // Check for exclude keywords
    const hasExcludeKeyword = excludeKeywords.some(keyword => 
      title.includes(keyword) || content.includes(keyword)
    );

    return hasListingKeyword && !hasExcludeKeyword;
  }

  private extractTokensFromAnnouncement(announcement: ExchangeAnnouncement): Array<{ symbol: string; name?: string }> {
    const tokens: Array<{ symbol: string; name?: string }> = [];
    
    // Extract from pre-parsed tokens
    if (announcement.tokens && announcement.tokens.length > 0) {
      return announcement.tokens.map(token => ({
        symbol: token.symbol,
        name: token.symbol, // Use symbol as name if not available
      }));
    }

    // Extract from title and content using regex
    const text = `${announcement.title} ${announcement.content}`;
    
    // Common patterns for token symbols
    const patterns = [
      /\b([A-Z]{2,10})\s*\(/g, // SYMBOL (
      /\(([A-Z]{2,10})\)/g,     // (SYMBOL)
      /\b([A-Z]{2,10})\s*token/gi,
      /\b([A-Z]{2,10})\s*coin/gi,
    ];

    const foundSymbols = new Set<string>();

    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const symbol = match[1].toUpperCase();
        
        // Filter out common false positives
        if (this.isValidTokenSymbol(symbol)) {
          foundSymbols.add(symbol);
        }
      }
    });

    foundSymbols.forEach(symbol => {
      tokens.push({ symbol });
    });

    return tokens;
  }

  private isValidTokenSymbol(symbol: string): boolean {
    // Filter out common false positives
    const excludeList = [
      'USD', 'USDT', 'USDC', 'BTC', 'ETH', 'BNB', // Common base currencies
      'API', 'URL', 'HTTP', 'HTTPS', 'WWW', 'COM', // Technical terms
      'NEW', 'OLD', 'ALL', 'AND', 'THE', 'FOR', // Common words
      'UTC', 'GMT', 'EST', 'PST', // Time zones
      'CEO', 'CTO', 'CMO', 'CFO', // Titles
    ];

    return (
      symbol.length >= 2 &&
      symbol.length <= 10 &&
      !excludeList.includes(symbol) &&
      /^[A-Z]+$/.test(symbol) // Only uppercase letters
    );
  }

  private async enrichTokenData(token: { symbol: string; name?: string }): Promise<{
    symbol: string;
    address?: string;
    chainId?: string;
  }> {
    // Try to get token address from CoinGecko
    try {
      const response = await axios.get(`https://api.coingecko.com/api/v3/search`, {
        params: { query: token.symbol },
        timeout: 10000,
      });

      if (response.data && response.data.coins && response.data.coins.length > 0) {
        const coin = response.data.coins.find((c: any) => 
          c.symbol.toLowerCase() === token.symbol.toLowerCase()
        );

        if (coin && coin.platforms) {
          // Try to find Ethereum address first, then others
          const platforms = coin.platforms;
          
          if (platforms.ethereum) {
            return {
              symbol: token.symbol,
              address: platforms.ethereum,
              chainId: 'eth',
            };
          }
          
          if (platforms['binance-smart-chain']) {
            return {
              symbol: token.symbol,
              address: platforms['binance-smart-chain'],
              chainId: 'bsc',
            };
          }
          
          if (platforms.solana) {
            return {
              symbol: token.symbol,
              address: platforms.solana,
              chainId: 'sol',
            };
          }
        }
      }
    } catch (error) {
      logger.debug(`Failed to enrich token data for ${token.symbol}:`, error);
    }

    // Return basic data if enrichment fails
    return {
      symbol: token.symbol,
    };
  }

  private async sendListingEvent(event: CEXListingEvent): Promise<void> {
    try {
      const response = await axios.post(this.config.apiWebhookUrl, event, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'CEX-Sentinel/1.0',
        },
      });

      if (response.status >= 200 && response.status < 300) {
        logger.info(`Successfully sent CEX listing event`, {
          exchange: event.exchange,
          symbol: event.token.symbol,
        });
      } else {
        logger.error(`Failed to send CEX listing event, status: ${response.status}`);
      }

    } catch (error) {
      logger.error(`Failed to send CEX listing event:`, error);
    }
  }

  getHealthStatus(): { status: 'up' | 'down' | 'degraded'; lastCheck: number; error?: string } {
    return {
      status: this.isRunning ? 'up' : 'down',
      lastCheck: Date.now(),
    };
  }

  getMonitoredExchanges(): string[] {
    return this.config.exchanges;
  }

  getLastAnnouncementIds(): Record<string, string> {
    const result: Record<string, string> = {};
    this.lastAnnouncementIds.forEach((id, exchange) => {
      result[exchange] = id;
    });
    return result;
  }
}