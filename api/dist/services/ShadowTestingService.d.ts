import { Pool } from 'pg';
import Redis from 'ioredis';
import { TuningConfig } from './AlertTuningService';
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
        precision: {
            lower: number;
            upper: number;
        };
        recall: {
            lower: number;
            upper: number;
        };
    };
}
export declare class ShadowTestingService {
    private db;
    private redis;
    private activeProposals;
    private isRunning;
    constructor(db: Pool, redis: Redis);
    startShadowTesting(): Promise<void>;
    stopShadowTesting(): Promise<void>;
    private loadActiveProposals;
    private setupRealtimeMonitoring;
    private processScanForShadowTesting;
    private processBatchShadowTesting;
    private wouldTriggerAlert;
    private checkIfActualAlertSent;
    private logShadowAlert;
    private scheduleOutcomeTracking;
    private trackOutcome;
    private getCurrentTokenData;
    private getShadowAlert;
    generateShadowTestMetrics(proposalId: string): Promise<ShadowTestMetrics>;
    private calculateConfidenceInterval;
    generateShadowTestReport(proposalId: string): Promise<ShadowTestMetrics>;
    getAllActiveShadowTestMetrics(): Promise<ShadowTestMetrics[]>;
}
//# sourceMappingURL=ShadowTestingService.d.ts.map