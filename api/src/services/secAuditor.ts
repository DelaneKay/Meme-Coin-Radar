import axios, { AxiosResponse } from 'axios';
import { secAuditorLogger as logger, logApiRequest, logError } from '../utils/logger';
import { CacheManager } from '../utils/cache';
import { RateLimitManager } from '../utils/rateLimiter';
import { 
  SecurityReport, 
  GoPlusSecurityData, 
  HoneypotIsResponse,
  ChainId 
} from '../types';

interface SecurityFlags {
  isHoneypot: boolean;
  highTax: boolean;
  upgradeable: boolean;
  blacklistable: boolean;
  mintable: boolean;
  cannotSell: boolean;
  fakeToken: boolean;
  airdropScam: boolean;
  antiWhale: boolean;
  tradingCooldown: boolean;
  externalCall: boolean;
  gasAbuse: boolean;
}

export class SecAuditor {
  private cache: CacheManager;
  private rateLimiter: RateLimitManager;
  private isRunning: boolean = false;
  private maxConcurrentChecks: number;

  constructor(cache: CacheManager, rateLimiter: RateLimitManager) {
    this.cache = cache;
    this.rateLimiter = rateLimiter;
    this.maxConcurrentChecks = parseInt(process.env.MAX_CONCURRENT_SECURITY_CHECKS || '5');
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    
    this.isRunning = true;
    logger.info('SecAuditor started');
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    logger.info('SecAuditor stopped');
  }

  // =============================================================================
  // MAIN SECURITY ANALYSIS
  // =============================================================================

  async analyzeToken(address: string, chainId: ChainId): Promise<SecurityReport> {
    const cacheKey = `security:${chainId}:${address}`;
    
    // Check cache first (security reports are cached for 1 hour)
    const cached = await this.cache.getSecurityReport(address);
    if (cached) {
      logger.debug(`Using cached security report for ${address}`);
      return cached;
    }

    try {
      logger.debug(`Starting security analysis for ${address} on ${chainId}`);
      
      const [goPlusResult, honeypotResult] = await Promise.allSettled([
        this.getGoPlusSecurityData(address, chainId),
        this.getHoneypotIsData(address, chainId),
      ]);

      const goPlusData = goPlusResult.status === 'fulfilled' ? goPlusResult.value : null;
      const honeypotData = honeypotResult.status === 'fulfilled' ? honeypotResult.value : null;

      const report = this.generateSecurityReport(address, goPlusData, honeypotData);
      
      // Cache the report for 1 hour
      await this.cache.cacheSecurityReport(address, report, 3600);
      
      logger.debug(`Security analysis completed for ${address}`, {
        security_ok: report.security_ok,
        penalty: report.penalty,
        flags: report.flags,
      });

      return report;
    } catch (error) {
      logError(error as Error, `Security analysis failed for ${address}`);
      
      // Return a conservative report on error
      return {
        address,
        security_ok: false,
        penalty: 50, // High penalty for unknown security status
        flags: ['analysis_failed'],
        sources: [],
      };
    }
  }

  async analyzeBatch(tokens: { address: string; chainId: ChainId }[]): Promise<SecurityReport[]> {
    const reports: SecurityReport[] = [];
    const semaphore = new Array(this.maxConcurrentChecks).fill(null);
    
    const processToken = async (token: { address: string; chainId: ChainId }) => {
      return await this.analyzeToken(token.address, token.chainId);
    };

    // Process tokens in batches to respect rate limits
    for (let i = 0; i < tokens.length; i += this.maxConcurrentChecks) {
      const batch = tokens.slice(i, i + this.maxConcurrentChecks);
      const batchPromises = batch.map(processToken);
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          reports.push(result.value);
        } else {
          logger.error('Batch security analysis failed:', result.reason);
        }
      }

      // Add delay between batches to respect rate limits
      if (i + this.maxConcurrentChecks < tokens.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    return reports;
  }

  // =============================================================================
  // GOPLUS SECURITY API
  // =============================================================================

  private async getGoPlusSecurityData(address: string, chainId: ChainId): Promise<GoPlusSecurityData | null> {
    if (!await this.rateLimiter.canMakeRequest('goplus')) {
      logger.warn('GoPlus rate limited');
      return null;
    }

    try {
      const startTime = Date.now();
      
      // Map chain IDs to GoPlus format
      const chainMap: Record<ChainId, string> = {
        'sol': 'solana',
        'eth': '1',
        'bsc': '56',
        'base': '8453'
      };

      const chainParam = chainMap[chainId];
      if (!chainParam) {
        logger.warn(`Unsupported chain for GoPlus: ${chainId}`);
        return null;
      }

      const url = `https://api.gopluslabs.io/api/v1/token_security/${chainParam}`;
      
      const response: AxiosResponse = await axios.get(url, {
        params: {
          contract_addresses: address,
        },
        timeout: parseInt(process.env.SECURITY_TIMEOUT || '10000'),
        headers: {
          'User-Agent': 'Meme-Coin-Radar/1.0',
        },
      });

      await this.rateLimiter.recordRequest('goplus');
      
      const duration = Date.now() - startTime;
      logApiRequest('goplus', 'token_security', duration, true, response.status);

      if (response.data && response.data.result) {
        return response.data;
      }

      return null;
    } catch (error: any) {
      if (error.response?.status === 429) {
        this.rateLimiter.handle429Response('goplus', error.response.headers['retry-after']);
      }
      
      logError(error, 'GoPlus API error');
      return null;
    }
  }

  // =============================================================================
  // HONEYPOT.IS API
  // =============================================================================

  private async getHoneypotIsData(address: string, chainId: ChainId): Promise<HoneypotIsResponse | null> {
    // Honeypot.is only supports EVM chains
    if (chainId === 'sol') {
      return null;
    }

    if (!await this.rateLimiter.canMakeRequest('honeypot')) {
      logger.warn('Honeypot.is rate limited');
      return null;
    }

    try {
      const startTime = Date.now();
      
      const response: AxiosResponse = await axios.get(`https://api.honeypot.is/v2/IsHoneypot`, {
        params: {
          address,
          chainID: this.getHoneypotChainId(chainId),
        },
        timeout: parseInt(process.env.SECURITY_TIMEOUT || '10000'),
        headers: {
          'User-Agent': 'Meme-Coin-Radar/1.0',
        },
      });

      await this.rateLimiter.recordRequest('honeypot');
      
      const duration = Date.now() - startTime;
      logApiRequest('honeypot', 'IsHoneypot', duration, true, response.status);

      return response.data;
    } catch (error: any) {
      if (error.response?.status === 429) {
        this.rateLimiter.handle429Response('honeypot', error.response.headers['retry-after']);
      }
      
      logError(error, 'Honeypot.is API error');
      return null;
    }
  }

  private getHoneypotChainId(chainId: ChainId): number {
    const chainMap: Record<ChainId, number> = {
      'eth': 1,
      'bsc': 56,
      'base': 8453,
      'sol': 0, // Not supported
    };
    return chainMap[chainId] || 1;
  }

  // =============================================================================
  // SECURITY REPORT GENERATION
  // =============================================================================

  private generateSecurityReport(
    address: string,
    goPlusData: GoPlusSecurityData | null,
    honeypotData: HoneypotIsResponse | null
  ): SecurityReport {
    const flags: string[] = [];
    const sources: string[] = [];
    let penalty = 0;

    // Analyze GoPlus data
    if (goPlusData && goPlusData.result && goPlusData.result[address]) {
      const tokenData = goPlusData.result[address];
      sources.push('goplus');

      const securityFlags = this.parseGoPlusFlags(tokenData);
      
      // Critical flags (make token unsellable)
      if (securityFlags.isHoneypot) {
        flags.push('honeypot');
        penalty += 100; // Maximum penalty
      }

      if (securityFlags.cannotSell) {
        flags.push('cannot_sell');
        penalty += 100;
      }

      if (securityFlags.fakeToken) {
        flags.push('fake_token');
        penalty += 100;
      }

      // High-risk flags
      if (securityFlags.highTax) {
        flags.push('high_tax');
        penalty += 15;
      }

      if (securityFlags.upgradeable) {
        flags.push('upgradeable');
        penalty += 12;
      }

      if (securityFlags.blacklistable) {
        flags.push('blacklistable');
        penalty += 12;
      }

      if (securityFlags.mintable) {
        flags.push('mintable');
        penalty += 8;
      }

      // Medium-risk flags
      if (securityFlags.antiWhale) {
        flags.push('anti_whale');
        penalty += 5;
      }

      if (securityFlags.tradingCooldown) {
        flags.push('trading_cooldown');
        penalty += 5;
      }

      if (securityFlags.externalCall) {
        flags.push('external_call');
        penalty += 3;
      }

      if (securityFlags.gasAbuse) {
        flags.push('gas_abuse');
        penalty += 3;
      }

      if (securityFlags.airdropScam) {
        flags.push('airdrop_scam');
        penalty += 20;
      }
    }

    // Analyze Honeypot.is data
    if (honeypotData && honeypotData.honeypotResult) {
      sources.push('honeypot.is');

      if (honeypotData.honeypotResult.isHoneypot) {
        if (!flags.includes('honeypot')) {
          flags.push('honeypot');
          penalty += 100;
        }
      }

      // Check tax rates
      if (honeypotData.simulationResult) {
        const maxTax = Math.max(
          honeypotData.simulationResult.buyTax || 0,
          honeypotData.simulationResult.sellTax || 0
        );

        const maxTaxThreshold = parseInt(process.env.MAX_TAX || '10');
        if (maxTax > maxTaxThreshold) {
          if (!flags.includes('high_tax')) {
            flags.push('high_tax');
            penalty += 15;
          }
        }
      }

      // Check risk level
      if (honeypotData.summary && honeypotData.summary.riskLevel > 7) {
        flags.push('high_risk');
        penalty += 10;
      }
    }

    // Determine if security is OK
    const security_ok = penalty < 50 && !flags.some(flag => 
      ['honeypot', 'cannot_sell', 'fake_token'].includes(flag)
    );

    return {
      address,
      security_ok,
      penalty: Math.min(penalty, 100), // Cap penalty at 100
      flags,
      sources,
    };
  }

  private parseGoPlusFlags(tokenData: any): SecurityFlags {
    const parseFlag = (value: string | undefined): boolean => {
      return value === '1' || value === 'true';
    };

    const buyTax = parseFloat(tokenData.buy_tax || '0');
    const sellTax = parseFloat(tokenData.sell_tax || '0');
    const maxTaxThreshold = parseInt(process.env.MAX_TAX || '10');

    return {
      isHoneypot: parseFlag(tokenData.is_honeypot),
      highTax: Math.max(buyTax, sellTax) > maxTaxThreshold,
      upgradeable: parseFlag(tokenData.is_proxy) || parseFlag(tokenData.can_take_back_ownership),
      blacklistable: parseFlag(tokenData.is_blacklisted),
      mintable: parseFlag(tokenData.is_mintable),
      cannotSell: parseFlag(tokenData.cannot_sell_all),
      fakeToken: parseFlag(tokenData.fake_token),
      airdropScam: parseFlag(tokenData.is_airdrop_scam),
      antiWhale: parseFlag(tokenData.is_anti_whale),
      tradingCooldown: parseFlag(tokenData.trading_cooldown),
      externalCall: parseFlag(tokenData.external_call),
      gasAbuse: parseFlag(tokenData.gas_abuse),
    };
  }

  // =============================================================================
  // UTILITY METHODS
  // =============================================================================

  async getSecuritySummary(addresses: string[]): Promise<{ safe: number; risky: number; unknown: number }> {
    const reports = await Promise.all(
      addresses.map(async (address) => {
        const cached = await this.cache.getSecurityReport(address);
        return cached;
      })
    );

    let safe = 0;
    let risky = 0;
    let unknown = 0;

    for (const report of reports) {
      if (!report) {
        unknown++;
      } else if (report.security_ok) {
        safe++;
      } else {
        risky++;
      }
    }

    return { safe, risky, unknown };
  }

  isTokenSafe(report: SecurityReport): boolean {
    return report.security_ok && report.penalty < 20;
  }

  getSecurityScore(report: SecurityReport): number {
    // Convert penalty to a 0-100 security score
    return Math.max(0, 100 - report.penalty);
  }

  getHealthStatus(): { status: 'up' | 'down' | 'degraded'; lastCheck: number; error?: string } {
    return {
      status: this.isRunning ? 'up' : 'down',
      lastCheck: Date.now(),
    };
  }

  // =============================================================================
  // QUICK SECURITY FILTERS
  // =============================================================================

  async filterSafeTokens(tokens: { address: string; chainId: ChainId }[]): Promise<{ address: string; chainId: ChainId }[]> {
    const reports = await this.analyzeBatch(tokens);
    const safeTokens: { address: string; chainId: ChainId }[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const report = reports[i];
      if (report && this.isTokenSafe(report)) {
        safeTokens.push(tokens[i]);
      }
    }

    logger.info(`Filtered ${safeTokens.length} safe tokens from ${tokens.length} total`);
    return safeTokens;
  }

  async getSecurityFlags(address: string, chainId: ChainId): Promise<string[]> {
    const report = await this.analyzeToken(address, chainId);
    return report.flags;
  }
}