import { Pool } from 'pg';
import Redis from 'ioredis';
export declare class TuningController {
    private db;
    private redis;
    private tuningService;
    private shadowTestingService;
    private reportService;
    private schedulerService;
    constructor(db: Pool, redis: Redis);
    execute48HourBacktest(): Promise<{
        success: boolean;
        proposals: any[];
        report_path: string;
        shadow_testing_status: string;
        summary: any;
    }>;
    getBacktestStatus(): Promise<any>;
    initialize(): Promise<void>;
    shutdown(): Promise<void>;
    getTuningMetrics(): Promise<any>;
    forceApplyProposal(proposalId: string, reason: string): Promise<any>;
}
//# sourceMappingURL=TuningController.d.ts.map