# DevOps Configuration Guide

## Overview

This document outlines the complete DevOps configuration for the Meme Coin Radar system, including environment variables, deployment configurations, and the RADAR_ONLY mode implementation.

## Environment Variables

### Core System Configuration

#### API Service (`api/`)
```bash
# Core Settings
NODE_ENV=production
PORT=3001
RADAR_ONLY=false

# Redis Configuration
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=your_redis_password
REDIS_DB=0

# Database Configuration
DATABASE_URL=postgresql://user:password@host:port/database

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS=true

# Circuit Breaker
CIRCUIT_BREAKER_FAILURE_THRESHOLD=5
CIRCUIT_BREAKER_RESET_TIMEOUT=60000
CIRCUIT_BREAKER_MONITOR_TIMEOUT=30000

# Chain Configuration
CHAINS=sol,eth,bsc,base
CHAIN_SOL_ENABLED=true
CHAIN_ETH_ENABLED=true
CHAIN_BSC_ENABLED=true
CHAIN_BASE_ENABLED=true

# Token Filtering
MIN_LIQUIDITY_ALERT=20000
MIN_LIQUIDITY_LIST=12000
MAX_TAX=10
MAX_AGE_HOURS=48

# Signal Detection
SCORE_ALERT=70
SURGE15_THRESHOLD=2.5
IMBALANCE5_THRESHOLD=0.4
REFRESH_MS=30000
SENTINEL_REFRESH_MS=120000

# Alert Configuration
MAX_ALERTS_PER_HOUR=30
ALERT_COOLDOWN_MINUTES=30
CEX_LISTING_COOLDOWN_HOURS=24

# Security Settings
SECURITY_SCAN_ENABLED=true
SECURITY_SCAN_TIMEOUT=10000
HONEYPOT_CHECK_ENABLED=true
CONTRACT_VERIFICATION_ENABLED=true

# Performance Monitoring
ENABLE_METRICS=true
METRICS_PORT=9090
HEALTH_CHECK_INTERVAL=30000
PERFORMANCE_MONITORING=true

# WebSocket Configuration
WS_PORT=3002
WS_HEARTBEAT_INTERVAL=30000
WS_MAX_CONNECTIONS=1000

# CORS Configuration
CORS_ORIGIN=https://your-frontend-domain.com
CORS_CREDENTIALS=true

# API Keys
BIRDEYE_API_KEY=your_birdeye_api_key
COINGECKO_API_KEY=your_coingecko_api_key
DEXSCREENER_API_KEY=your_dexscreener_api_key
GOPLUS_API_KEY=your_goplus_api_key

# Feature Flags (RADAR_ONLY Mode)
ENABLE_PORTFOLIO_SIM=true
ENABLE_TRADE_ACTIONS=true
ENABLE_ANY_WALLET_INTEGRATIONS=true
```

#### Sentinel Service (`sentinel/`)
```bash
# Core Settings
NODE_ENV=production
RADAR_ONLY=false

# Redis Configuration
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=your_redis_password
REDIS_DB=0

# Sentinel Configuration
SENTINEL_REFRESH_MS=120000
SENTINEL_ENABLED=true
SENTINEL_CHAINS=sol,eth,bsc,base

# Listing Detection
LISTING_DETECTION_ENABLED=true
LISTING_BOOST_SCORE=10
LISTING_PIN_DURATION_MINUTES=30

# Alert Configuration
ALERT_ENABLED=true
ALERT_CHANNELS=discord,telegram,webhook

# Performance Settings
PERFORMANCE_MONITORING=true
HEALTH_CHECK_INTERVAL=60000

# Webhook Configuration
WEBHOOK_TIMEOUT=10000
WEBHOOK_RETRY_ATTEMPTS=3
WEBHOOK_RETRY_DELAY=1000

# API Keys
BIRDEYE_API_KEY=your_birdeye_api_key
COINGECKO_API_KEY=your_coingecko_api_key
```

#### Frontend Service (`frontend/`)
```bash
# Core Settings
NEXT_PUBLIC_APP_NAME=Meme Coin Radar
NEXT_PUBLIC_APP_VERSION=1.0.0

# API Configuration
NEXT_PUBLIC_API_URL=https://api.your-domain.com
NEXT_PUBLIC_WS_URL=wss://api.your-domain.com

# Feature Flags
NEXT_PUBLIC_RADAR_ONLY=false
NEXT_PUBLIC_ENABLE_ANALYTICS=true
NEXT_PUBLIC_ENABLE_DEBUG=false

# UI Configuration
NEXT_PUBLIC_ENABLE_NOTIFICATIONS=true
NEXT_PUBLIC_ENABLE_SOUND_ALERTS=true
NEXT_PUBLIC_DEFAULT_THEME=dark
NEXT_PUBLIC_REFRESH_INTERVAL=30000
NEXT_PUBLIC_MAX_TOKENS_DISPLAY=100
```

## RADAR_ONLY Mode Configuration

### Purpose
RADAR_ONLY mode restricts the application to core radar functionality, disabling advanced trading features, portfolio simulation, and wallet integrations.

### Environment Variables
```bash
# API Service
RADAR_ONLY=true
ENABLE_PORTFOLIO_SIM=false
ENABLE_TRADE_ACTIONS=false
ENABLE_ANY_WALLET_INTEGRATIONS=false

# Frontend Service
NEXT_PUBLIC_RADAR_ONLY=true
```

### Affected Components

#### API Routes (Blocked in RADAR_ONLY mode)
- `/api/sim/*` - Portfolio simulation endpoints
- `/api/tuning/*` - Alert tuning endpoints
- `/api/wallet/*` - Wallet integration endpoints
- `/api/trade/*` - Trade action endpoints

#### API Routes (Allowed in RADAR_ONLY mode)
- `/api/config` - Configuration endpoints
- `/api/signals` - Signal and leaderboard endpoints
- `/api/search` - Token search endpoints
- `/api/health` - Health check endpoints
- `/api/listings/recent` - Recent listings
- `/api/tokens` - Token details
- `/api/webhooks/cex-listing` - CEX listing webhooks

#### Frontend Components
- **LeaderboardTabs**: Only shows radar-enabled tabs
- **Sidebar**: Filters navigation to radar-only items
- **Header**: Shows "RADAR ONLY" badge when active

### Implementation Details

#### Route Blocking Middleware
```typescript
const radarOnlyMiddleware = (req: any, res: any, next: any) => {
  const config = orchestrator.getConfig();
  
  if (config.radarOnly) {
    const allowedPaths = [
      '/api/config',
      '/api/signals',
      '/api/search',
      '/api/health',
      '/api/listings/recent',
      '/api/tokens',
      '/api/webhooks/cex-listing'
    ];
    
    const isAllowed = allowedPaths.some(path => req.path.startsWith(path));
    
    if (!isAllowed) {
      return res.status(404).json({
        success: false,
        error: 'Endpoint not available in RADAR_ONLY mode',
        timestamp: Date.now(),
      });
    }
  }
  
  next();
};
```

## Deployment Configurations

### Render.com (`infra/render.yaml`)
```yaml
services:
  - type: web
    name: meme-coin-radar-api
    env: docker
    dockerfilePath: ./infra/docker/Dockerfile
    healthCheckPath: /health
    autoDeploy: true
    buildFilter:
      paths:
        - api/**
        - shared/**
        - infra/docker/**
    envVars:
      # Feature Flags
      - key: RADAR_ONLY
        value: false
      # ... other environment variables
```

### Vercel (`infra/vercel.json`)
```json
{
  "projectSettings": {
    "nodeVersion": "18.x"
  },
  "build": {
    "env": {
      "NODE_VERSION": "18.17.0"
    }
  },
  "env": {
    "NEXT_PUBLIC_RADAR_ONLY": "false"
  }
}
```

### GitHub Actions

#### Frontend Deployment (`infra/github-actions/deploy-frontend.yml`)
```yaml
- name: Set environment variables
  run: |
    # Feature flags
    echo "NEXT_PUBLIC_ENABLE_ANALYTICS=true" >> $GITHUB_ENV
    echo "NEXT_PUBLIC_ENABLE_DEBUG=${{ needs.determine-environment.outputs.environment != 'production' }}" >> $GITHUB_ENV
    echo "NEXT_PUBLIC_RADAR_ONLY=false" >> $GITHUB_ENV
```

#### API Deployment (`infra/github-actions/deploy-api.yml`)
- Uses Render deployment hooks
- Environment variables configured in `render.yaml`

## Security Configuration

### Rate Limiting
- **Global**: 100 requests per 15 minutes
- **API**: 50 requests per 15 minutes
- **Speed Limiting**: 100ms delay after 50 requests/minute

### CORS Configuration
```typescript
cors: {
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}
```

### Security Headers
- Helmet.js configuration
- CSP policies
- HSTS enforcement
- XSS protection

## Monitoring and Health Checks

### Health Endpoints
- `/health` - Basic health check
- `/health/live` - Liveness probe
- `/health/ready` - Readiness probe
- `/health/detailed` - Detailed system status

### Metrics Collection
- Prometheus metrics on port 9090
- WebSocket connection tracking
- Request/response metrics
- Error rate monitoring

## Alert Configuration

### Supported Channels
- **Discord**: Rich embeds via webhooks
- **Telegram**: Markdown messages via bot API
- **Custom Webhooks**: JSON payloads

### Alert Types (RADAR_ONLY Mode)
- ✅ **Score Alerts**: Momentum-based alerts
- ✅ **CEX Listing Alerts**: Exchange listing notifications
- ❌ **Portfolio Alerts**: Disabled in RADAR_ONLY mode
- ❌ **Trade Action Alerts**: Disabled in RADAR_ONLY mode

## Troubleshooting

### Common Issues

#### RADAR_ONLY Mode Not Working
1. Check environment variable: `RADAR_ONLY=true`
2. Verify API restart after config change
3. Check frontend environment: `NEXT_PUBLIC_RADAR_ONLY=true`
4. Verify route middleware is applied

#### Node.js Version Issues
- **Required**: Node.js >= 18.17.0
- **Frontend**: Next.js 14+ requires 18.17.0+
- **API**: TypeScript compilation requires 18.17.0+

#### Redis Connection Issues
1. Verify `REDIS_URL` configuration
2. Check Redis server availability
3. Validate authentication credentials
4. Test connection with Redis CLI

### Deployment Verification

#### Post-Deployment Checklist
1. Health endpoints responding
2. WebSocket connections working
3. Alert channels functional
4. RADAR_ONLY mode (if enabled) working correctly
5. Rate limiting active
6. Security headers present

## Maintenance

### Regular Tasks
- Monitor alert frequency and adjust thresholds
- Review and update API rate limits
- Check security scan results
- Update API keys before expiration
- Monitor system performance metrics

### Configuration Updates
1. Update environment variables in deployment platform
2. Restart services to apply changes
3. Verify configuration via `/api/config` endpoint
4. Test affected functionality
5. Monitor for any issues

---

**Last Updated**: January 2025
**Version**: 1.0.0