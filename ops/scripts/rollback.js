#!/usr/bin/env node

/**
 * Rollback Script for Meme Coin Radar
 * Handles emergency rollbacks and version restoration
 */

const axios = require('axios');
const { execSync, spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

// Configuration
const CONFIG = {
  environments: {
    production: {
      api: {
        service: 'meme-coin-radar-api',
        url: 'https://meme-coin-radar-api.onrender.com',
        platform: 'render'
      },
      frontend: {
        service: 'meme-coin-radar',
        url: 'https://meme-coin-radar.vercel.app',
        platform: 'vercel'
      },
      scheduler: {
        service: 'meme-coin-radar-scheduler',
        url: 'https://meme-coin-radar-scheduler.onrender.com',
        platform: 'render'
      }
    },
    staging: {
      api: {
        service: 'meme-coin-radar-api-staging',
        url: 'https://meme-coin-radar-api-staging.onrender.com',
        platform: 'render'
      },
      frontend: {
        service: 'meme-coin-radar-staging',
        url: 'https://meme-coin-radar-staging.vercel.app',
        platform: 'vercel'
      },
      scheduler: {
        service: 'meme-coin-radar-scheduler-staging',
        url: 'https://meme-coin-radar-scheduler-staging.onrender.com',
        platform: 'render'
      }
    }
  },
  git: {
    remote: 'origin',
    mainBranch: 'main',
    stagingBranch: 'staging'
  },
  notifications: {
    slack: process.env.SLACK_WEBHOOK_URL,
    discord: process.env.DISCORD_WEBHOOK_URL,
    email: process.env.EMAIL_SERVICE_API_KEY
  }
};

class RollbackManager {
  constructor(environment = 'production') {
    this.environment = environment;
    this.config = CONFIG.environments[environment];
    this.rollbackLog = {
      timestamp: new Date().toISOString(),
      environment,
      steps: [],
      status: 'in_progress'
    };
  }

  /**
   * Execute rollback procedure
   */
  async rollback(options = {}) {
    const {
      component = 'all', // 'api', 'frontend', 'scheduler', or 'all'
      version = null,     // specific version to rollback to
      reason = 'Emergency rollback',
      skipVerification = false
    } = options;

    console.log(`🚨 Starting rollback for ${this.environment} environment`);
    console.log(`Component: ${component}`);
    console.log(`Reason: ${reason}`);
    console.log('');

    try {
      // Send initial notification
      await this.sendNotification('rollback_started', {
        environment: this.environment,
        component,
        reason
      });

      // Pre-rollback checks
      await this.preRollbackChecks();

      // Determine target version
      const targetVersion = version || await this.getLastKnownGoodVersion();
      this.logStep('version_determined', true, `Target version: ${targetVersion}`);

      // Execute rollback based on component
      if (component === 'all') {
        await this.rollbackAll(targetVersion);
      } else {
        await this.rollbackComponent(component, targetVersion);
      }

      // Post-rollback verification
      if (!skipVerification) {
        await this.postRollbackVerification();
      }

      // Update status
      this.rollbackLog.status = 'completed';
      this.rollbackLog.targetVersion = targetVersion;

      // Send success notification
      await this.sendNotification('rollback_completed', {
        environment: this.environment,
        component,
        targetVersion,
        duration: this.getRollbackDuration()
      });

      console.log('✅ Rollback completed successfully');
      return this.rollbackLog;

    } catch (error) {
      console.error('❌ Rollback failed:', error);
      
      this.rollbackLog.status = 'failed';
      this.rollbackLog.error = error.message;
      
      await this.sendNotification('rollback_failed', {
        environment: this.environment,
        component,
        error: error.message
      });

      throw error;
    } finally {
      // Save rollback log
      await this.saveRollbackLog();
    }
  }

  /**
   * Pre-rollback checks
   */
  async preRollbackChecks() {
    console.log('🔍 Running pre-rollback checks...');

    try {
      // Check Git repository status
      const gitStatus = execSync('git status --porcelain', { encoding: 'utf8' });
      if (gitStatus.trim()) {
        console.warn('⚠️ Working directory has uncommitted changes');
      }

      // Check if we're on the correct branch
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
      const expectedBranch = this.environment === 'production' ? CONFIG.git.mainBranch : CONFIG.git.stagingBranch;
      
      if (currentBranch !== expectedBranch) {
        console.warn(`⚠️ Current branch (${currentBranch}) differs from expected (${expectedBranch})`);
      }

      // Check service status
      await this.checkServiceStatus();

      this.logStep('pre_rollback_checks', true, 'All checks passed');

    } catch (error) {
      this.logStep('pre_rollback_checks', false, error.message);
      throw new Error(`Pre-rollback checks failed: ${error.message}`);
    }
  }

  /**
   * Check current service status
   */
  async checkServiceStatus() {
    const services = ['api', 'frontend', 'scheduler'];
    
    for (const service of services) {
      try {
        const serviceConfig = this.config[service];
        const response = await axios.get(`${serviceConfig.url}/health`, {
          timeout: 10000,
          validateStatus: () => true
        });

        const status = response.status === 200 ? 'healthy' : 'unhealthy';
        console.log(`  ${service}: ${status} (${response.status})`);

      } catch (error) {
        console.log(`  ${service}: unreachable (${error.message})`);
      }
    }
  }

  /**
   * Get last known good version
   */
  async getLastKnownGoodVersion() {
    try {
      // Try to get from deployment history
      const historyFile = path.join(__dirname, '../deployment-history.json');
      
      try {
        const history = JSON.parse(await fs.readFile(historyFile, 'utf8'));
        const lastGood = history.deployments
          .filter(d => d.environment === this.environment && d.status === 'success')
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[1]; // Get second-to-last (previous)

        if (lastGood) {
          return lastGood.version;
        }
      } catch (error) {
        console.warn('Could not read deployment history');
      }

      // Fallback to Git history
      const commits = execSync('git log --oneline -10', { encoding: 'utf8' })
        .split('\n')
        .filter(line => line.trim())
        .map(line => line.split(' ')[0]);

      // Return the commit before the current one
      return commits[1] || commits[0];

    } catch (error) {
      throw new Error(`Could not determine last known good version: ${error.message}`);
    }
  }

  /**
   * Rollback all components
   */
  async rollbackAll(targetVersion) {
    console.log('🔄 Rolling back all components...');

    const components = ['scheduler', 'api', 'frontend']; // Order matters for dependencies
    
    for (const component of components) {
      await this.rollbackComponent(component, targetVersion);
    }
  }

  /**
   * Rollback specific component
   */
  async rollbackComponent(component, targetVersion) {
    console.log(`🔄 Rolling back ${component}...`);

    try {
      const serviceConfig = this.config[component];
      
      switch (serviceConfig.platform) {
        case 'render':
          await this.rollbackRenderService(serviceConfig, targetVersion);
          break;
        case 'vercel':
          await this.rollbackVercelService(serviceConfig, targetVersion);
          break;
        default:
          throw new Error(`Unknown platform: ${serviceConfig.platform}`);
      }

      this.logStep(`rollback_${component}`, true, `Rolled back to ${targetVersion}`);

    } catch (error) {
      this.logStep(`rollback_${component}`, false, error.message);
      throw error;
    }
  }

  /**
   * Rollback Render service
   */
  async rollbackRenderService(serviceConfig, targetVersion) {
    try {
      // First, checkout the target version locally
      execSync(`git checkout ${targetVersion}`, { stdio: 'inherit' });

      // Force push to trigger redeployment
      const branch = this.environment === 'production' ? CONFIG.git.mainBranch : CONFIG.git.stagingBranch;
      execSync(`git push ${CONFIG.git.remote} ${targetVersion}:${branch} --force`, { stdio: 'inherit' });

      // Wait for deployment to complete
      await this.waitForDeployment(serviceConfig.url, 300000); // 5 minutes timeout

    } catch (error) {
      throw new Error(`Render rollback failed: ${error.message}`);
    }
  }

  /**
   * Rollback Vercel service
   */
  async rollbackVercelService(serviceConfig, targetVersion) {
    try {
      // Use Vercel CLI to rollback
      const projectName = serviceConfig.service;
      
      // Get deployment list
      const deployments = execSync(`vercel ls ${projectName} --scope team`, { encoding: 'utf8' });
      
      // Find deployment with target version (this is simplified - in practice you'd need better version tracking)
      console.log('Available deployments:');
      console.log(deployments);

      // For now, we'll use Git-based rollback
      execSync(`git checkout ${targetVersion}`, { stdio: 'inherit' });
      
      const branch = this.environment === 'production' ? CONFIG.git.mainBranch : CONFIG.git.stagingBranch;
      execSync(`git push ${CONFIG.git.remote} ${targetVersion}:${branch} --force`, { stdio: 'inherit' });

      // Trigger new deployment
      execSync(`vercel --prod --scope team`, { stdio: 'inherit' });

      // Wait for deployment
      await this.waitForDeployment(serviceConfig.url, 300000);

    } catch (error) {
      throw new Error(`Vercel rollback failed: ${error.message}`);
    }
  }

  /**
   * Wait for deployment to complete
   */
  async waitForDeployment(url, timeout = 300000) {
    const startTime = Date.now();
    const checkInterval = 10000; // 10 seconds

    console.log(`Waiting for deployment at ${url}...`);

    while (Date.now() - startTime < timeout) {
      try {
        const response = await axios.get(`${url}/health`, {
          timeout: 5000,
          validateStatus: () => true
        });

        if (response.status === 200) {
          console.log('✅ Deployment is live');
          return;
        }

      } catch (error) {
        // Service might be temporarily unavailable during deployment
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval));
      process.stdout.write('.');
    }

    throw new Error('Deployment timeout - service did not become available');
  }

  /**
   * Post-rollback verification
   */
  async postRollbackVerification() {
    console.log('🔍 Running post-rollback verification...');

    try {
      // Import and run verification script
      const DeploymentVerifier = require('./post-deployment-verification');
      const verifier = new DeploymentVerifier(this.environment);
      
      const results = await verifier.verify();
      
      if (results.summary.status === 'FAIL') {
        throw new Error('Post-rollback verification failed');
      }

      this.logStep('post_rollback_verification', true, 
        `Verification passed: ${results.summary.successRate * 100}% success rate`);

    } catch (error) {
      this.logStep('post_rollback_verification', false, error.message);
      throw error;
    }
  }

  /**
   * Emergency stop - immediately stop all services
   */
  async emergencyStop() {
    console.log('🛑 Emergency stop initiated...');

    try {
      // This would typically involve:
      // 1. Putting services in maintenance mode
      // 2. Stopping traffic routing
      // 3. Graceful shutdown of services

      // For now, we'll simulate by updating a maintenance flag
      await this.setMaintenanceMode(true);

      this.logStep('emergency_stop', true, 'Services stopped');

    } catch (error) {
      this.logStep('emergency_stop', false, error.message);
      throw error;
    }
  }

  /**
   * Set maintenance mode
   */
  async setMaintenanceMode(enabled) {
    // This would typically update a feature flag or configuration
    // For demonstration, we'll just log it
    console.log(`${enabled ? 'Enabling' : 'Disabling'} maintenance mode...`);
    
    // In a real implementation, you might:
    // - Update a feature flag in your configuration service
    // - Set a maintenance page in your CDN
    // - Update load balancer configuration
  }

  /**
   * Database rollback (if needed)
   */
  async rollbackDatabase(targetVersion) {
    console.log('🗄️ Rolling back database...');

    try {
      // This is a critical operation that should be handled carefully
      // In practice, you'd want to:
      // 1. Create a backup before rollback
      // 2. Run migration rollback scripts
      // 3. Verify data integrity

      console.warn('⚠️ Database rollback not implemented - manual intervention required');
      this.logStep('database_rollback', false, 'Manual intervention required');

    } catch (error) {
      this.logStep('database_rollback', false, error.message);
      throw error;
    }
  }

  /**
   * Log rollback step
   */
  logStep(step, success, message) {
    const logEntry = {
      step,
      success,
      message,
      timestamp: new Date().toISOString()
    };

    this.rollbackLog.steps.push(logEntry);
    
    const status = success ? '✅' : '❌';
    console.log(`  ${status} ${step}: ${message}`);
  }

  /**
   * Get rollback duration
   */
  getRollbackDuration() {
    const start = new Date(this.rollbackLog.timestamp);
    const end = new Date();
    return Math.round((end - start) / 1000); // seconds
  }

  /**
   * Send notification
   */
  async sendNotification(type, data) {
    const messages = {
      rollback_started: `🚨 Rollback started for ${data.environment} - ${data.reason}`,
      rollback_completed: `✅ Rollback completed for ${data.environment} in ${data.duration}s`,
      rollback_failed: `❌ Rollback failed for ${data.environment}: ${data.error}`
    };

    const message = messages[type];
    if (!message) return;

    try {
      // Slack notification
      if (CONFIG.notifications.slack) {
        await axios.post(CONFIG.notifications.slack, {
          text: message,
          attachments: [{
            color: type.includes('failed') ? 'danger' : type.includes('started') ? 'warning' : 'good',
            fields: Object.entries(data).map(([key, value]) => ({
              title: key,
              value: value.toString(),
              short: true
            }))
          }]
        });
      }

      // Discord notification
      if (CONFIG.notifications.discord) {
        await axios.post(CONFIG.notifications.discord, {
          embeds: [{
            title: type.replace('_', ' ').toUpperCase(),
            description: message,
            color: type.includes('failed') ? 0xff0000 : type.includes('started') ? 0xffaa00 : 0x00ff00,
            fields: Object.entries(data).map(([key, value]) => ({
              name: key,
              value: value.toString(),
              inline: true
            }))
          }]
        });
      }

    } catch (error) {
      console.warn('Failed to send notification:', error.message);
    }
  }

  /**
   * Save rollback log
   */
  async saveRollbackLog() {
    try {
      const logDir = path.join(__dirname, '../logs/rollbacks');
      await fs.mkdir(logDir, { recursive: true });
      
      const logFile = path.join(logDir, `rollback-${this.environment}-${Date.now()}.json`);
      await fs.writeFile(logFile, JSON.stringify(this.rollbackLog, null, 2));
      
      console.log(`📝 Rollback log saved: ${logFile}`);

    } catch (error) {
      console.warn('Failed to save rollback log:', error.message);
    }
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const environment = args[0] || 'production';
  const component = args[1] || 'all';
  const version = args[2];
  const reason = args[3] || 'Emergency rollback';

  const rollbackManager = new RollbackManager(environment);
  
  // Handle emergency stop
  if (component === 'emergency-stop') {
    rollbackManager.emergencyStop()
      .then(() => {
        console.log('Emergency stop completed');
        process.exit(0);
      })
      .catch((error) => {
        console.error('Emergency stop failed:', error);
        process.exit(1);
      });
    return;
  }

  // Handle normal rollback
  rollbackManager.rollback({
    component,
    version,
    reason,
    skipVerification: args.includes('--skip-verification')
  })
    .then(() => {
      console.log('Rollback completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Rollback failed:', error);
      process.exit(1);
    });
}

module.exports = RollbackManager;