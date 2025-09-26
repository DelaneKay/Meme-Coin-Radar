/**
 * Cloudflare Worker for Meme Coin Radar Scheduler
 * Handles cron triggers and job execution
 */

import { SchedulerState } from './durable-objects/scheduler-state.js';
import { JobQueue } from './durable-objects/job-queue.js';

// Export Durable Object classes
export { SchedulerState, JobQueue };

// Job definitions
const JOBS = {
  'radar-solana': {
    name: 'Radar Scan - Solana',
    endpoint: '/api/jobs/radar/solana',
    timeout: 30000,
    retries: 3
  },
  'radar-ethereum': {
    name: 'Radar Scan - Ethereum',
    endpoint: '/api/jobs/radar/ethereum',
    timeout: 45000,
    retries: 3
  },
  'radar-bsc': {
    name: 'Radar Scan - BSC',
    endpoint: '/api/jobs/radar/bsc',
    timeout: 30000,
    retries: 3
  },
  'radar-base': {
    name: 'Radar Scan - Base',
    endpoint: '/api/jobs/radar/base',
    timeout: 30000,
    retries: 3
  },
  'sentinel-cex-listings': {
    name: 'Sentinel - CEX Listings',
    endpoint: '/api/jobs/sentinel/cex-listings',
    timeout: 60000,
    retries: 2
  },
  'sentinel-price-movements': {
    name: 'Sentinel - Price Movements',
    endpoint: '/api/jobs/sentinel/price-movements',
    timeout: 45000,
    retries: 2
  },
  'security-monitoring': {
    name: 'Security Monitoring',
    endpoint: '/api/jobs/security/scan',
    timeout: 30000,
    retries: 2
  },
  'cache-cleanup': {
    name: 'Cache Cleanup',
    endpoint: '/api/jobs/maintenance/cache-cleanup',
    timeout: 15000,
    retries: 1
  },
  'metrics-aggregation': {
    name: 'Metrics Aggregation',
    endpoint: '/api/jobs/maintenance/metrics-aggregation',
    timeout: 30000,
    retries: 1
  },
  'health-monitoring': {
    name: 'Health Monitoring',
    endpoint: '/api/jobs/health/check',
    timeout: 15000,
    retries: 1
  },
  'performance-optimization': {
    name: 'Performance Optimization',
    endpoint: '/api/jobs/maintenance/performance-optimization',
    timeout: 60000,
    retries: 1
  },
  'daily-backup': {
    name: 'Daily Backup',
    endpoint: '/api/jobs/backup/daily',
    timeout: 300000,
    retries: 2
  },
  'weekly-reports': {
    name: 'Weekly Reports',
    endpoint: '/api/jobs/reports/weekly',
    timeout: 120000,
    retries: 1
  }
};

// Main worker export
export default {
  /**
   * Handle scheduled events (cron triggers)
   */
  async scheduled(event, env, ctx) {
    const { cron, scheduledTime } = event;
    const jobName = event.cron;
    
    console.log(`Cron trigger: ${jobName} at ${new Date(scheduledTime).toISOString()}`);
    
    try {
      // Get job configuration
      const job = JOBS[jobName];
      if (!job) {
        throw new Error(`Unknown job: ${jobName}`);
      }
      
      // Execute job
      const result = await executeJob(job, env, ctx);
      
      // Log success
      await logJobExecution(env, {
        jobName,
        status: 'success',
        scheduledTime,
        executionTime: Date.now(),
        duration: result.duration,
        result: result.data
      });
      
      // Update metrics
      await updateMetrics(env, jobName, 'success', result.duration);
      
    } catch (error) {
      console.error(`Job ${jobName} failed:`, error);
      
      // Log failure
      await logJobExecution(env, {
        jobName,
        status: 'failed',
        scheduledTime,
        executionTime: Date.now(),
        error: error.message,
        stack: error.stack
      });
      
      // Update metrics
      await updateMetrics(env, jobName, 'failed', 0);
      
      // Send alert for critical jobs
      if (isCriticalJob(jobName)) {
        await sendAlert(env, {
          type: 'job_failure',
          jobName,
          error: error.message,
          scheduledTime
        });
      }
    }
  },
  
  /**
   * Handle HTTP requests
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Health check endpoint
    if (path === '/health') {
      return new Response(JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Metrics endpoint
    if (path === '/metrics') {
      const metrics = await getMetrics(env);
      return new Response(metrics, {
        headers: { 'Content-Type': 'text/plain' }
      });
    }
    
    // Job status endpoint
    if (path === '/jobs/status') {
      const status = await getJobStatus(env);
      return new Response(JSON.stringify(status), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Manual job trigger endpoint
    if (path.startsWith('/jobs/trigger/') && request.method === 'POST') {
      const jobName = path.split('/').pop();
      const job = JOBS[jobName];
      
      if (!job) {
        return new Response(JSON.stringify({ error: 'Job not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      try {
        const result = await executeJob(job, env, ctx);
        return new Response(JSON.stringify({
          success: true,
          jobName,
          result: result.data,
          duration: result.duration
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          success: false,
          jobName,
          error: error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    return new Response('Not Found', { status: 404 });
  }
};

/**
 * Execute a job
 */
async function executeJob(job, env, ctx) {
  const startTime = Date.now();
  
  try {
    // Create request to API service
    const apiUrl = `${env.API_BASE_URL}${job.endpoint}`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.JWT_SECRET}`,
        'X-API-Key': env.API_KEY_SECRET,
        'User-Agent': 'Meme-Coin-Radar-Scheduler/1.0.0'
      },
      body: JSON.stringify({
        source: 'scheduler',
        timestamp: new Date().toISOString(),
        jobName: job.name
      }),
      signal: AbortSignal.timeout(job.timeout)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    const duration = Date.now() - startTime;
    
    return { data, duration };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    // Retry logic
    if (job.retries > 0) {
      console.log(`Retrying job ${job.name}, attempts left: ${job.retries}`);
      await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay
      
      return executeJob({
        ...job,
        retries: job.retries - 1
      }, env, ctx);
    }
    
    throw error;
  }
}

/**
 * Log job execution
 */
async function logJobExecution(env, logData) {
  try {
    // Store in KV for recent logs
    const logKey = `job_log:${logData.jobName}:${logData.executionTime}`;
    await env.JOB_CACHE.put(logKey, JSON.stringify(logData), {
      expirationTtl: 86400 // 24 hours
    });
    
    // Store in D1 for persistent history
    await env.SCHEDULER_DB.prepare(`
      INSERT INTO job_executions (
        job_name, status, scheduled_time, execution_time, 
        duration, result, error, stack
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      logData.jobName,
      logData.status,
      new Date(logData.scheduledTime).toISOString(),
      new Date(logData.executionTime).toISOString(),
      logData.duration || null,
      JSON.stringify(logData.result || null),
      logData.error || null,
      logData.stack || null
    ).run();
    
    // Store in R2 for long-term archival
    const logFileName = `logs/${new Date().toISOString().split('T')[0]}/${logData.jobName}-${logData.executionTime}.json`;
    await env.LOGS_BUCKET.put(logFileName, JSON.stringify(logData, null, 2));
    
  } catch (error) {
    console.error('Failed to log job execution:', error);
  }
}

/**
 * Update metrics
 */
async function updateMetrics(env, jobName, status, duration) {
  try {
    // Update in Analytics Engine
    env.SCHEDULER_ANALYTICS.writeDataPoint({
      blobs: [jobName, status],
      doubles: [duration],
      indexes: [jobName]
    });
    
    // Update counters in KV
    const successKey = `metrics:${jobName}:success_count`;
    const failureKey = `metrics:${jobName}:failure_count`;
    const durationKey = `metrics:${jobName}:avg_duration`;
    
    if (status === 'success') {
      const currentCount = parseInt(await env.METRICS_CACHE.get(successKey) || '0');
      await env.METRICS_CACHE.put(successKey, (currentCount + 1).toString());
      
      // Update average duration
      const currentDuration = parseFloat(await env.METRICS_CACHE.get(durationKey) || '0');
      const newDuration = currentCount === 0 ? duration : (currentDuration + duration) / 2;
      await env.METRICS_CACHE.put(durationKey, newDuration.toString());
    } else {
      const currentCount = parseInt(await env.METRICS_CACHE.get(failureKey) || '0');
      await env.METRICS_CACHE.put(failureKey, (currentCount + 1).toString());
    }
    
  } catch (error) {
    console.error('Failed to update metrics:', error);
  }
}

/**
 * Get metrics in Prometheus format
 */
async function getMetrics(env) {
  try {
    const metrics = [];
    
    // Job execution metrics
    for (const jobName of Object.keys(JOBS)) {
      const successCount = await env.METRICS_CACHE.get(`metrics:${jobName}:success_count`) || '0';
      const failureCount = await env.METRICS_CACHE.get(`metrics:${jobName}:failure_count`) || '0';
      const avgDuration = await env.METRICS_CACHE.get(`metrics:${jobName}:avg_duration`) || '0';
      
      metrics.push(`scheduler_job_executions_total{job="${jobName}",status="success"} ${successCount}`);
      metrics.push(`scheduler_job_executions_total{job="${jobName}",status="failure"} ${failureCount}`);
      metrics.push(`scheduler_job_duration_avg{job="${jobName}"} ${avgDuration}`);
    }
    
    // System metrics
    metrics.push(`scheduler_uptime_seconds ${Date.now() / 1000}`);
    metrics.push(`scheduler_version{version="1.0.0"} 1`);
    
    return metrics.join('\n');
    
  } catch (error) {
    console.error('Failed to get metrics:', error);
    return 'scheduler_error{type="metrics_collection"} 1';
  }
}

/**
 * Get job status
 */
async function getJobStatus(env) {
  try {
    const status = {};
    
    for (const [jobName, job] of Object.entries(JOBS)) {
      const successCount = await env.METRICS_CACHE.get(`metrics:${jobName}:success_count`) || '0';
      const failureCount = await env.METRICS_CACHE.get(`metrics:${jobName}:failure_count`) || '0';
      const avgDuration = await env.METRICS_CACHE.get(`metrics:${jobName}:avg_duration`) || '0';
      
      // Get last execution from D1
      const lastExecution = await env.SCHEDULER_DB.prepare(`
        SELECT * FROM job_executions 
        WHERE job_name = ? 
        ORDER BY execution_time DESC 
        LIMIT 1
      `).bind(jobName).first();
      
      status[jobName] = {
        name: job.name,
        successCount: parseInt(successCount),
        failureCount: parseInt(failureCount),
        avgDuration: parseFloat(avgDuration),
        lastExecution: lastExecution ? {
          status: lastExecution.status,
          executionTime: lastExecution.execution_time,
          duration: lastExecution.duration
        } : null
      };
    }
    
    return status;
    
  } catch (error) {
    console.error('Failed to get job status:', error);
    return { error: 'Failed to get job status' };
  }
}

/**
 * Check if job is critical
 */
function isCriticalJob(jobName) {
  const criticalJobs = [
    'radar-solana',
    'radar-ethereum',
    'sentinel-cex-listings',
    'security-monitoring',
    'health-monitoring'
  ];
  
  return criticalJobs.includes(jobName);
}

/**
 * Send alert
 */
async function sendAlert(env, alert) {
  try {
    // Send to Slack
    if (env.SLACK_WEBHOOK_URL) {
      await fetch(env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `🚨 Scheduler Alert: ${alert.type}`,
          attachments: [{
            color: 'danger',
            fields: [
              { title: 'Job', value: alert.jobName, short: true },
              { title: 'Error', value: alert.error, short: false },
              { title: 'Time', value: new Date(alert.scheduledTime).toISOString(), short: true }
            ]
          }]
        })
      });
    }
    
    // Send to Discord
    if (env.DISCORD_WEBHOOK_URL) {
      await fetch(env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: '🚨 Scheduler Alert',
            description: `Job **${alert.jobName}** failed`,
            color: 0xff0000,
            fields: [
              { name: 'Error', value: alert.error },
              { name: 'Time', value: new Date(alert.scheduledTime).toISOString() }
            ]
          }]
        })
      });
    }
    
  } catch (error) {
    console.error('Failed to send alert:', error);
  }
}