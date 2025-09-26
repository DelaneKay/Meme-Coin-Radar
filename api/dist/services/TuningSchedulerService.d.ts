import { Pool } from 'pg';
import Redis from 'ioredis';
import { AlertTuningService, GridSearchParams } from './AlertTuningService';
import { ShadowTestingService } from './ShadowTestingService';
import { ReportGenerationService } from './ReportGenerationService';
export interface SchedulerConfig {
    backtest_schedule: string;
    report_schedule: string;
    shadow_test_duration_hours: number;
    auto_apply_threshold: number;
    max_concurrent_backtests: number;
    notification_webhooks: {
        slack?: string;
        discord?: string;
        email?: string[];
    };
}
export interface ScheduledJob {
    id: string;
    type: 'backtest' | 'report' | 'shadow_cleanup' | 'auto_apply';
    status: 'pending' | 'running' | 'completed' | 'failed';
    scheduled_at: string;
    started_at?: string;
    completed_at?: string;
    error?: string;
    metadata?: any;
}
export declare class TuningSchedulerService {
    private db;
    private redis;
    private tuningService;
    private shadowTestingService;
    private reportService;
    private config;
    private isRunning;
    private scheduledTasks;
    private activeJobs;
    constructor(db: Pool, redis: Redis, tuningService: AlertTuningService, shadowTestingService: ShadowTestingService, reportService: ReportGenerationService, config?: Partial<SchedulerConfig>);
    start(): Promise<void>;
    stop(): Promise<void>;
    scheduleBacktest(chains?: string[], lookbackHours?: number, gridSearch?: GridSearchParams, scheduledAt?: Date): Promise<string>;
    private executeBacktestJob;
    private checkAutoApplyCandidates;
    private scheduleAutoApply;
    private executeAutoApplyJob;
    private scheduleRecurringTasks;
    private generateScheduledReport;
    private cleanupShadowTests;
    private sendNotification;
    private formatNotificationMessage;
    private initializeDatabase;
    private saveJob;
    private updateJob;
    private loadActiveJobs;
    private getRecentBacktestResults;
    private sendSlackNotification;
    private sendDiscordNotification;
    private sendEmailNotification;
    getStatus(): any;
    getJobStatus(jobId: string): Promise<ScheduledJob | null>;
}
//# sourceMappingURL=TuningSchedulerService.d.ts.map