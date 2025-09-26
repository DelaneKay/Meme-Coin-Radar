# Performance Optimization Runbook - Meme Coin Radar

## Overview
This runbook provides guidelines for monitoring, analyzing, and optimizing the performance of the Meme Coin Radar system across all components.

## Performance Targets

### Response Time Targets
```javascript
// API Endpoints
GET /api/tokens/trending     < 1.5s (95th percentile)
GET /api/tokens/hotlist      < 1.0s (95th percentile)
GET /api/tokens/search       < 2.0s (95th percentile)
POST /api/tokens/analyze     < 3.0s (95th percentile)
WebSocket connections        < 500ms initial connection

// External API Calls
DEX Screener API            < 1.0s
GoPlus Security API         < 2.0s
Birdeye API                 < 1.5s
CoinGecko API               < 1.0s
```

### Throughput Targets
```javascript
// API Capacity
Normal load:     100-500 requests/minute
Peak load:       1000-2000 requests/minute
Burst capacity:  Up to 5000 requests/minute

// WebSocket Connections
Concurrent connections: 1000+
Message throughput:     10,000 messages/minute
```

### Resource Utilization Targets
```bash
# Server Resources
CPU Usage:      < 70% average, < 90% peak
Memory Usage:   < 80% average, < 95% peak
Disk I/O:       < 80% capacity
Network I/O:    < 80% bandwidth

# Database/Cache
Redis Memory:   < 80% allocated
Redis CPU:      < 70% average
Connection Pool: < 80% utilization
```

## Performance Monitoring

### 1. Application Performance Monitoring (APM)

#### Key Metrics to Track
```javascript
// Request Performance
- Response time distribution (p50, p95, p99)
- Request rate (requests per second)
- Error rate percentage
- Concurrent request count

// Database Performance
- Query execution time
- Connection pool utilization
- Cache hit/miss ratios
- Redis memory usage

// External API Performance
- Third-party API response times
- Rate limit utilization
- Circuit breaker states
- Retry attempt counts
```

#### Performance Logging
```javascript
// Request timing middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    
    logger.info('Request completed', {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });
    
    // Record metrics
    metrics.recordHistogram('http_request_duration', duration, {
      method: req.method,
      route: req.route?.path || 'unknown',
      status: res.statusCode.toString()
    });
  });
  
  next();
});
```

### 2. Resource Monitoring

#### System Metrics Collection
```javascript
// CPU and Memory monitoring
const os = require('os');

setInterval(() => {
  const cpuUsage = process.cpuUsage();
  const memUsage = process.memoryUsage();
  
  metrics.setGauge('process_cpu_usage', cpuUsage.user + cpuUsage.system);
  metrics.setGauge('process_memory_usage', memUsage.heapUsed);
  metrics.setGauge('process_memory_total', memUsage.heapTotal);
  
  // System-wide metrics
  metrics.setGauge('system_load_average', os.loadavg()[0]);
  metrics.setGauge('system_memory_free', os.freemem());
  metrics.setGauge('system_memory_total', os.totalmem());
}, 30000); // Every 30 seconds
```

#### External Service Monitoring
```javascript
// Monitor external API performance
const monitorExternalAPI = async (serviceName, apiCall) => {
  const startTime = Date.now();
  let success = false;
  let statusCode = 0;
  
  try {
    const response = await apiCall();
    success = true;
    statusCode = response.status || 200;
    return response;
  } catch (error) {
    statusCode = error.response?.status || 0;
    throw error;
  } finally {
    const duration = Date.now() - startTime;
    
    metrics.recordHistogram('external_api_duration', duration, {
      service: serviceName,
      success: success.toString(),
      status: statusCode.toString()
    });
    
    metrics.incrementCounter('external_api_requests_total', 1, {
      service: serviceName,
      status: statusCode.toString()
    });
  }
};
```

## Performance Optimization Strategies

### 1. API Response Optimization

#### Caching Strategy
```javascript
// Multi-level caching implementation
const cacheStrategy = {
  // Level 1: In-memory cache (fastest)
  memory: {
    ttl: 30, // 30 seconds
    maxSize: 1000 // items
  },
  
  // Level 2: Redis cache (fast)
  redis: {
    ttl: 300, // 5 minutes
    keyPrefix: 'api:'
  },
  
  // Level 3: Database with optimized queries
  database: {
    indexOptimization: true,
    queryOptimization: true
  }
};

// Cache implementation
const getCachedData = async (key, fetchFunction, options = {}) => {
  // Check memory cache first
  let data = memoryCache.get(key);
  if (data) {
    metrics.incrementCounter('cache_hits', 1, { level: 'memory' });
    return data;
  }
  
  // Check Redis cache
  data = await redisCache.get(key);
  if (data) {
    metrics.incrementCounter('cache_hits', 1, { level: 'redis' });
    // Store in memory cache for next time
    memoryCache.set(key, data, options.memoryTtl || 30);
    return JSON.parse(data);
  }
  
  // Fetch from source
  metrics.incrementCounter('cache_misses', 1);
  data = await fetchFunction();
  
  // Store in both caches
  memoryCache.set(key, data, options.memoryTtl || 30);
  await redisCache.setex(key, options.redisTtl || 300, JSON.stringify(data));
  
  return data;
};
```

#### Response Compression
```javascript
// Implement response compression
const compression = require('compression');

app.use(compression({
  level: 6, // Compression level (1-9)
  threshold: 1024, // Only compress responses > 1KB
  filter: (req, res) => {
    // Don't compress if client doesn't support it
    if (req.headers['x-no-compression']) {
      return false;
    }
    
    // Compress JSON and text responses
    return compression.filter(req, res);
  }
}));
```

#### Pagination and Filtering
```javascript
// Efficient pagination implementation
const getPaginatedResults = async (req, res) => {
  const {
    page = 1,
    limit = 50,
    sortBy = 'timestamp',
    sortOrder = 'desc',
    filters = {}
  } = req.query;
  
  // Validate and sanitize inputs
  const validatedLimit = Math.min(Math.max(parseInt(limit), 1), 100);
  const validatedPage = Math.max(parseInt(page), 1);
  const offset = (validatedPage - 1) * validatedLimit;
  
  // Build optimized query
  const query = buildOptimizedQuery(filters, sortBy, sortOrder);
  
  // Execute with pagination
  const [results, totalCount] = await Promise.all([
    executeQuery(query, { limit: validatedLimit, offset }),
    getQueryCount(query)
  ]);
  
  res.json({
    data: results,
    pagination: {
      page: validatedPage,
      limit: validatedLimit,
      total: totalCount,
      pages: Math.ceil(totalCount / validatedLimit)
    }
  });
};
```

### 2. Database and Cache Optimization

#### Redis Optimization
```javascript
// Redis connection optimization
const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD,
  
  // Connection pool settings
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  maxLoadingTimeout: 1000,
  
  // Performance settings
  lazyConnect: true,
  keepAlive: 30000,
  
  // Cluster settings (if using Redis Cluster)
  enableOfflineQueue: false
});

// Batch operations for better performance
const batchRedisOperations = async (operations) => {
  const pipeline = redis.pipeline();
  
  operations.forEach(op => {
    pipeline[op.command](...op.args);
  });
  
  return await pipeline.exec();
};
```

#### Query Optimization
```javascript
// Optimize database queries
const optimizeQueries = {
  // Use indexes effectively
  createIndexes: async () => {
    await db.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tokens_chain_timestamp 
      ON tokens(chain_id, created_at DESC);
    `);
    
    await db.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tokens_score 
      ON tokens(score DESC) WHERE score > 70;
    `);
  },
  
  // Use prepared statements
  preparedStatements: {
    getTrendingTokens: db.prepare(`
      SELECT * FROM tokens 
      WHERE chain_id = ? AND created_at > ? 
      ORDER BY score DESC, volume_24h DESC 
      LIMIT ?
    `),
    
    getTokensByAddress: db.prepare(`
      SELECT * FROM tokens 
      WHERE address = ? AND chain_id = ?
    `)
  },
  
  // Batch database operations
  batchInsert: async (tokens) => {
    const values = tokens.map(token => 
      `('${token.address}', '${token.chain}', ${token.score}, '${token.timestamp}')`
    ).join(',');
    
    await db.query(`
      INSERT INTO tokens (address, chain_id, score, created_at) 
      VALUES ${values}
      ON CONFLICT (address, chain_id) DO UPDATE SET
        score = EXCLUDED.score,
        updated_at = NOW()
    `);
  }
};
```

### 3. External API Optimization

#### Request Batching
```javascript
// Batch external API requests
class APIBatcher {
  constructor(apiFunction, batchSize = 10, batchDelay = 100) {
    this.apiFunction = apiFunction;
    this.batchSize = batchSize;
    this.batchDelay = batchDelay;
    this.queue = [];
    this.processing = false;
  }
  
  async add(request) {
    return new Promise((resolve, reject) => {
      this.queue.push({ request, resolve, reject });
      this.processBatch();
    });
  }
  
  async processBatch() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.batchSize);
      
      try {
        const requests = batch.map(item => item.request);
        const results = await this.apiFunction(requests);
        
        batch.forEach((item, index) => {
          item.resolve(results[index]);
        });
      } catch (error) {
        batch.forEach(item => item.reject(error));
      }
      
      // Small delay between batches
      if (this.queue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, this.batchDelay));
      }
    }
    
    this.processing = false;
  }
}

// Usage example
const goPlusBatcher = new APIBatcher(
  async (addresses) => {
    const response = await fetch('https://api.gopluslabs.io/api/v1/token_security/1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contract_addresses: addresses })
    });
    return response.json();
  },
  20, // Batch size
  200 // Delay between batches (ms)
);
```

#### Smart Caching for External APIs
```javascript
// Intelligent caching based on data freshness requirements
const smartCache = {
  // Static data - cache for hours
  tokenMetadata: { ttl: 3600 }, // 1 hour
  
  // Semi-static data - cache for minutes
  tokenSecurity: { ttl: 900 }, // 15 minutes
  
  // Dynamic data - cache for seconds
  tokenPrices: { ttl: 30 }, // 30 seconds
  
  // Real-time data - minimal caching
  tokenVolume: { ttl: 5 } // 5 seconds
};

const getCachedAPIData = async (key, apiCall, cacheConfig) => {
  const cachedData = await redis.get(key);
  
  if (cachedData) {
    const parsed = JSON.parse(cachedData);
    
    // Check if data is still fresh enough
    const age = Date.now() - parsed.timestamp;
    if (age < cacheConfig.ttl * 1000) {
      return parsed.data;
    }
  }
  
  // Fetch fresh data
  const freshData = await apiCall();
  
  // Cache with timestamp
  await redis.setex(key, cacheConfig.ttl, JSON.stringify({
    data: freshData,
    timestamp: Date.now()
  }));
  
  return freshData;
};
```

### 4. WebSocket Optimization

#### Connection Management
```javascript
// Efficient WebSocket connection management
class WebSocketManager {
  constructor() {
    this.connections = new Map();
    this.rooms = new Map();
    this.heartbeatInterval = 30000; // 30 seconds
    this.maxConnections = 10000;
  }
  
  addConnection(ws, userId) {
    if (this.connections.size >= this.maxConnections) {
      ws.close(1013, 'Server overloaded');
      return false;
    }
    
    const connectionInfo = {
      ws,
      userId,
      lastHeartbeat: Date.now(),
      subscriptions: new Set()
    };
    
    this.connections.set(ws, connectionInfo);
    this.setupHeartbeat(ws);
    
    return true;
  }
  
  setupHeartbeat(ws) {
    const heartbeat = setInterval(() => {
      const connection = this.connections.get(ws);
      if (!connection) {
        clearInterval(heartbeat);
        return;
      }
      
      if (Date.now() - connection.lastHeartbeat > this.heartbeatInterval * 2) {
        // Connection is stale
        this.removeConnection(ws);
        clearInterval(heartbeat);
        return;
      }
      
      ws.ping();
    }, this.heartbeatInterval);
    
    ws.on('pong', () => {
      const connection = this.connections.get(ws);
      if (connection) {
        connection.lastHeartbeat = Date.now();
      }
    });
  }
  
  broadcast(room, message) {
    const roomConnections = this.rooms.get(room);
    if (!roomConnections) return;
    
    const messageStr = JSON.stringify(message);
    
    roomConnections.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      }
    });
  }
}
```

#### Message Optimization
```javascript
// Optimize WebSocket message handling
const optimizeWebSocketMessages = {
  // Message compression
  compressMessage: (message) => {
    if (message.length > 1024) {
      return zlib.gzipSync(JSON.stringify(message));
    }
    return JSON.stringify(message);
  },
  
  // Message batching
  batchMessages: (messages, maxBatchSize = 10) => {
    const batches = [];
    for (let i = 0; i < messages.length; i += maxBatchSize) {
      batches.push(messages.slice(i, i + maxBatchSize));
    }
    return batches;
  },
  
  // Selective updates (only send changed data)
  createDelta: (oldData, newData) => {
    const delta = {};
    
    for (const key in newData) {
      if (oldData[key] !== newData[key]) {
        delta[key] = newData[key];
      }
    }
    
    return Object.keys(delta).length > 0 ? delta : null;
  }
};
```

## Performance Testing

### 1. Load Testing

#### API Load Testing
```bash
# Using Artillery.js for load testing
npm install -g artillery

# Create load test configuration
cat > load-test.yml << EOF
config:
  target: 'https://your-api-domain.com'
  phases:
    - duration: 60
      arrivalRate: 10
    - duration: 120
      arrivalRate: 50
    - duration: 60
      arrivalRate: 100
  defaults:
    headers:
      Authorization: 'Bearer YOUR_TEST_TOKEN'

scenarios:
  - name: "API Load Test"
    weight: 100
    requests:
      - get:
          url: "/api/tokens/trending"
      - get:
          url: "/api/tokens/hotlist"
      - get:
          url: "/api/tokens/search?q=test"
EOF

# Run load test
artillery run load-test.yml
```

#### WebSocket Load Testing
```javascript
// WebSocket load testing script
const WebSocket = require('ws');

const loadTestWebSocket = async (concurrentConnections = 100) => {
  const connections = [];
  const startTime = Date.now();
  
  for (let i = 0; i < concurrentConnections; i++) {
    const ws = new WebSocket('wss://your-api-domain.com/ws');
    
    ws.on('open', () => {
      console.log(`Connection ${i} opened`);
      
      // Subscribe to updates
      ws.send(JSON.stringify({
        type: 'subscribe',
        channel: 'tokens',
        filters: { chain: 'sol' }
      }));
    });
    
    ws.on('message', (data) => {
      // Process received messages
      const message = JSON.parse(data);
      console.log(`Connection ${i} received:`, message.type);
    });
    
    ws.on('error', (error) => {
      console.error(`Connection ${i} error:`, error);
    });
    
    connections.push(ws);
    
    // Small delay between connections
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  // Keep connections open for testing
  setTimeout(() => {
    connections.forEach(ws => ws.close());
    console.log(`Test completed in ${Date.now() - startTime}ms`);
  }, 60000); // 1 minute test
};
```

### 2. Performance Benchmarking

#### API Endpoint Benchmarks
```bash
# Using Apache Bench (ab)
# Test trending endpoint
ab -n 1000 -c 10 -H "Authorization: Bearer YOUR_TOKEN" \
   https://your-api-domain.com/api/tokens/trending

# Test search endpoint
ab -n 500 -c 5 -H "Authorization: Bearer YOUR_TOKEN" \
   "https://your-api-domain.com/api/tokens/search?q=test"

# Using wrk for more advanced testing
wrk -t12 -c400 -d30s -H "Authorization: Bearer YOUR_TOKEN" \
    https://your-api-domain.com/api/tokens/trending
```

#### Database Performance Testing
```javascript
// Database query performance testing
const benchmarkQueries = async () => {
  const queries = [
    {
      name: 'Get trending tokens',
      query: 'SELECT * FROM tokens WHERE score > 70 ORDER BY score DESC LIMIT 50'
    },
    {
      name: 'Search tokens by symbol',
      query: 'SELECT * FROM tokens WHERE symbol ILIKE $1 LIMIT 20'
    },
    {
      name: 'Get token by address',
      query: 'SELECT * FROM tokens WHERE address = $1 AND chain_id = $2'
    }
  ];
  
  for (const queryTest of queries) {
    const iterations = 100;
    const startTime = Date.now();
    
    for (let i = 0; i < iterations; i++) {
      await db.query(queryTest.query, ['test']);
    }
    
    const avgTime = (Date.now() - startTime) / iterations;
    console.log(`${queryTest.name}: ${avgTime.toFixed(2)}ms average`);
  }
};
```

## Performance Troubleshooting

### 1. Identifying Bottlenecks

#### Performance Profiling
```javascript
// CPU profiling
const v8Profiler = require('v8-profiler-next');

const startProfiling = (name) => {
  v8Profiler.startProfiling(name, true);
};

const stopProfiling = (name) => {
  const profile = v8Profiler.stopProfiling(name);
  profile.export((error, result) => {
    if (!error) {
      fs.writeFileSync(`./profiles/${name}.cpuprofile`, result);
    }
    profile.delete();
  });
};

// Memory profiling
const takeHeapSnapshot = () => {
  const snapshot = v8Profiler.takeSnapshot();
  snapshot.export((error, result) => {
    if (!error) {
      fs.writeFileSync('./profiles/heap.heapsnapshot', result);
    }
    snapshot.delete();
  });
};
```

#### Slow Query Detection
```javascript
// Database query monitoring
const monitorSlowQueries = (threshold = 1000) => {
  const originalQuery = db.query;
  
  db.query = async function(...args) {
    const startTime = Date.now();
    
    try {
      const result = await originalQuery.apply(this, args);
      const duration = Date.now() - startTime;
      
      if (duration > threshold) {
        logger.warn('Slow query detected', {
          query: args[0],
          duration,
          params: args[1]
        });
      }
      
      return result;
    } catch (error) {
      logger.error('Query error', {
        query: args[0],
        error: error.message,
        params: args[1]
      });
      throw error;
    }
  };
};
```

### 2. Common Performance Issues

#### Memory Leaks
```javascript
// Memory leak detection
const detectMemoryLeaks = () => {
  let baseline = process.memoryUsage();
  
  setInterval(() => {
    const current = process.memoryUsage();
    const growth = {
      heapUsed: current.heapUsed - baseline.heapUsed,
      heapTotal: current.heapTotal - baseline.heapTotal,
      external: current.external - baseline.external
    };
    
    // Alert if memory growth is significant
    if (growth.heapUsed > 50 * 1024 * 1024) { // 50MB growth
      logger.warn('Potential memory leak detected', {
        growth,
        current
      });
    }
    
    baseline = current;
  }, 60000); // Check every minute
};
```

#### Connection Pool Issues
```javascript
// Monitor connection pool health
const monitorConnectionPool = (pool) => {
  setInterval(() => {
    const stats = {
      totalConnections: pool.totalCount,
      idleConnections: pool.idleCount,
      waitingClients: pool.waitingCount
    };
    
    metrics.setGauge('db_pool_total', stats.totalConnections);
    metrics.setGauge('db_pool_idle', stats.idleConnections);
    metrics.setGauge('db_pool_waiting', stats.waitingClients);
    
    // Alert if pool is under stress
    if (stats.waitingClients > 10) {
      logger.warn('Database connection pool under stress', stats);
    }
  }, 30000);
};
```

## Performance Optimization Checklist

### Daily Checks
- [ ] Review response time metrics
- [ ] Check error rate trends
- [ ] Monitor resource utilization
- [ ] Verify cache hit rates
- [ ] Check external API performance

### Weekly Optimization
- [ ] Analyze slow query logs
- [ ] Review cache effectiveness
- [ ] Optimize database indexes
- [ ] Update performance baselines
- [ ] Test load handling capacity

### Monthly Reviews
- [ ] Comprehensive performance audit
- [ ] Update performance targets
- [ ] Review and optimize caching strategy
- [ ] Analyze traffic patterns
- [ ] Plan capacity scaling

### Performance Alerts
- [ ] Set up response time alerts
- [ ] Configure resource utilization alerts
- [ ] Monitor external API degradation
- [ ] Track error rate spikes
- [ ] Alert on cache miss rate increases