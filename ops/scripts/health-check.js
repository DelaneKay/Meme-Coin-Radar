#!/usr/bin/env node

/**
 * Health Check Utility for Meme Coin Radar
 * Quick system health verification across all components
 */

const axios = require('axios');
const chalk = require('chalk');
const { table } = require('table');
const ora = require('ora');

// Configuration
const CONFIG = {
  environments: {
    production: {
      api: 'https://meme-coin-radar-api.onrender.com',
      frontend: 'https://meme-coin-radar.vercel.app',
      scheduler: 'https://meme-coin-radar-scheduler.onrender.com'
    },
    staging: {
      api: 'https://meme-coin-radar-api-staging.onrender.com',
      frontend: 'https://meme-coin-radar-staging.vercel.app',
      scheduler: 'https://meme-coin-radar-scheduler-staging.onrender.com'
    }
  },
  timeout: 10000,
  retries: 3
};

class HealthChecker {
  constructor(environment = 'staging') {
    this.environment = environment;
    this.config = CONFIG.environments[environment];
    this.results = [];
  }

  /**
   * Run comprehensive health check
   */
  async check() {
    console.log(chalk.blue.bold(`🏥 Health Check - ${this.environment.toUpperCase()}`));
    console.log('');

    const spinner = ora('Running health checks...').start();

    try {
      // Check all services
      await Promise.all([
        this.checkService('API', this.config.api),
        this.checkService('Frontend', this.config.frontend),
        this.checkService('Scheduler', this.config.scheduler)
      ]);

      // Check external dependencies
      await this.checkExternalDependencies();

      spinner.stop();
      this.displayResults();
      
      return this.generateSummary();

    } catch (error) {
      spinner.stop();
      console.error(chalk.red('Health check failed:'), error.message);
      throw error;
    }
  }

  /**
   * Check individual service health
   */
  async checkService(name, baseUrl) {
    const checks = [
      { name: `${name} Health`, endpoint: '/health', critical: true },
      { name: `${name} Status`, endpoint: '/status', critical: false },
      { name: `${name} Metrics`, endpoint: '/metrics', critical: false }
    ];

    for (const check of checks) {
      await this.performCheck(check.name, `${baseUrl}${check.endpoint}`, check.critical);
    }

    // Additional service-specific checks
    if (name === 'API') {
      await this.checkApiSpecific(baseUrl);
    } else if (name === 'Frontend') {
      await this.checkFrontendSpecific(baseUrl);
    } else if (name === 'Scheduler') {
      await this.checkSchedulerSpecific(baseUrl);
    }
  }

  /**
   * API-specific health checks
   */
  async checkApiSpecific(baseUrl) {
    const checks = [
      { name: 'API Auth', endpoint: '/auth/health', critical: true },
      { name: 'API Database', endpoint: '/db/health', critical: true },
      { name: 'API Cache', endpoint: '/cache/health', critical: true },
      { name: 'API Rate Limit', endpoint: '/rate-limit/status', critical: false }
    ];

    for (const check of checks) {
      await this.performCheck(check.name, `${baseUrl}${check.endpoint}`, check.critical);
    }
  }

  /**
   * Frontend-specific health checks
   */
  async checkFrontendSpecific(baseUrl) {
    const checks = [
      { name: 'Frontend Assets', endpoint: '/static/js/main.js', critical: false },
      { name: 'Frontend Config', endpoint: '/config.json', critical: false }
    ];

    for (const check of checks) {
      await this.performCheck(check.name, `${baseUrl}${check.endpoint}`, check.critical);
    }
  }

  /**
   * Scheduler-specific health checks
   */
  async checkSchedulerSpecific(baseUrl) {
    const checks = [
      { name: 'Scheduler Jobs', endpoint: '/jobs/status', critical: true },
      { name: 'Scheduler Queue', endpoint: '/queue/health', critical: true }
    ];

    for (const check of checks) {
      await this.performCheck(check.name, `${baseUrl}${check.endpoint}`, check.critical);
    }
  }

  /**
   * Check external dependencies
   */
  async checkExternalDependencies() {
    const dependencies = [
      { name: 'DEXScreener API', url: 'https://api.dexscreener.com/latest/dex/tokens/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
      { name: 'GoPlus API', url: 'https://api.gopluslabs.io/api/v1/supported_chains' },
      { name: 'Birdeye API', url: 'https://public-api.birdeye.so/public/tokenlist?sort_by=v24hUSD&sort_type=desc&offset=0&limit=1' },
      { name: 'CoinGecko API', url: 'https://api.coingecko.com/api/v3/ping' }
    ];

    for (const dep of dependencies) {
      await this.performCheck(dep.name, dep.url, false);
    }
  }

  /**
   * Perform individual health check
   */
  async performCheck(name, url, critical = false) {
    let attempt = 0;
    let lastError = null;

    while (attempt < CONFIG.retries) {
      try {
        const startTime = Date.now();
        
        const response = await axios.get(url, {
          timeout: CONFIG.timeout,
          validateStatus: () => true, // Don't throw on HTTP errors
          headers: {
            'User-Agent': 'Meme-Coin-Radar-Health-Check/1.0'
          }
        });

        const responseTime = Date.now() - startTime;
        const success = response.status >= 200 && response.status < 400;

        this.results.push({
          name,
          url,
          status: success ? 'PASS' : 'FAIL',
          httpStatus: response.status,
          responseTime,
          critical,
          attempt: attempt + 1,
          error: success ? null : `HTTP ${response.status}`
        });

        return; // Success, exit retry loop

      } catch (error) {
        lastError = error;
        attempt++;
        
        if (attempt < CONFIG.retries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    // All retries failed
    this.results.push({
      name,
      url,
      status: 'FAIL',
      httpStatus: null,
      responseTime: null,
      critical,
      attempt: CONFIG.retries,
      error: lastError.message
    });
  }

  /**
   * Display results in a formatted table
   */
  displayResults() {
    console.log('');
    console.log(chalk.blue.bold('📊 Health Check Results'));
    console.log('');

    const tableData = [
      ['Service', 'Status', 'Response Time', 'HTTP Status', 'Critical', 'Error']
    ];

    this.results.forEach(result => {
      const status = result.status === 'PASS' 
        ? chalk.green('✅ PASS') 
        : chalk.red('❌ FAIL');
      
      const responseTime = result.responseTime 
        ? `${result.responseTime}ms` 
        : 'N/A';
      
      const httpStatus = result.httpStatus || 'N/A';
      const critical = result.critical ? chalk.red('YES') : chalk.gray('NO');
      const error = result.error || '';

      tableData.push([
        result.name,
        status,
        responseTime,
        httpStatus,
        critical,
        error
      ]);
    });

    console.log(table(tableData, {
      border: {
        topBody: '─',
        topJoin: '┬',
        topLeft: '┌',
        topRight: '┐',
        bottomBody: '─',
        bottomJoin: '┴',
        bottomLeft: '└',
        bottomRight: '┘',
        bodyLeft: '│',
        bodyRight: '│',
        bodyJoin: '│',
        joinBody: '─',
        joinLeft: '├',
        joinRight: '┤',
        joinJoin: '┼'
      }
    }));
  }

  /**
   * Generate summary report
   */
  generateSummary() {
    const total = this.results.length;
    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = this.results.filter(r => r.status === 'FAIL').length;
    const criticalFailed = this.results.filter(r => r.status === 'FAIL' && r.critical).length;

    const summary = {
      environment: this.environment,
      timestamp: new Date().toISOString(),
      total,
      passed,
      failed,
      criticalFailed,
      successRate: (passed / total) * 100,
      overallStatus: criticalFailed > 0 ? 'CRITICAL' : failed > 0 ? 'WARNING' : 'HEALTHY'
    };

    console.log('');
    console.log(chalk.blue.bold('📋 Summary'));
    console.log('');
    console.log(`Environment: ${chalk.cyan(summary.environment)}`);
    console.log(`Total Checks: ${chalk.white(summary.total)}`);
    console.log(`Passed: ${chalk.green(summary.passed)}`);
    console.log(`Failed: ${chalk.red(summary.failed)}`);
    console.log(`Critical Failures: ${chalk.red.bold(summary.criticalFailed)}`);
    console.log(`Success Rate: ${chalk.yellow(summary.successRate.toFixed(1))}%`);
    
    const statusColor = summary.overallStatus === 'HEALTHY' ? 'green' : 
                       summary.overallStatus === 'WARNING' ? 'yellow' : 'red';
    console.log(`Overall Status: ${chalk[statusColor].bold(summary.overallStatus)}`);

    // Recommendations
    console.log('');
    console.log(chalk.blue.bold('💡 Recommendations'));
    console.log('');

    if (summary.criticalFailed > 0) {
      console.log(chalk.red('🚨 CRITICAL: Immediate attention required!'));
      console.log('   - Check failed critical services');
      console.log('   - Consider rollback if recently deployed');
      console.log('   - Alert on-call team');
    } else if (summary.failed > 0) {
      console.log(chalk.yellow('⚠️  WARNING: Some non-critical services are failing'));
      console.log('   - Monitor failed services');
      console.log('   - Plan maintenance if needed');
    } else {
      console.log(chalk.green('✅ All systems healthy!'));
      console.log('   - Continue normal operations');
      console.log('   - Regular monitoring recommended');
    }

    return summary;
  }

  /**
   * Export results to JSON
   */
  async exportResults(filename) {
    const report = {
      summary: this.generateSummary(),
      results: this.results,
      metadata: {
        timestamp: new Date().toISOString(),
        environment: this.environment,
        version: '1.0.0'
      }
    };

    const fs = require('fs').promises;
    await fs.writeFile(filename, JSON.stringify(report, null, 2));
    console.log(`\n📄 Results exported to: ${filename}`);
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const environment = args[0] || 'staging';
  const exportFile = args.includes('--export') ? 
    `health-check-${environment}-${Date.now()}.json` : null;

  const healthChecker = new HealthChecker(environment);
  
  healthChecker.check()
    .then(async (summary) => {
      if (exportFile) {
        await healthChecker.exportResults(exportFile);
      }

      // Exit with appropriate code
      const exitCode = summary.criticalFailed > 0 ? 2 : 
                      summary.failed > 0 ? 1 : 0;
      
      process.exit(exitCode);
    })
    .catch((error) => {
      console.error(chalk.red('Health check failed:'), error);
      process.exit(3);
    });
}

module.exports = HealthChecker;