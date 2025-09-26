# Deployment Guide - Meme Coin Radar

This guide covers the complete deployment process for the Meme Coin Radar system, including automated deployments, manual procedures, verification, and rollback strategies.

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Deployment Environments](#deployment-environments)
4. [Automated Deployment](#automated-deployment)
5. [Manual Deployment](#manual-deployment)
6. [Post-Deployment Verification](#post-deployment-verification)
7. [Rollback Procedures](#rollback-procedures)
8. [Monitoring and Alerting](#monitoring-and-alerting)
9. [Troubleshooting](#troubleshooting)
10. [Best Practices](#best-practices)

## Overview

The Meme Coin Radar system consists of three main components:

- **API**: FastAPI backend service (deployed on Render)
- **Frontend**: React application (deployed on Vercel)
- **Scheduler**: Node.js cron service (deployed on Render/Cloudflare Workers)

### Architecture

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Frontend  │    │     API     │    │  Scheduler  │
│   (Vercel)  │◄──►│  (Render)   │◄──►│  (Render)   │
└─────────────┘    └─────────────┘    └─────────────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                    ┌─────────────┐
                    │  Database   │
                    │ (PostgreSQL)│
                    └─────────────┘
```

## Prerequisites

### Required Tools

- Node.js 18+
- Git
- Vercel CLI (`npm install -g vercel`)
- Render CLI (optional)
- Docker (for local testing)

### Environment Variables

Ensure the following environment variables are set:

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:port/db
REDIS_URL=redis://user:pass@host:port

# Security
JWT_SECRET=your-jwt-secret
API_KEY_SECRET=your-api-key-secret
ENCRYPTION_KEY=your-encryption-key

# External APIs
DEXSCREENER_API_KEY=your-dexscreener-key
GOPLUS_API_KEY=your-goplus-key
BIRDEYE_API_KEY=your-birdeye-key
COINGECKO_API_KEY=your-coingecko-key

# Notifications
SLACK_WEBHOOK_URL=your-slack-webhook
DISCORD_WEBHOOK_URL=your-discord-webhook

# Monitoring
PROMETHEUS_URL=your-prometheus-url
GRAFANA_URL=your-grafana-url
```

### Access Requirements

- Git repository access
- Render account with deployment permissions
- Vercel account with deployment permissions
- Database access credentials
- External API keys

## Deployment Environments

### Staging Environment

- **Purpose**: Testing and validation before production
- **Branch**: `staging`
- **API URL**: `https://meme-coin-radar-api-staging.onrender.com`
- **Frontend URL**: `https://meme-coin-radar-staging.vercel.app`
- **Scheduler URL**: `https://meme-coin-radar-scheduler-staging.onrender.com`

### Production Environment

- **Purpose**: Live system serving real users
- **Branch**: `main`
- **API URL**: `https://meme-coin-radar-api.onrender.com`
- **Frontend URL**: `https://meme-coin-radar.vercel.app`
- **Scheduler URL**: `https://meme-coin-radar-scheduler.onrender.com`

## Automated Deployment

### Using the Deployment Script

The automated deployment script handles the complete deployment pipeline:

```bash
# Deploy to staging (recommended first)
node ops/scripts/deploy.js staging

# Deploy specific component to staging
node ops/scripts/deploy.js staging api
node ops/scripts/deploy.js staging frontend
node ops/scripts/deploy.js staging scheduler

# Deploy to production
node ops/scripts/deploy.js production

# Dry run (test without actual deployment)
node ops/scripts/deploy.js staging --dry-run

# Skip tests (not recommended)
node ops/scripts/deploy.js staging --skip-tests

# Skip verification (not recommended)
node ops/scripts/deploy.js staging --skip-verification

# Disable auto-rollback
node ops/scripts/deploy.js staging --no-rollback
```

### Deployment Pipeline Steps

1. **Pre-deployment Checks**
   - Git status validation
   - Environment variable verification
   - External dependency checks
   - Current system health assessment

2. **Testing**
   - Unit tests (API, Sentinel, Frontend)
   - Integration tests
   - Security tests

3. **Build and Deploy**
   - Component-specific builds
   - Platform-specific deployments
   - Service configuration updates

4. **Stabilization**
   - Wait for deployment completion
   - Service health checks
   - Connection verification

5. **Post-deployment Verification**
   - Comprehensive system testing
   - Performance validation
   - Security verification

6. **Rollback (if needed)**
   - Automatic rollback on failure
   - Manual rollback capability
   - State restoration

## Manual Deployment

### API Deployment (Render)

1. **Prepare the code:**
   ```bash
   git checkout main  # or staging
   git pull origin main
   npm install
   npm test --workspace=api
   ```

2. **Deploy to Render:**
   ```bash
   git push origin main
   # Render will automatically deploy
   ```

3. **Monitor deployment:**
   - Check Render dashboard
   - Monitor logs for errors
   - Verify health endpoint

### Frontend Deployment (Vercel)

1. **Build the frontend:**
   ```bash
   cd frontend
   npm install
   npm run build
   npm test
   ```

2. **Deploy to Vercel:**
   ```bash
   # For staging
   vercel --scope team

   # For production
   vercel --prod --scope team
   ```

3. **Verify deployment:**
   - Check Vercel dashboard
   - Test frontend functionality
   - Verify API connectivity

### Scheduler Deployment

#### Render Deployment

1. **Prepare the scheduler:**
   ```bash
   npm install
   npm test --workspace=scheduler
   ```

2. **Deploy:**
   ```bash
   git push origin main
   # Render will automatically deploy
   ```

#### Cloudflare Workers Deployment

1. **Configure Wrangler:**
   ```bash
   cd ops/cron
   npm install
   ```

2. **Deploy:**
   ```bash
   # For staging
   wrangler deploy --env staging

   # For production
   wrangler deploy --env production
   ```

## Post-Deployment Verification

### Automated Verification

```bash
# Run comprehensive verification
node ops/scripts/post-deployment-verification.js staging

# Run specific test suites
node ops/scripts/post-deployment-verification.js staging --suite=core
node ops/scripts/post-deployment-verification.js staging --suite=functional
node ops/scripts/post-deployment-verification.js staging --suite=performance
```

### Manual Verification Checklist

#### Core System Health

- [ ] API health endpoint responds (200 OK)
- [ ] Frontend loads without errors
- [ ] Scheduler health endpoint responds
- [ ] Database connectivity verified
- [ ] Redis connectivity verified

#### Functional Testing

- [ ] User authentication works
- [ ] Token radar scanning functions
- [ ] Sentinel monitoring active
- [ ] WebSocket connections stable
- [ ] API rate limiting enforced

#### Performance Testing

- [ ] API response times < 500ms
- [ ] Frontend load time < 3s
- [ ] Database query performance acceptable
- [ ] Memory usage within limits
- [ ] CPU usage within limits

#### Security Testing

- [ ] HTTPS enforced
- [ ] Security headers present
- [ ] Input validation working
- [ ] Authentication required for protected endpoints
- [ ] Rate limiting prevents abuse

#### Integration Testing

- [ ] External API connections working
- [ ] DEXScreener integration functional
- [ ] GoPlus security checks active
- [ ] Birdeye data retrieval working
- [ ] CoinGecko integration functional

## Rollback Procedures

### Automated Rollback

```bash
# Rollback entire system
node ops/scripts/rollback.js staging

# Rollback specific component
node ops/scripts/rollback.js staging api
node ops/scripts/rollback.js staging frontend
node ops/scripts/rollback.js staging scheduler

# Rollback to specific version
node ops/scripts/rollback.js staging --version=abc123def

# Emergency stop (immediate rollback)
node ops/scripts/rollback.js staging --emergency

# Rollback with custom reason
node ops/scripts/rollback.js staging --reason="Critical bug fix"
```

### Manual Rollback

#### API Rollback (Render)

1. **Identify last good version:**
   ```bash
   git log --oneline -10
   ```

2. **Revert to previous version:**
   ```bash
   git revert HEAD
   git push origin main
   ```

3. **Or rollback to specific commit:**
   ```bash
   git reset --hard <commit-hash>
   git push --force origin main
   ```

#### Frontend Rollback (Vercel)

1. **Using Vercel dashboard:**
   - Go to Vercel dashboard
   - Select the project
   - Go to "Deployments" tab
   - Click "Promote to Production" on previous deployment

2. **Using Vercel CLI:**
   ```bash
   vercel rollback <deployment-url>
   ```

#### Scheduler Rollback

Follow the same process as API rollback for Render deployments.

### Emergency Procedures

#### Immediate System Shutdown

```bash
# Stop all services immediately
node ops/scripts/rollback.js production --emergency

# Or manually disable services
# - Set maintenance mode in Render
# - Disable Vercel deployment
# - Stop Cloudflare Workers
```

#### Database Rollback

```bash
# Restore from backup
pg_restore --clean --no-acl --no-owner -h host -U user -d database backup.sql

# Or use point-in-time recovery
# (Requires database provider support)
```

## Monitoring and Alerting

### Health Monitoring

- **API Health**: `GET /health`
- **Frontend Health**: Page load monitoring
- **Scheduler Health**: `GET /health`
- **Database Health**: Connection monitoring
- **External APIs**: Response time monitoring

### Key Metrics

- Response times (p50, p95, p99)
- Error rates (4xx, 5xx)
- Throughput (requests/second)
- Resource utilization (CPU, memory)
- External API performance

### Alert Conditions

- **Critical**: Service down, high error rate (>5%)
- **Warning**: High response time (>1s), resource usage (>80%)
- **Info**: Deployment events, configuration changes

### Notification Channels

- **Slack**: Real-time alerts and updates
- **Discord**: Community notifications
- **Email**: Critical alerts and reports
- **PagerDuty**: On-call escalation

## Troubleshooting

### Common Issues

#### Deployment Failures

**Symptom**: Deployment script fails
**Causes**:
- Git repository issues
- Missing environment variables
- Test failures
- Build errors

**Solutions**:
1. Check Git status and branch
2. Verify environment variables
3. Run tests locally
4. Check build logs

#### Service Health Issues

**Symptom**: Health checks fail
**Causes**:
- Database connectivity issues
- External API failures
- Configuration errors
- Resource constraints

**Solutions**:
1. Check service logs
2. Verify database connectivity
3. Test external API endpoints
4. Monitor resource usage

#### Performance Issues

**Symptom**: Slow response times
**Causes**:
- Database query performance
- External API latency
- Resource constraints
- Network issues

**Solutions**:
1. Analyze database queries
2. Check external API status
3. Monitor resource usage
4. Review network connectivity

### Debugging Commands

```bash
# Check service logs
curl https://api.render.com/v1/services/{service-id}/logs

# Test API endpoints
curl -H "Authorization: Bearer $API_KEY" https://api-url/health

# Check database connectivity
psql $DATABASE_URL -c "SELECT 1"

# Test Redis connectivity
redis-cli -u $REDIS_URL ping

# Monitor resource usage
docker stats  # if running locally
```

### Log Analysis

#### API Logs
- Location: Render dashboard or logs API
- Key patterns: Error messages, slow queries, authentication failures

#### Frontend Logs
- Location: Browser console, Vercel dashboard
- Key patterns: JavaScript errors, API call failures, performance issues

#### Scheduler Logs
- Location: Render dashboard or Cloudflare Workers logs
- Key patterns: Cron job failures, external API errors, timeout issues

## Best Practices

### Pre-deployment

1. **Always deploy to staging first**
2. **Run comprehensive tests**
3. **Verify environment variables**
4. **Check external dependencies**
5. **Review recent changes**

### During Deployment

1. **Monitor deployment progress**
2. **Watch for error messages**
3. **Verify each component**
4. **Test critical functionality**
5. **Check performance metrics**

### Post-deployment

1. **Run verification tests**
2. **Monitor system health**
3. **Check error rates**
4. **Verify user functionality**
5. **Document any issues**

### Rollback Strategy

1. **Have a rollback plan ready**
2. **Know the last good version**
3. **Test rollback procedures**
4. **Monitor after rollback**
5. **Document rollback reasons**

### Security Considerations

1. **Never commit secrets**
2. **Use environment variables**
3. **Rotate API keys regularly**
4. **Monitor for security alerts**
5. **Keep dependencies updated**

### Performance Optimization

1. **Monitor response times**
2. **Optimize database queries**
3. **Cache frequently accessed data**
4. **Use CDN for static assets**
5. **Implement rate limiting**

## Emergency Contacts

### On-call Rotation

- **Primary**: [Contact Information]
- **Secondary**: [Contact Information]
- **Escalation**: [Contact Information]

### External Services

- **Render Support**: support@render.com
- **Vercel Support**: support@vercel.com
- **Database Provider**: [Contact Information]

### Communication Channels

- **Slack**: #meme-coin-radar-alerts
- **Discord**: #system-alerts
- **Email**: alerts@memecoinradar.com

---

## Appendix

### Useful Commands

```bash
# Quick health check
curl -s https://api-url/health | jq .

# Check all services
for service in api frontend scheduler; do
  echo "Checking $service..."
  curl -s https://$service-url/health
done

# Monitor deployment
watch -n 5 'curl -s https://api-url/health'

# Check logs
tail -f /var/log/app.log

# Database backup
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql
```

### Configuration Files

- **API**: `api/config/`
- **Frontend**: `frontend/.env`
- **Scheduler**: `ops/cron/`
- **Deployment**: `ops/scripts/`

### Documentation Links

- [API Documentation](../api/README.md)
- [Frontend Documentation](../frontend/README.md)
- [Scheduler Documentation](../ops/cron/README.md)
- [Security Guide](./security-incident-response.md)
- [Monitoring Guide](./dashboards/README.md)