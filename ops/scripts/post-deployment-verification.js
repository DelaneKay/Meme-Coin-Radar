#!/usr/bin/env node

/**
 * Post-Deployment Verification Script
 * Comprehensive testing suite to validate system functionality after deployment
 */

const axios = require('axios');
const WebSocket = require('ws');
const { performance } = require('perf_hooks');
const fs = require('fs').promises;
const path = require('path');

// Configuration
const CONFIG = {
  environments: {
    production: {
      api: 'https://meme-coin-radar-api.onrender.com',
      frontend: 'https://meme-coin-radar.vercel.app',
      websocket: 'wss://meme-coin-radar-api.onrender.com'
    },
    staging: {
      api: 'https://meme-coin-radar-api-staging.onrender.com',
      frontend: 'https://meme-coin-radar-staging.vercel.app',
      websocket: 'wss://meme-coin-radar-api-staging.onrender.com'
    },
    development: {
      api: 'http://localhost:3000',
      frontend: 'http://localhost:5173',
      websocket: 'ws://localhost:3000'
    }
  },
  timeouts: {
    api: 30000,
    websocket: 10000,
    frontend: 15000
  },
  thresholds: {
    responseTime: 2000,
    errorRate: 0.05,
    uptime: 0.99
  }
};

class DeploymentVerifier {
  constructor(environment = 'production') {
    this.environment = environment;
    this.config = CONFIG.environments[environment];
    this.results = {
      timestamp: new Date().toISOString(),
      environment,
      tests: [],
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        warnings: 0
      }
    };
  }

  /**
   * Run all verification tests
   */
  async verify() {
    console.log(`🚀 Starting post-deployment verification for ${this.environment}`);
    console.log(`📍 API: ${this.config.api}`);
    console.log(`📍 Frontend: ${this.config.frontend}`);
    console.log(`📍 WebSocket: ${this.config.websocket}`);
    console.log('');

    try {
      // Core API Tests
      await this.testHealthEndpoints();
      await this.testAuthentication();
      await this.testRateLimiting();
      await this.testSecurityEndpoints();
      
      // Functional Tests
      await this.testRadarEndpoints();
      await this.testSentinelEndpoints();
      await this.testWebSocketConnection();
      
      // Performance Tests
      await this.testResponseTimes();
      await this.testLoadCapacity();
      
      // Integration Tests
      await this.testExternalAPIs();
      await this.testDatabaseConnectivity();
      await this.testCacheConnectivity();
      
      // Frontend Tests
      await this.testFrontendAvailability();
      await this.testFrontendFunctionality();
      
      // Security Tests
      await this.testSecurityHeaders();
      await this.testInputValidation();
      
      // Monitoring Tests
      await this.testMetricsEndpoints();
      await this.testAlertingSystem();

      // Generate report
      await this.generateReport();
      
      return this.results;

    } catch (error) {
      console.error('❌ Verification failed:', error);
      this.addTest('verification-process', false, `Verification process failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Test health endpoints
   */
  async testHealthEndpoints() {
    console.log('🔍 Testing health endpoints...');
    
    const endpoints = [
      '/health',
      '/health/detailed',
      '/health/ready',
      '/health/live'
    ];

    for (const endpoint of endpoints) {
      try {
        const start = performance.now();
        const response = await axios.get(`${this.config.api}${endpoint}`, {
          timeout: CONFIG.timeouts.api
        });
        const duration = performance.now() - start;

        const passed = response.status === 200 && response.data.status === 'healthy';
        this.addTest(`health-${endpoint.replace('/', '-')}`, passed, 
          passed ? `Response time: ${duration.toFixed(2)}ms` : `Status: ${response.status}`);

      } catch (error) {
        this.addTest(`health-${endpoint.replace('/', '-')}`, false, error.message);
      }
    }
  }

  /**
   * Test authentication system
   */
  async testAuthentication() {
    console.log('🔐 Testing authentication...');
    
    try {
      // Test login endpoint
      const loginResponse = await axios.post(`${this.config.api}/api/auth/login`, {
        email: 'test@example.com',
        password: 'testpassword123'
      });

      const hasToken = loginResponse.data && loginResponse.data.token;
      this.addTest('auth-login', hasToken, hasToken ? 'Login successful' : 'No token returned');

      if (hasToken) {
        // Test protected endpoint
        const token = loginResponse.data.token;
        const protectedResponse = await axios.get(`${this.config.api}/api/auth/profile`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        this.addTest('auth-protected', protectedResponse.status === 200, 
          `Protected endpoint status: ${protectedResponse.status}`);
      }

    } catch (error) {
      this.addTest('auth-system', false, error.message);
    }
  }

  /**
   * Test rate limiting
   */
  async testRateLimiting() {
    console.log('⏱️ Testing rate limiting...');
    
    try {
      const requests = [];
      const endpoint = `${this.config.api}/api/tokens/search`;
      
      // Send multiple requests quickly
      for (let i = 0; i < 10; i++) {
        requests.push(
          axios.get(endpoint, { 
            params: { q: 'test' },
            validateStatus: () => true // Don't throw on 429
          })
        );
      }

      const responses = await Promise.all(requests);
      const rateLimited = responses.some(r => r.status === 429);
      
      this.addTest('rate-limiting', rateLimited, 
        rateLimited ? 'Rate limiting active' : 'Rate limiting not triggered');

    } catch (error) {
      this.addTest('rate-limiting', false, error.message);
    }
  }

  /**
   * Test security endpoints
   */
  async testSecurityEndpoints() {
    console.log('🛡️ Testing security endpoints...');
    
    const endpoints = [
      '/api/security/dashboard',
      '/api/security/events',
      '/api/security/alerts'
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await axios.get(`${this.config.api}${endpoint}`, {
          timeout: CONFIG.timeouts.api,
          validateStatus: () => true
        });

        // Security endpoints should require authentication
        const requiresAuth = response.status === 401 || response.status === 403;
        this.addTest(`security-${endpoint.split('/').pop()}`, requiresAuth,
          requiresAuth ? 'Properly protected' : `Unexpected status: ${response.status}`);

      } catch (error) {
        this.addTest(`security-${endpoint.split('/').pop()}`, false, error.message);
      }
    }
  }

  /**
   * Test radar endpoints
   */
  async testRadarEndpoints() {
    console.log('📡 Testing radar endpoints...');
    
    const chains = ['solana', 'ethereum', 'bsc', 'base'];
    
    for (const chain of chains) {
      try {
        const response = await axios.get(`${this.config.api}/api/radar/${chain}`, {
          timeout: CONFIG.timeouts.api
        });

        const hasData = response.status === 200 && Array.isArray(response.data);
        this.addTest(`radar-${chain}`, hasData,
          hasData ? `Found ${response.data.length} tokens` : `Status: ${response.status}`);

      } catch (error) {
        this.addTest(`radar-${chain}`, false, error.message);
      }
    }
  }

  /**
   * Test sentinel endpoints
   */
  async testSentinelEndpoints() {
    console.log('👁️ Testing sentinel endpoints...');
    
    try {
      const response = await axios.get(`${this.config.api}/api/sentinel/events`, {
        timeout: CONFIG.timeouts.api
      });

      const hasData = response.status === 200;
      this.addTest('sentinel-events', hasData, `Status: ${response.status}`);

    } catch (error) {
      this.addTest('sentinel-events', false, error.message);
    }
  }

  /**
   * Test WebSocket connection
   */
  async testWebSocketConnection() {
    console.log('🔌 Testing WebSocket connection...');
    
    return new Promise((resolve) => {
      try {
        const ws = new WebSocket(`${this.config.websocket}/ws`);
        let connected = false;
        let messageReceived = false;

        const timeout = setTimeout(() => {
          ws.close();
          this.addTest('websocket-connection', connected, 
            connected ? 'Connected but no data' : 'Connection timeout');
          resolve();
        }, CONFIG.timeouts.websocket);

        ws.on('open', () => {
          connected = true;
          ws.send(JSON.stringify({ type: 'ping' }));
        });

        ws.on('message', (data) => {
          messageReceived = true;
          clearTimeout(timeout);
          ws.close();
          this.addTest('websocket-connection', true, 'Connected and receiving data');
          resolve();
        });

        ws.on('error', (error) => {
          clearTimeout(timeout);
          this.addTest('websocket-connection', false, error.message);
          resolve();
        });

      } catch (error) {
        this.addTest('websocket-connection', false, error.message);
        resolve();
      }
    });
  }

  /**
   * Test response times
   */
  async testResponseTimes() {
    console.log('⚡ Testing response times...');
    
    const endpoints = [
      '/health',
      '/api/radar/solana',
      '/api/tokens/search?q=test'
    ];

    for (const endpoint of endpoints) {
      try {
        const start = performance.now();
        await axios.get(`${this.config.api}${endpoint}`, {
          timeout: CONFIG.timeouts.api
        });
        const duration = performance.now() - start;

        const withinThreshold = duration < CONFIG.thresholds.responseTime;
        this.addTest(`response-time-${endpoint.split('/').pop() || 'health'}`, 
          withinThreshold, `${duration.toFixed(2)}ms`);

      } catch (error) {
        this.addTest(`response-time-${endpoint.split('/').pop() || 'health'}`, 
          false, error.message);
      }
    }
  }

  /**
   * Test load capacity
   */
  async testLoadCapacity() {
    console.log('🏋️ Testing load capacity...');
    
    try {
      const concurrentRequests = 20;
      const requests = [];
      
      for (let i = 0; i < concurrentRequests; i++) {
        requests.push(
          axios.get(`${this.config.api}/health`, {
            timeout: CONFIG.timeouts.api,
            validateStatus: () => true
          })
        );
      }

      const start = performance.now();
      const responses = await Promise.all(requests);
      const duration = performance.now() - start;

      const successCount = responses.filter(r => r.status === 200).length;
      const successRate = successCount / concurrentRequests;

      this.addTest('load-capacity', successRate > 0.8, 
        `${successCount}/${concurrentRequests} requests succeeded in ${duration.toFixed(2)}ms`);

    } catch (error) {
      this.addTest('load-capacity', false, error.message);
    }
  }

  /**
   * Test external APIs
   */
  async testExternalAPIs() {
    console.log('🌐 Testing external API connectivity...');
    
    try {
      const response = await axios.get(`${this.config.api}/api/health/external`, {
        timeout: CONFIG.timeouts.api
      });

      const allHealthy = response.data && 
        Object.values(response.data).every(status => status === 'healthy');
      
      this.addTest('external-apis', allHealthy, 
        allHealthy ? 'All external APIs healthy' : 'Some external APIs unhealthy');

    } catch (error) {
      this.addTest('external-apis', false, error.message);
    }
  }

  /**
   * Test database connectivity
   */
  async testDatabaseConnectivity() {
    console.log('🗄️ Testing database connectivity...');
    
    try {
      const response = await axios.get(`${this.config.api}/api/health/database`, {
        timeout: CONFIG.timeouts.api
      });

      const connected = response.status === 200 && response.data.status === 'connected';
      this.addTest('database-connectivity', connected, 
        connected ? 'Database connected' : `Status: ${response.data?.status || 'unknown'}`);

    } catch (error) {
      this.addTest('database-connectivity', false, error.message);
    }
  }

  /**
   * Test cache connectivity
   */
  async testCacheConnectivity() {
    console.log('💾 Testing cache connectivity...');
    
    try {
      const response = await axios.get(`${this.config.api}/api/health/cache`, {
        timeout: CONFIG.timeouts.api
      });

      const connected = response.status === 200 && response.data.status === 'connected';
      this.addTest('cache-connectivity', connected,
        connected ? 'Cache connected' : `Status: ${response.data?.status || 'unknown'}`);

    } catch (error) {
      this.addTest('cache-connectivity', false, error.message);
    }
  }

  /**
   * Test frontend availability
   */
  async testFrontendAvailability() {
    console.log('🌐 Testing frontend availability...');
    
    try {
      const response = await axios.get(this.config.frontend, {
        timeout: CONFIG.timeouts.frontend
      });

      const available = response.status === 200;
      this.addTest('frontend-availability', available, `Status: ${response.status}`);

    } catch (error) {
      this.addTest('frontend-availability', false, error.message);
    }
  }

  /**
   * Test frontend functionality
   */
  async testFrontendFunctionality() {
    console.log('⚙️ Testing frontend functionality...');
    
    try {
      // Test if frontend can reach API
      const response = await axios.get(`${this.config.frontend}/api/health`, {
        timeout: CONFIG.timeouts.frontend,
        validateStatus: () => true
      });

      // Frontend should proxy to API or return 404 for unknown routes
      const functional = response.status === 200 || response.status === 404;
      this.addTest('frontend-functionality', functional, `API proxy status: ${response.status}`);

    } catch (error) {
      this.addTest('frontend-functionality', false, error.message);
    }
  }

  /**
   * Test security headers
   */
  async testSecurityHeaders() {
    console.log('🔒 Testing security headers...');
    
    try {
      const response = await axios.get(`${this.config.api}/health`);
      const headers = response.headers;

      const requiredHeaders = [
        'x-content-type-options',
        'x-frame-options',
        'x-xss-protection',
        'strict-transport-security'
      ];

      const missingHeaders = requiredHeaders.filter(header => !headers[header]);
      const allPresent = missingHeaders.length === 0;

      this.addTest('security-headers', allPresent,
        allPresent ? 'All security headers present' : `Missing: ${missingHeaders.join(', ')}`);

    } catch (error) {
      this.addTest('security-headers', false, error.message);
    }
  }

  /**
   * Test input validation
   */
  async testInputValidation() {
    console.log('✅ Testing input validation...');
    
    try {
      // Test with malicious input
      const maliciousInputs = [
        '<script>alert("xss")</script>',
        '"; DROP TABLE users; --',
        '../../../etc/passwd'
      ];

      let validationWorking = true;
      
      for (const input of maliciousInputs) {
        const response = await axios.get(`${this.config.api}/api/tokens/search`, {
          params: { q: input },
          validateStatus: () => true
        });

        // Should return 400 for malicious input or sanitize it
        if (response.status === 200 && response.data.includes(input)) {
          validationWorking = false;
          break;
        }
      }

      this.addTest('input-validation', validationWorking,
        validationWorking ? 'Input validation working' : 'Input validation bypassed');

    } catch (error) {
      this.addTest('input-validation', false, error.message);
    }
  }

  /**
   * Test metrics endpoints
   */
  async testMetricsEndpoints() {
    console.log('📊 Testing metrics endpoints...');
    
    try {
      const response = await axios.get(`${this.config.api}/metrics`, {
        timeout: CONFIG.timeouts.api
      });

      const hasMetrics = response.status === 200 && response.data.includes('# HELP');
      this.addTest('metrics-endpoint', hasMetrics,
        hasMetrics ? 'Metrics available' : `Status: ${response.status}`);

    } catch (error) {
      this.addTest('metrics-endpoint', false, error.message);
    }
  }

  /**
   * Test alerting system
   */
  async testAlertingSystem() {
    console.log('🚨 Testing alerting system...');
    
    try {
      // This is a basic test - in production you'd want more sophisticated testing
      const response = await axios.get(`${this.config.api}/api/security/alerts`, {
        timeout: CONFIG.timeouts.api,
        validateStatus: () => true
      });

      // Endpoint should exist (even if it requires auth)
      const endpointExists = response.status !== 404;
      this.addTest('alerting-system', endpointExists,
        endpointExists ? 'Alerting endpoint available' : 'Alerting endpoint not found');

    } catch (error) {
      this.addTest('alerting-system', false, error.message);
    }
  }

  /**
   * Add test result
   */
  addTest(name, passed, message = '') {
    const test = {
      name,
      passed,
      message,
      timestamp: new Date().toISOString()
    };

    this.results.tests.push(test);
    this.results.summary.total++;
    
    if (passed) {
      this.results.summary.passed++;
      console.log(`  ✅ ${name}: ${message}`);
    } else {
      this.results.summary.failed++;
      console.log(`  ❌ ${name}: ${message}`);
    }
  }

  /**
   * Generate verification report
   */
  async generateReport() {
    console.log('\n📋 Generating verification report...');
    
    const successRate = this.results.summary.passed / this.results.summary.total;
    this.results.summary.successRate = successRate;
    this.results.summary.status = successRate >= 0.9 ? 'PASS' : successRate >= 0.7 ? 'WARNING' : 'FAIL';

    // Create report
    const report = {
      ...this.results,
      recommendations: this.generateRecommendations()
    };

    // Save report
    const reportPath = path.join(__dirname, `../reports/verification-${this.environment}-${Date.now()}.json`);
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

    // Print summary
    console.log('\n📊 Verification Summary:');
    console.log(`Environment: ${this.environment}`);
    console.log(`Total Tests: ${this.results.summary.total}`);
    console.log(`Passed: ${this.results.summary.passed}`);
    console.log(`Failed: ${this.results.summary.failed}`);
    console.log(`Success Rate: ${(successRate * 100).toFixed(1)}%`);
    console.log(`Status: ${this.results.summary.status}`);
    console.log(`Report saved: ${reportPath}`);

    if (this.results.summary.failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.results.tests
        .filter(test => !test.passed)
        .forEach(test => console.log(`  - ${test.name}: ${test.message}`));
    }

    return report;
  }

  /**
   * Generate recommendations based on test results
   */
  generateRecommendations() {
    const recommendations = [];
    const failedTests = this.results.tests.filter(test => !test.passed);

    if (failedTests.some(test => test.name.includes('health'))) {
      recommendations.push('Check application health and ensure all services are running');
    }

    if (failedTests.some(test => test.name.includes('auth'))) {
      recommendations.push('Verify authentication system configuration and database connectivity');
    }

    if (failedTests.some(test => test.name.includes('database'))) {
      recommendations.push('Check database connection and credentials');
    }

    if (failedTests.some(test => test.name.includes('cache'))) {
      recommendations.push('Verify Redis/cache service is running and accessible');
    }

    if (failedTests.some(test => test.name.includes('external'))) {
      recommendations.push('Check external API keys and network connectivity');
    }

    if (failedTests.some(test => test.name.includes('response-time'))) {
      recommendations.push('Investigate performance issues and consider scaling resources');
    }

    if (failedTests.some(test => test.name.includes('security'))) {
      recommendations.push('Review security configuration and ensure proper headers are set');
    }

    return recommendations;
  }
}

// CLI interface
if (require.main === module) {
  const environment = process.argv[2] || 'production';
  
  const verifier = new DeploymentVerifier(environment);
  verifier.verify()
    .then((results) => {
      process.exit(results.summary.status === 'FAIL' ? 1 : 0);
    })
    .catch((error) => {
      console.error('Verification failed:', error);
      process.exit(1);
    });
}

module.exports = DeploymentVerifier;