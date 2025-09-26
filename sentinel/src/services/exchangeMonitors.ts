import axios from 'axios';
import * as cheerio from 'cheerio';
import { logger } from '../utils/logger';
import { ExchangeAnnouncement } from '@shared/types';

export class ExchangeMonitor {
  private exchange: string;
  private userAgent: string = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  constructor(exchange: string) {
    this.exchange = exchange;
  }

  async getLatestAnnouncements(): Promise<ExchangeAnnouncement[]> {
    switch (this.exchange.toLowerCase()) {
      case 'kucoin':
        return this.getKuCoinAnnouncements();
      case 'bybit':
        return this.getBybitAnnouncements();
      case 'mexc':
        return this.getMEXCAnnouncements();
      case 'gate':
        return this.getGateAnnouncements();
      case 'lbank':
        return this.getLBankAnnouncements();
      case 'bitmart':
        return this.getBitMartAnnouncements();
      default:
        logger.warn(`Unsupported exchange: ${this.exchange}`);
        return [];
    }
  }

  // =============================================================================
  // KUCOIN MONITOR
  // =============================================================================

  private async getKuCoinAnnouncements(): Promise<ExchangeAnnouncement[]> {
    try {
      const response = await axios.get('https://www.kucoin.com/news/categories/listing', {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
        },
        timeout: 15000,
      });

      const $ = cheerio.load(response.data);
      const announcements: ExchangeAnnouncement[] = [];

      $('.news-item').each((index, element) => {
        try {
          const $item = $(element);
          const title = $item.find('.news-title').text().trim();
          const url = 'https://www.kucoin.com' + $item.find('a').attr('href');
          const dateText = $item.find('.news-date').text().trim();
          
          if (title && url) {
            announcements.push({
              exchange: 'kucoin',
              title,
              content: title, // Use title as content for now
              url,
              publishedAt: this.parseKuCoinDate(dateText),
              tokens: this.extractTokensFromTitle(title),
              markets: this.extractMarketsFromTitle(title),
            });
          }
        } catch (error) {
          logger.debug('Failed to parse KuCoin announcement item:', error);
        }
      });

      logger.debug(`Found ${announcements.length} KuCoin announcements`);
      return announcements.slice(0, 10); // Return latest 10

    } catch (error) {
      logger.error('Failed to fetch KuCoin announcements:', error);
      return [];
    }
  }

  private parseKuCoinDate(dateText: string): number {
    try {
      // KuCoin typically uses formats like "2024-01-15" or "Jan 15, 2024"
      const date = new Date(dateText);
      return date.getTime();
    } catch {
      return Date.now();
    }
  }

  // =============================================================================
  // BYBIT MONITOR
  // =============================================================================

  private async getBybitAnnouncements(): Promise<ExchangeAnnouncement[]> {
    try {
      const response = await axios.get('https://announcements.bybit.com/en-US/article/category/spot/?page=1&limit=20', {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'application/json',
        },
        timeout: 15000,
      });

      const announcements: ExchangeAnnouncement[] = [];

      if (response.data && response.data.result && response.data.result.list) {
        response.data.result.list.forEach((item: any) => {
          try {
            if (item.title && item.url) {
              announcements.push({
                exchange: 'bybit',
                title: item.title,
                content: item.description || item.title,
                url: `https://announcements.bybit.com${item.url}`,
                publishedAt: new Date(item.dateTime).getTime(),
                tokens: this.extractTokensFromTitle(item.title),
                markets: this.extractMarketsFromTitle(item.title),
              });
            }
          } catch (error) {
            logger.debug('Failed to parse Bybit announcement item:', error);
          }
        });
      }

      logger.debug(`Found ${announcements.length} Bybit announcements`);
      return announcements.slice(0, 10);

    } catch (error) {
      logger.error('Failed to fetch Bybit announcements:', error);
      return [];
    }
  }

  // =============================================================================
  // MEXC MONITOR
  // =============================================================================

  private async getMEXCAnnouncements(): Promise<ExchangeAnnouncement[]> {
    try {
      const response = await axios.get('https://www.mexc.com/support/sections/360000203952', {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        timeout: 15000,
      });

      const $ = cheerio.load(response.data);
      const announcements: ExchangeAnnouncement[] = [];

      $('.article-list-item').each((index, element) => {
        try {
          const $item = $(element);
          const title = $item.find('.article-title').text().trim();
          const url = 'https://www.mexc.com' + $item.find('a').attr('href');
          const dateText = $item.find('.article-created-at').text().trim();
          
          if (title && url) {
            announcements.push({
              exchange: 'mexc',
              title,
              content: title,
              url,
              publishedAt: new Date(dateText).getTime() || Date.now(),
              tokens: this.extractTokensFromTitle(title),
              markets: this.extractMarketsFromTitle(title),
            });
          }
        } catch (error) {
          logger.debug('Failed to parse MEXC announcement item:', error);
        }
      });

      logger.debug(`Found ${announcements.length} MEXC announcements`);
      return announcements.slice(0, 10);

    } catch (error) {
      logger.error('Failed to fetch MEXC announcements:', error);
      return [];
    }
  }

  // =============================================================================
  // GATE.IO MONITOR
  // =============================================================================

  private async getGateAnnouncements(): Promise<ExchangeAnnouncement[]> {
    try {
      const response = await axios.get('https://www.gate.io/en/article/list/announcement', {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        timeout: 15000,
      });

      const $ = cheerio.load(response.data);
      const announcements: ExchangeAnnouncement[] = [];

      $('.announcement-item').each((index, element) => {
        try {
          const $item = $(element);
          const title = $item.find('.title').text().trim();
          const url = 'https://www.gate.io' + $item.find('a').attr('href');
          const dateText = $item.find('.time').text().trim();
          
          if (title && url) {
            announcements.push({
              exchange: 'gate',
              title,
              content: title,
              url,
              publishedAt: new Date(dateText).getTime() || Date.now(),
              tokens: this.extractTokensFromTitle(title),
              markets: this.extractMarketsFromTitle(title),
            });
          }
        } catch (error) {
          logger.debug('Failed to parse Gate.io announcement item:', error);
        }
      });

      logger.debug(`Found ${announcements.length} Gate.io announcements`);
      return announcements.slice(0, 10);

    } catch (error) {
      logger.error('Failed to fetch Gate.io announcements:', error);
      return [];
    }
  }

  // =============================================================================
  // LBANK MONITOR
  // =============================================================================

  private async getLBankAnnouncements(): Promise<ExchangeAnnouncement[]> {
    try {
      const response = await axios.get('https://www.lbank.info/en-US/notice', {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        timeout: 15000,
      });

      const $ = cheerio.load(response.data);
      const announcements: ExchangeAnnouncement[] = [];

      $('.notice-item').each((index, element) => {
        try {
          const $item = $(element);
          const title = $item.find('.notice-title').text().trim();
          const url = 'https://www.lbank.info' + $item.find('a').attr('href');
          const dateText = $item.find('.notice-time').text().trim();
          
          if (title && url) {
            announcements.push({
              exchange: 'lbank',
              title,
              content: title,
              url,
              publishedAt: new Date(dateText).getTime() || Date.now(),
              tokens: this.extractTokensFromTitle(title),
              markets: this.extractMarketsFromTitle(title),
            });
          }
        } catch (error) {
          logger.debug('Failed to parse LBank announcement item:', error);
        }
      });

      logger.debug(`Found ${announcements.length} LBank announcements`);
      return announcements.slice(0, 10);

    } catch (error) {
      logger.error('Failed to fetch LBank announcements:', error);
      return [];
    }
  }

  // =============================================================================
  // BITMART MONITOR
  // =============================================================================

  private async getBitMartAnnouncements(): Promise<ExchangeAnnouncement[]> {
    try {
      const response = await axios.get('https://www.bitmart.com/notice/en-US', {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        timeout: 15000,
      });

      const $ = cheerio.load(response.data);
      const announcements: ExchangeAnnouncement[] = [];

      $('.notice-list-item').each((index, element) => {
        try {
          const $item = $(element);
          const title = $item.find('.notice-title').text().trim();
          const url = 'https://www.bitmart.com' + $item.find('a').attr('href');
          const dateText = $item.find('.notice-date').text().trim();
          
          if (title && url) {
            announcements.push({
              exchange: 'bitmart',
              title,
              content: title,
              url,
              publishedAt: new Date(dateText).getTime() || Date.now(),
              tokens: this.extractTokensFromTitle(title),
              markets: this.extractMarketsFromTitle(title),
            });
          }
        } catch (error) {
          logger.debug('Failed to parse BitMart announcement item:', error);
        }
      });

      logger.debug(`Found ${announcements.length} BitMart announcements`);
      return announcements.slice(0, 10);

    } catch (error) {
      logger.error('Failed to fetch BitMart announcements:', error);
      return [];
    }
  }

  // =============================================================================
  // UTILITY METHODS
  // =============================================================================

  private extractTokensFromTitle(title: string): Array<{ symbol: string; address?: string; chainId?: string }> {
    const tokens: Array<{ symbol: string; address?: string; chainId?: string }> = [];
    
    // Common patterns for token symbols in titles
    const patterns = [
      /\b([A-Z]{2,10})\s*\(/g,     // SYMBOL (
      /\(([A-Z]{2,10})\)/g,        // (SYMBOL)
      /\b([A-Z]{2,10})\s+token/gi, // SYMBOL token
      /\b([A-Z]{2,10})\s+coin/gi,  // SYMBOL coin
      /\b([A-Z]{2,10})\s+listing/gi, // SYMBOL listing
      /listing\s+([A-Z]{2,10})/gi, // listing SYMBOL
      /support\s+([A-Z]{2,10})/gi, // support SYMBOL
    ];

    const foundSymbols = new Set<string>();

    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(title)) !== null) {
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

  private extractMarketsFromTitle(title: string): string[] {
    const markets: string[] = [];
    const lowerTitle = title.toLowerCase();
    
    // Common trading pair patterns
    const pairPatterns = [
      /([A-Z]{2,10})\/([A-Z]{2,10})/g,  // SYMBOL/USDT
      /([A-Z]{2,10})-([A-Z]{2,10})/g,   // SYMBOL-USDT
    ];

    pairPatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(title)) !== null) {
        markets.push(`${match[1]}/${match[2]}`);
      }
    });

    // If no specific pairs found, look for common base currencies
    if (markets.length === 0) {
      const baseCurrencies = ['USDT', 'USDC', 'BTC', 'ETH', 'BNB'];
      baseCurrencies.forEach(base => {
        if (lowerTitle.includes(base.toLowerCase())) {
          markets.push(`*/${base}`);
        }
      });
    }

    return markets;
  }

  private isValidTokenSymbol(symbol: string): boolean {
    // Filter out common false positives
    const excludeList = [
      'USD', 'USDT', 'USDC', 'BTC', 'ETH', 'BNB', // Common base currencies
      'API', 'URL', 'HTTP', 'HTTPS', 'WWW', 'COM', // Technical terms
      'NEW', 'OLD', 'ALL', 'AND', 'THE', 'FOR', 'NOW', // Common words
      'UTC', 'GMT', 'EST', 'PST', 'PDT', 'EDT', // Time zones
      'CEO', 'CTO', 'CMO', 'CFO', 'COO', // Titles
      'FAQ', 'AMA', 'IEO', 'ICO', 'IDO', // Crypto terms that aren't tokens
      'KYC', 'AML', 'P2P', 'OTC', 'DEX', 'CEX', // More crypto terms
    ];

    return (
      symbol.length >= 2 &&
      symbol.length <= 10 &&
      !excludeList.includes(symbol) &&
      /^[A-Z]+$/.test(symbol) && // Only uppercase letters
      !symbol.match(/^[0-9]+$/) // Not just numbers
    );
  }
}