"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShadowTestingService = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const logger_1 = require("../utils/logger");
class ShadowTestingService {
    constructor(db, redis) {
        this.activeProposals = new Map();
        this.isRunning = false;
        this.db = db;
        this.redis = redis;
    }
    async startShadowTesting() {
        if (this.isRunning) {
            logger_1.logger.warn('Shadow testing already running');
            return;
        }
        logger_1.logger.info('Starting shadow testing service');
        this.isRunning = true;
        try {
            await this.loadActiveProposals();
            await this.setupRealtimeMonitoring();
            logger_1.logger.info('Shadow testing service started', {
                activeProposals: this.activeProposals.size
            });
        }
        catch (error) {
            logger_1.logger.error('Failed to start shadow testing', { error: error.message });
            this.isRunning = false;
            throw error;
        }
    }
    async stopShadowTesting() {
        logger_1.logger.info('Stopping shadow testing service');
        this.isRunning = false;
        for (const [proposalId, proposal] of this.activeProposals.entries()) {
            await this.generateShadowTestReport(proposalId);
        }
        this.activeProposals.clear();
        logger_1.logger.info('Shadow testing service stopped');
    }
    async loadActiveProposals() {
        try {
            const cachedProposals = await this.redis.get('shadow:active_proposals');
            if (cachedProposals) {
                const proposals = JSON.parse(cachedProposals);
                for (const proposal of proposals) {
                    this.activeProposals.set(proposal.id, proposal);
                }
                logger_1.logger.info('Loaded proposals from cache', { count: proposals.length });
                return;
            }
            const query = `
        SELECT * FROM tuning_proposals 
        WHERE status = 'shadow_testing'
          AND shadow_start_time > NOW() - INTERVAL '24 hours'
      `;
            const result = await this.db.query(query);
            for (const row of result.rows) {
                const proposal = {
                    id: row.id,
                    chain: row.chain,
                    hour_bucket: row.hour_bucket,
                    rules: JSON.parse(row.rules),
                    evidence: JSON.parse(row.evidence),
                    created_at: row.created_at,
                    status: row.status
                };
                this.activeProposals.set(proposal.id, proposal);
            }
            logger_1.logger.info('Loaded proposals from database', { count: result.rows.length });
        }
        catch (error) {
            logger_1.logger.error('Failed to load active proposals', { error: error.message });
            throw error;
        }
    }
    async setupRealtimeMonitoring() {
        const subscriber = new ioredis_1.default(process.env.REDIS_URL);
        subscriber.subscribe('radar:new_scan', (err) => {
            if (err) {
                logger_1.logger.error('Failed to subscribe to radar updates', { error: err.message });
                return;
            }
            logger_1.logger.info('Subscribed to radar updates for shadow testing');
        });
        subscriber.on('message', async (channel, message) => {
            if (channel === 'radar:new_scan') {
                try {
                    const scanData = JSON.parse(message);
                    await this.processScanForShadowTesting(scanData);
                }
                catch (error) {
                    logger_1.logger.error('Error processing scan for shadow testing', {
                        error: error.message,
                        message
                    });
                }
            }
        });
        setInterval(async () => {
            await this.processBatchShadowTesting();
        }, 60000);
    }
    async processScanForShadowTesting(scanData) {
        if (!this.isRunning || this.activeProposals.size === 0) {
            return;
        }
        const { token_address, chain, score, surge_15min, imbalance_5min, liquidity } = scanData;
        for (const [proposalId, proposal] of this.activeProposals.entries()) {
            if (proposal.chain !== chain) {
                continue;
            }
            const currentHour = new Date().getHours();
            const [startHour, endHour] = proposal.hour_bucket.split('-').map(Number);
            if (currentHour < startHour || currentHour >= endHour) {
                continue;
            }
            const wouldAlert = this.wouldTriggerAlert(scanData, proposal.rules);
            const actualAlertSent = await this.checkIfActualAlertSent(token_address, chain);
            const shadowAlert = {
                id: `shadow_${proposalId}_${token_address}_${Date.now()}`,
                proposal_id: proposalId,
                token_address,
                chain,
                timestamp: new Date().toISOString(),
                triggered_by: proposal.rules,
                token_data: {
                    score,
                    surge_15min,
                    imbalance_5min,
                    liquidity,
                    price: scanData.price || 0,
                    volume_24h: scanData.volume_24h || 0
                },
                would_alert: wouldAlert,
                actual_alert_sent: actualAlertSent,
                outcome_tracked: false
            };
            await this.logShadowAlert(shadowAlert);
            if (wouldAlert) {
                await this.scheduleOutcomeTracking(shadowAlert.id, token_address, chain);
            }
        }
    }
    async processBatchShadowTesting() {
        if (!this.isRunning || this.activeProposals.size === 0) {
            return;
        }
        try {
            const query = `
        SELECT r.* FROM radar_scans r
        LEFT JOIN shadow_alerts sa ON (
          r.token_address = sa.token_address 
          AND r.chain = sa.chain 
          AND ABS(EXTRACT(EPOCH FROM (r.timestamp - sa.timestamp::timestamp))) < 60
        )
        WHERE r.timestamp > NOW() - INTERVAL '5 minutes'
          AND sa.id IS NULL
        ORDER BY r.timestamp DESC
        LIMIT 100
      `;
            const result = await this.db.query(query);
            for (const scan of result.rows) {
                await this.processScanForShadowTesting(scan);
            }
        }
        catch (error) {
            logger_1.logger.error('Error in batch shadow testing', { error: error.message });
        }
    }
    wouldTriggerAlert(scanData, rules) {
        return (scanData.score >= rules.SCORE_ALERT &&
            scanData.surge_15min >= rules.SURGE15_MIN &&
            scanData.imbalance_5min >= rules.IMBALANCE5_MIN &&
            scanData.liquidity >= rules.MIN_LIQ_ALERT);
    }
    async checkIfActualAlertSent(tokenAddress, chain) {
        try {
            const query = `
        SELECT 1 FROM alerts 
        WHERE token_address = $1 
          AND chain = $2 
          AND created_at > NOW() - INTERVAL '5 minutes'
        LIMIT 1
      `;
            const result = await this.db.query(query, [tokenAddress, chain]);
            return result.rows.length > 0;
        }
        catch (error) {
            logger_1.logger.error('Error checking actual alert', { error: error.message });
            return false;
        }
    }
    async logShadowAlert(shadowAlert) {
        try {
            const query = `
        INSERT INTO shadow_alerts (
          id, proposal_id, token_address, chain, timestamp,
          triggered_by, token_data, would_alert, actual_alert_sent,
          outcome_tracked
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO NOTHING
      `;
            await this.db.query(query, [
                shadowAlert.id,
                shadowAlert.proposal_id,
                shadowAlert.token_address,
                shadowAlert.chain,
                shadowAlert.timestamp,
                JSON.stringify(shadowAlert.triggered_by),
                JSON.stringify(shadowAlert.token_data),
                shadowAlert.would_alert,
                shadowAlert.actual_alert_sent,
                shadowAlert.outcome_tracked
            ]);
            await this.redis.lpush(`shadow:alerts:${shadowAlert.proposal_id}`, JSON.stringify(shadowAlert));
            await this.redis.ltrim(`shadow:alerts:${shadowAlert.proposal_id}`, 0, 999);
        }
        catch (error) {
            logger_1.logger.error('Error logging shadow alert', {
                error: error.message,
                shadowAlert: shadowAlert.id
            });
        }
    }
    async scheduleOutcomeTracking(shadowAlertId, tokenAddress, chain) {
        const trackingTimes = [10 * 60 * 1000, 60 * 60 * 1000];
        for (const delay of trackingTimes) {
            setTimeout(async () => {
                await this.trackOutcome(shadowAlertId, tokenAddress, chain, delay);
            }, delay);
        }
    }
    async trackOutcome(shadowAlertId, tokenAddress, chain, delayMs) {
        try {
            const currentData = await this.getCurrentTokenData(tokenAddress, chain);
            const originalAlert = await this.getShadowAlert(shadowAlertId);
            if (!originalAlert) {
                return;
            }
            const priceChange = currentData.price > 0 && originalAlert.token_data.price > 0 ?
                (currentData.price - originalAlert.token_data.price) / originalAlert.token_data.price :
                0;
            let outcome = 'neutral';
            if (delayMs === 10 * 60 * 1000) {
                if (priceChange > 0.1 || currentData.score > originalAlert.token_data.score * 1.1) {
                    outcome = 'positive';
                }
                else if (priceChange < -0.05) {
                    outcome = 'negative';
                }
            }
            else {
                if (priceChange > 0.2 || currentData.score > originalAlert.token_data.score * 1.2) {
                    outcome = 'positive';
                }
                else if (priceChange < -0.1) {
                    outcome = 'negative';
                }
            }
            const updateQuery = `
        UPDATE shadow_alerts 
        SET outcome_tracked = true,
            outcome_result = $1,
            price_change_10min = CASE WHEN $2 = 600000 THEN $3 ELSE price_change_10min END,
            price_change_1h = CASE WHEN $2 = 3600000 THEN $3 ELSE price_change_1h END
        WHERE id = $4
      `;
            await this.db.query(updateQuery, [outcome, delayMs, priceChange, shadowAlertId]);
        }
        catch (error) {
            logger_1.logger.error('Error tracking outcome', {
                error: error.message,
                shadowAlertId,
                tokenAddress,
                chain
            });
        }
    }
    async getCurrentTokenData(tokenAddress, chain) {
        try {
            const query = `
        SELECT score, price, volume_24h 
        FROM radar_scans 
        WHERE token_address = $1 AND chain = $2 
        ORDER BY timestamp DESC 
        LIMIT 1
      `;
            const result = await this.db.query(query, [tokenAddress, chain]);
            if (result.rows.length > 0) {
                return result.rows[0];
            }
            return { score: 0, price: 0, volume_24h: 0 };
        }
        catch (error) {
            logger_1.logger.error('Error getting current token data', { error: error.message });
            return { score: 0, price: 0, volume_24h: 0 };
        }
    }
    async getShadowAlert(shadowAlertId) {
        try {
            const query = `
        SELECT * FROM shadow_alerts WHERE id = $1
      `;
            const result = await this.db.query(query, [shadowAlertId]);
            if (result.rows.length > 0) {
                const row = result.rows[0];
                return {
                    id: row.id,
                    proposal_id: row.proposal_id,
                    token_address: row.token_address,
                    chain: row.chain,
                    timestamp: row.timestamp,
                    triggered_by: JSON.parse(row.triggered_by),
                    token_data: JSON.parse(row.token_data),
                    would_alert: row.would_alert,
                    actual_alert_sent: row.actual_alert_sent,
                    outcome_tracked: row.outcome_tracked,
                    outcome_result: row.outcome_result,
                    price_change_10min: row.price_change_10min,
                    price_change_1h: row.price_change_1h
                };
            }
            return null;
        }
        catch (error) {
            logger_1.logger.error('Error getting shadow alert', { error: error.message });
            return null;
        }
    }
    async generateShadowTestMetrics(proposalId) {
        try {
            const query = `
        SELECT 
          proposal_id,
          chain,
          MIN(timestamp) as start_time,
          MAX(timestamp) as end_time,
          COUNT(*) as total_events,
          COUNT(*) FILTER (WHERE would_alert = true) as total_would_alerts,
          COUNT(*) FILTER (WHERE actual_alert_sent = true) as total_actual_alerts,
          COUNT(*) FILTER (WHERE would_alert = true AND outcome_result = 'positive') as true_positives,
          COUNT(*) FILTER (WHERE would_alert = true AND outcome_result IN ('negative', 'neutral')) as false_positives,
          COUNT(*) FILTER (WHERE would_alert = false AND outcome_result = 'positive') as false_negatives,
          COUNT(*) FILTER (WHERE outcome_tracked = true) as tracked_outcomes
        FROM shadow_alerts 
        WHERE proposal_id = $1
        GROUP BY proposal_id, chain
      `;
            const result = await this.db.query(query, [proposalId]);
            if (result.rows.length === 0) {
                throw new Error(`No shadow test data found for proposal ${proposalId}`);
            }
            const row = result.rows[0];
            const precision = row.total_would_alerts > 0 ?
                row.true_positives / row.total_would_alerts : 0;
            const recall = (row.true_positives + row.false_negatives) > 0 ?
                row.true_positives / (row.true_positives + row.false_negatives) : 0;
            const f1 = (precision + recall) > 0 ?
                2 * (precision * recall) / (precision + recall) : 0;
            const startTime = new Date(row.start_time);
            const endTime = new Date(row.end_time);
            const timeSpanHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
            const alertsPerHour = timeSpanHours > 0 ? row.total_would_alerts / timeSpanHours : 0;
            const n = row.total_would_alerts;
            const z = 1.96;
            const precisionCI = this.calculateConfidenceInterval(precision, n, z);
            const recallCI = this.calculateConfidenceInterval(recall, row.true_positives + row.false_negatives, z);
            return {
                proposal_id: proposalId,
                chain: row.chain,
                start_time: row.start_time,
                end_time: row.end_time,
                total_would_alerts: row.total_would_alerts,
                total_actual_alerts: row.total_actual_alerts,
                precision_estimate: precision,
                recall_estimate: recall,
                f1_estimate: f1,
                alerts_per_hour: alertsPerHour,
                false_positive_rate: row.total_would_alerts > 0 ? row.false_positives / row.total_would_alerts : 0,
                false_negative_rate: (row.true_positives + row.false_negatives) > 0 ?
                    row.false_negatives / (row.true_positives + row.false_negatives) : 0,
                confidence_interval: {
                    precision: precisionCI,
                    recall: recallCI
                }
            };
        }
        catch (error) {
            logger_1.logger.error('Error generating shadow test metrics', {
                error: error.message,
                proposalId
            });
            throw error;
        }
    }
    calculateConfidenceInterval(proportion, n, z) {
        if (n === 0) {
            return { lower: 0, upper: 0 };
        }
        const margin = z * Math.sqrt((proportion * (1 - proportion)) / n);
        return {
            lower: Math.max(0, proportion - margin),
            upper: Math.min(1, proportion + margin)
        };
    }
    async generateShadowTestReport(proposalId) {
        logger_1.logger.info('Generating shadow test report', { proposalId });
        const metrics = await this.generateShadowTestMetrics(proposalId);
        const reportQuery = `
      INSERT INTO shadow_test_reports (
        proposal_id, metrics, generated_at
      ) VALUES ($1, $2, NOW())
      ON CONFLICT (proposal_id) DO UPDATE SET
        metrics = EXCLUDED.metrics,
        generated_at = EXCLUDED.generated_at
    `;
        await this.db.query(reportQuery, [proposalId, JSON.stringify(metrics)]);
        logger_1.logger.info('Shadow test report generated', {
            proposalId,
            precision: metrics.precision_estimate,
            recall: metrics.recall_estimate,
            f1: metrics.f1_estimate,
            alertsPerHour: metrics.alerts_per_hour
        });
        return metrics;
    }
    async getAllActiveShadowTestMetrics() {
        const metrics = [];
        for (const proposalId of this.activeProposals.keys()) {
            try {
                const proposalMetrics = await this.generateShadowTestMetrics(proposalId);
                metrics.push(proposalMetrics);
            }
            catch (error) {
                logger_1.logger.warn('Could not generate metrics for proposal', {
                    proposalId,
                    error: error.message
                });
            }
        }
        return metrics;
    }
}
exports.ShadowTestingService = ShadowTestingService;
//# sourceMappingURL=ShadowTestingService.js.map