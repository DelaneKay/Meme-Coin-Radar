const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3002;

app.use(cors());
app.use(express.json());

// Mock data storage
let proposals = [
  {
    proposal_id: "proposal_ethereum_1758840144227_0",
    chain: "ethereum",
    status: "shadow_testing",
    shadow_testing: true,
    created_at: "2025-01-26T10:00:00Z",
    rules: {
      SCORE_ALERT: 70,
      SURGE15_MIN: 2.5,
      IMBALANCE5_MIN: 0.35,
      MIN_LIQ_ALERT: 25000
    },
    evidence: {
      precision: 0.650,
      recall: 0.580,
      f1: 0.610,
      alerts_per_hour: 7.2,
      f1_improvement: 22.0
    },
    shadow_metrics: {
      duration_hours: 24,
      total_signals: 156,
      would_alert_count: 34,
      precision: 0.655,
      recall: 0.585,
      f1: 0.615,
      alerts_per_hour: 7.1
    }
  },
  {
    proposal_id: "proposal_bsc_1758840144232_1",
    chain: "bsc",
    status: "shadow_testing",
    shadow_testing: true,
    created_at: "2025-01-26T10:00:00Z",
    rules: {
      SCORE_ALERT: 72,
      SURGE15_MIN: 2.8,
      IMBALANCE5_MIN: 0.40,
      MIN_LIQ_ALERT: 30000
    },
    evidence: {
      precision: 0.700,
      recall: 0.610,
      f1: 0.650,
      alerts_per_hour: 6.4,
      f1_improvement: 30.0
    },
    shadow_metrics: {
      duration_hours: 24,
      total_signals: 142,
      would_alert_count: 28,
      precision: 0.705,
      recall: 0.615,
      f1: 0.655,
      alerts_per_hour: 6.2
    }
  },
  {
    proposal_id: "proposal_polygon_1758840144233_2",
    chain: "polygon",
    status: "shadow_testing",
    shadow_testing: true,
    created_at: "2025-01-26T10:00:00Z",
    rules: {
      SCORE_ALERT: 74,
      SURGE15_MIN: 3.1,
      IMBALANCE5_MIN: 0.45,
      MIN_LIQ_ALERT: 35000
    },
    evidence: {
      precision: 0.750,
      recall: 0.640,
      f1: 0.690,
      alerts_per_hour: 5.6,
      f1_improvement: 38.0
    },
    shadow_metrics: {
      duration_hours: 24,
      total_signals: 128,
      would_alert_count: 22,
      precision: 0.755,
      recall: 0.645,
      f1: 0.695,
      alerts_per_hour: 5.4
    }
  }
];

let currentConfig = {
  ethereum: {
    SCORE_ALERT: 65,
    SURGE15_MIN: 2.0,
    IMBALANCE5_MIN: 0.30,
    MIN_LIQ_ALERT: 20000
  },
  bsc: {
    SCORE_ALERT: 68,
    SURGE15_MIN: 2.2,
    IMBALANCE5_MIN: 0.32,
    MIN_LIQ_ALERT: 22000
  },
  polygon: {
    SCORE_ALERT: 70,
    SURGE15_MIN: 2.4,
    IMBALANCE5_MIN: 0.35,
    MIN_LIQ_ALERT: 25000
  }
};

let orchestratorFlag = true; // TUNING_CAN_APPLY

// GET /api/tuning/proposals
app.get('/api/tuning/proposals', (req, res) => {
  console.log('📋 GET /api/tuning/proposals - Fetching proposals');
  
  const { chain, status } = req.query;
  let filteredProposals = proposals;
  
  if (chain) {
    filteredProposals = filteredProposals.filter(p => p.chain === chain);
  }
  
  if (status) {
    filteredProposals = filteredProposals.filter(p => p.status === status);
  }
  
  res.json({
    success: true,
    proposals: filteredProposals,
    total: filteredProposals.length
  });
});

// GET /api/tuning/shadow/metrics
app.get('/api/tuning/shadow/metrics', (req, res) => {
  console.log('📊 GET /api/tuning/shadow/metrics - Fetching shadow metrics');
  
  const shadowMetrics = proposals.map(p => ({
    proposal_id: p.proposal_id,
    chain: p.chain,
    ...p.shadow_metrics
  }));
  
  res.json({
    success: true,
    metrics: shadowMetrics
  });
});

// POST /api/tuning/apply
app.post('/api/tuning/apply', (req, res) => {
  const { proposal_id } = req.body;
  
  console.log(`🚀 POST /api/tuning/apply - Applying proposal: ${proposal_id}`);
  
  if (!orchestratorFlag) {
    return res.status(403).json({
      success: false,
      error: 'TUNING_CAN_APPLY flag is false. Cannot apply proposals.'
    });
  }
  
  const proposal = proposals.find(p => p.proposal_id === proposal_id);
  
  if (!proposal) {
    return res.status(404).json({
      success: false,
      error: 'Proposal not found'
    });
  }
  
  // Update proposal status
  proposal.status = 'applied';
  proposal.applied_at = new Date().toISOString();
  
  // Update current config
  currentConfig[proposal.chain] = { ...proposal.rules };
  
  console.log(`✅ Applied ${proposal.chain} proposal with rules:`, proposal.rules);
  
  res.json({
    success: true,
    message: 'Proposal applied successfully',
    proposal_id: proposal_id,
    chain: proposal.chain,
    applied_rules: proposal.rules,
    applied_at: proposal.applied_at
  });
});

// POST /api/tuning/rollback
app.post('/api/tuning/rollback', (req, res) => {
  const { proposal_id } = req.body;
  
  console.log(`🔄 POST /api/tuning/rollback - Rolling back proposal: ${proposal_id}`);
  
  const proposal = proposals.find(p => p.proposal_id === proposal_id);
  
  if (!proposal) {
    return res.status(404).json({
      success: false,
      error: 'Proposal not found'
    });
  }
  
  // Revert to previous config (mock implementation)
  const previousConfig = {
    ethereum: { SCORE_ALERT: 65, SURGE15_MIN: 2.0, IMBALANCE5_MIN: 0.30, MIN_LIQ_ALERT: 20000 },
    bsc: { SCORE_ALERT: 68, SURGE15_MIN: 2.2, IMBALANCE5_MIN: 0.32, MIN_LIQ_ALERT: 22000 },
    polygon: { SCORE_ALERT: 70, SURGE15_MIN: 2.4, IMBALANCE5_MIN: 0.35, MIN_LIQ_ALERT: 25000 }
  };
  
  currentConfig[proposal.chain] = previousConfig[proposal.chain];
  proposal.status = 'rolled_back';
  proposal.rolled_back_at = new Date().toISOString();
  
  res.json({
    success: true,
    message: 'Proposal rolled back successfully',
    proposal_id: proposal_id,
    chain: proposal.chain,
    reverted_to: previousConfig[proposal.chain]
  });
});

// GET /api/config
app.get('/api/config', (req, res) => {
  console.log('⚙️ GET /api/config - Fetching current configuration');
  
  res.json({
    success: true,
    config: currentConfig,
    last_updated: new Date().toISOString()
  });
});

// GET /api/tuning/orchestrator/status
app.get('/api/tuning/orchestrator/status', (req, res) => {
  res.json({
    success: true,
    TUNING_CAN_APPLY: orchestratorFlag
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🎯 Mock Tuning API server running on http://localhost:${PORT}`);
  console.log(`📋 Available endpoints:`);
  console.log(`   GET  /api/tuning/proposals`);
  console.log(`   GET  /api/tuning/shadow/metrics`);
  console.log(`   POST /api/tuning/apply`);
  console.log(`   POST /api/tuning/rollback`);
  console.log(`   GET  /api/config`);
  console.log(`   GET  /api/tuning/orchestrator/status`);
  console.log(`   GET  /health`);
});