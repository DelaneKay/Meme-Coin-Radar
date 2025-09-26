#!/usr/bin/env node

/**
 * Meme Coin Radar - Job Scheduler
 * 
 * This module implements a robust job scheduler for managing
 * all scheduled tasks in the Meme Coin Radar system.
 */

const cron = require('node-cron');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const EventEmitter = require('events');

class JobScheduler extends EventEmitter {
  constructor(configPath) {
    super();
    this.configPath = configPath;
    this.config = null;
    this.jobs = new Map();
    this.runningJobs = new Map();
    this.jobStats = new Map();
    this.environment = process.env.NODE_ENV || 'development';
    
    this.loadConfig();
    this.setupSignalHandlers();
  }

  /**
   * Load configuration from YAML file
   */
  loadConfig() {
    try {
      const configFile = fs.readFileSync(this.configPath, 'utf8');
      this.config = yaml.load(configFile);
      
      // Apply environment-specific settings
      const envConfig = this.config.environments[this.environment];
      if (envConfig) {
        this.config.environment = envConfig;
      }
      
      console.log(`[Scheduler] Configuration loaded for environment: ${this.environment}`);
    } catch (error) {
      console.error('[Scheduler] Failed to load configuration:', error.message);
      process.exit(1);
    }
  }

  /**
   * Initialize and start all scheduled jobs
   */
  start() {
    console.log('[Scheduler] Starting job scheduler...');
    
    // Validate configuration
    if (!this.validateConfig()) {
      console.error('[Scheduler] Configuration validation failed');
      process.exit(1);
    }
    
    // Schedule all jobs
    for (const [jobId, jobConfig] of Object.entries(this.config.jobs)) {
      if (jobConfig.enabled) {
        this.scheduleJob(jobId, jobConfig);
      } else {
        console.log(`[Scheduler] Job ${jobId} is disabled, skipping`);
      }
    }
    
    console.log(`[Scheduler] Scheduled ${this.jobs.size} jobs`);
    this.emit('started');
  }

  /**
   * Schedule a single job
   */
  scheduleJob(jobId, jobConfig) {
    try {
      // Validate cron expression
      if (!cron.validate(jobConfig.schedule)) {
        throw new Error(`Invalid cron expression: ${jobConfig.schedule}`);
      }
      
      // Create job stats entry
      this.jobStats.set(jobId, {
        executions: 0,
        failures: 0,
        lastExecution: null,
        lastSuccess: null,
        lastFailure: null,
        averageExecutionTime: 0,
        totalExecutionTime: 0
      });
      
      // Schedule the job
      const task = cron.schedule(jobConfig.schedule, () => {
        this.executeJob(jobId, jobConfig);
      }, {
        scheduled: false,
        timezone: this.config.environment.timezone || 'UTC'
      });
      
      this.jobs.set(jobId, {
        task,
        config: jobConfig,
        id: jobId
      });
      
      // Start the task
      task.start();
      
      console.log(`[Scheduler] Scheduled job: ${jobId} (${jobConfig.schedule})`);
    } catch (error) {
      console.error(`[Scheduler] Failed to schedule job ${jobId}:`, error.message);
    }
  }

  /**
   * Execute a job with proper error handling and monitoring
   */
  async executeJob(jobId, jobConfig) {
    const startTime = Date.now();
    const stats = this.jobStats.get(jobId);
    
    // Check if job is already running
    if (this.runningJobs.has(jobId)) {
      console.warn(`[Scheduler] Job ${jobId} is already running, skipping execution`);
      return;
    }
    
    // Check concurrent job limit
    if (this.runningJobs.size >= this.config.environment.max_concurrent_jobs) {
      console.warn(`[Scheduler] Maximum concurrent jobs reached, skipping ${jobId}`);
      return;
    }
    
    console.log(`[Scheduler] Executing job: ${jobId}`);
    
    try {
      // Mark job as running
      this.runningJobs.set(jobId, {
        startTime,
        pid: null
      });
      
      // Update stats
      stats.executions++;
      stats.lastExecution = new Date();
      
      // Execute the job
      const result = await this.runJobCommand(jobId, jobConfig);
      
      // Job completed successfully
      const executionTime = Date.now() - startTime;
      this.handleJobSuccess(jobId, result, executionTime);
      
    } catch (error) {
      // Job failed
      const executionTime = Date.now() - startTime;
      this.handleJobFailure(jobId, error, executionTime);
    } finally {
      // Remove from running jobs
      this.runningJobs.delete(jobId);
    }
  }

  /**
   * Run the actual job command
   */
  runJobCommand(jobId, jobConfig) {
    return new Promise((resolve, reject) => {
      const timeout = (jobConfig.timeout || this.config.environment.job_timeout) * 1000;
      const env = { ...process.env, ...jobConfig.environment };
      
      // Execute command
      const child = exec(jobConfig.command, {
        env,
        timeout,
        cwd: process.cwd(),
        maxBuffer: 1024 * 1024 * 10 // 10MB buffer
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Command failed: ${error.message}\\nStderr: ${stderr}`));
        } else {
          resolve({ stdout, stderr });
        }
      });
      
      // Store PID for monitoring
      const runningJob = this.runningJobs.get(jobId);
      if (runningJob) {
        runningJob.pid = child.pid;
      }
      
      // Handle timeout
      child.on('timeout', () => {
        reject(new Error(`Job ${jobId} timed out after ${timeout}ms`));
      });
    });
  }

  /**
   * Handle successful job execution
   */
  handleJobSuccess(jobId, result, executionTime) {
    const stats = this.jobStats.get(jobId);
    
    // Update stats
    stats.lastSuccess = new Date();
    stats.totalExecutionTime += executionTime;
    stats.averageExecutionTime = stats.totalExecutionTime / stats.executions;
    
    console.log(`[Scheduler] Job ${jobId} completed successfully in ${executionTime}ms`);
    
    // Emit success event
    this.emit('jobSuccess', {
      jobId,
      executionTime,
      result
    });
    
    // Send notifications if configured
    this.sendNotification('success', jobId, { executionTime, result });
  }

  /**
   * Handle failed job execution
   */
  async handleJobFailure(jobId, error, executionTime) {
    const stats = this.jobStats.get(jobId);
    const jobConfig = this.config.jobs[jobId];
    
    // Update stats
    stats.failures++;
    stats.lastFailure = new Date();
    
    console.error(`[Scheduler] Job ${jobId} failed after ${executionTime}ms:`, error.message);
    
    // Emit failure event
    this.emit('jobFailure', {
      jobId,
      error,
      executionTime
    });
    
    // Retry logic
    const retryAttempts = jobConfig.retry_attempts || this.config.environment.retry_attempts;
    const retryDelay = (jobConfig.retry_delay || this.config.environment.retry_delay) * 1000;
    
    if (stats.failures <= retryAttempts) {
      console.log(`[Scheduler] Retrying job ${jobId} in ${retryDelay}ms (attempt ${stats.failures}/${retryAttempts})`);
      
      setTimeout(() => {
        this.executeJob(jobId, jobConfig);
      }, retryDelay);
    } else {
      console.error(`[Scheduler] Job ${jobId} failed after ${retryAttempts} attempts`);
      
      // Send failure notification
      this.sendNotification('failure', jobId, { error, executionTime, attempts: stats.failures });
    }
  }

  /**
   * Send notifications based on configuration
   */
  sendNotification(type, jobId, data) {
    const notifications = this.config.notifications;
    if (!notifications || !notifications[`on_${type}`]) {
      return;
    }
    
    const notificationConfig = notifications[`on_${type}`];
    const jobConfig = this.config.jobs[jobId];
    
    // Check if notification should be sent for this job
    if (notificationConfig.jobs && !notificationConfig.jobs.includes(jobId)) {
      return;
    }
    
    // Check severity threshold
    if (notificationConfig.severity_threshold) {
      const jobPriority = jobConfig.priority || 'medium';
      const priorities = { low: 1, medium: 2, high: 3, critical: 4 };
      const thresholdLevel = priorities[notificationConfig.severity_threshold] || 2;
      const jobLevel = priorities[jobPriority] || 2;
      
      if (jobLevel < thresholdLevel) {
        return;
      }
    }
    
    // Send notification (implementation would depend on notification channels)
    console.log(`[Scheduler] Sending ${type} notification for job ${jobId}:`, data);
    
    // Emit notification event for external handlers
    this.emit('notification', {
      type,
      jobId,
      data,
      channels: notificationConfig.channels
    });
  }

  /**
   * Get job statistics
   */
  getJobStats(jobId = null) {
    if (jobId) {
      return this.jobStats.get(jobId);
    }
    
    const allStats = {};
    for (const [id, stats] of this.jobStats.entries()) {
      allStats[id] = { ...stats };
    }
    return allStats;
  }

  /**
   * Get running jobs
   */
  getRunningJobs() {
    const running = {};
    for (const [jobId, jobInfo] of this.runningJobs.entries()) {
      running[jobId] = {
        ...jobInfo,
        duration: Date.now() - jobInfo.startTime
      };
    }
    return running;
  }

  /**
   * Stop a specific job
   */
  stopJob(jobId) {
    const job = this.jobs.get(jobId);
    if (job) {
      job.task.stop();
      console.log(`[Scheduler] Stopped job: ${jobId}`);
      return true;
    }
    return false;
  }

  /**
   * Start a specific job
   */
  startJob(jobId) {
    const job = this.jobs.get(jobId);
    if (job) {
      job.task.start();
      console.log(`[Scheduler] Started job: ${jobId}`);
      return true;
    }
    return false;
  }

  /**
   * Stop all jobs and shutdown scheduler
   */
  shutdown() {
    console.log('[Scheduler] Shutting down...');
    
    // Stop all scheduled jobs
    for (const [jobId, job] of this.jobs.entries()) {
      job.task.stop();
    }
    
    // Wait for running jobs to complete or force kill after timeout
    const runningJobIds = Array.from(this.runningJobs.keys());
    if (runningJobIds.length > 0) {
      console.log(`[Scheduler] Waiting for ${runningJobIds.length} running jobs to complete...`);
      
      // Give jobs 30 seconds to complete gracefully
      setTimeout(() => {
        for (const [jobId, jobInfo] of this.runningJobs.entries()) {
          if (jobInfo.pid) {
            try {
              process.kill(jobInfo.pid, 'SIGTERM');
              console.log(`[Scheduler] Terminated job ${jobId} (PID: ${jobInfo.pid})`);
            } catch (error) {
              console.error(`[Scheduler] Failed to terminate job ${jobId}:`, error.message);
            }
          }
        }
        
        this.emit('shutdown');
        process.exit(0);
      }, 30000);
    } else {
      this.emit('shutdown');
      process.exit(0);
    }
  }

  /**
   * Validate configuration
   */
  validateConfig() {
    if (!this.config.jobs || Object.keys(this.config.jobs).length === 0) {
      console.error('[Scheduler] No jobs defined in configuration');
      return false;
    }
    
    for (const [jobId, jobConfig] of Object.entries(this.config.jobs)) {
      if (!jobConfig.schedule || !jobConfig.command) {
        console.error(`[Scheduler] Job ${jobId} missing required fields (schedule, command)`);
        return false;
      }
      
      if (!cron.validate(jobConfig.schedule)) {
        console.error(`[Scheduler] Job ${jobId} has invalid cron expression: ${jobConfig.schedule}`);
        return false;
      }
    }
    
    return true;
  }

  /**
   * Setup signal handlers for graceful shutdown
   */
  setupSignalHandlers() {
    process.on('SIGINT', () => {
      console.log('[Scheduler] Received SIGINT, shutting down gracefully...');
      this.shutdown();
    });
    
    process.on('SIGTERM', () => {
      console.log('[Scheduler] Received SIGTERM, shutting down gracefully...');
      this.shutdown();
    });
    
    process.on('uncaughtException', (error) => {
      console.error('[Scheduler] Uncaught exception:', error);
      this.shutdown();
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      console.error('[Scheduler] Unhandled rejection at:', promise, 'reason:', reason);
      this.shutdown();
    });
  }
}

// CLI interface
if (require.main === module) {
  const configPath = process.argv[2] || path.join(__dirname, 'cron-config.yml');
  
  console.log('[Scheduler] Meme Coin Radar Job Scheduler starting...');
  console.log(`[Scheduler] Using configuration: ${configPath}`);
  console.log(`[Scheduler] Environment: ${process.env.NODE_ENV || 'development'}`);
  
  const scheduler = new JobScheduler(configPath);
  
  // Setup event listeners
  scheduler.on('started', () => {
    console.log('[Scheduler] All jobs scheduled successfully');
  });
  
  scheduler.on('jobSuccess', (event) => {
    console.log(`[Scheduler] ✓ Job ${event.jobId} completed in ${event.executionTime}ms`);
  });
  
  scheduler.on('jobFailure', (event) => {
    console.error(`[Scheduler] ✗ Job ${event.jobId} failed: ${event.error.message}`);
  });
  
  scheduler.on('notification', (event) => {
    console.log(`[Scheduler] 📢 Notification: ${event.type} for job ${event.jobId}`);
  });
  
  scheduler.on('shutdown', () => {
    console.log('[Scheduler] Shutdown complete');
  });
  
  // Start the scheduler
  scheduler.start();
  
  // Health check endpoint (if running as a service)
  if (process.env.ENABLE_HEALTH_ENDPOINT === 'true') {
    const express = require('express');
    const app = express();
    const port = process.env.HEALTH_PORT || 3001;
    
    app.get('/health', (req, res) => {
      const stats = scheduler.getJobStats();
      const running = scheduler.getRunningJobs();
      
      res.json({
        status: 'healthy',
        uptime: process.uptime(),
        jobs: {
          total: scheduler.jobs.size,
          running: Object.keys(running).length,
          stats
        },
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
      });
    });
    
    app.listen(port, () => {
      console.log(`[Scheduler] Health endpoint available at http://localhost:${port}/health`);
    });
  }
}

module.exports = JobScheduler;