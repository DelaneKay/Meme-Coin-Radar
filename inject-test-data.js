// This script simulates the DataCollector emitting pair updates
// to test that the leaderboard population mechanism works

const EventEmitter = require('events');

// Mock normalized pair data that would come from DataCollector
const mockPairData = [
  {
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
  },
  {
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
  },
  {
    chainId: "bsc",
    token: {
      address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
      symbol: "DOGE",
      name: "Dogecoin"
    },
    pairAddress: "0x1B96B92314C44b159149f7E0303511fB2Fc4774f",
    stats: {
      buys_5: 203,
      sells_5: 156,
      vol_5_usd: 45000,
      vol_15_usd: 135000,
      price_usd: 0.000156,
      price_change_5m: 22.1,
      liquidity_usd: 280000,
      fdv_usd: 1200000,
      pair_created_at: Math.floor(Date.now() / 1000) - 1800 // 30 minutes ago
    },
    boosts_active: 2
  }
];

console.log('Mock pair data created:');
console.log('- POPCAT (SOL): +15.7% momentum, $25k vol, 1 hour old');
console.log('- SHIB (ETH): -8.3% momentum, $18k vol, 2 hours old');
console.log('- DOGE (BSC): +22.1% momentum, $45k vol, 30 minutes old');
console.log('\nThis data would normally be processed by the Orchestrator');
console.log('when the DataCollector emits "collector.pairs.updates" events.');
console.log('\nExpected leaderboard results:');
console.log('- new_mints: DOGE (newest), POPCAT, SHIB');
console.log('- momentum_5m: DOGE (+22.1%), POPCAT (+15.7%)');
console.log('- unusual_volume: DOGE ($45k), POPCAT ($25k), SHIB ($18k)');

// Note: We can't directly inject this into the running system without
// modifying the DataCollector or Orchestrator to accept external events.
// The system is designed to get data from real APIs.

console.log('\n✓ Mock data generation completed!');
console.log('To see real data, the DataCollector needs working API endpoints.');