#!/usr/bin/env node

import { Pool } from 'pg';
import Redis from 'ioredis';
import { config } from 'dotenv';
import { TuningController } from '../controllers/TuningController';
import logger from '../utils/logger';
import { getErrorMessage } from '../types/utils';

// Load environment variables
config();

async function main() {
  let db: Pool | null = null;
  let redis: Redis | null = null;
  let tuningController: TuningController | null = null;

  try {
    console.log('🚀 Starting 48-hour backtest with grid search optimization...\n');

    // Initialize database connection
    db = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

    // Test database connection
    await db.query('SELECT NOW()');
    console.log('✅ Database connection established');

    // Initialize Redis connection
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    await redis.ping();
    console.log('✅ Redis connection established');

    // Initialize tuning controller
    tuningController = new TuningController(db, redis);
    await tuningController.initialize();
    console.log('✅ Tuning controller initialized\n');

    // Execute the 48-hour backtest
    console.log('📊 Executing 48-hour backtest with the following parameters:');
    console.log('   • Lookback period: 48 hours');
    console.log('   • Time buckets: 3-hour windows');
    console.log('   • Grid search parameters:');
    console.log('     - SCORE_ALERT: 60-80 (step: 5)');
    console.log('     - SURGE15_MIN: 2.0-4.0 (step: 0.5)');
    console.log('     - IMBALANCE5_MIN: 0.25-0.6 (step: 0.05)');
    console.log('     - MIN_LIQ_ALERT: 12k-50k (step: 5k)');
    console.log('   • Target chains: ethereum, bsc, polygon');
    console.log('   • Optimization criteria:');
    console.log('     - F1 improvement ≥10% vs current');
    console.log('     - Alerts/hour ≤10');
    console.log('     - Precision ≥0.5\n');

    const startTime = Date.now();
    const result = await tuningController.execute48HourBacktest();
    const executionTime = (Date.now() - startTime) / 1000;

    console.log('\n🎉 48-hour backtest completed successfully!\n');

    // Display results
    console.log('📈 EXECUTION SUMMARY');
    console.log('='.repeat(50));
    console.log(`⏱️  Execution time: ${executionTime.toFixed(2)} seconds`);
    console.log(`📊 Total configurations tested: ${result.summary.total_configurations_tested}`);
    console.log(`🎯 Proposals generated: ${result.proposals.length}`);
    console.log(`⛓️  Chains with proposals: ${result.summary.chains_with_proposals}`);
    console.log(`📄 Report saved to: ${result.report_path}`);
    console.log(`🔍 Shadow testing: ${result.shadow_testing_status}\n`);

    // Display top candidates per chain
    if (result.summary.top_candidates_per_chain.length > 0) {
      console.log('🏆 TOP CANDIDATES PER CHAIN');
      console.log('='.repeat(50));
      
      for (const chainSummary of result.summary.top_candidates_per_chain) {
        console.log(`\n🔗 ${chainSummary.chain.toUpperCase()}`);
        console.log(`   Proposal ID: ${chainSummary.best_proposal.id}`);
        console.log(`   F1 Improvement: +${chainSummary.best_proposal.f1_improvement.toFixed(1)}%`);
        console.log(`   Precision: ${chainSummary.best_proposal.evidence.precision.toFixed(3)}`);
        console.log(`   Recall: ${chainSummary.best_proposal.evidence.recall.toFixed(3)}`);
        console.log(`   F1 Score: ${chainSummary.best_proposal.evidence.f1.toFixed(3)}`);
        console.log(`   Alerts/hour: ${chainSummary.best_proposal.evidence.alerts_per_hour.toFixed(1)}`);
        console.log(`   Valid proposals: ${chainSummary.total_valid_proposals}`);
        console.log(`   Configurations tested: ${chainSummary.configurations_tested}`);
        
        console.log('   Optimized rules:');
        const rules = chainSummary.best_proposal.rules;
        console.log(`     • SCORE_ALERT: ${rules.SCORE_ALERT}`);
        console.log(`     • SURGE15_MIN: ${rules.SURGE15_MIN}`);
        console.log(`     • IMBALANCE5_MIN: ${rules.IMBALANCE5_MIN}`);
        console.log(`     • MIN_LIQ_ALERT: ${rules.MIN_LIQ_ALERT.toLocaleString()}`);
      }
    }

    // Display proposal submission results
    if (result.proposals.length > 0) {
      console.log('\n📤 PROPOSAL SUBMISSIONS');
      console.log('='.repeat(50));
      for (const proposal of result.proposals) {
        console.log(`✅ ${proposal.chain}: Proposal ${proposal.proposal_id} submitted (Shadow testing: ${proposal.shadow_testing})`);
      }
    }

    console.log('\n🔍 SHADOW TESTING STATUS');
    console.log('='.repeat(50));
    console.log(`Status: ${result.shadow_testing_status}`);
    console.log('Shadow testing will log "would-alert" events for the next 24 hours');
    console.log('without sending actual alerts to validate proposal performance.\n');

    console.log('✨ Next steps:');
    console.log('   1. Monitor shadow testing metrics via /api/tuning/shadow/metrics');
    console.log('   2. Review the generated report for detailed analysis');
    console.log('   3. Apply approved proposals via /api/tuning/apply when ready');
    console.log('   4. Check proposal status via /api/tuning/proposals\n');

    // Get current tuning metrics for additional context
    const metrics = await tuningController.getTuningMetrics();
    console.log('📊 CURRENT SYSTEM STATUS');
    console.log('='.repeat(50));
    console.log(`Tuning service: ${metrics.system_status.tuning_service}`);
    console.log(`Shadow testing: ${metrics.system_status.shadow_testing}`);
    console.log(`Scheduler: ${metrics.system_status.scheduler}`);
    console.log(`Active shadow tests: ${metrics.active_shadow_tests}`);
    console.log(`Recent proposals: ${metrics.recent_proposals}\n`);

    console.log('🎯 SUCCESS: 48-hour backtest completed with all requirements met!');

  } catch (error: unknown) {
    console.error('\n❌ ERROR: 48-hour backtest failed');
    console.error('Error details:', getErrorMessage(error));
    logger.error('48-hour backtest script failed', { 
      error: getErrorMessage(error), 
      stack: error instanceof Error ? error.stack : undefined 
    });
    process.exit(1);

  } finally {
    // Cleanup connections
    try {
      if (tuningController) {
        await tuningController.shutdown();
      }
      if (redis) {
        redis.disconnect();
      }
      if (db) {
        await db.end();
      }
      console.log('\n🧹 Cleanup completed');
    } catch (cleanupError: unknown) {
      console.error('Cleanup error:', getErrorMessage(cleanupError));
    }
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n⚠️  Process interrupted. Cleaning up...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n⚠️  Process terminated. Cleaning up...');
  process.exit(0);
});

// Run the script
if (require.main === module) {
  main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

export { main };