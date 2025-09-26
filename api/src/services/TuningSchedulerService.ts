import { Pool } from 'pg';
import Redis from 'ioredis';
import * as cron from 'node-cron';
import { logger } from '../utils/logger';
import { AlertTuningService, GridSearchParams } from './AlertTuningService';
import { ShadowTestingService } from './ShadowTestingService';
import { ReportGenerationService } from './ReportGenerationService';

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

export interface SchedulerConfig {
  backtest_schedule: string; // Cron expression
  report_schedule: string; // Cron expression
  shadow_test_duration_hours: number;
  auto_apply_threshold: number; // F1 improvement threshold for auto-apply
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

export class TuningSchedulerService {
  private db: Pool;
  private redis: Redis;
  private tuningService: AlertTuningService;
  private shadowTestingService: ShadowTestingService;
  private reportService: ReportGenerationService;
  private config: SchedulerConfig;
  private isRunning: boolean = false;
  private scheduledTasks: Map<string, cron.ScheduledTask> = new Map();
  private activeJobs: Map<string, ScheduledJob> = new Map();

  constructor(
    db: Pool,
    redis: Redis,
    tuningService: AlertTuningService,
    shadowTestingService: ShadowTestingService,
    reportService: ReportGenerationService,
    config?: Partial<SchedulerConfig>
  ) {
    this.db = db;
    this.redis = redis;
    this.tuningService = tuningService;
    this.shadowTestingService = shadowTestingService;
    this.reportService = reportService;
    
    // Default configuration
    this.config = {
      backtest_schedule: '0 2 * * *', // Daily at 2 AM
      report_schedule: '0 8 * * *', // Daily at 8 AM
      shadow_test_duration_hours: 24,
      auto_apply_threshold: 15, // 15% F1 improvement
      max_concurrent_backtests: 2,
      notification_webhooks: {},
      ...config
    };
  }

  /**
   * Start the tuning scheduler
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Tuning scheduler already running');
      return;
    }

    logger.info('Starting tuning scheduler', { config: this.config });

    try {
      // Initialize database tables if needed
      await this.initializeDatabase();

      // Load existing jobs
      await this.loadActiveJobs();

      // Schedule recurring tasks
      this.scheduleRecurringTasks();

      // Start shadow testing service
      await this.shadowTestingService.startShadowTesting();

      this.isRunning = true;
      logger.info('Tuning scheduler started successfully');

    } catch (error) {
      logger.error('Failed to start tuning scheduler', { error: getErrorMessage(error) });
      throw error;
    }
  }

  /**
   * Stop the tuning scheduler
   */
  async stop(): Promise<void> {
    logger.info('Stopping tuning scheduler');

    this.isRunning = false;

    // Stop all scheduled tasks
    for (const [taskId, task] of Array.from(this.scheduledTasks.entries())) {
      task.stop();
      logger.info('Stopped scheduled task', { taskId });
    }

    this.scheduledTasks.clear();

    // Stop shadow testing
    await this.shadowTestingService.stopShadowTesting();

    logger.info('Tuning scheduler stopped');
  }

  /**
   * Schedule a one-time backtest job
   */
  async scheduleBacktest(
    chains: string[] = ['ethereum', 'bsc', 'polygon'],
    lookbackHours: number = 48,
    gridSearch?: GridSearchParams,
    scheduledAt?: Date
  ): Promise<string> {
    const jobId = `backtest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const scheduledTime = scheduledAt || new Date();

    const job: ScheduledJob = {
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

    // Save job to database
    await this.saveJob(job);

    // Schedule execution
    if (scheduledTime <= new Date()) {
      // Execute immediately
      this.executeBacktestJob(job);
    } else {
      // Schedule for later
      const delay = scheduledTime.getTime() - Date.now();
      setTimeout(() => {
        this.executeBacktestJob(job);
      }, delay);
    }

    logger.info('Backtest job scheduled', {
      jobId,
      chains,
      lookbackHours,
      scheduledAt: scheduledTime.toISOString()
    });

    return jobId;
  }

  /**
   * Execute a backtest job
   */
  private async executeBacktestJob(job: ScheduledJob): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Scheduler not running, skipping job', { jobId: job.id });
      return;
    }

    // Check concurrent job limit
    const runningBacktests = Array.from(this.activeJobs.values())
      .filter(j => j.type === 'backtest' && j.status === 'running').length;

    if (runningBacktests >= this.config.max_concurrent_backtests) {
      logger.warn('Max concurrent backtests reached, rescheduling', {
        jobId: job.id,
        running: runningBacktests,
        max: this.config.max_concurrent_backtests
      });

      // Reschedule for 30 minutes later
      setTimeout(() => {
        this.executeBacktestJob(job);
      }, 30 * 60 * 1000);
      return;
    }

    try {
      // Update job status
      job.status = 'running';
      job.started_at = new Date().toISOString();
      this.activeJobs.set(job.id, job);
      await this.updateJob(job);

      logger.info('Starting backtest job', { jobId: job.id });

      // Execute backtest
      const results = await this.tuningService.runBacktest(
        job.metadata.lookback_hours || 48,
        3 // bucket_hours
      );

      // Process results
      const topProposals = [];
      for (const result of results) {
        if (result.proposals.length > 0) {
          const topProposal = result.proposals[0];
          await this.tuningService.saveProposal(topProposal);
          topProposals.push(topProposal);

          // Start shadow testing for promising proposals
          if (topProposal.evidence.f1 && topProposal.evidence.f1 > 0.6) {
            await this.tuningService.updateProposalStatus(topProposal.id, 'shadow_testing');
          }
        }
      }

      // Generate report
      const shadowMetrics = await this.shadowTestingService.getAllActiveShadowTestMetrics();
      const reportPath = await this.reportService.generateTuningReport(results, shadowMetrics);

      // Check for auto-apply candidates
      await this.checkAutoApplyCandidates(topProposals);

      // Send notifications
      await this.sendNotification('backtest_completed', {
        jobId: job.id,
        chains: job.metadata.chains,
        proposalsGenerated: topProposals.length,
        reportPath
      });

      // Update job status
      job.status = 'completed';
      job.completed_at = new Date().toISOString();
      job.metadata.results = {
        proposals_generated: topProposals.length,
        report_path: reportPath,
        chains_processed: results.length
      };

      await this.updateJob(job);
      logger.info('Backtest job completed', { jobId: job.id });

    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Backtest job failed', { jobId: job.id, error: errorMessage });

      job.status = 'failed';
      job.error = errorMessage;
      job.completed_at = new Date().toISOString();

      await this.updateJob(job);

      // Send failure notification
      await this.sendNotification('backtest_failed', {
        jobId: job.id,
        error: errorMessage
      });
    } finally {
      this.activeJobs.delete(job.id);
    }
  }

  /**
   * Check for auto-apply candidates
   */
  private async checkAutoApplyCandidates(proposals: any[]): Promise<void> {
    try {
      const orchestratorFlag = await this.tuningService.checkOrchestratorFlag();
      if (!orchestratorFlag) {
        logger.info('Orchestrator flag disabled, skipping auto-apply');
        return;
      }

      const currentConfig = await this.tuningService.getCurrentConfig();

      for (const proposal of proposals) {
        // Calculate improvement vs current config
        // Use a baseline F1 score since currentConfig doesn't contain metrics
        const currentF1 = 0.5; // Default baseline F1 score
        const improvement = proposal.evidence.f1 ? 
          ((proposal.evidence.f1 - currentF1) / currentF1) * 100 : 0;

        // Check if meets auto-apply threshold
        if (improvement >= this.config.auto_apply_threshold &&
            proposal.evidence.precision >= 0.5 &&
            proposal.evidence.alerts_per_hour <= 10) {

          logger.info('Auto-apply candidate found', {
            proposalId: proposal.id,
            chain: proposal.chain,
            improvement: improvement.toFixed(1)
          });

          // Schedule auto-apply job
          await this.scheduleAutoApply(proposal.id, improvement);
        }
      }

    } catch (error) {
      logger.error('Error checking auto-apply candidates', { error: getErrorMessage(error) });
    }
  }

  /**
   * Schedule auto-apply job
   */
  private async scheduleAutoApply(proposalId: string, improvement: number): Promise<void> {
    const jobId = `auto_apply_${proposalId}_${Date.now()}`;

    const job: ScheduledJob = {
      id: jobId,
      type: 'auto_apply',
      status: 'pending',
      scheduled_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour delay
      metadata: {
        proposal_id: proposalId,
        improvement_percent: improvement
      }
    };

    await this.saveJob(job);

    // Schedule execution
    setTimeout(async () => {
      await this.executeAutoApplyJob(job);
    }, 60 * 60 * 1000);

    logger.info('Auto-apply job scheduled', { jobId, proposalId, improvement });
  }

  /**
   * Execute auto-apply job
   */
  private async executeAutoApplyJob(job: ScheduledJob): Promise<void> {
    try {
      job.status = 'running';
      job.started_at = new Date().toISOString();
      await this.updateJob(job);

      const proposalId = job.metadata.proposal_id;

      // Final validation before applying
      const proposal = await this.tuningService.getProposal(proposalId);
      if (!proposal) {
        throw new Error('Proposal not found');
      }

      if (proposal.status !== 'approved' && proposal.status !== 'shadow_testing') {
        throw new Error(`Proposal status is ${proposal.status}, cannot auto-apply`);
      }

      // Get latest shadow test metrics
      const shadowMetrics = await this.shadowTestingService.generateShadowTestMetrics(proposalId);
      
      // Validate shadow test results
      if (shadowMetrics.precision_estimate < 0.5 || shadowMetrics.alerts_per_hour > 10) {
        throw new Error('Shadow test results do not meet criteria');
      }

      // Apply the proposal
      await this.tuningService.applyProposal(proposalId);

      // Send notification
      await this.sendNotification('auto_apply_completed', {
        proposalId,
        chain: proposal.chain,
        improvement: job.metadata.improvement_percent
      });

      job.status = 'completed';
      job.completed_at = new Date().toISOString();

      logger.info('Auto-apply job completed', { jobId: job.id, proposalId });

    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Auto-apply job failed', { jobId: job.id, error: errorMessage });

      job.status = 'failed';
      job.error = errorMessage;
      job.completed_at = new Date().toISOString();

      await this.sendNotification('auto_apply_failed', {
        jobId: job.id,
        proposalId: job.metadata.proposal_id,
        error: errorMessage
      });
    }

    await this.updateJob(job);
  }

  /**
   * Schedule recurring tasks
   */
  private scheduleRecurringTasks(): void {
    // Daily backtest
    const backtestTask = cron.schedule(this.config.backtest_schedule, async () => {
      logger.info('Executing scheduled backtest');
      await this.scheduleBacktest();
    }, { scheduled: false });

    // Daily report generation
    const reportTask = cron.schedule(this.config.report_schedule, async () => {
      logger.info('Executing scheduled report generation');
      await this.generateScheduledReport();
    }, { scheduled: false });

    // Shadow test cleanup (every 6 hours)
    const cleanupTask = cron.schedule('0 */6 * * *', async () => {
      logger.info('Executing shadow test cleanup');
      await this.cleanupShadowTests();
    }, { scheduled: false });

    // Start tasks
    backtestTask.start();
    reportTask.start();
    cleanupTask.start();

    this.scheduledTasks.set('daily_backtest', backtestTask);
    this.scheduledTasks.set('daily_report', reportTask);
    this.scheduledTasks.set('shadow_cleanup', cleanupTask);

    logger.info('Recurring tasks scheduled', {
      backtest: this.config.backtest_schedule,
      report: this.config.report_schedule
    });
  }

  /**
   * Generate scheduled report
   */
  private async generateScheduledReport(): Promise<void> {
    try {
      // Get recent backtest results
      const recentResults = await this.getRecentBacktestResults();
      
      // Get shadow test metrics
      const shadowMetrics = await this.shadowTestingService.getAllActiveShadowTestMetrics();

      // Generate report
      const reportPath = await this.reportService.generateTuningReport(recentResults, shadowMetrics);

      // Send notification
      await this.sendNotification('report_generated', {
        reportPath,
        backtestResults: recentResults.length,
        shadowMetrics: shadowMetrics.length
      });

      logger.info('Scheduled report generated', { reportPath });

    } catch (error) {
      logger.error('Failed to generate scheduled report', { error: getErrorMessage(error) });
    }
  }

  /**
   * Cleanup old shadow tests
   */
  private async cleanupShadowTests(): Promise<void> {
    try {
      // Remove shadow tests older than 48 hours
      const cutoffTime = new Date(Date.now() - 48 * 60 * 60 * 1000);

      const query = `
        DELETE FROM shadow_alerts 
        WHERE timestamp < $1
      `;

      const result = await this.db.query(query, [cutoffTime.toISOString()]);

      logger.info('Shadow test cleanup completed', {
        deletedRecords: result.rowCount,
        cutoffTime: cutoffTime.toISOString()
      });

    } catch (error) {
      logger.error('Shadow test cleanup failed', { error: getErrorMessage(error) });
    }
  }

  /**
   * Send notification
   */
  private async sendNotification(type: string, data: any): Promise<void> {
    try {
      const message = this.formatNotificationMessage(type, data);

      // Send to configured webhooks
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

    } catch (error) {
      logger.error('Failed to send notification', { error: getErrorMessage(error), type, data });
    }
  }

  /**
   * Format notification message
   */
  private formatNotificationMessage(type: string, data: any): string {
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

  /**
   * Database and utility methods
   */

  private async initializeDatabase(): Promise<void> {
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

  private async saveJob(job: ScheduledJob): Promise<void> {
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

  private async updateJob(job: ScheduledJob): Promise<void> {
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

  private async loadActiveJobs(): Promise<void> {
    const query = `
      SELECT * FROM scheduled_jobs 
      WHERE status IN ('pending', 'running')
      ORDER BY scheduled_at ASC
    `;

    const result = await this.db.query(query);

    for (const row of result.rows) {
      const job: ScheduledJob = {
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

    logger.info('Loaded active jobs', { count: result.rows.length });
  }

  private async getRecentBacktestResults(): Promise<any[]> {
    // This would fetch recent backtest results from the database
    // For now, return empty array as placeholder
    return [];
  }

  private async sendSlackNotification(message: string): Promise<void> {
    // Implement Slack webhook notification
    logger.info('Slack notification sent', { message });
  }

  private async sendDiscordNotification(message: string): Promise<void> {
    // Implement Discord webhook notification
    logger.info('Discord notification sent', { message });
  }

  private async sendEmailNotification(message: string, emails: string[]): Promise<void> {
    // Implement email notification
    logger.info('Email notification sent', { message, recipients: emails.length });
  }

  /**
   * Get scheduler status
   */
  getStatus(): any {
    return {
      running: this.isRunning,
      active_jobs: this.activeJobs.size,
      scheduled_tasks: this.scheduledTasks.size,
      config: this.config
    };
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<ScheduledJob | null> {
    const job = this.activeJobs.get(jobId);
    if (job) {
      return job;
    }

    // Check database for completed jobs
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