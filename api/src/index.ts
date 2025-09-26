import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';

import { logger } from './utils/logger';
import { setupLoggingMiddleware } from './middleware/logging';
import { setupSecurityMiddleware } from './middleware/security';
import { sanitizeRequest } from './utils/validation';
import { startMetricsReporting, trackActiveConnections } from './utils/metrics';
import healthRouter from './routes/health';
import { initializeGracefulShutdown } from './utils/gracefulShutdown';
import { setupRoutes } from './routes';
import { setupWebSocket } from './websocket';
import { Orchestrator } from './services/orchestrator';
import { CacheManager } from './utils/cache';
import { RateLimitManager } from './utils/rateLimiter';

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// Initialize core services
const cacheManager = new CacheManager();
const rateLimitManager = new RateLimitManager();
const orchestrator = new Orchestrator(cacheManager, rateLimitManager);

// Setup comprehensive security middleware
setupSecurityMiddleware(app);

// Compression middleware
app.use(compression());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request sanitization middleware
app.use(sanitizeRequest);

// Setup structured logging and metrics middleware
const { errorMiddleware } = setupLoggingMiddleware(app, {
  maxRequestSize: 10 * 1024 * 1024, // 10MB
  skipPaths: ['/health', '/health/live', '/health/ready']
});

// Health endpoints (before other routes for priority)
app.use('/health', healthRouter);

// Setup main application routes
setupRoutes(app, orchestrator, cacheManager);

// Setup WebSocket with connection tracking
setupWebSocket(wss, orchestrator);

// Track WebSocket connections for metrics
let wsConnections = 0;
wss.on('connection', (ws) => {
  wsConnections++;
  trackActiveConnections('websocket', wsConnections);
  
  ws.on('close', () => {
    wsConnections--;
    trackActiveConnections('websocket', wsConnections);
  });
});

// Error handling middleware (must be after routes)
app.use(errorMiddleware);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    timestamp: Date.now(),
  });
});

// Initialize graceful shutdown
const gracefulShutdown = initializeGracefulShutdown(server);

// Add custom shutdown handlers for this application
gracefulShutdown.addHandler({
  name: 'orchestrator',
  priority: 5,
  timeout: 10000,
  handler: async () => {
    logger.info('Stopping orchestrator');
    // Stop orchestrator if it has a stop method
    // orchestrator.stop();
  }
});

gracefulShutdown.addHandler({
  name: 'websocket',
  priority: 15,
  timeout: 5000,
  handler: async () => {
    logger.info('Closing WebSocket connections');
    // Close WebSocket connections if needed
  }
});

// Start server
server.listen(PORT, () => {
  logger.info(`🚀 Meme Coin Radar API server running on port ${PORT}`, {
    type: 'server_start',
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    version: process.env.SERVICE_VERSION || '1.0.0'
  });
  logger.info(`📊 Dashboard available at ${FRONTEND_URL}`);
  logger.info(`🏥 Health checks available at http://localhost:${PORT}/health`);
  logger.info(`📈 Metrics available at http://localhost:${PORT}/health/metrics`);
  
  // Start metrics reporting
  startMetricsReporting(60000); // Report every minute
  
  // Start the orchestrator
  orchestrator.start().catch((error) => {
    logger.error('Failed to start orchestrator:', error);
    process.exit(1);
  });
});

export { app, server, wss, orchestrator };