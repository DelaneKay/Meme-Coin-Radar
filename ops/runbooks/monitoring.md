# Monitoring Runbook - Meme Coin Radar

## Overview
This runbook covers monitoring strategies, metrics collection, alerting procedures, and observability best practices for the Meme Coin Radar system.

## Monitoring Architecture

### Components
1. **Application Metrics**: Custom metrics from API and Sentinel
2. **Infrastructure Metrics**: Server resources, network, storage
3. **External API Monitoring**: Third-party service health and performance
4. **Security Monitoring**: Threat detection and security events
5. **Business Metrics**: Token discovery, user engagement, system usage

### Data Flow
```
Application → Metrics Collection → Storage → Dashboards → Alerts
     ↓              ↓                ↓          ↓         ↓
  Custom Logs → Log Aggregation → Analysis → Reports → Actions
```

## Key Metrics and Thresholds

### 1. Application Performance Metrics

#### API Response Times
```javascript
// Target: < 2 seconds (95th percentile)
// Warning: > 3 seconds
// Critical: > 5 seconds

// Endpoints to monitor:
- GET /api/tokens/trending
- GET /api/tokens/hotlist
- GET /api/tokens/search
- WebSocket connections
```

#### Error Rates
```javascript
// Target: < 1%
// Warning: > 2%
// Critical: > 5%

// Error types to track:
- 4xx client errors
- 5xx server errors
- Timeout errors
- Circuit breaker trips
```

#### Throughput
```javascript
// Requests per minute
// Normal: 100-1000 RPM
// High load: 1000-5000 RPM
// Critical: > 5000 RPM

// Track by endpoint and method
```

### 2. Infrastructure Metrics

#### System Resources
```bash
# CPU Usage
# Target: < 70%
# Warning: > 80%
# Critical: > 90%

# Memory Usage
# Target: < 80%
# Warning: > 85%
# Critical: > 95%

# Disk Usage
# Target: < 80%
# Warning: > 85%
# Critical: > 90%
```

#### Network Metrics
```bash
# Network Latency
# Target: < 100ms
# Warning: > 200ms
# Critical: > 500ms

# Bandwidth Usage
# Monitor inbound/outbound traffic
# Alert on unusual spikes
```

### 3. External API Metrics

#### Rate Limit Usage
```javascript
// DEX Screener: 300 RPM
// GoPlus: 30 RPM  
// Birdeye: 60 RPM (1 RPS)
// CoinGecko: Variable

// Thresholds:
// Warning: > 80% of limit
// Critical: > 95% of limit
```

#### API Response Times
```javascript
// Target: < 1 second
// Warning: > 2 seconds
// Critical: > 5 seconds

// Track by API provider
```

#### Circuit Breaker Status
```javascript
// States: CLOSED, OPEN, HALF_OPEN
// Alert on: OPEN state
// Monitor: Failure rates and recovery times
```

### 4. Security Metrics

#### Authentication Events
```javascript
// Failed login attempts
// Warning: > 10 per minute from single IP
// Critical: > 50 per minute from single IP

// Brute force detection
// Warning: > 5 failed attempts per user
// Critical: > 10 failed attempts per user
```

#### Threat Detection
```javascript
// SQL injection attempts
// XSS attempts
// Path traversal attempts
// Malicious payloads

// Any detection: Immediate alert
```

#### Rate Limiting Violations
```javascript
// API rate limit exceeded
// Warning: > 10 violations per hour
// Critical: > 100 violations per hour
```

### 5. Business Metrics

#### Token Discovery
```javascript
// New tokens discovered per hour
// Normal: 10-100 tokens
// High activity: 100-500 tokens
// Unusual: > 500 tokens

// Quality score distribution
// Monitor average quality scores
```

#### User Engagement
```javascript
// WebSocket connections
// Active connections count
// Connection duration
// Reconnection rates
```

## Monitoring Implementation

### 1. Health Check Endpoints

#### Basic Health Check
```bash
# Endpoint: GET /health
# Expected Response: 200 OK
curl https://your-api-domain.com/health

# Response format:
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00Z",
  "uptime": 3600,
  "version": "1.0.0"
}
```

#### Detailed Health Check
```bash
# Endpoint: GET /health/detailed
# Includes dependency status
curl https://your-api-domain.com/health/detailed

# Response includes:
- Redis connection status
- External API availability
- Circuit breaker states
- Rate limiter status
- Security system health
```

### 2. Metrics Collection

#### Custom Metrics Endpoint
```bash
# Endpoint: GET /metrics
# Prometheus-compatible format
curl https://your-api-domain.com/metrics

# Metrics include:
- http_requests_total
- http_request_duration_seconds
- websocket_connections_active
- external_api_requests_total
- circuit_breaker_state
- rate_limit_usage
```

#### Application Logs
```javascript
// Log levels: ERROR, WARN, INFO, DEBUG
// Structured logging with JSON format

// Key log events:
- API requests/responses
- External API calls
- Security events
- Error conditions
- Performance metrics
```

### 3. External Monitoring

#### Uptime Monitoring
```bash
# Use external services to monitor:
# - API availability
# - Response times
# - SSL certificate validity
# - DNS resolution

# Recommended tools:
# - UptimeRobot
# - Pingdom
# - StatusCake
```

#### Synthetic Monitoring
```bash
# Automated tests to verify:
# - Critical user journeys
# - API functionality
# - WebSocket connections
# - Data accuracy

# Test scenarios:
# - Token search and discovery
# - Real-time updates
# - Security features
```

## Alerting Configuration

### 1. Alert Channels

#### Immediate Alerts (Critical)
- **Slack**: #alerts-critical
- **Email**: oncall@company.com
- **SMS**: On-call engineer
- **PagerDuty**: Critical incidents

#### Warning Alerts
- **Slack**: #alerts-warning
- **Email**: team@company.com

#### Info Alerts
- **Slack**: #monitoring
- **Email**: Daily digest

### 2. Alert Rules

#### Critical Alerts
```yaml
# API Down
- alert: APIDown
  expr: up{job="meme-coin-api"} == 0
  for: 1m
  labels:
    severity: critical
  annotations:
    summary: "API service is down"

# High Error Rate
- alert: HighErrorRate
  expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
  for: 2m
  labels:
    severity: critical
  annotations:
    summary: "High error rate detected"

# External API Circuit Breaker Open
- alert: CircuitBreakerOpen
  expr: circuit_breaker_state{state="open"} == 1
  for: 1m
  labels:
    severity: critical
  annotations:
    summary: "Circuit breaker is open for {{ $labels.service }}"
```

#### Warning Alerts
```yaml
# High Response Time
- alert: HighResponseTime
  expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 3
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "High response time detected"

# High CPU Usage
- alert: HighCPUUsage
  expr: cpu_usage_percent > 80
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "High CPU usage detected"

# Rate Limit Usage High
- alert: RateLimitHigh
  expr: rate_limit_usage_percent > 80
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Rate limit usage is high for {{ $labels.service }}"
```

### 3. Alert Escalation

#### Escalation Timeline
```
0-5 minutes:    On-call engineer notification
5-15 minutes:   Senior engineer escalation
15-30 minutes:  Engineering manager escalation
30+ minutes:    Executive escalation
```

#### Auto-Resolution
```yaml
# Alerts that auto-resolve:
- API response time improvements
- Error rate reductions
- Circuit breaker recovery
- Resource usage normalization

# Alerts requiring manual resolution:
- Security incidents
- Data corruption
- External service outages
```

## Dashboard Configuration

### 1. Executive Dashboard

#### Key Metrics
- System uptime (99.9% target)
- User-facing error rate
- Response time trends
- Security incident count
- Business metrics overview

#### Update Frequency
- Real-time for critical metrics
- Hourly for trend analysis
- Daily for business metrics

### 2. Operations Dashboard

#### System Health
- Service status indicators
- Resource utilization graphs
- Error rate trends
- Performance metrics
- Alert status

#### External Dependencies
- API provider status
- Rate limit usage
- Circuit breaker states
- Response time trends

### 3. Security Dashboard

#### Threat Monitoring
- Security event timeline
- Attack pattern analysis
- Blocked IP/user lists
- Authentication metrics
- Vulnerability status

#### Compliance Metrics
- Security scan results
- Audit trail completeness
- Access control effectiveness
- Data protection status

### 4. Business Dashboard

#### Token Discovery Metrics
- New tokens per hour/day
- Quality score distribution
- Chain activity breakdown
- Discovery source analysis

#### User Engagement
- Active WebSocket connections
- API usage patterns
- Feature adoption rates
- Geographic distribution

## Monitoring Tools and Setup

### 1. Application Monitoring

#### Built-in Metrics
```javascript
// Metrics collection in application
import { metrics } from './utils/metrics';

// Counter metrics
metrics.incrementCounter('api_requests_total', 1, {
  method: 'GET',
  endpoint: '/tokens/trending',
  status: '200'
});

// Histogram metrics
metrics.recordHistogram('api_request_duration', duration, {
  method: 'GET',
  endpoint: '/tokens/trending'
});

// Gauge metrics
metrics.setGauge('websocket_connections_active', connectionCount);
```

#### Log Aggregation
```javascript
// Structured logging
logger.info('Token discovered', {
  type: 'token_discovery',
  chain: 'sol',
  address: 'token_address',
  score: 85,
  timestamp: new Date().toISOString()
});

// Error logging
logger.error('External API error', {
  type: 'external_api_error',
  service: 'dexscreener',
  endpoint: '/tokens/sol',
  error: error.message,
  statusCode: 429
});
```

### 2. Infrastructure Monitoring

#### Render Monitoring
```bash
# Built-in metrics available:
# - CPU usage
# - Memory usage
# - Network I/O
# - Request count
# - Response times

# Access via Render dashboard
# API available for programmatic access
```

#### Redis Monitoring
```bash
# Upstash provides:
# - Connection count
# - Memory usage
# - Command statistics
# - Latency metrics

# Monitor via Upstash dashboard
# Alerts available for thresholds
```

### 3. External Service Monitoring

#### API Provider Status
```javascript
// Monitor external API health
const checkExternalAPIs = async () => {
  const apis = [
    { name: 'dexscreener', url: 'https://api.dexscreener.com' },
    { name: 'goplus', url: 'https://api.gopluslabs.io' },
    { name: 'birdeye', url: 'https://public-api.birdeye.so' },
    { name: 'coingecko', url: 'https://api.coingecko.com' }
  ];

  for (const api of apis) {
    try {
      const response = await fetch(`${api.url}/health`);
      metrics.setGauge('external_api_status', response.ok ? 1 : 0, {
        service: api.name
      });
    } catch (error) {
      metrics.setGauge('external_api_status', 0, {
        service: api.name
      });
    }
  }
};
```

## Troubleshooting Monitoring Issues

### 1. Missing Metrics

#### Diagnosis
```bash
# Check metrics endpoint
curl https://your-api-domain.com/metrics

# Verify metric collection in logs
grep "metrics" logs/combined.log | tail -20

# Check metric storage/aggregation
```

#### Resolution
```bash
# Restart metrics collection
# Verify metric definitions
# Check network connectivity
# Review metric retention policies
```

### 2. False Alerts

#### Common Causes
- Incorrect thresholds
- Network blips
- Temporary spikes
- Configuration errors

#### Resolution
```bash
# Adjust alert thresholds
# Add alert dampening
# Improve signal-to-noise ratio
# Review alert logic
```

### 3. Alert Fatigue

#### Prevention
```bash
# Implement alert grouping
# Use intelligent routing
# Set appropriate thresholds
# Regular alert review and tuning
```

## Monitoring Best Practices

### 1. Metric Design
- Use consistent naming conventions
- Include relevant labels/tags
- Avoid high-cardinality metrics
- Document metric meanings

### 2. Alert Design
- Make alerts actionable
- Include context in notifications
- Use appropriate severity levels
- Test alert delivery

### 3. Dashboard Design
- Focus on key metrics
- Use appropriate visualizations
- Include context and annotations
- Regular review and updates

### 4. Data Retention
- Define retention policies
- Balance cost vs. value
- Archive historical data
- Regular cleanup procedures

## Monitoring Maintenance

### Weekly Tasks
- [ ] Review alert effectiveness
- [ ] Check dashboard accuracy
- [ ] Verify metric collection
- [ ] Update thresholds if needed

### Monthly Tasks
- [ ] Analyze monitoring trends
- [ ] Review and update runbooks
- [ ] Test alert escalation
- [ ] Optimize monitoring costs

### Quarterly Tasks
- [ ] Comprehensive monitoring review
- [ ] Update monitoring strategy
- [ ] Evaluate new tools
- [ ] Training and knowledge sharing