const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

console.log('Starting debug server...');

const app = express();
const PORT = process.env.PORT || 3001;

// Basic middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

console.log('Middleware configured...');

// Basic routes
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: Date.now(),
    service: 'debug-api',
    version: '1.0.0'
  });
});

app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    data: {
      chains: ['sol', 'eth', 'bsc', 'base'],
      refreshMs: 30000,
      radarOnly: process.env.RADAR_ONLY === 'true',
      enablePortfolioSim: process.env.ENABLE_PORTFOLIO_SIM === 'true',
      enableTradeActions: process.env.ENABLE_TRADE_ACTIONS === 'true',
      enableWalletIntegrations: process.env.ENABLE_ANY_WALLET_INTEGRATIONS === 'true',
      allowedRoutes: (process.env.PUBLIC_ROUTES || 'config,signals,search,health,listings').split(','),
      alertTypesEnabled: (process.env.ALERT_TYPES_ENABLED || 'RADAR_MOMENTUM,CEX_LISTING').split(','),
      environment: process.env.NODE_ENV || 'development'
    },
    timestamp: Date.now()
  });
});

console.log('Routes configured...');

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

console.log('Error handling configured...');

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 Debug API server running on port ${PORT}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/api/health`);
  console.log(`⚙️ Config: http://localhost:${PORT}/api/config`);
});

server.on('error', (error) => {
  console.error('Server error:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

console.log('Debug server setup complete!');