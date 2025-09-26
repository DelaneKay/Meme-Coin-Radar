console.log('Starting import test...');

try {
  console.log('1. Testing dotenv...');
  require('dotenv').config();
  console.log('✓ dotenv loaded');

  console.log('2. Testing express...');
  const express = require('express');
  console.log('✓ express loaded');

  console.log('3. Testing logger...');
  const { logger } = require('./dist/utils/logger');
  console.log('✓ logger loaded');

  console.log('4. Testing cache...');
  const { CacheManager } = require('./dist/utils/cache');
  console.log('✓ cache loaded');

  console.log('5. Testing orchestrator...');
  const { Orchestrator } = require('./dist/services/orchestrator');
  console.log('✓ orchestrator loaded');

  console.log('All imports successful!');
} catch (error) {
  console.error('Import failed:', error.message);
  console.error('Stack:', error.stack);
}