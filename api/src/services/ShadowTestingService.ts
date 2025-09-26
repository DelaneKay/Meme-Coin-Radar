import { Pool } from 'pg';
import Redis from 'ioredis';
import { logger } from '../utils/logger';
import { TuningConfig, TuningProposal } from './AlertTuningService';

// Utility function to safely extract error message
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error occurred';
}

export interface ShadowAlert {
  id: string;
  proposal_id: string;
  token_address: string;
  chain: string;
  timestamp: string;
  triggered_by: TuningConfig;
  token_data: {
    score: number;
    surge_15min: number;
    imbalance_5min: number;
    liquidity: number;
    price: number;
    volume_24h: number;
  };
  would_alert: boolean;
  actual_alert_sent: boolean;
  outcome_tracked: boolean;
  outcome_result?: 'positive' | 'negative' | 'neutral';
  price_change_10min?: number;
  price_change_1h?: number;
}

export interface ShadowTestMetrics {
  proposal_id: string;
  chain: string;
  start_time: string;
  end_time?: string;
  total_would_alerts: number;
  total_actual_alerts: number;
  precision_estimate: number;
  recall_estimate: number;
  f1_estimate: number;
  alerts_per_hour: number;
  false_positive_rate: number;
  false_negative_rate: number;
  confidence_interval: {
    precision: { lower: number; upper: number };
    recall: { lower: number; upper: number };
  };
}

export class ShadowTestingService {
  private db: Pool;
  private redis: Redis;
  private activeProposals: Map<string, TuningProposal> = new Map();
  private isRunning: boolean = false;

  constructor(db: Pool, redis: Redis) {
    this.db = db;
    this.redis = redis;
  }

  /**
   * Start shadow testing for active proposals
   */
  async startShadowTesting(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Shadow testing already running');
      return;
    }

    logger.info('Starting shadow testing service');
    this.isRunning = true;

    try {
      // Load active proposals
      await this.loadActiveProposals();

      // Set up real-time monitoring
      await this.setupRealtimeMonitoring();

      logger.info('Shadow testing service started', {
        activeProposals: this.activeProposals.size
      });

    } catch (error) {
      logger.error('Failed to start shadow testing', { error: getErrorMessage(error) });
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop shadow testing
   */
  async stopShadowTesting(): Promise<void> {
    logger.info('Stopping shadow testing service');
    this.isRunning = false;

    // Generate final reports for all active proposals
    for (const [proposalId, proposal] of Array.from(this.activeProposals.entries())) {
      await this.generateShadowTestReport(proposalId);
    }

    this.activeProposals.clear();
    logger.info('Shadow testing service stopped');
  }

  /**
   * Load active shadow testing proposals
   */
  private async loadActiveProposals(): Promise<void> {
    try {
      // Check Redis cache first
      const cachedProposals = await this.redis.get('shadow:active_proposals');
      if (cachedProposals) {
        const proposals: TuningProposal[] = JSON.parse(cachedProposals);
        for (const proposal of proposals) {
          this.activeProposals.set(proposal.id, proposal);
        }
        logger.info('Loaded proposals from cache', { count: proposals.length });
        return;
      }

      // Load from database
      const query = `
        SELECT * FROM tuning_proposals 
        WHERE status = 'shadow_testing'
          AND shadow_start_time > NOW() - INTERVAL '24 hours'
      `;

      const result = await this.db.query(query);
      
      for (const row of result.rows) {
        const proposal: TuningProposal = {
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

      logger.info('Loaded proposals from database', { count: result.rows.length });

    } catch (error) {
      logger.error('Failed to load active proposals', { error: getErrorMessage(error) });
      throw error;
    }
  }

  /**
   * Set up real-time monitoring for incoming radar data
   */
  private async setupRealtimeMonitoring(): Promise<void> {
    // Subscribe to Redis pub/sub for new radar scans
    const subscriber = new Redis(process.env.REDIS_URL!);
    
    subscriber.subscribe('radar:new_scan', (err) => {
      if (err) {
        logger.error('Failed to subscribe to radar updates', { error: err.message });
        return;
      }
      logger.info('Subscribed to radar updates for shadow testing');
    });

    subscriber.on('message', async (channel, message) => {
      if (channel === 'radar:new_scan') {
        try {
          const scanData = JSON.parse(message);
          await this.processScanForShadowTesting(scanData);
        } catch (error) {
          logger.error('Error processing scan for shadow testing', { 
            error: getErrorMessage(error),
            message 
          });
        }
      }
    });

    // Also set up periodic batch processing for missed events
    setInterval(async () => {
      await this.processBatchShadowTesting();
    }, 60000); // Every minute
  }

  /**
   * Process a single radar scan for shadow testing
   */
  private async processScanForShadowTesting(scanData: any): Promise<void> {
    if (!this.isRunning || this.activeProposals.size === 0) {
      return;
    }

    const { token_address, chain, score, surge_15min, imbalance_5min, liquidity } = scanData;

    // Test each active proposal
    for (const [proposalId, proposal] of Array.from(this.activeProposals.entries())) {
      // Skip if proposal is for different chain
      if (proposal.chain !== chain) {
        continue;
      }

      // Check if current time matches proposal's hour bucket
      const currentHour = new Date().getHours();
      const [startHour, endHour] = proposal.hour_bucket.split('-').map(Number);
      
      if (currentHour < startHour || currentHour >= endHour) {
        continue;
      }

      // Test if this scan would trigger an alert
      const wouldAlert = this.wouldTriggerAlert(scanData, proposal.rules);
      
      // Check if actual alert was sent (from current system)
      const actualAlertSent = await this.checkIfActualAlertSent(token_address, chain);

      // Log shadow alert
      const shadowAlert: ShadowAlert = {
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

      // Schedule outcome tracking
      if (wouldAlert) {
        await this.scheduleOutcomeTracking(shadowAlert.id, token_address, chain);
      }
    }
  }

  /**
   * Process batch shadow testing for missed events
   */
  private async processBatchShadowTesting(): Promise<void> {
    if (!this.isRunning || this.activeProposals.size === 0) {
      return;
    }

    try {
      // Get recent radar scans that haven't been processed
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

    } catch (error) {
      logger.error('Error in batch shadow testing', { error: getErrorMessage(error) });
    }
  }

  /**
   * Check if scan would trigger alert with given rules
   */
  private wouldTriggerAlert(scanData: any, rules: TuningConfig): boolean {
    return (
      scanData.score >= rules.SCORE_ALERT &&
      scanData.surge_15min >= rules.SURGE15_MIN &&
      scanData.imbalance_5min >= rules.IMBALANCE5_MIN &&
      scanData.liquidity >= rules.MIN_LIQ_ALERT
    );
  }

  /**
   * Check if actual alert was sent by current system
   */
  private async checkIfActualAlertSent(
    tokenAddress: string, 
    chain: string
  ): Promise<boolean> {
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

    } catch (error) {
      logger.error('Error checking actual alert', { error: getErrorMessage(error) });
      return false;
    }
  }

  /**
   * Log shadow alert to database
   */
  private async logShadowAlert(shadowAlert: ShadowAlert): Promise<void> {
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

      // Also cache in Redis for real-time access
      await this.redis.lpush(
        `shadow:alerts:${shadowAlert.proposal_id}`,
        JSON.stringify(shadowAlert)
      );

      // Keep only last 1000 alerts per proposal
      await this.redis.ltrim(`shadow:alerts:${shadowAlert.proposal_id}`, 0, 999);

    } catch (error) {
      logger.error('Error logging shadow alert', { 
        error: getErrorMessage(error),
        shadowAlert: shadowAlert.id 
      });
    }
  }

  /**
   * Schedule outcome tracking for shadow alert
   */
  private async scheduleOutcomeTracking(
    shadowAlertId: string,
    tokenAddress: string,
    chain: string
  ): Promise<void> {
    // Schedule tracking for 10 minutes and 1 hour later
    const trackingTimes = [10 * 60 * 1000, 60 * 60 * 1000]; // 10 min, 1 hour

    for (const delay of trackingTimes) {
      setTimeout(async () => {
        await this.trackOutcome(shadowAlertId, tokenAddress, chain, delay);
      }, delay);
    }
  }

  /**
   * Track outcome of shadow alert
   */
  private async trackOutcome(
    shadowAlertId: string,
    tokenAddress: string,
    chain: string,
    delayMs: number
  ): Promise<void> {
    try {
      // Get current price and score
      const currentData = await this.getCurrentTokenData(tokenAddress, chain);
      
      // Get original shadow alert data
      const originalAlert = await this.getShadowAlert(shadowAlertId);
      if (!originalAlert) {
        return;
      }

      // Calculate price change
      const priceChange = currentData.price > 0 && originalAlert.token_data.price > 0 ?
        (currentData.price - originalAlert.token_data.price) / originalAlert.token_data.price :
        0;

      // Determine outcome
      let outcome: 'positive' | 'negative' | 'neutral' = 'neutral';
      
      if (delayMs === 10 * 60 * 1000) { // 10 minutes
        if (priceChange > 0.1 || currentData.score > originalAlert.token_data.score * 1.1) {
          outcome = 'positive';
        } else if (priceChange < -0.05) {
          outcome = 'negative';
        }
      } else { // 1 hour
        if (priceChange > 0.2 || currentData.score > originalAlert.token_data.score * 1.2) {
          outcome = 'positive';
        } else if (priceChange < -0.1) {
          outcome = 'negative';
        }
      }

      // Update shadow alert with outcome
      const updateQuery = `
        UPDATE shadow_alerts 
        SET outcome_tracked = true,
            outcome_result = $1,
            price_change_10min = CASE WHEN $2 = 600000 THEN $3 ELSE price_change_10min END,
            price_change_1h = CASE WHEN $2 = 3600000 THEN $3 ELSE price_change_1h END
        WHERE id = $4
      `;

      await this.db.query(updateQuery, [outcome, delayMs, priceChange, shadowAlertId]);

    } catch (error) {
      logger.error('Error tracking outcome', { 
        error: getErrorMessage(error),
        shadowAlertId,
        tokenAddress,
        chain 
      });
    }
  }

  /**
   * Get current token data
   */
  private async getCurrentTokenData(tokenAddress: string, chain: string): Promise<any> {
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

    } catch (error) {
      logger.error('Error getting current token data', { error: getErrorMessage(error) });
      return { score: 0, price: 0, volume_24h: 0 };
    }
  }

  /**
   * Get shadow alert by ID
   */
  private async getShadowAlert(shadowAlertId: string): Promise<ShadowAlert | null> {
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

    } catch (error) {
      logger.error('Error getting shadow alert', { error: getErrorMessage(error) });
      return null;
    }
  }

  /**
   * Generate shadow test metrics for a proposal
   */
  async generateShadowTestMetrics(proposalId: string): Promise<ShadowTestMetrics> {
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

      // Calculate time span and alerts per hour
      const startTime = new Date(row.start_time);
      const endTime = new Date(row.end_time);
      const timeSpanHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
      const alertsPerHour = timeSpanHours > 0 ? row.total_would_alerts / timeSpanHours : 0;

      // Calculate confidence intervals (simplified)
      const n = row.total_would_alerts;
      const z = 1.96; // 95% confidence
      
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

    } catch (error) {
      logger.error('Error generating shadow test metrics', { 
        error: getErrorMessage(error),
        proposalId 
      });
      throw error;
    }
  }

  /**
   * Calculate confidence interval for proportion
   */
  private calculateConfidenceInterval(
    proportion: number, 
    n: number, 
    z: number
  ): { lower: number; upper: number } {
    if (n === 0) {
      return { lower: 0, upper: 0 };
    }

    const margin = z * Math.sqrt((proportion * (1 - proportion)) / n);
    return {
      lower: Math.max(0, proportion - margin),
      upper: Math.min(1, proportion + margin)
    };
  }

  /**
   * Generate shadow test report for a proposal
   */
  async generateShadowTestReport(proposalId: string): Promise<ShadowTestMetrics> {
    logger.info('Generating shadow test report', { proposalId });

    const metrics = await this.generateShadowTestMetrics(proposalId);

    // Save report to database
    const reportQuery = `
      INSERT INTO shadow_test_reports (
        proposal_id, metrics, generated_at
      ) VALUES ($1, $2, NOW())
      ON CONFLICT (proposal_id) DO UPDATE SET
        metrics = EXCLUDED.metrics,
        generated_at = EXCLUDED.generated_at
    `;

    await this.db.query(reportQuery, [proposalId, JSON.stringify(metrics)]);

    logger.info('Shadow test report generated', { 
      proposalId,
      precision: metrics.precision_estimate,
      recall: metrics.recall_estimate,
      f1: metrics.f1_estimate,
      alertsPerHour: metrics.alerts_per_hour
    });

    return metrics;
  }

  /**
   * Get all active shadow test metrics
   */
  async getAllActiveShadowTestMetrics(): Promise<ShadowTestMetrics[]> {
    const metrics: ShadowTestMetrics[] = [];

    for (const proposalId of Array.from(this.activeProposals.keys())) {
      try {
        const proposalMetrics = await this.generateShadowTestMetrics(proposalId);
        metrics.push(proposalMetrics);
      } catch (error) {
        logger.warn('Could not generate metrics for proposal', { 
          proposalId,
          error: getErrorMessage(error) 
        });
      }
    }

    return metrics;
  }
}