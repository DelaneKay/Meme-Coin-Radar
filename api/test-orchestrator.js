console.log('Testing orchestrator startup...');

require('dotenv').config();

const { CacheManager } = require('./dist/utils/cache');
const { RateLimitManager } = require('./dist/utils/rateLimiter');
const { Orchestrator } = require('./dist/services/orchestrator');

async function testOrchestrator() {
  try {
    console.log('1. Creating cache manager...');
    const cacheManager = new CacheManager();
    console.log('✓ Cache manager created');

    console.log('2. Creating rate limit manager...');
    const rateLimitManager = new RateLimitManager();
    console.log('✓ Rate limit manager created');

    console.log('3. Creating orchestrator...');
    const orchestrator = new Orchestrator(cacheManager, rateLimitManager);
    console.log('✓ Orchestrator created');

    console.log('4. Starting orchestrator...');
    await orchestrator.start();
    console.log('✓ Orchestrator started successfully');

    // Stop after 5 seconds
    setTimeout(async () => {
      console.log('5. Stopping orchestrator...');
      await orchestrator.stop();
      console.log('✓ Orchestrator stopped');
      process.exit(0);
    }, 5000);

  } catch (error) {
    console.error('❌ Orchestrator test failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

testOrchestrator();