"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.orchestrator = exports.wss = exports.server = exports.app = void 0;
const express_1 = __importDefault(require("express"));
const compression_1 = __importDefault(require("compression"));
const http_1 = require("http");
const ws_1 = require("ws");
const dotenv_1 = __importDefault(require("dotenv"));
const logger_1 = require("./utils/logger");
const logging_1 = require("./middleware/logging");
const security_1 = require("./middleware/security");
const validation_1 = require("./utils/validation");
const metrics_1 = require("./utils/metrics");
const health_1 = require("./routes/health");
const gracefulShutdown_1 = require("./utils/gracefulShutdown");
const routes_1 = require("./routes");
const websocket_1 = require("./websocket");
const orchestrator_1 = require("./services/orchestrator");
const cache_1 = require("./utils/cache");
const rateLimiter_1 = require("./utils/rateLimiter");
dotenv_1.default.config();
const app = (0, express_1.default)();
exports.app = app;
const server = (0, http_1.createServer)(app);
exports.server = server;
const wss = new ws_1.WebSocketServer({ server });
exports.wss = wss;
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const cacheManager = new cache_1.CacheManager();
const rateLimitManager = new rateLimiter_1.RateLimitManager();
const orchestrator = new orchestrator_1.Orchestrator(cacheManager, rateLimitManager);
exports.orchestrator = orchestrator;
(0, security_1.setupSecurityMiddleware)(app);
app.use((0, compression_1.default)());
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
app.use(validation_1.sanitizeRequest);
const { errorMiddleware } = (0, logging_1.setupLoggingMiddleware)(app, {
    maxRequestSize: 10 * 1024 * 1024,
    skipPaths: ['/health', '/health/live', '/health/ready']
});
app.use('/health', health_1.healthRouter);
(0, routes_1.setupRoutes)(app, orchestrator, cacheManager);
(0, websocket_1.setupWebSocket)(wss, orchestrator);
let wsConnections = 0;
wss.on('connection', (ws) => {
    wsConnections++;
    (0, metrics_1.trackActiveConnections)('websocket', wsConnections);
    ws.on('close', () => {
        wsConnections--;
        (0, metrics_1.trackActiveConnections)('websocket', wsConnections);
    });
});
app.use(errorMiddleware);
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        timestamp: Date.now(),
    });
});
const gracefulShutdown = (0, gracefulShutdown_1.initializeGracefulShutdown)(server);
gracefulShutdown.addHandler({
    name: 'orchestrator',
    priority: 5,
    timeout: 10000,
    handler: async () => {
        logger_1.logger.info('Stopping orchestrator');
    }
});
gracefulShutdown.addHandler({
    name: 'websocket',
    priority: 15,
    timeout: 5000,
    handler: async () => {
        logger_1.logger.info('Closing WebSocket connections');
    }
});
server.listen(PORT, () => {
    logger_1.logger.info(`🚀 Meme Coin Radar API server running on port ${PORT}`, {
        type: 'server_start',
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        version: process.env.SERVICE_VERSION || '1.0.0'
    });
    logger_1.logger.info(`📊 Dashboard available at ${FRONTEND_URL}`);
    logger_1.logger.info(`🏥 Health checks available at http://localhost:${PORT}/health`);
    logger_1.logger.info(`📈 Metrics available at http://localhost:${PORT}/health/metrics`);
    (0, metrics_1.startMetricsReporting)(60000);
    orchestrator.start().catch((error) => {
        logger_1.logger.error('Failed to start orchestrator:', error);
        process.exit(1);
    });
});
//# sourceMappingURL=index.js.map