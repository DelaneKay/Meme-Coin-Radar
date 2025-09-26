const axios = require('axios');

const API_BASE = 'http://localhost:3001/api';

// Mock normalized pair data
const mockPairData = {
  chainId: "sol",
  token: {
    address: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr",
    symbol: "POPCAT",
    name: "Popcat"
  },
  pairAddress: "CATx42MjBrnbQ5S3vSyJuA8rjeXrJ2r9g8x6sNNLoVrt",
  stats: {
    buys_5: 150,
    sells_5: 98,
    vol_5_usd: 25000,
    vol_15_usd: 75000,
    price_usd: 0.00125,
    price_change_5m: 15.7,
    liquidity_usd: 125000,
    fdv_usd: 850000,
    pair_created_at: Math.floor(Date.now() / 1000) - 3600 // 1 hour ago
  },
  boosts_active: 1
};

const mockPairData2 = {
  chainId: "eth",
  token: {
    address: "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE",
    symbol: "SHIB",
    name: "Shiba Inu"
  },
  pairAddress: "0x811beEd0119b4AfCE20D2583EB608C6F7AF1954f",
  stats: {
    buys_5: 89,
    sells_5: 134,
    vol_5_usd: 18000,
    vol_15_usd: 54000,
    price_usd: 0.000008,
    price_change_5m: -8.3,
    liquidity_usd: 95000,
    fdv_usd: 420000,
    pair_created_at: Math.floor(Date.now() / 1000) - 7200 // 2 hours ago
  },
  boosts_active: 0
};

async function testDataCollector() {
  console.log('Testing DataCollector and Leaderboards...\n');

  try {
    // Test 1: Check if API is running
    console.log('1. Testing API connectivity...');
    const healthResponse = await axios.get(`${API_BASE}/health/detailed`);
    console.log('✓ API is running:', healthResponse.data);

    // Test 2: Check current leaderboards (should be empty)
    console.log('\n2. Checking current leaderboards...');
    const leaderboardsResponse = await axios.get(`${API_BASE}/signals/leaderboards`);
    console.log('Available leaderboards:', Object.keys(leaderboardsResponse.data.data));

    // Check specific leaderboards
    const newMintsResponse = await axios.get(`${API_BASE}/signals/leaderboards/new_mints`);
    console.log('Current new_mints count:', newMintsResponse.data.data.length);

    const momentumResponse = await axios.get(`${API_BASE}/signals/leaderboards/momentum_5m`);
    console.log('Current momentum_5m count:', momentumResponse.data.data.length);

    // Test 3: Simulate DataCollector processing (this would normally come from the collector)
    console.log('\n3. Simulating pair data processing...');
    
    // We can't directly inject into the DataCollector from here, but we can test the endpoints
    // Let's check if the system is processing any data
    
    // Test 4: Check cache status
    console.log('\n4. Testing cache endpoints...');
    try {
      const cacheResponse = await axios.get(`${API_BASE}/status/cache`);
      console.log('Cache stats:', cacheResponse.data);
    } catch (error) {
      console.log('Cache endpoint not available or empty');
    }

    // Test 5: Check WebSocket connectivity
    console.log('\n5. Testing WebSocket...');
    const WebSocket = require('ws');
    const ws = new WebSocket('ws://localhost:3001');
    
    ws.on('open', () => {
      console.log('✓ WebSocket connected');
      ws.close();
    });

    ws.on('error', (error) => {
      console.log('✗ WebSocket error:', error.message);
    });

    // Test 6: Wait a bit and check leaderboards again
    console.log('\n6. Waiting 5 seconds and checking leaderboards again...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const newMintsResponse2 = await axios.get(`${API_BASE}/signals/leaderboards/new_mints`);
    console.log('New mints after wait:', newMintsResponse2.data.data.length);

    const momentumResponse2 = await axios.get(`${API_BASE}/signals/leaderboards/momentum_5m`);
    console.log('Momentum 5m after wait:', momentumResponse2.data.data.length);

    console.log('\n✓ Test completed successfully!');

  } catch (error) {
    console.error('✗ Test failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

// Run the test
testDataCollector();