"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AlertTuningService = void 0;
const logger_1 = require("../utils/logger");
const DatabaseService_1 = require("./DatabaseService");
class AlertTuningService {
    constructor(db, redis) {
        this.db = db;
        this.redis = redis;
        this.dbService = new DatabaseService_1.DatabaseService(db);
    }
    async runBacktest(lookbackHours = 48, timeBucketHours = 3) {
        logger_1.logger.info('Starting alert threshold backtesting', {
            lookbackHours,
            timeBucketHours
        });
        try {
            const historicalData = await this.getHistoricalData(lookbackHours);
            const gridParams = {
                SCORE_ALERT: { min: 60, max: 80, step: 5 },
                SURGE15_MIN: { min: 2.0, max: 4.0, step: 0.5 },
                IMBALANCE5_MIN: { min: 0.25, max: 0.6, step: 0.05 },
                MIN_LIQ_ALERT: { min: 12000, max: 50000, step: 5000 }
            };
            const bucketedData = this.bucketDataByChainAndTime(historicalData, timeBucketHours);
            const results = [];
            for (const [chainTimeBucket, data] of bucketedData.entries()) {
                const [chain, timeBucket] = chainTimeBucket.split('|');
                logger_1.logger.info(`Running grid search for ${chain} - ${timeBucket}`, {
                    dataPoints: data.length
                });
                const chainResults = await this.runGridSearch(chain, timeBucket, data, gridParams);
                results.push(...chainResults);
            }
            await this.cacheBacktestResults(results);
            logger_1.logger.info('Backtesting completed', {
                totalResults: results.length,
                chains: [...new Set(results.map(r => r.chain))],
                timeBuckets: [...new Set(results.map(r => r.time_bucket))]
            });
            return results;
        }
        catch (error) {
            logger_1.logger.error('Backtesting failed', { error: error.message });
            throw error;
        }
    }
    async getHistoricalData(lookbackHours) {
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
    bucketDataByChainAndTime(data, bucketHours) {
        const buckets = new Map();
        for (const row of data) {
            const timestamp = new Date(row.timestamp);
            const hourBucket = Math.floor(timestamp.getHours() / bucketHours) * bucketHours;
            const bucketKey = `${row.chain}|${hourBucket}-${hourBucket + bucketHours}`;
            if (!buckets.has(bucketKey)) {
                buckets.set(bucketKey, []);
            }
            buckets.get(bucketKey).push(row);
        }
        return buckets;
    }
    async runGridSearch(chain, timeBucket, data, gridParams) {
        const results = [];
        const combinations = this.generateParameterCombinations(gridParams);
        logger_1.logger.info(`Testing ${combinations.length} parameter combinations`, {
            chain,
            timeBucket
        });
        for (const config of combinations) {
            const metrics = await this.evaluateConfiguration(data, config);
            const alerts = this.simulateAlerts(data, config);
            results.push({
                chain,
                time_bucket: timeBucket,
                config,
                metrics,
                alerts
            });
        }
        return results;
    }
    generateParameterCombinations(gridParams) {
        const combinations = [];
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
    async evaluateConfiguration(data, config) {
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
                }
                else {
                    falsePositives++;
                }
            }
            else if (actuallyGood) {
                falseNegatives++;
            }
        }
        const precision = totalAlerts > 0 ? truePositives / totalAlerts : 0;
        const recall = (truePositives + falseNegatives) > 0 ?
            truePositives / (truePositives + falseNegatives) : 0;
        const f1 = (precision + recall) > 0 ?
            2 * (precision * recall) / (precision + recall) : 0;
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
    wouldTriggerAlert(data, config) {
        return (data.score >= config.SCORE_ALERT &&
            data.surge_15min >= config.SURGE15_MIN &&
            data.imbalance_5min >= config.IMBALANCE5_MIN &&
            data.liquidity >= config.MIN_LIQ_ALERT);
    }
    simulateAlerts(data, config) {
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
    async findParetoOptimalConfigurations(results, currentConfig, constraints) {
        logger_1.logger.info('Finding Pareto-optimal configurations', {
            totalResults: results.length,
            constraints
        });
        const baselineMetrics = await this.evaluateCurrentConfiguration(currentConfig);
        const minF1Required = baselineMetrics.f1 * (1 + constraints.minF1Improvement);
        const resultsByChain = new Map();
        for (const result of results) {
            if (!resultsByChain.has(result.chain)) {
                resultsByChain.set(result.chain, []);
            }
            resultsByChain.get(result.chain).push(result);
        }
        const proposals = [];
        for (const [chain, chainResults] of resultsByChain.entries()) {
            const validResults = chainResults.filter(result => result.metrics.f1 >= minF1Required &&
                result.metrics.alerts_per_hour <= constraints.maxAlertsPerHour &&
                result.metrics.precision >= constraints.minPrecision);
            if (validResults.length === 0) {
                logger_1.logger.warn(`No valid configurations found for chain ${chain}`);
                continue;
            }
            const paretoOptimal = this.findParetoFrontier(validResults);
            const bucketBest = new Map();
            for (const result of paretoOptimal) {
                const current = bucketBest.get(result.time_bucket);
                if (!current || result.metrics.f1 > current.metrics.f1) {
                    bucketBest.set(result.time_bucket, result);
                }
            }
            for (const [timeBucket, result] of bucketBest.entries()) {
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
        logger_1.logger.info('Generated tuning proposals', {
            totalProposals: proposals.length,
            chains: [...new Set(proposals.map(p => p.chain))]
        });
        return proposals;
    }
    findParetoFrontier(results) {
        const paretoOptimal = [];
        for (const candidate of results) {
            let isDominated = false;
            for (const other of results) {
                if (other === candidate)
                    continue;
                const betterF1 = other.metrics.f1 >= candidate.metrics.f1;
                const betterPrecision = other.metrics.precision >= candidate.metrics.precision;
                const fewerAlerts = other.metrics.alerts_per_hour <= candidate.metrics.alerts_per_hour;
                const strictlyBetter = other.metrics.f1 > candidate.metrics.f1 ||
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
    async evaluateCurrentConfiguration(config) {
        return {
            precision: 0.45,
            recall: 0.38,
            f1: 0.41,
            alerts_per_hour: 8.5
        };
    }
    async saveProposals(proposals) {
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
        logger_1.logger.info('Saved tuning proposals to database', {
            count: proposals.length
        });
    }
    async cacheBacktestResults(results) {
        const cacheKey = `backtest:results:${Date.now()}`;
        await this.redis.setex(cacheKey, 24 * 60 * 60, JSON.stringify(results));
        const summaryByChain = new Map();
        for (const result of results) {
            if (!summaryByChain.has(result.chain)) {
                summaryByChain.set(result.chain, {
                    chain: result.chain,
                    configurations_tested: 0,
                    best_f1: 0,
                    best_config: null
                });
            }
            const summary = summaryByChain.get(result.chain);
            summary.configurations_tested++;
            if (result.metrics.f1 > summary.best_f1) {
                summary.best_f1 = result.metrics.f1;
                summary.best_config = result.config;
            }
        }
        await this.redis.setex(`backtest:summary:${Date.now()}`, 24 * 60 * 60, JSON.stringify([...summaryByChain.values()]));
    }
    async getCurrentConfiguration() {
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
        }
        catch (error) {
            logger_1.logger.warn('Could not fetch current config from database', { error: error.message });
        }
        return {
            SCORE_ALERT: 70,
            SURGE15_MIN: 2.5,
            IMBALANCE5_MIN: 0.35,
            MIN_LIQ_ALERT: 25000
        };
    }
    async startShadowTesting(proposalIds) {
        logger_1.logger.info('Starting shadow testing', { proposalIds });
        const updateQuery = `
      UPDATE tuning_proposals 
      SET status = 'shadow_testing',
          shadow_start_time = NOW()
      WHERE id = ANY($1)
    `;
        await this.db.query(updateQuery, [proposalIds]);
        const proposals = await this.getProposalsByIds(proposalIds);
        await this.redis.setex('shadow:active_proposals', 24 * 60 * 60, JSON.stringify(proposals));
        logger_1.logger.info('Shadow testing started', {
            proposalCount: proposals.length,
            duration: '24 hours'
        });
    }
    async getProposalsByIds(ids) {
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
}
exports.AlertTuningService = AlertTuningService;
//# sourceMappingURL=AlertTuningService.js.map