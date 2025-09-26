#!/usr/bin/env node

/**
 * Deployment Automation Script for Meme Coin Radar
 * Handles complete deployment pipeline with verification and rollback
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

// Import our verification and rollback scripts
const DeploymentVerifier = require('./post-deployment-verification');
const RollbackManager = require('./rollback');

// Configuration
const CONFIG = {
  environments: {
    production: {
      branch: 'main',
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
      branch: 'staging',
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
  timeouts: {
    deployment: 600000, // 10 minutes
    verification: 300000, // 5 minutes
    healthCheck: 30000   // 30 seconds
  },
  notifications: {
    slack: process.env.SLACK_WEBHOOK_URL,
    discord: process.env.DISCORD_WEBHOOK_URL
  }
};

class DeploymentManager {
  constructor(environment = 'staging') {
    this.environment = environment;
    this.config = CONFIG.environments[environment];
    this.deploymentLog = {
      id: `deploy-${Date.now()}`,
      timestamp: new Date().toISOString(),
      environment,
      version: null,
      steps: [],
      status: 'in_progress'
    };
  }

  /**
   * Execute complete deployment pipeline
   */
  async deploy(options = {}) {
    const {
      component = 'all',
      skipTests = false,
      skipVerification = false,
      autoRollback = true,
      dryRun = false
    } = options;

    console.log(`🚀 Starting deployment to ${this.environment}`);
    console.log(`Component: ${component}`);
    console.log(`Dry run: ${dryRun}`);
    console.log('');

    try {
      // Send deployment started notification
      await this.sendNotification('deployment_started', {
        environment: this.environment,
        component,
        dryRun
      });

      // Pre-deployment checks
      await this.preDeploymentChecks();

      // Get current version
      const currentVersion = await this.getCurrentVersion();
      this.deploymentLog.version = currentVersion;

      // Run tests
      if (!skipTests) {
        await this.runTests();
      }

      // Build and deploy
      if (!dryRun) {
        if (component === 'all') {
          await this.deployAll();
        } else {
          await this.deployComponent(component);
        }

        // Wait for deployment to stabilize
        await this.waitForStabilization();

        // Post-deployment verification
        if (!skipVerification) {
          await this.runVerification();
        }
      } else {
        console.log('🔍 Dry run - skipping actual deployment');
        this.logStep('dry_run', true, 'Deployment simulation completed');
      }

      // Update deployment status
      this.deploymentLog.status = 'success';

      // Send success notification
      await this.sendNotification('deployment_completed', {
        environment: this.environment,
        component,
        version: currentVersion,
        duration: this.getDeploymentDuration()
      });

      // Save deployment history
      await this.saveDeploymentHistory();

      console.log('✅ Deployment completed successfully');
      return this.deploymentLog;

    } catch (error) {
      console.error('❌ Deployment failed:', error);
      
      this.deploymentLog.status = 'failed';
      this.deploymentLog.error = error.message;

      // Auto-rollback if enabled and not a dry run
      if (autoRollback && !dryRun && this.deploymentLog.version) {
        console.log('🔄 Initiating auto-rollback...');
        try {
          await this.performRollback();
        } catch (rollbackError) {
          console.error('❌ Rollback also failed:', rollbackError);
          this.deploymentLog.rollbackError = rollbackError.message;
        }
      }

      // Send failure notification
      await this.sendNotification('deployment_failed', {
        environment: this.environment,
        component,
        error: error.message,
        autoRollback
      });

      throw error;
    } finally {
      // Always save deployment log
      await this.saveDeploymentLog();
    }
  }

  /**
   * Pre-deployment checks
   */
  async preDeploymentChecks() {
    console.log('🔍 Running pre-deployment checks...');

    try {
      // Check Git status
      await this.checkGitStatus();

      // Check environment variables
      await this.checkEnvironmentVariables();

      // Check external dependencies
      await this.checkExternalDependencies();

      // Check current system health
      await this.checkCurrentSystemHealth();

      this.logStep('pre_deployment_checks', true, 'All checks passed');

    } catch (error) {
      this.logStep('pre_deployment_checks', false, error.message);
      throw new Error(`Pre-deployment checks failed: ${error.message}`);
    }
  }

  /**
   * Check Git status
   */
  async checkGitStatus() {
    try {
      // Ensure we're on the correct branch
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
      if (currentBranch !== this.config.branch) {
        throw new Error(`Wrong branch: ${currentBranch}, expected: ${this.config.branch}`);
      }

      // Ensure working directory is clean
      const gitStatus = execSync('git status --porcelain', { encoding: 'utf8' });
      if (gitStatus.trim()) {
        throw new Error('Working directory has uncommitted changes');
      }

      // Ensure we're up to date with remote
      execSync('git fetch origin', { stdio: 'inherit' });
      const behind = execSync(`git rev-list --count HEAD..origin/${this.config.branch}`, { encoding: 'utf8' }).trim();
      if (parseInt(behind) > 0) {
        throw new Error(`Branch is ${behind} commits behind origin/${this.config.branch}`);
      }

      console.log('  ✅ Git status check passed');

    } catch (error) {
      throw new Error(`Git status check failed: ${error.message}`);
    }
  }

  /**
   * Check environment variables
   */
  async checkEnvironmentVariables() {
    const requiredVars = [
      'DATABASE_URL',
      'REDIS_URL',
      'JWT_SECRET',
      'API_KEY_SECRET'
    ];

    const missing = requiredVars.filter(varName => !process.env[varName]);
    
    if (missing.length > 0) {
      throw new Error(`Missing environment variables: ${missing.join(', ')}`);
    }

    console.log('  ✅ Environment variables check passed');
  }

  /**
   * Check external dependencies
   */
  async checkExternalDependencies() {
    const dependencies = [
      { name: 'DEXScreener', url: 'https://api.dexscreener.com/latest/dex/tokens/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
      { name: 'GoPlus', url: 'https://api.gopluslabs.io/api/v1/supported_chains' },
      { name: 'Birdeye', url: 'https://public-api.birdeye.so/public/tokenlist?sort_by=v24hUSD&sort_type=desc&offset=0&limit=1' }
    ];

    for (const dep of dependencies) {
      try {
        await axios.get(dep.url, { timeout: 10000 });
        console.log(`  ✅ ${dep.name} API accessible`);
      } catch (error) {
        console.warn(`  ⚠️ ${dep.name} API check failed: ${error.message}`);
      }
    }
  }

  /**
   * Check current system health
   */
  async checkCurrentSystemHealth() {
    const services = ['api', 'frontend', 'scheduler'];
    
    for (const service of services) {
      try {
        const serviceConfig = this.config[service];
        const response = await axios.get(`${serviceConfig.url}/health`, {
          timeout: CONFIG.timeouts.healthCheck,
          validateStatus: () => true
        });

        if (response.status === 200) {
          console.log(`  ✅ ${service} is healthy`);
        } else {
          console.warn(`  ⚠️ ${service} health check returned ${response.status}`);
        }

      } catch (error) {
        console.warn(`  ⚠️ ${service} health check failed: ${error.message}`);
      }
    }
  }

  /**
   * Get current version
   */
  async getCurrentVersion() {
    try {
      const version = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
      console.log(`📋 Current version: ${version.substring(0, 8)}`);
      return version;
    } catch (error) {
      throw new Error(`Failed to get current version: ${error.message}`);
    }
  }

  /**
   * Run tests
   */
  async runTests() {
    console.log('🧪 Running tests...');

    try {
      // Run API tests
      console.log('  Running API tests...');
      execSync('npm test --workspace=api', { stdio: 'inherit' });

      // Run Sentinel tests
      console.log('  Running Sentinel tests...');
      execSync('npm test --workspace=sentinel', { stdio: 'inherit' });

      // Run Frontend tests
      console.log('  Running Frontend tests...');
      execSync('npm test --workspace=frontend', { stdio: 'inherit' });

      // Run integration tests
      console.log('  Running integration tests...');
      execSync('npm run test:integration', { stdio: 'inherit' });

      this.logStep('tests', true, 'All tests passed');

    } catch (error) {
      this.logStep('tests', false, error.message);
      throw new Error(`Tests failed: ${error.message}`);
    }
  }

  /**
   * Deploy all components
   */
  async deployAll() {
    console.log('🚀 Deploying all components...');

    // Deploy in order: scheduler -> api -> frontend
    const components = ['scheduler', 'api', 'frontend'];
    
    for (const component of components) {
      await this.deployComponent(component);
    }
  }

  /**
   * Deploy specific component
   */
  async deployComponent(component) {
    console.log(`🚀 Deploying ${component}...`);

    try {
      const serviceConfig = this.config[component];
      
      switch (serviceConfig.platform) {
        case 'render':
          await this.deployToRender(component, serviceConfig);
          break;
        case 'vercel':
          await this.deployToVercel(component, serviceConfig);
          break;
        default:
          throw new Error(`Unknown platform: ${serviceConfig.platform}`);
      }

      this.logStep(`deploy_${component}`, true, 'Deployment triggered');

    } catch (error) {
      this.logStep(`deploy_${component}`, false, error.message);
      throw error;
    }
  }

  /**
   * Deploy to Render
   */
  async deployToRender(component, serviceConfig) {
    try {
      // Render deploys automatically on Git push
      // We just need to ensure the latest code is pushed
      execSync(`git push origin ${this.config.branch}`, { stdio: 'inherit' });
      
      console.log(`  ✅ Code pushed to ${this.config.branch} branch`);
      console.log(`  🔄 Render will automatically deploy ${serviceConfig.service}`);

    } catch (error) {
      throw new Error(`Render deployment failed: ${error.message}`);
    }
  }

  /**
   * Deploy to Vercel
   */
  async deployToVercel(component, serviceConfig) {
    try {
      // Build the frontend
      if (component === 'frontend') {
        console.log('  Building frontend...');
        execSync('npm run build --workspace=frontend', { stdio: 'inherit' });
      }

      // Deploy to Vercel
      const deployCmd = this.environment === 'production' ? 
        'vercel --prod --scope team' : 
        'vercel --scope team';
      
      execSync(deployCmd, { 
        stdio: 'inherit',
        cwd: component === 'frontend' ? './frontend' : '.'
      });

      console.log(`  ✅ ${component} deployed to Vercel`);

    } catch (error) {
      throw new Error(`Vercel deployment failed: ${error.message}`);
    }
  }

  /**
   * Wait for deployment stabilization
   */
  async waitForStabilization() {
    console.log('⏳ Waiting for deployment to stabilize...');

    const stabilizationTime = 60000; // 1 minute
    await new Promise(resolve => setTimeout(resolve, stabilizationTime));

    // Check if all services are responding
    const services = ['api', 'frontend', 'scheduler'];
    
    for (const service of services) {
      await this.waitForService(service);
    }

    this.logStep('stabilization', true, 'All services stabilized');
  }

  /**
   * Wait for specific service to be ready
   */
  async waitForService(service) {
    const serviceConfig = this.config[service];
    const maxAttempts = 30; // 5 minutes with 10-second intervals
    let attempts = 0;

    console.log(`  Waiting for ${service} to be ready...`);

    while (attempts < maxAttempts) {
      try {
        const response = await axios.get(`${serviceConfig.url}/health`, {
          timeout: 10000,
          validateStatus: () => true
        });

        if (response.status === 200) {
          console.log(`  ✅ ${service} is ready`);
          return;
        }

      } catch (error) {
        // Service might be temporarily unavailable during deployment
      }

      attempts++;
      await new Promise(resolve => setTimeout(resolve, 10000));
      process.stdout.write('.');
    }

    throw new Error(`${service} did not become ready within timeout`);
  }

  /**
   * Run post-deployment verification
   */
  async runVerification() {
    console.log('🔍 Running post-deployment verification...');

    try {
      const verifier = new DeploymentVerifier(this.environment);
      const results = await verifier.verify();

      if (results.summary.status === 'FAIL') {
        throw new Error(`Verification failed: ${results.summary.failed} tests failed`);
      }

      this.logStep('verification', true, 
        `Verification passed: ${results.summary.successRate * 100}% success rate`);

    } catch (error) {
      this.logStep('verification', false, error.message);
      throw error;
    }
  }

  /**
   * Perform rollback
   */
  async performRollback() {
    console.log('🔄 Performing rollback...');

    try {
      const rollbackManager = new RollbackManager(this.environment);
      await rollbackManager.rollback({
        reason: 'Auto-rollback due to deployment failure',
        skipVerification: false
      });

      this.logStep('rollback', true, 'Rollback completed successfully');

    } catch (error) {
      this.logStep('rollback', false, error.message);
      throw error;
    }
  }

  /**
   * Log deployment step
   */
  logStep(step, success, message) {
    const logEntry = {
      step,
      success,
      message,
      timestamp: new Date().toISOString()
    };

    this.deploymentLog.steps.push(logEntry);
    
    const status = success ? '✅' : '❌';
    console.log(`  ${status} ${step}: ${message}`);
  }

  /**
   * Get deployment duration
   */
  getDeploymentDuration() {
    const start = new Date(this.deploymentLog.timestamp);
    const end = new Date();
    return Math.round((end - start) / 1000); // seconds
  }

  /**
   * Send notification
   */
  async sendNotification(type, data) {
    const messages = {
      deployment_started: `🚀 Deployment started for ${data.environment}`,
      deployment_completed: `✅ Deployment completed for ${data.environment} in ${data.duration}s`,
      deployment_failed: `❌ Deployment failed for ${data.environment}: ${data.error}`
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
   * Save deployment history
   */
  async saveDeploymentHistory() {
    try {
      const historyFile = path.join(__dirname, '../deployment-history.json');
      
      let history = { deployments: [] };
      try {
        const existingHistory = await fs.readFile(historyFile, 'utf8');
        history = JSON.parse(existingHistory);
      } catch (error) {
        // File doesn't exist yet
      }

      history.deployments.push(this.deploymentLog);
      
      // Keep only last 100 deployments
      history.deployments = history.deployments.slice(-100);

      await fs.writeFile(historyFile, JSON.stringify(history, null, 2));

    } catch (error) {
      console.warn('Failed to save deployment history:', error.message);
    }
  }

  /**
   * Save deployment log
   */
  async saveDeploymentLog() {
    try {
      const logDir = path.join(__dirname, '../logs/deployments');
      await fs.mkdir(logDir, { recursive: true });
      
      const logFile = path.join(logDir, `${this.deploymentLog.id}.json`);
      await fs.writeFile(logFile, JSON.stringify(this.deploymentLog, null, 2));
      
      console.log(`📝 Deployment log saved: ${logFile}`);

    } catch (error) {
      console.warn('Failed to save deployment log:', error.message);
    }
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const environment = args[0] || 'staging';
  const component = args[1] || 'all';
  
  const options = {
    skipTests: args.includes('--skip-tests'),
    skipVerification: args.includes('--skip-verification'),
    autoRollback: !args.includes('--no-rollback'),
    dryRun: args.includes('--dry-run')
  };

  const deploymentManager = new DeploymentManager(environment);
  
  deploymentManager.deploy({ component, ...options })
    .then(() => {
      console.log('Deployment pipeline completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Deployment pipeline failed:', error);
      process.exit(1);
    });
}

module.exports = DeploymentManager;