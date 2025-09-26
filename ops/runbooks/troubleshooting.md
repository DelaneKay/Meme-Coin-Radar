# Troubleshooting Runbook - Meme Coin Radar

## Overview
This runbook provides step-by-step troubleshooting procedures for common issues in the Meme Coin Radar system.

## Quick Reference

### Emergency Response Priority
1. **P0 - Critical**: System down, data loss, security breach
2. **P1 - High**: Major functionality broken, high error rates
3. **P2 - Medium**: Performance degradation, minor features broken
4. **P3 - Low**: Cosmetic issues, enhancement requests

### First Response Checklist
- [ ] Check system health dashboard
- [ ] Review recent deployments
- [ ] Check external service status
- [ ] Verify monitoring alerts
- [ ] Document incident start time

## Common Issues and Solutions

### 1. API Service Down

#### Symptoms
- Health check endpoint returns 5xx errors
- No response from API endpoints
- WebSocket connections failing

#### Diagnosis Steps
```bash
# 1. Check service status
curl -I https://your-api-domain.com/health

# 2. Check Render service status
# Go to Render dashboard > Services > meme-coin-api

# 3. Check recent logs
# In Render dashboard: Logs tab
# Look for startup errors, crashes, or exceptions

# 4. Check resource usage
# Monitor CPU, memory, and network metrics
```

#### Resolution Steps
```bash
# 1. Restart the service
# In Render dashboard: Manual Deploy > Deploy Latest Commit

# 2. If restart fails, check environment variables
# Verify all required env vars are set correctly

# 3. Check Redis connectivity
curl https://your-api-domain.com/health/detailed
# Look for Redis connection status

# 4. If Redis is down, check Upstash status
# Go to Upstash dashboard > Database status

# 5. Rollback if recent deployment caused issue
# Follow rollback procedures in deployment runbook
```

#### Prevention
- Implement proper health checks
- Set up automated restarts
- Monitor resource usage trends
- Regular dependency updates

### 2. High Error Rates

#### Symptoms
- Error rate > 5% in monitoring
- Multiple 5xx responses
- Circuit breakers opening frequently

#### Diagnosis Steps
```bash
# 1. Check error logs
# In Render dashboard: Logs > Filter by "ERROR"

# 2. Identify error patterns
grep "rate_limit_exceeded" logs/combined.log | tail -20
grep "circuit_breaker_open" logs/combined.log | tail -20
grep "timeout" logs/combined.log | tail -20

# 3. Check external API status
curl -I https://api.dexscreener.com/latest/dex/tokens/sol
curl -I https://api.gopluslabs.io/api/v1/supported_chains
curl -I https://public-api.birdeye.so/public/price
```

#### Resolution Steps
```bash
# 1. If rate limiting issues
# Check rate limit usage in security dashboard
curl https://your-api-domain.com/api/security/dashboard

# 2. If external API issues
# Check circuit breaker status
# Wait for automatic recovery or manually reset

# 3. If timeout issues
# Check network connectivity
# Review timeout configurations

# 4. If database issues
# Check Redis connection health
# Monitor query performance
```

#### Prevention
- Implement proper retry logic
- Set appropriate timeout values
- Monitor external API health
- Use circuit breakers effectively

### 3. WebSocket Connection Issues

#### Symptoms
- Clients cannot connect to WebSocket
- Frequent disconnections
- Real-time updates not working

#### Diagnosis Steps
```bash
# 1. Test WebSocket endpoint
wscat -c wss://your-api-domain.com

# 2. Check WebSocket logs
grep "websocket" logs/combined.log | tail -20

# 3. Check connection count
# Monitor active WebSocket connections in dashboard

# 4. Test from different networks
# Rule out client-side network issues
```

#### Resolution Steps
```bash
# 1. Check CORS configuration
# Verify allowed origins in security middleware

# 2. Check SSL certificate
# Ensure valid certificate for WSS connections

# 3. Check load balancer settings
# Verify WebSocket support and timeout settings

# 4. Restart WebSocket service
# May require full API restart
```

#### Prevention
- Monitor WebSocket connection metrics
- Implement connection heartbeat
- Set appropriate timeout values
- Test WebSocket functionality in CI/CD

### 4. Performance Degradation

#### Symptoms
- Response times > 3 seconds
- High CPU or memory usage
- Slow database queries

#### Diagnosis Steps
```bash
# 1. Check response time metrics
curl -w "@curl-format.txt" -o /dev/null -s https://your-api-domain.com/api/tokens/trending

# 2. Check resource usage
# Monitor CPU, memory, and network in Render dashboard

# 3. Check database performance
# Monitor Redis query times and connection pool

# 4. Check external API response times
# Test individual API endpoints
```

#### Resolution Steps
```bash
# 1. Identify bottlenecks
# Use profiling tools to identify slow code paths

# 2. Optimize database queries
# Add caching where appropriate
# Optimize Redis usage patterns

# 3. Scale resources if needed
# Upgrade Render plan if resource-constrained

# 4. Implement caching
# Add response caching for expensive operations
```

#### Prevention
- Regular performance testing
- Monitor key performance metrics
- Implement proper caching strategies
- Regular code profiling

### 5. Security Issues

#### Symptoms
- Unusual traffic patterns
- High number of failed authentication attempts
- Security alerts triggered

#### Diagnosis Steps
```bash
# 1. Check security dashboard
curl https://your-api-domain.com/api/security/dashboard

# 2. Review security events
curl https://your-api-domain.com/api/security/events?limit=50

# 3. Check active alerts
curl https://your-api-domain.com/api/security/alerts

# 4. Review access logs
grep "401\|403\|429" logs/combined.log | tail -50
```

#### Resolution Steps
```bash
# 1. Block malicious IPs
# Use security dashboard to blacklist IPs

# 2. Adjust rate limiting
# Temporarily reduce rate limits if under attack

# 3. Enable additional security measures
# Activate stricter validation rules

# 4. Contact security team
# For serious security incidents
```

#### Prevention
- Regular security audits
- Monitor security metrics
- Keep dependencies updated
- Implement proper logging

### 6. External API Issues

#### Symptoms
- Circuit breakers opening
- Rate limit exceeded errors
- External API timeouts

#### Diagnosis Steps
```bash
# 1. Check external API status
curl -I https://api.dexscreener.com/latest/dex/tokens/sol
curl -I https://api.gopluslabs.io/api/v1/supported_chains
curl -I https://public-api.birdeye.so/public/price
curl -I https://api.coingecko.com/api/v3/ping

# 2. Check rate limit usage
# Review rate limiter status in logs

# 3. Check circuit breaker status
# Monitor circuit breaker metrics

# 4. Test with different endpoints
# Verify if issue is service-wide or endpoint-specific
```

#### Resolution Steps
```bash
# 1. Wait for rate limit reset
# Check rate limit headers for reset time

# 2. Implement backoff strategy
# Reduce request frequency temporarily

# 3. Use alternative endpoints
# Switch to backup APIs if available

# 4. Contact API provider
# For persistent issues or service outages
```

#### Prevention
- Monitor API usage patterns
- Implement proper rate limiting
- Use multiple API providers
- Cache API responses appropriately

## Monitoring and Alerting

### Key Metrics to Watch
```bash
# API Health
curl https://your-api-domain.com/health

# Response Times
curl -w "%{time_total}" https://your-api-domain.com/api/tokens/trending

# Error Rates
grep "ERROR" logs/combined.log | wc -l

# WebSocket Connections
# Monitor active connection count

# External API Status
# Check circuit breaker and rate limiter status
```

### Alert Response Procedures

#### Critical Alerts (P0)
1. **Immediate Response** (within 5 minutes)
   - Acknowledge alert
   - Check system status
   - Implement immediate fix or rollback

2. **Communication** (within 15 minutes)
   - Notify stakeholders
   - Update status page
   - Provide ETA for resolution

3. **Resolution** (within 1 hour)
   - Implement permanent fix
   - Verify system stability
   - Document incident

#### High Priority Alerts (P1)
1. **Response** (within 30 minutes)
   - Investigate issue
   - Implement workaround if possible

2. **Resolution** (within 4 hours)
   - Implement permanent fix
   - Monitor for recurrence

## Escalation Procedures

### Level 1: On-Call Engineer
- Initial response and basic troubleshooting
- Implement known fixes and workarounds
- Escalate if unable to resolve within SLA

### Level 2: Senior Engineer
- Complex troubleshooting and debugging
- Code changes and emergency patches
- Coordinate with external vendors

### Level 3: Engineering Manager
- Major architectural decisions
- Resource allocation and scaling
- External communication and coordination

## Post-Incident Procedures

### Immediate Actions
1. **Verify Resolution**
   - Confirm issue is fully resolved
   - Monitor for recurrence
   - Update stakeholders

2. **Document Incident**
   - Timeline of events
   - Root cause analysis
   - Actions taken

### Follow-up Actions
1. **Post-Incident Review**
   - Schedule within 48 hours
   - Include all involved parties
   - Identify improvement opportunities

2. **Action Items**
   - Create tickets for preventive measures
   - Update runbooks and procedures
   - Implement monitoring improvements

## Tools and Resources

### Monitoring Tools
- **Render Dashboard**: Service metrics and logs
- **Upstash Dashboard**: Redis metrics
- **GitHub Actions**: Deployment status
- **Custom Health Endpoints**: Application-specific metrics

### Debugging Tools
```bash
# Log analysis
grep -E "(ERROR|WARN)" logs/combined.log | tail -50

# Performance testing
curl -w "@curl-format.txt" -o /dev/null -s <endpoint>

# WebSocket testing
wscat -c wss://your-domain.com

# API testing
curl -H "Content-Type: application/json" <endpoint>
```

### Contact Information
- **On-Call Engineer**: [Phone] [Email]
- **Engineering Manager**: [Phone] [Email]
- **External Support**: 
  - Render: support@render.com
  - Upstash: support@upstash.com
  - Vercel: support@vercel.com

## Runbook Maintenance

### Regular Updates
- Review monthly for accuracy
- Update contact information
- Add new common issues
- Update tool references

### Version Control
- Track changes in Git
- Document major updates
- Review with team quarterly