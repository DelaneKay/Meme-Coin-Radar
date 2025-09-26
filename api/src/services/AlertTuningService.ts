import { Pool } from 'pg';
import * as Redis from 'ioredis';
import { logger } from '../utils/logger';

export interface TuningConfig {
  SCORE_ALERT: number;
  SURGE15_MIN: number;
  IMBALANCE5_MIN: number;
  MIN_LIQ_ALERT: number;
}

export interface TuningProposal {
  id: string;
  chain: string;
  hour_bucket: string;
  rules: TuningConfig;
  evidence: {
    precision: number;
    recall: number;
    f1: number;
    alerts_per_hour: number;
    true_positives: number;
    false_positives: number;
    false_negatives: number;
    total_alerts: number;
    total_opportunities: number;
  };
  created_at: string;
  status: 'pending' | 'shadow_testing' | 'approved' | 'rejected' | 'applied';
}

export interface BacktestResult {
  chain: string;
  time_bucket: string;
  config: TuningConfig;
  metrics: {
    precision: number;
    recall: number;
    f1: number;
    alerts_per_hour: number;
    true_positives: number;
    false_positives: number;
    false_negatives: number;
  };
  alerts: AlertEvent[];
  proposals: TuningProposal[];
  total_configurations?: number;
  time_buckets?: string[];
  data_points?: number;
  current_performance?: {
    f1: number;
    precision: number;
    recall: number;
    alerts_per_hour: number;
  };
}

export interface AlertEvent {
  token_address: string;
  timestamp: string;
  score: number;
  surge_15min: number;
  imbalance_5min: number;
  liquidity: number;
  triggered: boolean;
  actual_outcome: 'positive' | 'negative' | 'neutral';
  price_change_10min: number;
  sustained_score: boolean;
}

export interface GridSearchParams {
  SCORE_ALERT: { min: number; max: number; step: number };
  SURGE15_MIN: { min: number; max: number; step: number };
  IMBALANCE5_MIN: { min: number; max: number; step: number };
  MIN_LIQ_ALERT: { min: number; max: number; step: number };
}

export class AlertTuningService {
  private db: Pool;
  private redis: Redis.Redis;

  constructor(db: Pool, redis: Redis.Redis) {
    this.db = db;
    this.redis = redis;
  }

  /**
   * Run comprehensive backtesting with grid search optimization
   */
  async runBacktest(
    lookbackHours: number = 48,
    timeBucketHours: number = 3
  ): Promise<BacktestResult[]> {
    logger.info('Starting alert threshold backtesting', {
      lookbackHours,
      timeBucketHours
    });

    try {
      // Get historical data
      const historicalData = await this.getHistoricalData(lookbackHours);
      
      // Define grid search parameters
      const gridParams: GridSearchParams = {
        SCORE_ALERT: { min: 60, max: 80, step: 5 },
        SURGE15_MIN: { min: 2.0, max: 4.0, step: 0.5 },
        IMBALANCE5_MIN: { min: 0.25, max: 0.6, step: 0.05 },
        MIN_LIQ_ALERT: { min: 12000, max: 50000, step: 5000 }
      };

      // Group data by chain and time buckets
      const bucketedData = this.bucketDataByChainAndTime(
        historicalData,
        timeBucketHours
      );

      const results: BacktestResult[] = [];

      // Run grid search for each chain and time bucket
      for (const [chainTimeBucket, data] of Array.from(bucketedData.entries())) {
        const [chain, timeBucket] = chainTimeBucket.split('|');
        
        logger.info(`Running grid search for ${chain} - ${timeBucket}`, {
          dataPoints: data.length
        });

        const chainResults = await this.runGridSearch(
          chain,
          timeBucket,
          data,
          gridParams
        );

        results.push(...chainResults);
      }

      // Cache results for analysis
      await this.cacheBacktestResults(results);

      logger.info('Backtesting completed', {
        totalResults: results.length,
        chains: Array.from(new Set(results.map(r => r.chain))),
        timeBuckets: Array.from(new Set(results.map(r => r.time_bucket)))
      });

      return results;

    } catch (error: unknown) {
      logger.error('Backtesting failed', { error: getErrorMessage(error) });
      throw error;
    }
  }

  /**
   * Get historical radar and signals data
   */
  private async getHistoricalData(lookbackHours: number): Promise<any[]> {
    const cutoffTime = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

    const query = `
      WITH radar_data AS (
        SELECT 
          r.token_address,
          r.chain,
          r.timestamp,
          r.score,
          r.surge_15min,
          r.imbalance_5min,
          r.liquidity,
          r.price_change_1h,
          r.price_change_24h,
          -- Calculate actual outcome based on price performance
          CASE 
            WHEN r.price_change_1h > 0.1 OR r.score > r.score * 1.1 THEN 'positive'
            WHEN r.price_change_1h < -0.05 THEN 'negative'
            ELSE 'neutral'
          END as actual_outcome,
          -- Check if score was sustained for 10+ minutes
          LAG(r.score, 1) OVER (
            PARTITION BY r.token_address 
            ORDER BY r.timestamp
          ) as prev_score
        FROM radar_scans r
        WHERE r.timestamp >= $1
          AND r.score IS NOT NULL
          AND r.surge_15min IS NOT NULL
          AND r.imbalance_5min IS NOT NULL
          AND r.liquidity IS NOT NULL
      ),
      signals_data AS (
        SELECT 
          s.token_address,
          s.chain,
          s.timestamp,
          s.signal_type,
          s.confidence,
          s.metadata
        FROM signals s
        WHERE s.timestamp >= $1
      )
      SELECT 
        rd.*,
        sd.signal_type,
        sd.confidence as signal_confidence,
        -- Calculate if score was sustained
        CASE 
          WHEN rd.prev_score IS NOT NULL 
            AND rd.score >= rd.prev_score * 0.9 
          THEN true 
          ELSE false 
        END as sustained_score,
        -- Get price change 10 minutes later
        LEAD(rd.price_change_1h, 1) OVER (
          PARTITION BY rd.token_address 
          ORDER BY rd.timestamp
        ) as price_change_10min
      FROM radar_data rd
      LEFT JOIN signals_data sd ON (
        rd.token_address = sd.token_address 
        AND rd.chain = sd.chain
        AND ABS(EXTRACT(EPOCH FROM (rd.timestamp - sd.timestamp))) < 300
      )
      ORDER BY rd.chain, rd.timestamp;
    `;

    const result = await this.db.query(query, [cutoffTime]);
    return result.rows;
  }

  /**
   * Bucket data by chain and time windows
   */
  private bucketDataByChainAndTime(
    data: any[],
    bucketHours: number
  ): Map<string, any[]> {
    const buckets = new Map<string, any[]>();

    for (const row of data) {
      const timestamp = new Date(row.timestamp);
      const hourBucket = Math.floor(timestamp.getHours() / bucketHours) * bucketHours;
      const bucketKey = `${row.chain}|${hourBucket}-${hourBucket + bucketHours}`;

      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, []);
      }
      buckets.get(bucketKey)!.push(row);
    }

    return buckets;
  }

  /**
   * Run grid search optimization for a specific chain and time bucket
   */
  private async runGridSearch(
    chain: string,
    timeBucket: string,
    data: any[],
    gridParams: GridSearchParams
  ): Promise<BacktestResult[]> {
    const results: BacktestResult[] = [];

    // Generate all parameter combinations
    const combinations = this.generateParameterCombinations(gridParams);
    
    logger.info(`Testing ${combinations.length} parameter combinations`, {
      chain,
      timeBucket
    });

    for (const config of combinations) {
      const metrics = await this.evaluateConfiguration(data, config);
      
      // Filter alerts that would have been triggered
      const alerts = this.simulateAlerts(data, config);

      results.push({
        chain,
        time_bucket: timeBucket,
        config,
        metrics,
        alerts,
        proposals: []
      });
    }

    return results;
  }

  /**
   * Generate all parameter combinations for grid search
   */
  private generateParameterCombinations(gridParams: GridSearchParams): TuningConfig[] {
    const combinations: TuningConfig[] = [];

    for (let score = gridParams.SCORE_ALERT.min; score <= gridParams.SCORE_ALERT.max; score += gridParams.SCORE_ALERT.step) {
      for (let surge = gridParams.SURGE15_MIN.min; surge <= gridParams.SURGE15_MIN.max; surge += gridParams.SURGE15_MIN.step) {
        for (let imbalance = gridParams.IMBALANCE5_MIN.min; imbalance <= gridParams.IMBALANCE5_MIN.max; imbalance += gridParams.IMBALANCE5_MIN.step) {
          for (let liquidity = gridParams.MIN_LIQ_ALERT.min; liquidity <= gridParams.MIN_LIQ_ALERT.max; liquidity += gridParams.MIN_LIQ_ALERT.step) {
            combinations.push({
              SCORE_ALERT: score,
              SURGE15_MIN: surge,
              IMBALANCE5_MIN: imbalance,
              MIN_LIQ_ALERT: liquidity
            });
          }
        }
      }
    }

    return combinations;
  }

  /**
   * Evaluate a configuration against historical data
   */
  private async evaluateConfiguration(
    data: any[],
    config: TuningConfig
  ): Promise<BacktestResult['metrics']> {
    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;
    let totalAlerts = 0;

    for (const row of data) {
      const wouldAlert = this.wouldTriggerAlert(row, config);
      const actuallyGood = row.actual_outcome === 'positive' || row.sustained_score;

      if (wouldAlert) {
        totalAlerts++;
        if (actuallyGood) {
          truePositives++;
        } else {
          falsePositives++;
        }
      } else if (actuallyGood) {
        falseNegatives++;
      }
    }

    const precision = totalAlerts > 0 ? truePositives / totalAlerts : 0;
    const recall = (truePositives + falseNegatives) > 0 ? 
      truePositives / (truePositives + falseNegatives) : 0;
    const f1 = (precision + recall) > 0 ? 
      2 * (precision * recall) / (precision + recall) : 0;

    // Calculate alerts per hour (assuming data spans the lookback period)
    const timeSpanHours = data.length > 0 ? 
      (new Date(data[data.length - 1].timestamp).getTime() - 
       new Date(data[0].timestamp).getTime()) / (1000 * 60 * 60) : 1;
    const alertsPerHour = totalAlerts / Math.max(timeSpanHours, 1);

    return {
      precision,
      recall,
      f1,
      alerts_per_hour: alertsPerHour,
      true_positives: truePositives,
      false_positives: falsePositives,
      false_negatives: falseNegatives
    };
  }

  /**
   * Check if a data point would trigger an alert with given config
   */
  private wouldTriggerAlert(data: any, config: TuningConfig): boolean {
    return (
      data.score >= config.SCORE_ALERT &&
      data.surge_15min >= config.SURGE15_MIN &&
      data.imbalance_5min >= config.IMBALANCE5_MIN &&
      data.liquidity >= config.MIN_LIQ_ALERT
    );
  }

  /**
   * Simulate alerts for a configuration
   */
  private simulateAlerts(data: any[], config: TuningConfig): AlertEvent[] {
    return data
      .filter(row => this.wouldTriggerAlert(row, config))
      .map(row => ({
        token_address: row.token_address,
        timestamp: row.timestamp,
        score: row.score,
        surge_15min: row.surge_15min,
        imbalance_5min: row.imbalance_5min,
        liquidity: row.liquidity,
        triggered: true,
        actual_outcome: row.actual_outcome,
        price_change_10min: row.price_change_10min || 0,
        sustained_score: row.sustained_score || false
      }));
  }

  /**
   * Find Pareto-optimal configurations
   */
  async findParetoOptimalConfigurations(
    results: BacktestResult[],
    currentConfig: TuningConfig,
    constraints: {
      minF1Improvement: number;
      maxAlertsPerHour: number;
      minPrecision: number;
    }
  ): Promise<TuningProposal[]> {
    logger.info('Finding Pareto-optimal configurations', {
      totalResults: results.length,
      constraints
    });

    // Get current baseline metrics
    const baselineMetrics = await this.evaluateCurrentConfiguration(currentConfig);
    const minF1Required = baselineMetrics.f1 * (1 + constraints.minF1Improvement);

    // Group results by chain
    const resultsByChain = new Map<string, BacktestResult[]>();
    for (const result of results) {
      if (!resultsByChain.has(result.chain)) {
        resultsByChain.set(result.chain, []);
      }
      resultsByChain.get(result.chain)!.push(result);
    }

    const proposals: TuningProposal[] = [];

    for (const [chain, chainResults] of Array.from(resultsByChain.entries())) {
      // Filter results that meet constraints
      const validResults = chainResults.filter(result => 
        result.metrics.f1 >= minF1Required &&
        result.metrics.alerts_per_hour <= constraints.maxAlertsPerHour &&
        result.metrics.precision >= constraints.minPrecision
      );

      if (validResults.length === 0) {
        logger.warn(`No valid configurations found for chain ${chain}`);
        continue;
      }

      // Find Pareto frontier
      const paretoOptimal = this.findParetoFrontier(validResults);

      // Group by time bucket and select best for each
      const bucketBest = new Map<string, BacktestResult>();
      for (const result of paretoOptimal) {
        const current = bucketBest.get(result.time_bucket);
        if (!current || result.metrics.f1 > current.metrics.f1) {
          bucketBest.set(result.time_bucket, result);
        }
      }

      // Create proposals
      for (const [timeBucket, result] of Array.from(bucketBest.entries())) {
        proposals.push({
          id: `${chain}-${timeBucket}-${Date.now()}`,
          chain,
          hour_bucket: timeBucket,
          rules: result.config,
          evidence: {
            precision: result.metrics.precision,
            recall: result.metrics.recall,
            f1: result.metrics.f1,
            alerts_per_hour: result.metrics.alerts_per_hour,
            true_positives: result.metrics.true_positives,
            false_positives: result.metrics.false_positives,
            false_negatives: result.metrics.false_negatives,
            total_alerts: result.metrics.true_positives + result.metrics.false_positives,
            total_opportunities: result.metrics.true_positives + result.metrics.false_negatives
          },
          created_at: new Date().toISOString(),
          status: 'pending'
        });
      }
    }

    logger.info('Generated tuning proposals', {
      totalProposals: proposals.length,
      chains: Array.from(new Set(proposals.map(p => p.chain)))
    });

    return proposals;
  }

  /**
   * Find Pareto frontier (non-dominated solutions)
   */
  private findParetoFrontier(results: BacktestResult[]): BacktestResult[] {
    const paretoOptimal: BacktestResult[] = [];

    for (const candidate of results) {
      let isDominated = false;

      for (const other of results) {
        if (other === candidate) continue;

        // Check if 'other' dominates 'candidate'
        // Better in all objectives: F1, precision, and lower alerts/hour
        const betterF1 = other.metrics.f1 >= candidate.metrics.f1;
        const betterPrecision = other.metrics.precision >= candidate.metrics.precision;
        const fewerAlerts = other.metrics.alerts_per_hour <= candidate.metrics.alerts_per_hour;

        const strictlyBetter = 
          other.metrics.f1 > candidate.metrics.f1 ||
          other.metrics.precision > candidate.metrics.precision ||
          other.metrics.alerts_per_hour < candidate.metrics.alerts_per_hour;

        if (betterF1 && betterPrecision && fewerAlerts && strictlyBetter) {
          isDominated = true;
          break;
        }
      }

      if (!isDominated) {
        paretoOptimal.push(candidate);
      }
    }

    return paretoOptimal;
  }

  /**
   * Evaluate current configuration for baseline
   */
  private async evaluateCurrentConfiguration(config: TuningConfig): Promise<any> {
    // This would typically fetch recent performance data
    // For now, return reasonable baseline metrics
    return {
      precision: 0.45,
      recall: 0.38,
      f1: 0.41,
      alerts_per_hour: 8.5
    };
  }

  /**
   * Save proposals to database
   */
  async saveProposals(proposals: TuningProposal[]): Promise<void> {
    const query = `
      INSERT INTO tuning_proposals (
        id, chain, hour_bucket, rules, evidence, created_at, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET
        rules = EXCLUDED.rules,
        evidence = EXCLUDED.evidence,
        status = EXCLUDED.status
    `;

    for (const proposal of proposals) {
      await this.db.query(query, [
        proposal.id,
        proposal.chain,
        proposal.hour_bucket,
        JSON.stringify(proposal.rules),
        JSON.stringify(proposal.evidence),
        proposal.created_at,
        proposal.status
      ]);
    }

    logger.info('Saved tuning proposals to database', {
      count: proposals.length
    });
  }

  /**
   * Cache backtest results for analysis
   */
  private async cacheBacktestResults(results: BacktestResult[]): Promise<void> {
    const cacheKey = `backtest:results:${Date.now()}`;
    await this.redis.setex(
      cacheKey,
      24 * 60 * 60, // 24 hours
      JSON.stringify(results)
    );

    // Also cache summary by chain
    const summaryByChain = new Map<string, any>();
    for (const result of results) {
      if (!summaryByChain.has(result.chain)) {
        summaryByChain.set(result.chain, {
          chain: result.chain,
          configurations_tested: 0,
          best_f1: 0,
          best_config: null
        });
      }

      const summary = summaryByChain.get(result.chain)!;
      summary.configurations_tested++;
      
      if (result.metrics.f1 > summary.best_f1) {
        summary.best_f1 = result.metrics.f1;
        summary.best_config = result.config;
      }
    }

    await this.redis.setex(
      `backtest:summary:${Date.now()}`,
      24 * 60 * 60,
      JSON.stringify(Array.from(summaryByChain.values()))
    );
  }

  /**
   * Get current configuration from database/config
   */
  async getCurrentConfiguration(): Promise<TuningConfig> {
    try {
      const query = `
        SELECT config_value 
        FROM system_config 
        WHERE config_key = 'alert_thresholds'
      `;
      
      const result = await this.db.query(query);
      
      if (result.rows.length > 0) {
        return JSON.parse(result.rows[0].config_value);
      }
    } catch (error: unknown) {
      logger.warn('Could not fetch current config from database', { error: getErrorMessage(error) });
    }

    // Return default configuration
    return {
      SCORE_ALERT: 70,
      SURGE15_MIN: 2.5,
      IMBALANCE5_MIN: 0.35,
      MIN_LIQ_ALERT: 25000
    };
  }

  /**
   * Start shadow testing for proposals
   */
  async startShadowTesting(proposalIds: string[]): Promise<void> {
    logger.info('Starting shadow testing', { proposalIds });

    // Update proposal status
    const updateQuery = `
      UPDATE tuning_proposals 
      SET status = 'shadow_testing',
          shadow_start_time = NOW()
      WHERE id = ANY($1)
    `;
    
    await this.db.query(updateQuery, [proposalIds]);

    // Cache active shadow proposals
    const proposals = await this.getProposalsByIds(proposalIds);
    await this.redis.setex(
      'shadow:active_proposals',
      24 * 60 * 60, // 24 hours
      JSON.stringify(proposals)
    );

    logger.info('Shadow testing started', {
      proposalCount: proposals.length,
      duration: '24 hours'
    });
  }

  /**
   * Get proposals by IDs
   */
  private async getProposalsByIds(ids: string[]): Promise<TuningProposal[]> {
    const query = `
      SELECT * FROM tuning_proposals 
      WHERE id = ANY($1)
    `;
    
    const result = await this.db.query(query, [ids]);
    
    return result.rows.map(row => ({
      id: row.id,
      chain: row.chain,
      hour_bucket: row.hour_bucket,
      rules: JSON.parse(row.rules),
      evidence: JSON.parse(row.evidence),
      created_at: row.created_at,
      status: row.status
    }));
  }

  /**
   * Check orchestrator flag for auto-apply functionality
   */
  async checkOrchestratorFlag(): Promise<boolean> {
    try {
      const query = `
        SELECT config_value 
        FROM system_config 
        WHERE config_key = 'orchestrator_enabled'
      `;
      
      const result = await this.db.query(query);
      
      if (result.rows.length > 0) {
        return JSON.parse(result.rows[0].config_value) === true;
      }
    } catch (error) {
      logger.warn('Could not fetch orchestrator flag from database', { error: getErrorMessage(error) });
    }

    // Default to false for safety
    return false;
  }

  /**
   * Get current config (alias for getCurrentConfiguration)
   */
  async getCurrentConfig(): Promise<TuningConfig> {
    return this.getCurrentConfiguration();
  }

  /**
   * Get a specific proposal by ID
   */
  async getProposal(proposalId: string): Promise<TuningProposal | null> {
    try {
      const query = `
        SELECT * FROM tuning_proposals 
        WHERE id = $1
      `;
      
      const result = await this.db.query(query, [proposalId]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        chain: row.chain,
        hour_bucket: row.hour_bucket,
        rules: JSON.parse(row.rules),
        evidence: JSON.parse(row.evidence),
        created_at: row.created_at,
        status: row.status
      };
    } catch (error) {
      logger.error('Failed to get proposal', { proposalId, error: getErrorMessage(error) });
      return null;
    }
  }

  /**
   * Apply a proposal to production
   */
  async applyProposal(proposalId: string): Promise<void> {
    try {
      const proposal = await this.getProposal(proposalId);
      if (!proposal) {
        throw new Error('Proposal not found');
      }

      // Update system config with new rules
      const updateConfigQuery = `
        INSERT INTO system_config (config_key, config_value, updated_at)
        VALUES ('alert_thresholds', $1, NOW())
        ON CONFLICT (config_key) 
        DO UPDATE SET config_value = $1, updated_at = NOW()
      `;
      
      await this.db.query(updateConfigQuery, [JSON.stringify(proposal.rules)]);

      // Update proposal status
      const updateProposalQuery = `
        UPDATE tuning_proposals 
        SET status = 'applied', applied_at = NOW()
        WHERE id = $1
      `;
      
      await this.db.query(updateProposalQuery, [proposalId]);

      // Clear any cached configurations
      await this.redis.del('config:alert_thresholds');

      logger.info('Proposal applied successfully', { 
        proposalId, 
        chain: proposal.chain,
        rules: proposal.rules 
      });

    } catch (error) {
      logger.error('Failed to apply proposal', { proposalId, error: getErrorMessage(error) });
      throw error;
    }
  }

  /**
   * Save a single proposal to the database
   */
  async saveProposal(proposal: TuningProposal): Promise<void> {
    try {
      const query = `
        INSERT INTO tuning_proposals (
          id, chain, hour_bucket, rules, evidence, status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (id) DO UPDATE SET
          rules = EXCLUDED.rules,
          evidence = EXCLUDED.evidence,
          status = EXCLUDED.status,
          updated_at = NOW()
      `;

      await this.db.query(query, [
        proposal.id,
        proposal.chain,
        proposal.hour_bucket,
        JSON.stringify(proposal.rules),
        JSON.stringify(proposal.evidence),
        proposal.status || 'pending'
      ]);

      logger.info('Proposal saved successfully', { 
        proposalId: proposal.id,
        chain: proposal.chain,
        status: proposal.status 
      });

    } catch (error) {
      logger.error('Failed to save proposal', { 
        proposalId: proposal.id, 
        error: getErrorMessage(error) 
      });
      throw error;
    }
  }

  /**
   * Update proposal status
   */
  async updateProposalStatus(proposalId: string, status: string): Promise<void> {
    try {
      const query = `
        UPDATE tuning_proposals 
        SET status = $1, updated_at = NOW()
        WHERE id = $2
      `;

      const result = await this.db.query(query, [status, proposalId]);

      if (result.rowCount === 0) {
        throw new Error(`Proposal ${proposalId} not found`);
      }

      logger.info('Proposal status updated', { proposalId, status });

    } catch (error) {
      logger.error('Failed to update proposal status', { 
        proposalId, 
        status, 
        error: getErrorMessage(error) 
      });
      throw error;
    }
  }

  /**
   * Get current backtest status
   */
  async getBacktestStatus(): Promise<any> {
    try {
      const query = `
        SELECT 
          COUNT(*) as total_proposals,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
          COUNT(CASE WHEN status = 'shadow_testing' THEN 1 END) as shadow_testing,
          COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved,
          COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected,
          MAX(created_at) as last_backtest
        FROM tuning_proposals
        WHERE created_at > NOW() - INTERVAL '7 days'
      `;

      const result = await this.db.query(query);
      const stats = result.rows[0];

      return {
        status: 'active',
        proposal_stats: {
          total: parseInt(stats.total_proposals),
          pending: parseInt(stats.pending),
          shadow_testing: parseInt(stats.shadow_testing),
          approved: parseInt(stats.approved),
          rejected: parseInt(stats.rejected)
        },
        last_backtest: stats.last_backtest,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Failed to get backtest status', { 
        error: getErrorMessage(error) 
      });
      return {
        status: 'error',
        error: getErrorMessage(error),
        timestamp: new Date().toISOString()
      };
     }
   }

  /**
   * Get proposals with pagination
   */
  async getProposals(options: { limit?: number; offset?: number; status?: string } = {}): Promise<any[]> {
    try {
      const { limit = 20, offset = 0, status } = options;
      
      let query = `
        SELECT id, chain, hour_bucket, rules, evidence, status, created_at, updated_at
        FROM tuning_proposals
      `;
      
      const params: any[] = [];
      
      if (status) {
        query += ` WHERE status = $1`;
        params.push(status);
      }
      
      query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const result = await this.db.query(query, params);
      
      return result.rows.map(row => ({
        id: row.id,
        chain: row.chain,
        hour_bucket: row.hour_bucket,
        rules: JSON.parse(row.rules),
        evidence: JSON.parse(row.evidence),
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at
      }));
    } catch (error) {
      logger.error('Failed to get proposals', { 
        error: getErrorMessage(error) 
      });
      return [];
    }
  }

  /**
   * Set orchestrator flag for auto-apply functionality
   */
  async setOrchestratorFlag(enabled: boolean): Promise<void> {
    try {
      const query = `
        INSERT INTO system_config (config_key, config_value, updated_at)
        VALUES ('orchestrator_enabled', $1, NOW())
        ON CONFLICT (config_key) 
        DO UPDATE SET config_value = $1, updated_at = NOW()
      `;
      
      await this.db.query(query, [JSON.stringify(enabled)]);

      logger.info('Orchestrator flag updated', { enabled });

    } catch (error) {
      logger.error('Failed to set orchestrator flag', { 
        enabled, 
        error: getErrorMessage(error) 
      });
      throw error;
    }
  }
}

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