#!/usr/bin/env node

/**
 * Radar-Only Mode Test Script
 * Verifies that only allowed routes are accessible and others return 404
 */

const axios = require('axios');

const API_BASE = 'http://localhost:3001';

class RadarOnlyTester {
  constructor() {
    this.results = {
      allowedRoutes: [],
      blockedRoutes: [],
      configTest: null
    };
  }

  async testAllowedRoute(route, description) {
    try {
      console.log(`✅ Testing allowed route: ${route}`);
      const response = await axios.get(`${API_BASE}${route}`, { timeout: 5000 });
      
      const result = {
        route,
        description,
        status: response.status,
        success: response.status === 200,
        data: response.data
      };
      
      this.results.allowedRoutes.push(result);
      console.log(`  ✅ ${route}: ${response.status} - ${description}`);
      return result;
    } catch (error) {
      const result = {
        route,
        description,
        status: error.response?.status || 0,
        success: false,
        error: error.message
      };
      
      this.results.allowedRoutes.push(result);
      console.log(`  ❌ ${route}: ${error.response?.status || 'ERROR'} - ${error.message}`);
      return result;
    }
  }

  async testBlockedRoute(route, description) {
    try {
      console.log(`🚫 Testing blocked route: ${route}`);
      const response = await axios.get(`${API_BASE}${route}`, { timeout: 5000 });
      
      const result = {
        route,
        description,
        status: response.status,
        shouldBeBlocked: true,
        actuallyBlocked: false,
        data: response.data
      };
      
      this.results.blockedRoutes.push(result);
      console.log(`  ⚠️  ${route}: ${response.status} - Should be blocked but returned data`);
      return result;
    } catch (error) {
      const isBlocked = error.response?.status === 404;
      const result = {
        route,
        description,
        status: error.response?.status || 0,
        shouldBeBlocked: true,
        actuallyBlocked: isBlocked,
        error: error.message
      };
      
      this.results.blockedRoutes.push(result);
      console.log(`  ${isBlocked ? '✅' : '❌'} ${route}: ${error.response?.status || 'ERROR'} - ${isBlocked ? 'Correctly blocked' : error.message}`);
      return result;
    }
  }

  async testConfigEndpoint() {
    try {
      console.log('🔧 Testing config endpoint for radar-only flags...');
      const response = await axios.get(`${API_BASE}/api/config`);
      
      const config = response.data.data;
      const result = {
        status: response.status,
        radarOnly: config.radarOnly,
        enablePortfolioSim: config.enablePortfolioSim,
        enableTradeActions: config.enableTradeActions,
        enableWalletIntegrations: config.enableWalletIntegrations,
        allowedRoutes: config.allowedRoutes,
        alertTypesEnabled: config.alertTypesEnabled,
        environment: config.environment
      };
      
      this.results.configTest = result;
      
      console.log('  📊 Configuration flags:');
      console.log(`    RADAR_ONLY: ${result.radarOnly ? '✅ true' : '❌ false'}`);
      console.log(`    ENABLE_PORTFOLIO_SIM: ${result.enablePortfolioSim ? '❌ true' : '✅ false'}`);
      console.log(`    ENABLE_TRADE_ACTIONS: ${result.enableTradeActions ? '❌ true' : '✅ false'}`);
      console.log(`    ENABLE_WALLET_INTEGRATIONS: ${result.enableWalletIntegrations ? '❌ true' : '✅ false'}`);
      console.log(`    ENVIRONMENT: ${result.environment}`);
      console.log(`    ALLOWED_ROUTES: ${result.allowedRoutes.join(', ')}`);
      console.log(`    ALERT_TYPES: ${result.alertTypesEnabled.join(', ')}`);
      
      return result;
    } catch (error) {
      console.log(`  ❌ Config test failed: ${error.message}`);
      return null;
    }
  }

  async runAllTests() {
    console.log('🔒 Starting Radar-Only Mode Verification\n');

    // Test configuration endpoint
    await this.testConfigEndpoint();
    console.log('');

    // Test allowed routes
    console.log('📋 Testing Allowed Routes:');
    await this.testAllowedRoute('/api/config', 'Configuration endpoint');
    await this.testAllowedRoute('/api/signals/leaderboards/momentum_5m', 'Signals leaderboard');
    await this.testAllowedRoute('/api/search?q=test', 'Search endpoint');
    await this.testAllowedRoute('/api/health', 'Health check');
    await this.testAllowedRoute('/api/listings/recent', 'Recent listings');
    console.log('');

    // Test blocked routes (should return 404)
    console.log('🚫 Testing Blocked Routes (should return 404):');
    await this.testBlockedRoute('/api/portfolio/balance', 'Portfolio balance');
    await this.testBlockedRoute('/api/trading/execute', 'Trade execution');
    await this.testBlockedRoute('/api/wallet/connect', 'Wallet connection');
    await this.testBlockedRoute('/api/admin/users', 'Admin users');
    await this.testBlockedRoute('/api/tuning/backtest', 'Tuning backtest');
    await this.testBlockedRoute('/api/auth/login', 'Authentication');
    console.log('');

    // Summary
    const allowedPassed = this.results.allowedRoutes.filter(r => r.success).length;
    const allowedTotal = this.results.allowedRoutes.length;
    const blockedCorrectly = this.results.blockedRoutes.filter(r => r.actuallyBlocked).length;
    const blockedTotal = this.results.blockedRoutes.length;

    console.log('📊 Test Summary:');
    console.log(`  Allowed Routes: ${allowedPassed}/${allowedTotal} accessible`);
    console.log(`  Blocked Routes: ${blockedCorrectly}/${blockedTotal} correctly blocked`);
    
    const configValid = this.results.configTest && 
                       this.results.configTest.radarOnly && 
                       !this.results.configTest.enablePortfolioSim &&
                       !this.results.configTest.enableTradeActions &&
                       !this.results.configTest.enableWalletIntegrations;
    
    console.log(`  Config Flags: ${configValid ? '✅ Correct' : '❌ Incorrect'}`);

    const allTestsPassed = allowedPassed === allowedTotal && 
                          blockedCorrectly === blockedTotal && 
                          configValid;

    console.log(`\n🎯 Overall Status: ${allTestsPassed ? '✅ RADAR-ONLY MODE ACTIVE' : '❌ CONFIGURATION ISSUES'}`);

    return {
      success: allTestsPassed,
      allowedRoutes: this.results.allowedRoutes,
      blockedRoutes: this.results.blockedRoutes,
      configTest: this.results.configTest
    };
  }
}

// Run tests if called directly
if (require.main === module) {
  const tester = new RadarOnlyTester();
  tester.runAllTests()
    .then(results => {
      process.exit(results.success ? 0 : 1);
    })
    .catch(error => {
      console.error('❌ Test runner failed:', error);
      process.exit(1);
    });
}

module.exports = RadarOnlyTester;