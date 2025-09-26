import { Router, Request, Response } from 'express';
import { metrics } from '../utils/metrics';
import { logger } from '../utils/logger';
import { cache } from '../utils/cache';
import { circuitBreakerManager } from '../utils/circuitBreaker';
import { HttpClientFactory } from '../utils/resilientHttp';
import Redis from 'ioredis';

const router = Router();

// Health check dependencies
interface HealthDependency {
  name: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  responseTime?: number;
  error?: string;
  details?: any;
}

// Check Redis connection
async function checkRedis(): Promise<HealthDependency> {
  const start = Date.now();
  
  try {
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      connectTimeout: 5000,
      lazyConnect: true,
      maxRetriesPerRequest: 1
    });
    
    await redis.ping();
    const responseTime = Date.now() - start;
    
    // Get Redis info
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
  } catch (error) {
    return {
      name: 'redis',
      status: 'unhealthy',
      responseTime: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Check external API endpoints
async function checkExternalAPIs(): Promise<HealthDependency[]> {
  const apis = [
    { name: 'dexscreener', url: 'https://api.dexscreener.com/latest/dex/tokens/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
    { name: 'goplus', url: 'https://api.gopluslabs.io/api/v1/supported_chains' },
    { name: 'birdeye', url: 'https://public-api.birdeye.so/public/tokenlist?sort_by=v24hUSD&sort_type=desc&offset=0&limit=1' }
  ];

  const results: HealthDependency[] = [];

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
    } catch (error) {
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

// Basic health endpoint
router.get('/', async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    // Basic system info
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // Get basic metrics
    const allMetrics = metrics.getAllMetrics();
    
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
  } catch (error) {
    logger.error('Health check failed', { error });
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
      responseTime: Date.now() - startTime
    });
  }
});

// Detailed health endpoint with dependency checks
router.get('/detailed', async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    // Basic system info
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();
    
    // Check dependencies
    const [redisHealth, apiHealths] = await Promise.all([
      checkRedis(),
      checkExternalAPIs()
    ]);
    
    // Get circuit breaker status
    const circuitBreakers = circuitBreakerManager.getStatus();
    
    // Get HTTP client health status
    const httpClients = HttpClientFactory.getHealthStatus();
    
    const dependencies = [redisHealth, ...apiHealths];
    const unhealthyDeps = dependencies.filter(dep => dep.status === 'unhealthy');
    const degradedDeps = dependencies.filter(dep => dep.status === 'degraded');
    
    // Determine overall status
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
    if (unhealthyDeps.length > 0) {
      overallStatus = 'unhealthy';
    } else if (degradedDeps.length > 0) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'healthy';
    }
    
    // Get detailed metrics
    const allMetrics = metrics.getAllMetrics();
    
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
    
  } catch (error) {
    logger.error('Detailed health check failed', { error });
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
      responseTime: Date.now() - startTime
    });
  }
});

// Metrics endpoint
router.get('/metrics', async (req: Request, res: Response) => {
  try {
    const allMetrics = metrics.getAllMetrics();
    
    // Format metrics for Prometheus-style output if requested
    const format = req.query.format as string;
    
    if (format === 'prometheus') {
      let output = '';
      
      // Counters
      allMetrics.counters.forEach(counter => {
        output += `# TYPE ${counter.name} counter\n`;
        output += `${counter.name} ${counter.value}\n`;
      });
      
      // Gauges
      allMetrics.gauges.forEach(gauge => {
        output += `# TYPE ${gauge.name} gauge\n`;
        output += `${gauge.name} ${gauge.value}\n`;
      });
      
      // Histograms (simplified)
      allMetrics.histograms.forEach(histogram => {
        if (histogram.stats) {
          output += `# TYPE ${histogram.name}_duration_seconds histogram\n`;
          output += `${histogram.name}_duration_seconds_count ${histogram.stats.count}\n`;
          output += `${histogram.name}_duration_seconds_sum ${histogram.stats.sum / 1000}\n`;
        }
      });
      
      res.setHeader('Content-Type', 'text/plain');
      res.send(output);
    } else {
      res.json({
        timestamp: new Date().toISOString(),
        metrics: allMetrics
      });
    }
  } catch (error) {
    logger.error('Metrics endpoint failed', { error });
    res.status(500).json({
      error: 'Failed to retrieve metrics',
      timestamp: new Date().toISOString()
    });
  }
});

// Readiness probe (for Kubernetes/container orchestration)
router.get('/ready', async (req: Request, res: Response): Promise<Response | void> => {
  try {
    // Check if essential services are ready
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
  } catch (error) {
    res.status(503).json({
      ready: false,
      reason: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// Liveness probe (for Kubernetes/container orchestration)
router.get('/live', (req: Request, res: Response) => {
  res.json({
    alive: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

export default router;