import dotenv from 'dotenv';
import { CEXSentinel } from './services/cexSentinel';
import { logger } from './utils/logger';

// Load environment variables
dotenv.config({ path: '../.env' });

async function main() {
  try {
    logger.info('🔍 Starting CEX Listing Sentinel...');
    
    const sentinel = new CEXSentinel();
    
    // Handle graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received, shutting down gracefully');
      await sentinel.stop();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.info('SIGINT received, shutting down gracefully');
      await sentinel.stop();
      process.exit(0);
    });

    // Start the sentinel
    await sentinel.start();
    
    logger.info('🚀 CEX Listing Sentinel started successfully');
    
  } catch (error) {
    logger.error('Failed to start CEX Listing Sentinel:', error);
    process.exit(1);
  }
}

main();