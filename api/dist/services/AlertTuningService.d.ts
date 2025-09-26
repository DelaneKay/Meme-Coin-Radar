import { Pool } from 'pg';
import Redis from 'ioredis';
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
    SCORE_ALERT: {
        min: number;
        max: number;
        step: number;
    };
    SURGE15_MIN: {
        min: number;
        max: number;
        step: number;
    };
    IMBALANCE5_MIN: {
        min: number;
        max: number;
        step: number;
    };
    MIN_LIQ_ALERT: {
        min: number;
        max: number;
        step: number;
    };
}
export declare class AlertTuningService {
    private db;
    private redis;
    private dbService;
    constructor(db: Pool, redis: Redis);
    runBacktest(lookbackHours?: number, timeBucketHours?: number): Promise<BacktestResult[]>;
    private getHistoricalData;
    private bucketDataByChainAndTime;
    private runGridSearch;
    private generateParameterCombinations;
    private evaluateConfiguration;
    private wouldTriggerAlert;
    private simulateAlerts;
    findParetoOptimalConfigurations(results: BacktestResult[], currentConfig: TuningConfig, constraints: {
        minF1Improvement: number;
        maxAlertsPerHour: number;
        minPrecision: number;
    }): Promise<TuningProposal[]>;
    private findParetoFrontier;
    private evaluateCurrentConfiguration;
    saveProposals(proposals: TuningProposal[]): Promise<void>;
    private cacheBacktestResults;
    getCurrentConfiguration(): Promise<TuningConfig>;
    startShadowTesting(proposalIds: string[]): Promise<void>;
    private getProposalsByIds;
}
//# sourceMappingURL=AlertTuningService.d.ts.map