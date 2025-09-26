"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const metrics_1 = require("../utils/metrics");
const logger_1 = require("../utils/logger");
const circuitBreaker_1 = require("../utils/circuitBreaker");
const resilientHttp_1 = require("../utils/resilientHttp");
const ioredis_1 = __importDefault(require("ioredis"));
const router = (0, express_1.Router)();
async function checkRedis() {
    const start = Date.now();
    try {
        const redis = new ioredis_1.default(process.env.REDIS_URL || 'redis://localhost:6379', {
            connectTimeout: 5000,
            lazyConnect: true,
            maxRetriesPerRequest: 1
        });
        await redis.ping();
        const responseTime = Date.now() - start;
        const info = await redis.info('memory');
        const memoryMatch = info.match(/used_memory_human:(.+)/);
        const memoryUsed = memoryMatch ? memoryMatch[1].trim() : 'unknown';
        await redis.disconnect();
        return {
            name: 'redis',
            status: responseTime > 1000 ? 'degraded' : 'healthy',
            responseTime,
            details: {
                memoryUsed,
                url: process.env.REDIS_URL ? 'configured' : 'default'
            }
        };
    }
    catch (error) {
        return {
            name: 'redis',
            status: 'unhealthy',
            responseTime: Date.now() - start,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}
async function checkExternalAPIs() {
    const apis = [
        { name: 'dexscreener', url: 'https://api.dexscreener.com/latest/dex/tokens/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
        { name: 'goplus', url: 'https://api.gopluslabs.io/api/v1/supported_chains' },
        { name: 'birdeye', url: 'https://public-api.birdeye.so/public/tokenlist?sort_by=v24hUSD&sort_type=desc&offset=0&limit=1' }
    ];
    const results = [];
    for (const api of apis) {
        const start = Date.now();
        try {
            const response = await fetch(api.url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Meme-Coin-Radar/1.0',
                    ...(api.name === 'birdeye' && process.env.BIRDEYE_API_KEY ? {
                        'X-API-KEY': process.env.BIRDEYE_API_KEY
                    } : {})
                },
                signal: AbortSignal.timeout(5000)
            });
            const responseTime = Date.now() - start;
            const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
            results.push({
                name: api.name,
                status: response.ok ? (responseTime > 2000 ? 'degraded' : 'healthy') : 'unhealthy',
                responseTime,
                details: {
                    statusCode: response.status,
                    rateLimitRemaining: rateLimitRemaining ? parseInt(rateLimitRemaining) : null
                }
            });
        }
        catch (error) {
            results.push({
                name: api.name,
                status: 'unhealthy',
                responseTime: Date.now() - start,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
    return results;
}
router.get('/', async (req, res) => {
    const startTime = Date.now();
    try {
        const uptime = process.uptime();
        const memoryUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        const allMetrics = metrics_1.metrics.getAllMetrics();
        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: Math.floor(uptime),
            version: process.env.SERVICE_VERSION || '1.0.0',
            environment: process.env.NODE_ENV || 'development',
            system: {
                memory: {
                    used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
                    total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
                    external: Math.round(memoryUsage.external / 1024 / 1024),
                    rss: Math.round(memoryUsage.rss / 1024 / 1024)
                },
                cpu: {
                    user: cpuUsage.user,
                    system: cpuUsage.system
                }
            },
            metrics: {
                counters: allMetrics.counters.length,
                histograms: allMetrics.histograms.length,
                gauges: allMetrics.gauges.length
            },
            responseTime: Date.now() - startTime
        };
        res.status(200).json(health);
    }
    catch (error) {
        logger_1.logger.error('Health check failed', { error });
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'Unknown error',
            responseTime: Date.now() - startTime
        });
    }
});
router.get('/detailed', async (req, res) => {
    const startTime = Date.now();
    try {
        const uptime = process.uptime();
        const memoryUsage = process.memoryUsage();
        const [redisHealth, apiHealths] = await Promise.all([
            checkRedis(),
            checkExternalAPIs()
        ]);
        const circuitBreakers = circuitBreaker_1.circuitBreakerManager.getStatus();
        const httpClients = resilientHttp_1.HttpClientFactory.getHealthStatus();
        const dependencies = [redisHealth, ...apiHealths];
        const unhealthyDeps = dependencies.filter(dep => dep.status === 'unhealthy');
        const degradedDeps = dependencies.filter(dep => dep.status === 'degraded');
        let overallStatus;
        if (unhealthyDeps.length > 0) {
            overallStatus = 'unhealthy';
        }
        else if (degradedDeps.length > 0) {
            overallStatus = 'degraded';
        }
        else {
            overallStatus = 'healthy';
        }
        const allMetrics = metrics_1.metrics.getAllMetrics();
        const health = {
            status: overallStatus,
            timestamp: new Date().toISOString(),
            uptime: Math.floor(uptime),
            version: process.env.SERVICE_VERSION || '1.0.0',
            environment: process.env.NODE_ENV || 'development',
            system: {
                memory: {
                    used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
                    total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
                    external: Math.round(memoryUsage.external / 1024 / 1024),
                    rss: Math.round(memoryUsage.rss / 1024 / 1024),
                    utilization: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100)
                },
                node: {
                    version: process.version,
                    platform: process.platform,
                    arch: process.arch
                }
            },
            dependencies,
            resiliency: {
                circuitBreakers,
                httpClients
            },
            metrics: {
                summary: {
                    counters: allMetrics.counters.length,
                    histograms: allMetrics.histograms.length,
                    gauges: allMetrics.gauges.length
                },
                recent: {
                    httpRequests: allMetrics.counters.find(c => c.name === 'http_requests_total')?.value || 0,
                    apiCalls: allMetrics.counters.find(c => c.name === 'api_calls_total')?.value || 0,
                    errors: allMetrics.counters.find(c => c.name === 'http_requests_error')?.value || 0
                }
            },
            responseTime: Date.now() - startTime
        };
        const statusCode = overallStatus === 'healthy' ? 200 : overallStatus === 'degraded' ? 200 : 503;
        res.status(statusCode).json(health);
    }
    catch (error) {
        logger_1.logger.error('Detailed health check failed', { error });
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'Unknown error',
            responseTime: Date.now() - startTime
        });
    }
});
router.get('/metrics', async (req, res) => {
    try {
        const allMetrics = metrics_1.metrics.getAllMetrics();
        const format = req.query.format;
        if (format === 'prometheus') {
            let output = '';
            allMetrics.counters.forEach(counter => {
                output += `# TYPE ${counter.name} counter\n`;
                output += `${counter.name} ${counter.value}\n`;
            });
            allMetrics.gauges.forEach(gauge => {
                output += `# TYPE ${gauge.name} gauge\n`;
                output += `${gauge.name} ${gauge.value}\n`;
            });
            allMetrics.histograms.forEach(histogram => {
                if (histogram.stats) {
                    output += `# TYPE ${histogram.name}_duration_seconds histogram\n`;
                    output += `${histogram.name}_duration_seconds_count ${histogram.stats.count}\n`;
                    output += `${histogram.name}_duration_seconds_sum ${histogram.stats.sum / 1000}\n`;
                }
            });
            res.setHeader('Content-Type', 'text/plain');
            res.send(output);
        }
        else {
            res.json({
                timestamp: new Date().toISOString(),
                metrics: allMetrics
            });
        }
    }
    catch (error) {
        logger_1.logger.error('Metrics endpoint failed', { error });
        res.status(500).json({
            error: 'Failed to retrieve metrics',
            timestamp: new Date().toISOString()
        });
    }
});
router.get('/ready', async (req, res) => {
    try {
        const redisHealth = await checkRedis();
        if (redisHealth.status === 'unhealthy') {
            return res.status(503).json({
                ready: false,
                reason: 'Redis unavailable',
                timestamp: new Date().toISOString()
            });
        }
        res.json({
            ready: true,
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        res.status(503).json({
            ready: false,
            reason: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
        });
    }
});
router.get('/live', (req, res) => {
    res.json({
        alive: true,
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});
exports.default = router;
//# sourceMappingURL=health.js.map