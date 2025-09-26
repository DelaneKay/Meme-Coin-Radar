"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TuningSchedulerService = void 0;
const cron = __importStar(require("node-cron"));
const logger_1 = require("../utils/logger");
class TuningSchedulerService {
    constructor(db, redis, tuningService, shadowTestingService, reportService, config) {
        this.isRunning = false;
        this.scheduledTasks = new Map();
        this.activeJobs = new Map();
        this.db = db;
        this.redis = redis;
        this.tuningService = tuningService;
        this.shadowTestingService = shadowTestingService;
        this.reportService = reportService;
        this.config = {
            backtest_schedule: '0 2 * * *',
            report_schedule: '0 8 * * *',
            shadow_test_duration_hours: 24,
            auto_apply_threshold: 15,
            max_concurrent_backtests: 2,
            notification_webhooks: {},
            ...config
        };
    }
    async start() {
        if (this.isRunning) {
            logger_1.logger.warn('Tuning scheduler already running');
            return;
        }
        logger_1.logger.info('Starting tuning scheduler', { config: this.config });
        try {
            await this.initializeDatabase();
            await this.loadActiveJobs();
            this.scheduleRecurringTasks();
            await this.shadowTestingService.startShadowTesting();
            this.isRunning = true;
            logger_1.logger.info('Tuning scheduler started successfully');
        }
        catch (error) {
            logger_1.logger.error('Failed to start tuning scheduler', { error: error.message });
            throw error;
        }
    }
    async stop() {
        logger_1.logger.info('Stopping tuning scheduler');
        this.isRunning = false;
        for (const [taskId, task] of this.scheduledTasks.entries()) {
            task.stop();
            logger_1.logger.info('Stopped scheduled task', { taskId });
        }
        this.scheduledTasks.clear();
        await this.shadowTestingService.stopShadowTesting();
        logger_1.logger.info('Tuning scheduler stopped');
    }
    async scheduleBacktest(chains = ['ethereum', 'bsc', 'polygon'], lookbackHours = 48, gridSearch, scheduledAt) {
        const jobId = `backtest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const scheduledTime = scheduledAt || new Date();
        const job = {
            id: jobId,
            type: 'backtest',
            status: 'pending',
            scheduled_at: scheduledTime.toISOString(),
            metadata: {
                chains,
                lookback_hours: lookbackHours,
                grid_search: gridSearch
            }
        };
        await this.saveJob(job);
        if (scheduledTime <= new Date()) {
            this.executeBacktestJob(job);
        }
        else {
            const delay = scheduledTime.getTime() - Date.now();
            setTimeout(() => {
                this.executeBacktestJob(job);
            }, delay);
        }
        logger_1.logger.info('Backtest job scheduled', {
            jobId,
            chains,
            lookbackHours,
            scheduledAt: scheduledTime.toISOString()
        });
        return jobId;
    }
    async executeBacktestJob(job) {
        if (!this.isRunning) {
            logger_1.logger.warn('Scheduler not running, skipping job', { jobId: job.id });
            return;
        }
        const runningBacktests = Array.from(this.activeJobs.values())
            .filter(j => j.type === 'backtest' && j.status === 'running').length;
        if (runningBacktests >= this.config.max_concurrent_backtests) {
            logger_1.logger.warn('Max concurrent backtests reached, rescheduling', {
                jobId: job.id,
                running: runningBacktests,
                max: this.config.max_concurrent_backtests
            });
            setTimeout(() => {
                this.executeBacktestJob(job);
            }, 30 * 60 * 1000);
            return;
        }
        try {
            job.status = 'running';
            job.started_at = new Date().toISOString();
            this.activeJobs.set(job.id, job);
            await this.updateJob(job);
            logger_1.logger.info('Starting backtest job', { jobId: job.id });
            const results = await this.tuningService.runBacktest({
                lookback_hours: job.metadata.lookback_hours,
                chains: job.metadata.chains,
                bucket_hours: 3,
                grid_search: job.metadata.grid_search
            });
            const topProposals = [];
            for (const result of results) {
                if (result.proposals.length > 0) {
                    const topProposal = result.proposals[0];
                    await this.tuningService.saveProposal(topProposal);
                    topProposals.push(topProposal);
                    if (topProposal.evidence.f1 && topProposal.evidence.f1 > 0.6) {
                        await this.tuningService.updateProposalStatus(topProposal.id, 'shadow_testing');
                    }
                }
            }
            const shadowMetrics = await this.shadowTestingService.getAllActiveShadowTestMetrics();
            const reportPath = await this.reportService.generateTuningReport(results, shadowMetrics);
            await this.checkAutoApplyCandidates(topProposals);
            await this.sendNotification('backtest_completed', {
                jobId: job.id,
                chains: job.metadata.chains,
                proposalsGenerated: topProposals.length,
                reportPath
            });
            job.status = 'completed';
            job.completed_at = new Date().toISOString();
            job.metadata.results = {
                proposals_generated: topProposals.length,
                report_path: reportPath,
                chains_processed: results.length
            };
            await this.updateJob(job);
            logger_1.logger.info('Backtest job completed', { jobId: job.id });
        }
        catch (error) {
            logger_1.logger.error('Backtest job failed', { jobId: job.id, error: error.message });
            job.status = 'failed';
            job.error = error.message;
            job.completed_at = new Date().toISOString();
            await this.updateJob(job);
            await this.sendNotification('backtest_failed', {
                jobId: job.id,
                error: error.message
            });
        }
        finally {
            this.activeJobs.delete(job.id);
        }
    }
    async checkAutoApplyCandidates(proposals) {
        try {
            const orchestratorFlag = await this.tuningService.checkOrchestratorFlag();
            if (!orchestratorFlag) {
                logger_1.logger.info('Orchestrator flag disabled, skipping auto-apply');
                return;
            }
            const currentConfig = await this.tuningService.getCurrentConfig();
            for (const proposal of proposals) {
                const currentF1 = currentConfig[proposal.chain]?.f1 || 0.5;
                const improvement = proposal.evidence.f1 ?
                    ((proposal.evidence.f1 - currentF1) / currentF1) * 100 : 0;
                if (improvement >= this.config.auto_apply_threshold &&
                    proposal.evidence.precision >= 0.5 &&
                    proposal.evidence.alerts_per_hour <= 10) {
                    logger_1.logger.info('Auto-apply candidate found', {
                        proposalId: proposal.id,
                        chain: proposal.chain,
                        improvement: improvement.toFixed(1)
                    });
                    await this.scheduleAutoApply(proposal.id, improvement);
                }
            }
        }
        catch (error) {
            logger_1.logger.error('Error checking auto-apply candidates', { error: error.message });
        }
    }
    async scheduleAutoApply(proposalId, improvement) {
        const jobId = `auto_apply_${proposalId}_${Date.now()}`;
        const job = {
            id: jobId,
            type: 'auto_apply',
            status: 'pending',
            scheduled_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            metadata: {
                proposal_id: proposalId,
                improvement_percent: improvement
            }
        };
        await this.saveJob(job);
        setTimeout(async () => {
            await this.executeAutoApplyJob(job);
        }, 60 * 60 * 1000);
        logger_1.logger.info('Auto-apply job scheduled', { jobId, proposalId, improvement });
    }
    async executeAutoApplyJob(job) {
        try {
            job.status = 'running';
            job.started_at = new Date().toISOString();
            await this.updateJob(job);
            const proposalId = job.metadata.proposal_id;
            const proposal = await this.tuningService.getProposal(proposalId);
            if (!proposal) {
                throw new Error('Proposal not found');
            }
            if (proposal.status !== 'approved' && proposal.status !== 'shadow_testing') {
                throw new Error(`Proposal status is ${proposal.status}, cannot auto-apply`);
            }
            const shadowMetrics = await this.shadowTestingService.generateShadowTestMetrics(proposalId);
            if (shadowMetrics.precision_estimate < 0.5 || shadowMetrics.alerts_per_hour > 10) {
                throw new Error('Shadow test results do not meet criteria');
            }
            await this.tuningService.applyProposal(proposalId);
            await this.sendNotification('auto_apply_completed', {
                proposalId,
                chain: proposal.chain,
                improvement: job.metadata.improvement_percent
            });
            job.status = 'completed';
            job.completed_at = new Date().toISOString();
            logger_1.logger.info('Auto-apply job completed', { jobId: job.id, proposalId });
        }
        catch (error) {
            logger_1.logger.error('Auto-apply job failed', { jobId: job.id, error: error.message });
            job.status = 'failed';
            job.error = error.message;
            job.completed_at = new Date().toISOString();
            await this.sendNotification('auto_apply_failed', {
                jobId: job.id,
                proposalId: job.metadata.proposal_id,
                error: error.message
            });
        }
        await this.updateJob(job);
    }
    scheduleRecurringTasks() {
        const backtestTask = cron.schedule(this.config.backtest_schedule, async () => {
            logger_1.logger.info('Executing scheduled backtest');
            await this.scheduleBacktest();
        }, { scheduled: false });
        const reportTask = cron.schedule(this.config.report_schedule, async () => {
            logger_1.logger.info('Executing scheduled report generation');
            await this.generateScheduledReport();
        }, { scheduled: false });
        const cleanupTask = cron.schedule('0 */6 * * *', async () => {
            logger_1.logger.info('Executing shadow test cleanup');
            await this.cleanupShadowTests();
        }, { scheduled: false });
        backtestTask.start();
        reportTask.start();
        cleanupTask.start();
        this.scheduledTasks.set('daily_backtest', backtestTask);
        this.scheduledTasks.set('daily_report', reportTask);
        this.scheduledTasks.set('shadow_cleanup', cleanupTask);
        logger_1.logger.info('Recurring tasks scheduled', {
            backtest: this.config.backtest_schedule,
            report: this.config.report_schedule
        });
    }
    async generateScheduledReport() {
        try {
            const recentResults = await this.getRecentBacktestResults();
            const shadowMetrics = await this.shadowTestingService.getAllActiveShadowTestMetrics();
            const reportPath = await this.reportService.generateTuningReport(recentResults, shadowMetrics);
            await this.sendNotification('report_generated', {
                reportPath,
                backtestResults: recentResults.length,
                shadowMetrics: shadowMetrics.length
            });
            logger_1.logger.info('Scheduled report generated', { reportPath });
        }
        catch (error) {
            logger_1.logger.error('Failed to generate scheduled report', { error: error.message });
        }
    }
    async cleanupShadowTests() {
        try {
            const cutoffTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
            const query = `
        DELETE FROM shadow_alerts 
        WHERE timestamp < $1
      `;
            const result = await this.db.query(query, [cutoffTime.toISOString()]);
            logger_1.logger.info('Shadow test cleanup completed', {
                deletedRecords: result.rowCount,
                cutoffTime: cutoffTime.toISOString()
            });
        }
        catch (error) {
            logger_1.logger.error('Shadow test cleanup failed', { error: error.message });
        }
    }
    async sendNotification(type, data) {
        try {
            const message = this.formatNotificationMessage(type, data);
            const promises = [];
            if (this.config.notification_webhooks.slack) {
                promises.push(this.sendSlackNotification(message));
            }
            if (this.config.notification_webhooks.discord) {
                promises.push(this.sendDiscordNotification(message));
            }
            if (this.config.notification_webhooks.email?.length) {
                promises.push(this.sendEmailNotification(message, this.config.notification_webhooks.email));
            }
            await Promise.allSettled(promises);
        }
        catch (error) {
            logger_1.logger.error('Failed to send notification', { error: error.message, type, data });
        }
    }
    formatNotificationMessage(type, data) {
        switch (type) {
            case 'backtest_completed':
                return `🎯 **Backtest Completed**\n` +
                    `Job ID: ${data.jobId}\n` +
                    `Chains: ${data.chains.join(', ')}\n` +
                    `Proposals Generated: ${data.proposalsGenerated}\n` +
                    `Report: ${data.reportPath}`;
            case 'backtest_failed':
                return `❌ **Backtest Failed**\n` +
                    `Job ID: ${data.jobId}\n` +
                    `Error: ${data.error}`;
            case 'auto_apply_completed':
                return `✅ **Auto-Apply Completed**\n` +
                    `Proposal: ${data.proposalId}\n` +
                    `Chain: ${data.chain}\n` +
                    `Improvement: +${data.improvement.toFixed(1)}%`;
            case 'auto_apply_failed':
                return `⚠️ **Auto-Apply Failed**\n` +
                    `Proposal: ${data.proposalId}\n` +
                    `Error: ${data.error}`;
            case 'report_generated':
                return `📊 **Daily Report Generated**\n` +
                    `Report: ${data.reportPath}\n` +
                    `Backtest Results: ${data.backtestResults}\n` +
                    `Shadow Metrics: ${data.shadowMetrics}`;
            default:
                return `📢 **Tuning System Notification**\n${JSON.stringify(data, null, 2)}`;
        }
    }
    async initializeDatabase() {
        const createJobsTable = `
      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id VARCHAR(255) PRIMARY KEY,
        type VARCHAR(50) NOT NULL,
        status VARCHAR(20) NOT NULL,
        scheduled_at TIMESTAMP NOT NULL,
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        error TEXT,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;
        await this.db.query(createJobsTable);
    }
    async saveJob(job) {
        const query = `
      INSERT INTO scheduled_jobs (
        id, type, status, scheduled_at, started_at, completed_at, error, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;
        await this.db.query(query, [
            job.id,
            job.type,
            job.status,
            job.scheduled_at,
            job.started_at || null,
            job.completed_at || null,
            job.error || null,
            JSON.stringify(job.metadata || {})
        ]);
    }
    async updateJob(job) {
        const query = `
      UPDATE scheduled_jobs 
      SET status = $2, started_at = $3, completed_at = $4, error = $5, 
          metadata = $6, updated_at = NOW()
      WHERE id = $1
    `;
        await this.db.query(query, [
            job.id,
            job.status,
            job.started_at || null,
            job.completed_at || null,
            job.error || null,
            JSON.stringify(job.metadata || {})
        ]);
    }
    async loadActiveJobs() {
        const query = `
      SELECT * FROM scheduled_jobs 
      WHERE status IN ('pending', 'running')
      ORDER BY scheduled_at ASC
    `;
        const result = await this.db.query(query);
        for (const row of result.rows) {
            const job = {
                id: row.id,
                type: row.type,
                status: row.status,
                scheduled_at: row.scheduled_at,
                started_at: row.started_at,
                completed_at: row.completed_at,
                error: row.error,
                metadata: row.metadata
            };
            this.activeJobs.set(job.id, job);
        }
        logger_1.logger.info('Loaded active jobs', { count: result.rows.length });
    }
    async getRecentBacktestResults() {
        return [];
    }
    async sendSlackNotification(message) {
        logger_1.logger.info('Slack notification sent', { message });
    }
    async sendDiscordNotification(message) {
        logger_1.logger.info('Discord notification sent', { message });
    }
    async sendEmailNotification(message, emails) {
        logger_1.logger.info('Email notification sent', { message, recipients: emails.length });
    }
    getStatus() {
        return {
            running: this.isRunning,
            active_jobs: this.activeJobs.size,
            scheduled_tasks: this.scheduledTasks.size,
            config: this.config
        };
    }
    async getJobStatus(jobId) {
        const job = this.activeJobs.get(jobId);
        if (job) {
            return job;
        }
        const query = `SELECT * FROM scheduled_jobs WHERE id = $1`;
        const result = await this.db.query(query, [jobId]);
        if (result.rows.length > 0) {
            const row = result.rows[0];
            return {
                id: row.id,
                type: row.type,
                status: row.status,
                scheduled_at: row.scheduled_at,
                started_at: row.started_at,
                completed_at: row.completed_at,
                error: row.error,
                metadata: row.metadata
            };
        }
        return null;
    }
}
exports.TuningSchedulerService = TuningSchedulerService;
//# sourceMappingURL=TuningSchedulerService.js.map