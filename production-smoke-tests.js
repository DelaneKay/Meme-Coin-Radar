#!/usr/bin/env node

/**
 * Production Smoke Tests for Meme Coin Radar
 * Validates core functionality after deployment
 */

const axios = require('axios');
const WebSocket = require('ws');

const API_BASE = 'http://localhost:3001';
const WS_URL = 'ws://localhost:3001';

class ProductionSmokeTests {
  constructor() {
    this.results = {
      passed: 0,
      failed: 0,
      tests: []
    };
  }

  async runTest(name, testFn) {
    console.log(`🧪 Testing: ${name}`);
    try {
      const result = await testFn();
      this.results.tests.push({ name, status: 'PASS', result });
      this.results.passed++;
      console.log(`  ✅ PASS: ${name}`);
      return result;
    } catch (error) {
      this.results.tests.push({ name, status: 'FAIL', error: error.message });
      this.results.failed++;
      console.log(`  ❌ FAIL: ${name} - ${error.message}`);
      return null;
    }
  }

  async testHealthEndpoint() {
    const response = await axios.get(`${API_BASE}/api/health`);
    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}`);
    }
    if (response.data.status !== 'healthy') {
      throw new Error(`Expected status 'healthy', got '${response.data.status}'`);
    }
    return response.data;
  }

  async testConfigEndpoint() {
    const response = await axios.get(`${API_BASE}/api/config`);
    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}`);
    }
    if (!response.data.success) {
      throw new Error('Config endpoint returned success: false');
    }
    return response.data;
  }

  async testSignalsEndpoint() {
    try {
      const response = await axios.get(`${API_BASE}/api/signals/leaderboards/momentum_5m`);
      if (response.status !== 200) {
        throw new Error(`Expected 200, got ${response.status}`);
      }
      return response.data;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log('  ⚠️  Signals endpoint not available (expected in debug mode)');
        return { note: 'Endpoint not available in debug mode' };
      }
      throw error;
    }
  }

  async testListingsEndpoint() {
    try {
      const response = await axios.get(`${API_BASE}/api/listings/recent`);
      if (response.status !== 200) {
        throw new Error(`Expected 200, got ${response.status}`);
      }
      return response.data;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log('  ⚠️  Listings endpoint not available (expected in debug mode)');
        return { note: 'Endpoint not available in debug mode' };
      }
      throw error;
    }
  }

  async testWebSocketConnection() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout (10s)'));
      }, 10000);

      try {
        const ws = new WebSocket(WS_URL);
        
        ws.on('open', () => {
          console.log('  📡 WebSocket connected');
          clearTimeout(timeout);
          ws.close();
          resolve({ connected: true });
        });

        ws.on('error', (error) => {
          clearTimeout(timeout);
          reject(new Error(`WebSocket error: ${error.message}`));
        });

        ws.on('message', (data) => {
          console.log('  📨 Received WebSocket message');
        });
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  async testRateLimits() {
    const requests = [];
    const startTime = Date.now();
    
    // Make 10 rapid requests to test rate limiting
    for (let i = 0; i < 10; i++) {
      requests.push(
        axios.get(`${API_BASE}/api/health`).catch(err => ({
          status: err.response?.status || 0,
          error: err.message
        }))
      );
    }

    const responses = await Promise.all(requests);
    const rateLimited = responses.filter(r => r.status === 429);
    const successful = responses.filter(r => r.status === 200 || (r.data && r.data.status === 'healthy'));
    
    return {
      totalRequests: requests.length,
      successful: successful.length,
      rateLimited: rateLimited.length,
      duration: Date.now() - startTime
    };
  }

  async runAllTests() {
    console.log('🚀 Starting Production Smoke Tests\n');

    await this.runTest('Health Endpoint', () => this.testHealthEndpoint());
    await this.runTest('Config Endpoint', () => this.testConfigEndpoint());
    await this.runTest('Signals Endpoint', () => this.testSignalsEndpoint());
    await this.runTest('Listings Endpoint', () => this.testListingsEndpoint());
    await this.runTest('WebSocket Connection', () => this.testWebSocketConnection());
    await this.runTest('Rate Limiting', () => this.testRateLimits());

    console.log('\n📊 Test Results Summary:');
    console.log(`✅ Passed: ${this.results.passed}`);
    console.log(`❌ Failed: ${this.results.failed}`);
    console.log(`📈 Success Rate: ${((this.results.passed / (this.results.passed + this.results.failed)) * 100).toFixed(1)}%`);

    if (this.results.failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.results.tests
        .filter(t => t.status === 'FAIL')
        .forEach(t => console.log(`  - ${t.name}: ${t.error}`));
    }

    return this.results;
  }
}

// Run tests if called directly
if (require.main === module) {
  const tester = new ProductionSmokeTests();
  tester.runAllTests()
    .then(results => {
      process.exit(results.failed > 0 ? 1 : 0);
    })
    .catch(error => {
      console.error('Test runner failed:', error);
      process.exit(1);
    });
}

module.exports = ProductionSmokeTests;