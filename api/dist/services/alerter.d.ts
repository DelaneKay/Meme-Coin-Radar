import { CacheManager } from '../utils/cache';
import { TokenSummary, CEXListingEvent, RadarConfig } from '../types';
export declare class Alerter {
    private cache;
    private config;
    private isRunning;
    private alertHistory;
    private maxAlertsPerHour;
    private alertCooldownMinutes;
    private cexListingCooldownHours;
    constructor(cache: CacheManager, config?: RadarConfig);
    start(): Promise<void>;
    stop(): Promise<void>;
    private startCleanupInterval;
    private cleanupAlertHistory;
    sendScoreAlert(token: TokenSummary): Promise<boolean>;
    sendCEXListingAlert(event: CEXListingEvent): Promise<boolean>;
    private sendDiscordAlert;
    private createDiscordEmbed;
    private sendTelegramAlert;
    private createTelegramMessage;
    private sendWebhookAlert;
    private shouldSendScoreAlert;
    private shouldSendCEXListingAlert;
    private checkRateLimit;
    private checkDeduplication;
    private checkCEXListingDeduplication;
    private recordAlert;
    private createTokenSummaryFromEvent;
    private generateScoreAlertMessage;
    private generateCEXListingMessage;
    private getScoreColor;
    private getChainEmoji;
    private getChainName;
    private formatCurrency;
    private formatAge;
    getHealthStatus(): {
        status: 'up' | 'down' | 'degraded';
        lastCheck: number;
        error?: string;
    };
    updateConfig(config: RadarConfig): void;
    private getEnabledAlertTypes;
    private generateAlertRulesReport;
}
//# sourceMappingURL=alerter.d.ts.map