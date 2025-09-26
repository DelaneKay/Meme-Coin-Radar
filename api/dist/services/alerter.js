"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Alerter = void 0;
const axios_1 = __importDefault(require("axios"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const logger_1 = require("../utils/logger");
class Alerter {
    constructor(cache, config) {
        this.config = null;
        this.isRunning = false;
        this.alertHistory = new Map();
        this.cache = cache;
        this.config = config || null;
        this.maxAlertsPerHour = parseInt(process.env.MAX_ALERTS_PER_HOUR || '50');
        this.alertCooldownMinutes = parseInt(process.env.ALERT_COOLDOWN_MINUTES || '30');
        this.cexListingCooldownHours = parseInt(process.env.CEX_LISTING_COOLDOWN_HOURS || '24');
    }
    async start() {
        if (this.isRunning)
            return;
        this.isRunning = true;
        this.startCleanupInterval();
        logger_1.alerterLogger.info('Alerter started');
    }
    async stop() {
        this.isRunning = false;
        logger_1.alerterLogger.info('Alerter stopped');
    }
    startCleanupInterval() {
        setInterval(() => {
            this.cleanupAlertHistory();
        }, 60 * 60 * 1000);
    }
    cleanupAlertHistory() {
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
            logger_1.alerterLogger.debug(`Cleaned up ${cleaned} old alert history entries`);
        }
    }
    async sendScoreAlert(token) {
        try {
            if (!this.shouldSendScoreAlert(token)) {
                return false;
            }
            const alertPayload = {
                type: 'score_alert',
                token,
                timestamp: Date.now(),
                message: this.generateScoreAlertMessage(token),
            };
            const results = await Promise.allSettled([
                this.sendDiscordAlert(alertPayload),
                this.sendTelegramAlert(alertPayload),
                this.sendWebhookAlert(alertPayload),
            ]);
            this.recordAlert(token.token.address, 'score_alert', token.score);
            const success = results.some(result => result.status === 'fulfilled' && result.value);
            if (success) {
                logger_1.alerterLogger.info(`Score alert sent for ${token.token.symbol}`, {
                    address: token.token.address,
                    score: token.score,
                    chain: token.chainId,
                });
            }
            return success;
        }
        catch (error) {
            (0, logger_1.logError)(error, `Failed to send score alert for ${token.token.symbol}`);
            return false;
        }
    }
    async sendCEXListingAlert(event) {
        try {
            if (!this.shouldSendCEXListingAlert(event)) {
                return false;
            }
            const alertPayload = {
                type: 'cex_listing',
                token: this.createTokenSummaryFromEvent(event),
                event,
                timestamp: Date.now(),
                message: this.generateCEXListingMessage(event),
            };
            const results = await Promise.allSettled([
                this.sendDiscordAlert(alertPayload),
                this.sendTelegramAlert(alertPayload),
                this.sendWebhookAlert(alertPayload),
            ]);
            const alertKey = `${event.token.address}_${event.exchange}`;
            this.recordAlert(alertKey, 'cex_listing');
            const success = results.some(result => result.status === 'fulfilled' && result.value);
            if (success) {
                logger_1.alerterLogger.info(`CEX listing alert sent for ${event.token.symbol}`, {
                    address: event.token.address,
                    exchange: event.exchange,
                    chain: event.token.chainId,
                });
            }
            return success;
        }
        catch (error) {
            (0, logger_1.logError)(error, `Failed to send CEX listing alert for ${event.token.symbol}`);
            return false;
        }
    }
    async sendDiscordAlert(alert) {
        const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
        if (!webhookUrl) {
            return false;
        }
        try {
            const embed = this.createDiscordEmbed(alert);
            const payload = {
                embeds: [embed],
                username: 'Meme Coin Radar',
                avatar_url: 'https://example.com/radar-icon.png',
            };
            const response = await axios_1.default.post(webhookUrl, payload, {
                timeout: 10000,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            return response.status === 204;
        }
        catch (error) {
            (0, logger_1.logError)(error, 'Discord webhook failed');
            return false;
        }
    }
    createDiscordEmbed(alert) {
        const token = alert.token;
        const isListing = alert.type === 'cex_listing';
        const embed = {
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
        if (!isListing) {
            const imbalance = (token.buys5 - token.sells5) / Math.max(1, token.buys5 + token.sells5);
            embed.fields.push({
                name: '📊 5m Activity',
                value: `${token.buys5} buys / ${token.sells5} sells\n**${(imbalance * 100).toFixed(1)}%** buy pressure`,
                inline: false,
            });
        }
        embed.fields.push({
            name: '🛡️ Security',
            value: token.security.ok
                ? '✅ Verified Safe'
                : `❌ ${token.security.flags.join(', ')}`,
            inline: false,
        });
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
    async sendTelegramAlert(alert) {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;
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
            const response = await axios_1.default.post(url, payload, {
                timeout: 10000,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            return response.status === 200;
        }
        catch (error) {
            (0, logger_1.logError)(error, 'Telegram alert failed');
            return false;
        }
    }
    createTelegramMessage(alert) {
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
    async sendWebhookAlert(alert) {
        const webhookUrl = process.env.WEBHOOK_URL;
        if (!webhookUrl) {
            return false;
        }
        try {
            const response = await axios_1.default.post(webhookUrl, alert, {
                timeout: 10000,
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Meme-Coin-Radar/1.0',
                },
            });
            return response.status >= 200 && response.status < 300;
        }
        catch (error) {
            (0, logger_1.logError)(error, 'Webhook alert failed');
            return false;
        }
    }
    shouldSendScoreAlert(token) {
        const scoreThreshold = parseInt(process.env.SCORE_ALERT || '70');
        if (token.score < scoreThreshold) {
            return false;
        }
        const surgeThreshold = parseFloat(process.env.SURGE15_THRESHOLD || '2.5');
        if (token.vol15Usd / Math.max(1, token.vol5Usd * 2) < surgeThreshold) {
            return false;
        }
        const imbalanceThreshold = parseFloat(process.env.IMBALANCE5_THRESHOLD || '0.4');
        const imbalance = (token.buys5 - token.sells5) / Math.max(1, token.buys5 + token.sells5);
        if (imbalance < imbalanceThreshold) {
            return false;
        }
        const liquidityThreshold = parseInt(process.env.MIN_LIQUIDITY_ALERT || '20000');
        if (token.liquidityUsd < liquidityThreshold) {
            return false;
        }
        if (!token.security.ok) {
            return false;
        }
        if (!this.checkRateLimit()) {
            return false;
        }
        return this.checkDeduplication(token.token.address, 'score_alert', token.score);
    }
    shouldSendCEXListingAlert(event) {
        const alertKey = `${event.token.address}_${event.exchange}`;
        return this.checkCEXListingDeduplication(alertKey);
    }
    checkRateLimit() {
        const now = Date.now();
        const oneHourAgo = now - 60 * 60 * 1000;
        let totalAlerts = 0;
        for (const alerts of this.alertHistory.values()) {
            totalAlerts += alerts.filter(alert => alert.timestamp > oneHourAgo).length;
        }
        return totalAlerts < this.maxAlertsPerHour;
    }
    checkDeduplication(tokenAddress, alertType, currentScore) {
        const alerts = this.alertHistory.get(tokenAddress) || [];
        const now = Date.now();
        const cooldownMs = this.alertCooldownMinutes * 60 * 1000;
        const recentAlerts = alerts.filter(alert => alert.alertType === alertType &&
            now - alert.timestamp < cooldownMs);
        if (recentAlerts.length === 0) {
            return true;
        }
        if (alertType === 'score_alert' && currentScore !== undefined) {
            const lastAlert = recentAlerts[recentAlerts.length - 1];
            if (lastAlert.score !== undefined && currentScore >= lastAlert.score + 10) {
                return true;
            }
        }
        return false;
    }
    checkCEXListingDeduplication(alertKey) {
        const alerts = this.alertHistory.get(alertKey) || [];
        const now = Date.now();
        const cooldownMs = this.cexListingCooldownHours * 60 * 60 * 1000;
        const recentAlerts = alerts.filter(alert => alert.alertType === 'cex_listing' &&
            now - alert.timestamp < cooldownMs);
        return recentAlerts.length === 0;
    }
    recordAlert(key, alertType, score) {
        const alerts = this.alertHistory.get(key) || [];
        alerts.push({
            tokenAddress: key,
            alertType,
            timestamp: Date.now(),
            score,
        });
        this.alertHistory.set(key, alerts);
    }
    createTokenSummaryFromEvent(event) {
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
    generateScoreAlertMessage(token) {
        const imbalance = (token.buys5 - token.sells5) / Math.max(1, token.buys5 + token.sells5);
        return `High-scoring token detected: ${token.token.symbol} with ${token.score.toFixed(1)}/100 score, ${(imbalance * 100).toFixed(1)}% buy pressure, and ${this.formatCurrency(token.liquidityUsd)} liquidity.`;
    }
    generateCEXListingMessage(event) {
        return `CEX listing detected: ${event.token.symbol} listed on ${event.exchange.toUpperCase()} with ${this.formatCurrency(event.liquidityUsd)} liquidity.`;
    }
    getScoreColor(score) {
        if (score >= 80)
            return 0x22c55e;
        if (score >= 60)
            return 0xf59e0b;
        return 0xef4444;
    }
    getChainEmoji(chainId) {
        const emojis = {
            sol: '🟣',
            eth: '🔵',
            bsc: '🟡',
            base: '🔷',
        };
        return emojis[chainId] || '⚪';
    }
    getChainName(chainId) {
        const names = {
            sol: 'Solana',
            eth: 'Ethereum',
            bsc: 'BSC',
            base: 'Base',
        };
        return names[chainId] || chainId.toUpperCase();
    }
    formatCurrency(amount) {
        if (amount >= 1e6)
            return `$${(amount / 1e6).toFixed(1)}M`;
        if (amount >= 1e3)
            return `$${(amount / 1e3).toFixed(1)}K`;
        return `$${amount.toFixed(0)}`;
    }
    formatAge(minutes) {
        if (minutes < 60)
            return `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24)
            return `${hours}h`;
        const days = Math.floor(hours / 24);
        return `${days}d`;
    }
    getHealthStatus() {
        return {
            status: this.isRunning ? 'up' : 'down',
            lastCheck: Date.now(),
        };
    }
    updateConfig(config) {
        this.config = config;
        logger_1.alerterLogger.info('Alerter configuration updated', {
            radarOnly: config.radarOnly,
            enabledAlertTypes: this.getEnabledAlertTypes()
        });
        if (config.radarOnly) {
            this.generateAlertRulesReport().catch(error => {
                (0, logger_1.logError)(error, 'Failed to generate alert rules report');
            });
        }
    }
    getEnabledAlertTypes() {
        if (!this.config || !this.config.radarOnly) {
            return ['score_alert', 'cex_listing'];
        }
        return ['score_alert', 'cex_listing'];
    }
    async generateAlertRulesReport() {
        try {
            const reportsDir = path_1.default.join(process.cwd(), 'reports');
            if (!fs_1.default.existsSync(reportsDir)) {
                fs_1.default.mkdirSync(reportsDir, { recursive: true });
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
            const reportPath = path_1.default.join(reportsDir, 'alert-rules.md');
            fs_1.default.writeFileSync(reportPath, report, 'utf8');
            logger_1.alerterLogger.info('Alert rules report generated', {
                path: reportPath,
                mode: this.config?.radarOnly ? 'RADAR_ONLY' : 'FULL'
            });
        }
        catch (error) {
            (0, logger_1.logError)(error, 'Failed to generate alert rules report');
            throw error;
        }
    }
}
exports.Alerter = Alerter;
//# sourceMappingURL=alerter.js.map