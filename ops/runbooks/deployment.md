# Deployment Runbook - Meme Coin Radar

## Overview
This runbook covers deployment procedures, rollback strategies, and post-deployment verification for the Meme Coin Radar system.

## Pre-Deployment Checklist

### 1. Environment Preparation
- [ ] Verify all environment variables are set correctly
- [ ] Check Redis connection and health
- [ ] Validate external API keys and rate limits
- [ ] Ensure database migrations are ready (if applicable)
- [ ] Verify SSL certificates are valid

### 2. Code Quality Checks
- [ ] All tests pass (`npm test`)
- [ ] Code coverage meets minimum threshold (80%)
- [ ] Security scan completed without critical issues
- [ ] Dependency audit clean (`npm audit`)
- [ ] TypeScript compilation successful

### 3. Infrastructure Readiness
- [ ] Target environment is healthy
- [ ] Monitoring systems are operational
- [ ] Backup systems are functional
- [ ] Load balancers configured correctly

## Deployment Procedures

### API Deployment (Render)

#### 1. Automated Deployment via GitHub Actions
```bash
# Trigger deployment by pushing to main branch
git push origin main

# Monitor deployment status
# Check GitHub Actions: https://github.com/your-repo/actions
```

#### 2. Manual Deployment
```bash
# 1. Build the application
cd api
npm run build

# 2. Run tests
npm test

# 3. Deploy to Render
# - Push to connected GitHub repository
# - Or use Render CLI if configured
```

#### 3. Environment Variables Setup
```bash
# Required environment variables for API
NODE_ENV=production
PORT=3000
REDIS_URL=redis://...
DEXSCREENER_API_BASE=https://api.dexscreener.com
GOPLUS_API_BASE=https://api.gopluslabs.io
BIRDEYE_API_BASE=https://public-api.birdeye.so
COINGECKO_API_BASE=https://api.coingecko.com
JWT_SECRET=your-jwt-secret
API_RATE_LIMIT_WINDOW=900000
API_RATE_LIMIT_MAX=100
```

### Frontend Deployment (Vercel)

#### 1. Automated Deployment
```bash
# Deployment triggers automatically on push to main
git push origin main

# Monitor at: https://vercel.com/dashboard
```

#### 2. Manual Deployment
```bash
cd frontend
npm run build
npx vercel --prod
```

### Sentinel Deployment (Render Cron)

#### 1. Cron Job Configuration
```yaml
# render.yaml
services:
  - type: cron
    name: meme-coin-sentinel
    env: node
    schedule: "*/2 * * * *"  # Every 2 minutes
    buildCommand: npm install && npm run build
    startCommand: npm start
    envVars:
      - key: NODE_ENV
        value: production
      - key: REDIS_URL
        fromService:
          type: redis
          name: meme-coin-redis
          property: connectionString
```

## Post-Deployment Verification

### 1. Health Checks
```bash
# API Health Check
curl https://your-api-domain.com/health
# Expected: {"status": "healthy", "timestamp": "..."}

# Detailed Health Check
curl https://your-api-domain.com/health/detailed
# Verify all services are operational

# Frontend Health Check
curl https://your-frontend-domain.com/api/health
# Verify frontend can reach API
```

### 2. Functional Testing
```bash
# Test token discovery endpoint
curl "https://your-api-domain.com/api/tokens/trending?chain=sol&limit=10"

# Test WebSocket connection
# Use browser dev tools or WebSocket client
# Connect to: wss://your-api-domain.com

# Test security endpoints
curl -H "Authorization: Bearer test-token" \
     "https://your-api-domain.com/api/security/dashboard"
```

### 3. Performance Verification
- [ ] Response times < 2 seconds for API endpoints
- [ ] WebSocket connections establish within 5 seconds
- [ ] Memory usage within expected limits
- [ ] CPU usage stable under load
- [ ] No memory leaks detected

### 4. Monitoring Verification
- [ ] Logs are being generated and stored
- [ ] Metrics are being collected
- [ ] Alerts are configured and functional
- [ ] Error tracking is operational

## Rollback Procedures

### 1. Immediate Rollback (Critical Issues)
```bash
# For Render deployments
# 1. Go to Render dashboard
# 2. Select the service
# 3. Go to "Deploys" tab
# 4. Click "Rollback" on previous stable deployment

# For Vercel deployments
# 1. Go to Vercel dashboard
# 2. Select the project
# 3. Go to "Deployments" tab
# 4. Click "Promote to Production" on previous deployment
```

### 2. Git-based Rollback
```bash
# Identify the last known good commit
git log --oneline -10

# Create rollback branch
git checkout -b rollback-to-stable
git reset --hard <last-good-commit-hash>
git push origin rollback-to-stable

# Merge rollback to main
git checkout main
git merge rollback-to-stable
git push origin main
```

### 3. Database Rollback (if applicable)
```bash
# If database migrations were applied
# Run rollback migrations
npm run migrate:rollback

# Restore from backup if necessary
# Follow database-specific restore procedures
```

## Troubleshooting Common Issues

### 1. API Not Responding
```bash
# Check service status
curl https://your-api-domain.com/health

# Check logs
# In Render dashboard: Service > Logs
# Look for error patterns

# Common fixes:
# - Restart the service
# - Check environment variables
# - Verify Redis connectivity
# - Check rate limiting status
```

### 2. High Error Rates
```bash
# Check error logs
grep "ERROR" /path/to/logs/error.log | tail -50

# Check specific error patterns
grep "rate_limit_exceeded" /path/to/logs/combined.log
grep "circuit_breaker_open" /path/to/logs/combined.log

# Monitor external API status
curl https://api.dexscreener.com/latest/dex/tokens/sol
curl https://api.gopluslabs.io/api/v1/supported_chains
```

### 3. WebSocket Connection Issues
```bash
# Check WebSocket endpoint
# Use browser dev tools or wscat
wscat -c wss://your-api-domain.com

# Common issues:
# - CORS configuration
# - Load balancer timeout settings
# - SSL certificate problems
```

### 4. Performance Issues
```bash
# Check system metrics
# CPU, Memory, Network usage

# Check database performance
# Query execution times
# Connection pool status

# Check external API response times
# Review rate limiting logs
# Monitor circuit breaker status
```

## Emergency Contacts

### On-Call Rotation
- **Primary**: [Your Name] - [Phone] - [Email]
- **Secondary**: [Backup Name] - [Phone] - [Email]

### External Services
- **Render Support**: support@render.com
- **Vercel Support**: support@vercel.com
- **Upstash Redis**: support@upstash.com

## Monitoring and Alerting

### Key Metrics to Monitor
- API response times (< 2s target)
- Error rates (< 1% target)
- WebSocket connection count
- External API rate limit usage
- Memory and CPU utilization
- Redis connection health

### Alert Thresholds
- **Critical**: API down, error rate > 5%
- **Warning**: Response time > 3s, error rate > 2%
- **Info**: Rate limit usage > 80%

### Monitoring URLs
- **API Health**: https://your-api-domain.com/health
- **Security Dashboard**: https://your-api-domain.com/api/security/dashboard
- **Metrics Endpoint**: https://your-api-domain.com/metrics

## Maintenance Windows

### Scheduled Maintenance
- **Frequency**: Monthly, first Sunday 2-4 AM UTC
- **Duration**: 2 hours maximum
- **Notification**: 48 hours advance notice

### Emergency Maintenance
- **Authorization**: Lead Developer or Operations Manager
- **Communication**: Immediate notification to stakeholders
- **Documentation**: Post-incident report required

## Documentation Updates

### After Each Deployment
- [ ] Update version numbers
- [ ] Document any configuration changes
- [ ] Update monitoring thresholds if needed
- [ ] Review and update this runbook

### Quarterly Reviews
- [ ] Review all procedures
- [ ] Update contact information
- [ ] Validate emergency procedures
- [ ] Update monitoring and alerting rules