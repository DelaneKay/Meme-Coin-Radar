const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Basic middleware
app.use(helmet());
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: Date.now(),
    service: 'meme-coin-radar-api',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: Date.now()
  });
});

// Basic radar endpoints
app.get('/api/radar/hotlist', (req, res) => {
  res.json({
    success: true,
    data: [],
    timestamp: Date.now(),
    message: 'Minimal API - orchestrator not running'
  });
});

app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    data: {
      chains: (process.env.CHAINS || 'sol,eth,bsc,base').split(','),
      refreshMs: parseInt(process.env.REFRESH_MS || '30000'),
      radarOnly: process.env.RADAR_ONLY === 'true'
    },
    timestamp: Date.now()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    timestamp: Date.now(),
  });
});

// Error handler
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    timestamp: Date.now()
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Minimal Meme Coin Radar API server running on port ${PORT}`);
  console.log(`🏥 Health checks available at http://localhost:${PORT}/health`);
  console.log(`📊 API endpoints available at http://localhost:${PORT}/api/*`);
  console.log(`⚠️  Note: This is a minimal server - orchestrator and full features are disabled`);
});

module.exports = app;