import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { alerterLogger as logger, logError } from '../utils/logger';
import { CacheManager } from '../utils/cache';
import { 
  AlertPayload, 
  TokenSummary, 
  CEXListingEvent,
  ChainId,
  RadarConfig 
} from '../types';

interface AlertHistory {
  tokenAddress: string;
  alertType: string;
  timestamp: number;
  score?: number;
}

interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  fields: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  footer?: {
    text: string;
  };
  timestamp?: string;
}

export class Alerter {
  private cache: CacheManager;
  private config: RadarConfig | null = null;
  private isRunning: boolean = false;
  private alertHistory: Map<string, AlertHistory[]> = new Map();
  private maxAlertsPerHour: number;
  private alertCooldownMinutes: number;
  private cexListingCooldownHours: number;

  constructor(cache: CacheManager, config?: RadarConfig) {
    this.cache = cache;
    this.config = config || null;
    this.maxAlertsPerHour = parseInt(process.env.MAX_ALERTS_PER_HOUR || '50');
    this.alertCooldownMinutes = parseInt(process.env.ALERT_COOLDOWN_MINUTES || '30');
    this.cexListingCooldownHours = parseInt(process.env.CEX_LISTING_COOLDOWN_HOURS || '24');
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.startCleanupInterval();
    logger.info('Alerter started');
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    logger.info('Alerter stopped');
  }

  private startCleanupInterval(): void {
    // Clean up old alert history every hour
    setInterval(() => {
      this.cleanupAlertHistory();
    }, 60 * 60 * 1000);
  }

  private cleanupAlertHistory(): void {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    let cleaned = 0;

    for (const [key, alerts] of this.alertHistory.entries()) {
      const filteredAlerts = alerts.filter(alert => alert.timestamp > oneHourAgo);
      
      if (filteredAlerts.length !== alerts.length) {
        this.alertHistory.set(key, filteredAlerts);
        cleaned += alerts.length - filteredAlerts.length;
      }
      
      if (filteredAlerts.length === 0) {
        this.alertHistory.delete(key);
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cleaned up ${cleaned} old alert history entries`);
    }
  }

  // =============================================================================
  // MAIN ALERT METHODS
  // =============================================================================

  async sendScoreAlert(token: TokenSummary): Promise<boolean> {
    try {
      // Check if alert type is enabled in production
      if (!this.isAlertTypeEnabled('RADAR_MOMENTUM')) {
        logger.debug('RADAR momentum alerts disabled in current configuration');
        return false;
      }

      // Check if we should send this alert
      if (!this.shouldSendScoreAlert(token)) {
        return false;
      }

      const alertPayload: AlertPayload = {
        type: 'score_alert',
        token,
        timestamp: Date.now(),
        message: this.generateScoreAlertMessage(token),
      };

      // Send to all configured channels
      const results = await Promise.allSettled([
        this.sendDiscordAlert(alertPayload),
        this.sendTelegramAlert(alertPayload),
        this.sendWebhookAlert(alertPayload),
      ]);

      // Record the alert
      this.recordAlert(token.token.address, 'score_alert', token.score);

      // Check if at least one channel succeeded
      const success = results.some(result => result.status === 'fulfilled' && result.value);
      
      if (success) {
        logger.info(`Score alert sent for ${token.token.symbol}`, {
          address: token.token.address,
          score: token.score,
          chain: token.chainId,
        });
      }

      return success;
    } catch (error) {
      logError(error as Error, `Failed to send score alert for ${token.token.symbol}`);
      return false;
    }
  }

  async sendCEXListingAlert(event: CEXListingEvent): Promise<boolean> {
    try {
      // Check if alert type is enabled in production
      if (!this.isAlertTypeEnabled('CEX_LISTING')) {
        logger.debug('CEX listing alerts disabled in current configuration');
        return false;
      }

      // Check if we should send this CEX listing alert
      if (!this.shouldSendCEXListingAlert(event)) {
        return false;
      }

      const alertPayload: AlertPayload = {
        type: 'cex_listing',
        token: this.createTokenSummaryFromEvent(event),
        event,
        timestamp: Date.now(),
        message: this.generateCEXListingMessage(event),
      };

      // Send to all configured channels
      const results = await Promise.allSettled([
        this.sendDiscordAlert(alertPayload),
        this.sendTelegramAlert(alertPayload),
        this.sendWebhookAlert(alertPayload),
      ]);

      // Record the alert with exchange-specific key
      const alertKey = `${event.token.address}_${event.exchange}`;
      this.recordAlert(alertKey, 'cex_listing');

      // Check if at least one channel succeeded
      const success = results.some(result => result.status === 'fulfilled' && result.value);
      
      if (success) {
        logger.info(`CEX listing alert sent for ${event.token.symbol}`, {
          address: event.token.address,
          exchange: event.exchange,
          chain: event.token.chainId,
        });
      }

      return success;
    } catch (error) {
      logError(error as Error, `Failed to send CEX listing alert for ${event.token.symbol}`);
      return false;
    }
  }

  // =============================================================================
  // DISCORD INTEGRATION
  // =============================================================================

  private async sendDiscordAlert(alert: AlertPayload): Promise<boolean> {
    // Use production webhook URL if in production environment
    const webhookUrl = process.env.NODE_ENV === 'production' 
      ? process.env.DISCORD_WEBHOOK_URL_PROD 
      : process.env.DISCORD_WEBHOOK_URL;
    
    if (!webhookUrl) {
      return false;
    }

    try {
      const embed = this.createDiscordEmbed(alert);
      
      const payload = {
        embeds: [embed],
        username: 'Meme Coin Radar',
        avatar_url: 'https://example.com/radar-icon.png', // TODO: Add actual icon URL
      };

      const response = await axios.post(webhookUrl, payload, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      return response.status === 204;
    } catch (error) {
      logError(error as Error, 'Discord webhook failed');
      return false;
    }
  }

  private createDiscordEmbed(alert: AlertPayload): DiscordEmbed {
    const token = alert.token;
    const isListing = alert.type === 'cex_listing';
    
    const embed: DiscordEmbed = {
      title: isListing 
        ? `🚀 CEX Listing Alert: ${token.token.symbol}`
        : `⚡ High Score Alert: ${token.token.symbol}`,
      description: alert.message,
      color: isListing ? 0x00ff00 : this.getScoreColor(token.score),
      fields: [
        {
          name: '🏷️ Token',
          value: `**${token.token.symbol}** (${token.token.name})`,
          inline: true,
        },
        {
          name: '⛓️ Chain',
          value: this.getChainEmoji(token.chainId) + ' ' + this.getChainName(token.chainId),
          inline: true,
        },
        {
          name: '📊 Score',
          value: `**${token.score.toFixed(1)}**/100`,
          inline: true,
        },
        {
          name: '💰 Price',
          value: `$${token.priceUsd.toFixed(6)}`,
          inline: true,
        },
        {
          name: '💧 Liquidity',
          value: this.formatCurrency(token.liquidityUsd),
          inline: true,
        },
        {
          name: '⏰ Age',
          value: this.formatAge(token.ageMinutes),
          inline: true,
        },
      ],
      footer: {
        text: 'Meme Coin Radar • Free Tier',
      },
      timestamp: new Date().toISOString(),
    };

    // Add CEX listing specific fields
    if (isListing && alert.event) {
      embed.fields.push({
        name: '🏢 Exchange',
        value: `**${alert.event.exchange.toUpperCase()}**`,
        inline: true,
      });
      
      if (alert.event.markets.length > 0) {
        embed.fields.push({
          name: '📈 Markets',
          value: alert.event.markets.join(', '),
          inline: true,
        });
      }
    }

    // Add buy/sell pressure for score alerts
    if (!isListing) {
      const imbalance = (token.buys5 - token.sells5) / Math.max(1, token.buys5 + token.sells5);
      embed.fields.push({
        name: '📊 5m Activity',
        value: `${token.buys5} buys / ${token.sells5} sells\n**${(imbalance * 100).toFixed(1)}%** buy pressure`,
        inline: false,
      });
    }

    // Add security status
    embed.fields.push({
      name: '🛡️ Security',
      value: token.security.ok 
        ? '✅ Verified Safe' 
        : `❌ ${token.security.flags.join(', ')}`,
      inline: false,
    });

    // Add links
    const links = [
      `[DexScreener](${token.links.dexscreener})`,
    ];
    if (token.links.chart) {
      links.push(`[Chart](${token.links.chart})`);
    }
    
    embed.fields.push({
      name: '🔗 Links',
      value: links.join(' • '),
      inline: false,
    });

    return embed;
  }

  // =============================================================================
  // TELEGRAM INTEGRATION
  // =============================================================================

  private async sendTelegramAlert(alert: AlertPayload): Promise<boolean> {
    // Use production credentials if in production environment
    const botToken = process.env.NODE_ENV === 'production'
      ? process.env.TELEGRAM_BOT_TOKEN_PROD
      : process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.NODE_ENV === 'production'
      ? process.env.TELEGRAM_CHAT_ID_PROD
      : process.env.TELEGRAM_CHAT_ID;
    
    if (!botToken || !chatId) {
      return false;
    }

    try {
      const message = this.createTelegramMessage(alert);
      
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const payload = {
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: false,
      };

      const response = await axios.post(url, payload, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      return response.status === 200;
    } catch (error) {
      logError(error as Error, 'Telegram alert failed');
      return false;
    }
  }

  private createTelegramMessage(alert: AlertPayload): string {
    const token = alert.token;
    const isListing = alert.type === 'cex_listing';
    
    let message = isListing 
      ? `🚀 *CEX LISTING ALERT*\n\n`
      : `⚡ *HIGH SCORE ALERT*\n\n`;

    message += `*${token.token.symbol}* (${token.token.name})\n`;
    message += `${this.getChainEmoji(token.chainId)} ${this.getChainName(token.chainId)} • Score: *${token.score.toFixed(1)}*/100\n\n`;

    if (isListing && alert.event) {
      message += `🏢 Exchange: *${alert.event.exchange.toUpperCase()}*\n`;
      if (alert.event.markets.length > 0) {
        message += `📈 Markets: ${alert.event.markets.join(', ')}\n`;
      }
      message += '\n';
    }

    message += `💰 Price: $${token.priceUsd.toFixed(6)}\n`;
    message += `💧 Liquidity: ${this.formatCurrency(token.liquidityUsd)}\n`;
    message += `⏰ Age: ${this.formatAge(token.ageMinutes)}\n`;

    if (!isListing) {
      const imbalance = (token.buys5 - token.sells5) / Math.max(1, token.buys5 + token.sells5);
      message += `📊 5m: ${token.buys5} buys / ${token.sells5} sells (${(imbalance * 100).toFixed(1)}% buy pressure)\n`;
    }

    message += `🛡️ Security: ${token.security.ok ? '✅ Safe' : '❌ ' + token.security.flags.join(', ')}\n\n`;

    message += `🔗 [DexScreener](${token.links.dexscreener})`;
    if (token.links.chart) {
      message += ` • [Chart](${token.links.chart})`;
    }

    message += '\n\n_Meme Coin Radar • Free Tier_';

    return message;
  }

  // =============================================================================
  // WEBHOOK INTEGRATION
  // =============================================================================

  private async sendWebhookAlert(alert: AlertPayload): Promise<boolean> {
    const webhookUrl = process.env.WEBHOOK_URL;
    if (!webhookUrl) {
      return false;
    }

    try {
      const response = await axios.post(webhookUrl, alert, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Meme-Coin-Radar/1.0',
        },
      });

      return response.status >= 200 && response.status < 300;
    } catch (error) {
      logError(error as Error, 'Webhook alert failed');
      return false;
    }
  }

  // =============================================================================
  // ALERT LOGIC & DEDUPLICATION
  // =============================================================================

  private shouldSendScoreAlert(token: TokenSummary): boolean {
    // Check score threshold
    const scoreThreshold = parseInt(process.env.SCORE_ALERT || '70');
    if (token.score < scoreThreshold) {
      return false;
    }

    // Check surge threshold
    const surgeThreshold = parseFloat(process.env.SURGE15_THRESHOLD || '2.5');
    if (token.vol15Usd / Math.max(1, token.vol5Usd * 2) < surgeThreshold) {
      return false;
    }

    // Check imbalance threshold
    const imbalanceThreshold = parseFloat(process.env.IMBALANCE5_THRESHOLD || '0.4');
    const imbalance = (token.buys5 - token.sells5) / Math.max(1, token.buys5 + token.sells5);
    if (imbalance < imbalanceThreshold) {
      return false;
    }

    // Check liquidity threshold
    const liquidityThreshold = parseInt(process.env.MIN_LIQUIDITY_ALERT || '20000');
    if (token.liquidityUsd < liquidityThreshold) {
      return false;
    }

    // Check security
    if (!token.security.ok) {
      return false;
    }

    // Check rate limiting
    if (!this.checkRateLimit()) {
      return false;
    }

    // Check deduplication
    return this.checkDeduplication(token.token.address, 'score_alert', token.score);
  }

  private shouldSendCEXListingAlert(event: CEXListingEvent): boolean {
    // CEX listings are always high priority, but check deduplication
    const alertKey = `${event.token.address}_${event.exchange}`;
    return this.checkCEXListingDeduplication(alertKey);
  }

  private checkRateLimit(): boolean {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    
    let totalAlerts = 0;
    for (const alerts of this.alertHistory.values()) {
      totalAlerts += alerts.filter(alert => alert.timestamp > oneHourAgo).length;
    }

    return totalAlerts < this.maxAlertsPerHour;
  }

  private checkDeduplication(tokenAddress: string, alertType: string, currentScore?: number): boolean {
    const alerts = this.alertHistory.get(tokenAddress) || [];
    const now = Date.now();
    const cooldownMs = this.alertCooldownMinutes * 60 * 1000;

    // Find recent alerts of the same type
    const recentAlerts = alerts.filter(alert => 
      alert.alertType === alertType && 
      now - alert.timestamp < cooldownMs
    );

    if (recentAlerts.length === 0) {
      return true; // No recent alerts, OK to send
    }

    // For score alerts, allow if score increased by 10+ points
    if (alertType === 'score_alert' && currentScore !== undefined) {
      const lastAlert = recentAlerts[recentAlerts.length - 1];
      if (lastAlert.score !== undefined && currentScore >= lastAlert.score + 10) {
        return true;
      }
    }

    return false; // Deduplicated
  }

  private checkCEXListingDeduplication(alertKey: string): boolean {
    const alerts = this.alertHistory.get(alertKey) || [];
    const now = Date.now();
    const cooldownMs = this.cexListingCooldownHours * 60 * 60 * 1000;

    // Check if we've sent an alert for this token on this exchange recently
    const recentAlerts = alerts.filter(alert => 
      alert.alertType === 'cex_listing' && 
      now - alert.timestamp < cooldownMs
    );

    return recentAlerts.length === 0;
  }

  private recordAlert(key: string, alertType: string, score?: number): void {
    const alerts = this.alertHistory.get(key) || [];
    alerts.push({
      tokenAddress: key,
      alertType,
      timestamp: Date.now(),
      score,
    });
    this.alertHistory.set(key, alerts);
  }

  // =============================================================================
  // UTILITY METHODS
  // =============================================================================

  private createTokenSummaryFromEvent(event: CEXListingEvent): TokenSummary {
    return {
      chainId: event.token.chainId as ChainId,
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
      ageMinutes: 0,
      score: event.radarScore,
      reasons: [`CEX listing: ${event.exchange}`],
      security: { ok: true, flags: [] },
      links: {
        dexscreener: `https://dexscreener.com/search?q=${event.token.address}`,
        chart: event.urls[0] || '',
      },
    };
  }

  private generateScoreAlertMessage(token: TokenSummary): string {
    const imbalance = (token.buys5 - token.sells5) / Math.max(1, token.buys5 + token.sells5);
    return `High-scoring token detected: ${token.token.symbol} with ${token.score.toFixed(1)}/100 score, ${(imbalance * 100).toFixed(1)}% buy pressure, and ${this.formatCurrency(token.liquidityUsd)} liquidity.`;
  }

  private generateCEXListingMessage(event: CEXListingEvent): string {
    return `CEX listing detected: ${event.token.symbol} listed on ${event.exchange.toUpperCase()} with ${this.formatCurrency(event.liquidityUsd)} liquidity.`;
  }

  private getScoreColor(score: number): number {
    if (score >= 80) return 0x22c55e; // Green
    if (score >= 60) return 0xf59e0b; // Yellow
    return 0xef4444; // Red
  }

  private getChainEmoji(chainId: string): string {
    const emojis: Record<string, string> = {
      sol: '🟣',
      eth: '🔵',
      bsc: '🟡',
      base: '🔷',
    };
    return emojis[chainId] || '⚪';
  }

  private getChainName(chainId: string): string {
    const names: Record<string, string> = {
      sol: 'Solana',
      eth: 'Ethereum',
      bsc: 'BSC',
      base: 'Base',
    };
    return names[chainId] || chainId.toUpperCase();
  }

  private formatCurrency(amount: number): string {
    if (amount >= 1e6) return `$${(amount / 1e6).toFixed(1)}M`;
    if (amount >= 1e3) return `$${(amount / 1e3).toFixed(1)}K`;
    return `$${amount.toFixed(0)}`;
  }

  private formatAge(minutes: number): string {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }

  getHealthStatus(): { status: 'up' | 'down' | 'degraded'; lastCheck: number; error?: string } {
    return {
      status: this.isRunning ? 'up' : 'down',
      lastCheck: Date.now(),
    };
  }

  // =============================================================================
  // RADAR_ONLY MODE CONFIGURATION
  // =============================================================================

  updateConfig(config: RadarConfig): void {
    this.config = config;
    logger.info('Alerter configuration updated', {
      radarOnly: config.radarOnly,
      enabledAlertTypes: this.getEnabledAlertTypes()
    });

    // Generate alert rules report when config is updated
    if (config.radarOnly) {
      this.generateAlertRulesReport().catch(error => {
        logError(error as Error, 'Failed to generate alert rules report');
      });
    }
  }

  private isAlertTypeEnabled(alertType: string): boolean {
    const enabledTypes = process.env.ALERT_TYPES_ENABLED?.split(',') || ['RADAR_MOMENTUM', 'CEX_LISTING'];
    return enabledTypes.includes(alertType);
  }

  private getEnabledAlertTypes(): string[] {
    if (!this.config || !this.config.radarOnly) {
      return ['score_alert', 'cex_listing']; // All alerts enabled in normal mode
    }

    // In RADAR_ONLY mode, only these alert types are allowed
    return ['score_alert', 'cex_listing'];
  }

  private async generateAlertRulesReport(): Promise<void> {
    try {
      const reportsDir = path.join(process.cwd(), 'reports');
      
      // Ensure reports directory exists
      if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
      }

      const timestamp = new Date().toISOString();
      const enabledTypes = this.getEnabledAlertTypes();
      
      const report = `# Alert Rules Summary

**Generated:** ${timestamp}
**Mode:** ${this.config?.radarOnly ? 'RADAR_ONLY' : 'FULL'}

## Active Alert Types

${enabledTypes.map(type => `- **${type}**: ✅ Enabled`).join('\n')}

## Alert Configuration

### Score Alert Rules
- **Score Threshold:** ${process.env.SCORE_ALERT || '70'}
- **Surge 15m Threshold:** ${process.env.SURGE15_THRESHOLD || '2.5'}x
- **Imbalance 5m Threshold:** ${process.env.IMBALANCE5_THRESHOLD || '0.4'} (40% buy pressure)
- **Min Liquidity:** $${parseInt(process.env.MIN_LIQUIDITY_ALERT || '20000').toLocaleString()}
- **Security Check:** Required (must pass security audit)

### CEX Listing Alert Rules
- **Trigger:** Immediate on CEX listing event
- **Deduplication:** 24 hours per exchange
- **Boost Applied:** +10 to computed score
- **Pin Duration:** 30 minutes on dashboard

## Rate Limiting

- **Max Alerts/Hour:** ${this.maxAlertsPerHour}
- **Alert Cooldown:** ${this.alertCooldownMinutes} minutes
- **CEX Listing Cooldown:** ${this.cexListingCooldownHours} hours

## Delivery Channels

${process.env.DISCORD_WEBHOOK_URL ? '- **Discord:** ✅ Configured' : '- **Discord:** ❌ Not configured'}
${process.env.TELEGRAM_BOT_TOKEN ? '- **Telegram:** ✅ Configured' : '- **Telegram:** ❌ Not configured'}
${process.env.WEBHOOK_URL ? '- **Custom Webhook:** ✅ Configured' : '- **Custom Webhook:** ❌ Not configured'}

## RADAR_ONLY Mode Restrictions

${this.config?.radarOnly ? `
✅ **RADAR_ONLY Mode Active**

**Allowed Alert Types:**
- Radar momentum alerts (score_alert)
- CEX listing alerts (cex_listing)

**Disabled Features:**
- Portfolio simulation alerts
- Trade action alerts  
- Wallet integration alerts
- Advanced trading signals
` : `
❌ **RADAR_ONLY Mode Inactive**

All alert types and features are enabled.
`}

## Alert History Summary

- **Total Alert Types Tracked:** ${this.alertHistory.size}
- **Active Rate Limits:** ${this.checkRateLimit() ? 'None' : 'Rate limited'}

---
*Generated by Meme Coin Radar Alerter Service*
`;

      const reportPath = path.join(reportsDir, 'alert-rules.md');
      fs.writeFileSync(reportPath, report, 'utf8');
      
      logger.info('Alert rules report generated', { 
        path: reportPath,
        mode: this.config?.radarOnly ? 'RADAR_ONLY' : 'FULL'
      });

    } catch (error) {
      logError(error as Error, 'Failed to generate alert rules report');
      throw error;
    }
  }
}