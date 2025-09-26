# Alert Rules Summary - Meme Coin Radar

## Overview

This document provides a comprehensive summary of all active alert rules and configurations in the Meme Coin Radar system.

**Generated**: September 26, 2025 10:20 UTC  
**System Version**: 1.0.0  
**Environment**: Production Active

## 🚨 Production Alert Configuration

### Active Alert Types (RESTRICTED)
✅ **RADAR Momentum Alerts** - High-scoring token detection  
✅ **CEX Listing Alerts** - Exchange listing notifications  
❌ **Portfolio Alerts** - Disabled in RADAR_ONLY mode  
❌ **Trade Action Alerts** - Disabled in RADAR_ONLY mode  
❌ **Wallet Integration Alerts** - Disabled in RADAR_ONLY mode

### Production Channels
- **Discord Webhook:** `DISCORD_WEBHOOK_URL_PROD` (configured)
- **Telegram Bot:** `TELEGRAM_BOT_TOKEN_PROD` + `TELEGRAM_CHAT_ID_PROD` (configured)
- **Environment:** Production mode active

### Active Thresholds
- **RADAR_MOMENTUM_THRESHOLD:** 75 (increased for production)
- **CEX_LISTING_COOLDOWN_HOURS:** 24 (one alert per exchange per day)
- **ALERT_TYPES_ENABLED:** RADAR_MOMENTUM,CEX_LISTING (restricted)

## Alert Types

### 1. Score-Based Alerts

#### High Score Threshold Alert
- **Trigger**: Token score ≥ `SCORE_ALERT` (default: 70)
- **Frequency**: Real-time, with 30-minute cooldown per token
- **Channels**: Discord, Telegram, Custom Webhook
- **Payload**: Full token details, score breakdown, security analysis

#### Score Components
```
Score = 28×Imbalance5 + 28×Z(Surge15) + 16×Z(PriceAccel) + 18×LiquidityQuality + 10×AgeFactor - Penalties + Boosts
```

**Thresholds**:
- `SURGE15_MIN`: 2.5 (15-minute volume surge multiplier)
- `IMBALANCE5_MIN`: 0.4 (5-minute buy/sell imbalance ratio)
- `MIN_LIQ_ALERT`: $20,000 (minimum liquidity for alerts)

### 2. CEX Listing Alerts

#### New Exchange Listing Detection
- **Trigger**: Token detected on monitored CEX announcement pages
- **Frequency**: Immediate, with 24-hour de-duplication per exchange
- **Score Boost**: +10 points applied automatically
- **Dashboard**: Token pinned for 30 minutes
- **Channels**: All configured alert channels

#### Monitored Exchanges
- KuCoin (announcements page)
- Bybit (spot trading announcements)
- MEXC (new listing notices)
- Gate.io (trading announcements)
- LBank (listing notices)
- BitMart (new token announcements)

### 3. Security-Based Filtering

#### Automatic Exclusions
- **Honeypots**: Complete exclusion (-100 score penalty)
- **High Tax Tokens**: >10% tax (-15 score penalty)
- **Upgradeable Contracts**: (-12 score penalty)
- **Blacklist Capability**: (-12 score penalty)
- **Mintable Tokens**: (-8 score penalty)
- **Anti-Whale Mechanisms**: (-5 score penalty)

## Alert Channels Configuration

### Discord Webhooks
- **Format**: Rich embeds with token details
- **Rate Limit**: Respects Discord API limits
- **Retry Logic**: Exponential backoff on failures
- **Configuration**: `DISCORD_WEBHOOK_URL`

### Telegram Bot
- **Format**: Markdown-formatted messages
- **Rate Limit**: 30 messages per second
- **Configuration**: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

### Custom Webhooks
- **Format**: JSON payload
- **Timeout**: 10 seconds
- **Retry**: 3 attempts with backoff
- **Configuration**: `WEBHOOK_URL`

## Alert Frequency Controls

### Cooldown Mechanisms
- **Score Alerts**: 30 minutes per token
- **CEX Listing Alerts**: 24 hours per exchange/token pair
- **System Health Alerts**: 1 hour for repeated issues

### Rate Limiting
- **Maximum Alerts per Hour**: 30 (configurable)
- **Burst Protection**: Token bucket algorithm
- **Backoff Strategy**: Exponential backoff on channel failures

## Chain-Specific Configuration

### Supported Chains
- **Solana (SOL)**: Primary focus, Birdeye integration
- **Ethereum (ETH)**: DEX Screener + GeckoTerminal
- **Binance Smart Chain (BSC)**: DEX Screener + GeckoTerminal
- **Base**: DEX Screener + GeckoTerminal

### Chain Toggles
```env
CHAINS=sol,eth,bsc,base
```

### Minimum Liquidity by Chain
- **SOL**: $20,000 (configurable via `MIN_LIQ_ALERT`)
- **ETH**: $20,000
- **BSC**: $20,000
- **BASE**: $20,000

## Alert Payload Examples

### Score Alert Payload
```json
{
  "type": "score_alert",
  "token": {
    "chainId": "sol",
    "address": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "symbol": "MEME",
    "name": "Meme Token",
    "priceUsd": 0.001234,
    "liquidityUsd": 45000,
    "score": 85.2,
    "scoreBreakdown": {
      "imbalance5": 0.65,
      "surge15": 3.2,
      "priceAccel": 1.8,
      "liquidityQuality": 0.9,
      "ageFactor": 0.8,
      "penalties": 0,
      "boosts": 0
    },
    "security": {
      "ok": true,
      "honeypot": false,
      "buyTax": 0.05,
      "sellTax": 0.05,
      "flags": []
    }
  },
  "timestamp": 1703123456789,
  "message": "High-scoring token detected: MEME (85.2 points)"
}
```

### CEX Listing Alert Payload
```json
{
  "type": "cex_listing",
  "event": {
    "exchange": "kucoin",
    "symbol": "MEME",
    "address": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "chainId": "sol",
    "listingTime": "2024-01-15T10:00:00Z",
    "tradingPairs": ["MEME/USDT", "MEME/BTC"],
    "announcementUrl": "https://www.kucoin.com/news/en-meme-token-listing"
  },
  "token": {
    "score": 95.2,
    "priceUsd": 0.002468,
    "liquidityUsd": 125000,
    "scoreBoost": 10
  },
  "timestamp": 1703123456789,
  "message": "CEX listing detected: MEME on KuCoin"
}
```

## Monitoring and Health Checks

### Alert System Health
- **Endpoint**: `/api/health/detailed`
- **Metrics**: Alert queue size, delivery success rate, channel status
- **Alerting**: System health alerts for critical failures

### Performance Metrics
- **Alert Latency**: Target <5 seconds from detection to delivery
- **Delivery Success Rate**: Target >95% across all channels
- **False Positive Rate**: Target <10% for score alerts

## Configuration Management

### Environment Variables
```env
# Alert Thresholds
SCORE_ALERT=70
SURGE15_MIN=2.5
IMBALANCE5_MIN=0.4
MIN_LIQ_ALERT=20000

# Alert Channels
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
WEBHOOK_URL=https://your-webhook-endpoint.com

# Rate Limiting
MAX_ALERTS_PER_HOUR=30
ALERT_COOLDOWN_MINUTES=30
CEX_LISTING_COOLDOWN_HOURS=24

# Security Penalties
HONEYPOT_PENALTY=100
HIGH_TAX_PENALTY=15
UPGRADEABLE_PENALTY=12
BLACKLIST_PENALTY=12
MINTABLE_PENALTY=8
ANTI_WHALE_PENALTY=5
```

### Runtime Configuration
- **API Endpoint**: `/api/config`
- **Update Endpoint**: `/api/config/update` (admin only)
- **Validation**: All configuration changes are validated before application

## Troubleshooting

### Common Issues

#### No Alerts Being Sent
1. Check alert thresholds - may be set too high
2. Verify webhook URLs and tokens
3. Check rate limiting status
4. Review security filtering - tokens may be excluded

#### Too Many False Positives
1. Increase `SCORE_ALERT` threshold
2. Adjust `SURGE15_MIN` and `IMBALANCE5_MIN`
3. Increase `MIN_LIQ_ALERT` for higher quality tokens
4. Review security penalty configuration

#### Missing CEX Listings
1. Check Sentinel service status
2. Verify exchange monitoring is active
3. Review announcement page parsing logic
4. Check for rate limiting on exchange APIs

### Debug Commands
```bash
# Check alert system status
curl http://localhost:3001/api/health/detailed

# View current configuration
curl http://localhost:3001/api/config

# Test webhook delivery
curl -X POST http://localhost:3001/api/alerts/test

# Check recent alerts
curl http://localhost:3001/api/alerts/history
```

## Security Considerations

### Alert Content Security
- No sensitive API keys in alert payloads
- Token addresses validated before inclusion
- Rate limiting prevents spam attacks
- Webhook URLs validated for HTTPS

### Access Control
- Configuration updates require authentication
- Alert history access is logged
- Webhook endpoints should implement verification
- Rate limiting protects against abuse

## Maintenance

### Regular Tasks
- **Weekly**: Review alert performance metrics
- **Monthly**: Analyze false positive rates and adjust thresholds
- **Quarterly**: Review and update monitored exchanges
- **As Needed**: Update security penalty weights based on market conditions

### Backup and Recovery
- Alert configuration backed up daily
- Alert history retained for 30 days
- Webhook delivery logs retained for 7 days
- Configuration changes are versioned and reversible

---

**Last Updated**: ${new Date().toISOString()}  
**Next Review**: ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}