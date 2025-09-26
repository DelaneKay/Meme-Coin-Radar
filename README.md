# 🎯 Meme Coin Radar

**Free-tier memecoin early-pump radar with CEX listing detection**

A comprehensive system for detecting early-stage memecoin opportunities through buy/sell imbalance analysis, volume surge detection, price acceleration monitoring, and real-time CEX listing alerts across multiple blockchain networks.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/node.js-18+-green.svg)
![TypeScript](https://img.shields.io/badge/typescript-5.0+-blue.svg)

## 🚀 Features

### 📊 **Multi-Chain Token Analysis**
- **Supported Chains**: Solana, Ethereum, BSC, Base
- **Real-time Data**: DEX Screener, GeckoTerminal, Birdeye (SOL)
- **Volume Analysis**: 5-minute and 15-minute surge detection
- **Price Acceleration**: 1m/5m slope analysis with z-score normalization

### 🛡️ **Security Analysis**
- **GoPlus Integration**: Honeypot detection, tax analysis, contract risks
- **Honeypot.is**: EVM chain verification and simulation
- **Risk Scoring**: Comprehensive penalty system for unsafe tokens
- **Auto-filtering**: Removes scams, high-tax tokens, and honeypots

### 📈 **Advanced Scoring System**
```
Score = 28×Imbalance5 + 28×Z(Surge15) + 16×Z(PriceAccel) + 18×LiquidityQuality + 10×AgeFactor - Penalties + ListingBoost
```

### 🔔 **Real-time Alerts**
- **Discord Webhooks**: Rich embeds with token details
- **Telegram Bot**: Markdown-formatted alerts
- **Custom Webhooks**: JSON payload for integrations
- **De-duplication**: Smart cooldown system (30min alerts, 24h CEX listings)

### 🏢 **CEX Listing Detection**
- **Monitored Exchanges**: KuCoin, Bybit, MEXC, Gate.io, LBank, BitMart
- **Auto-detection**: Scrapes announcement pages for new listings
- **Instant Alerts**: +10 score boost and immediate notifications
- **Token Pinning**: 30-minute dashboard highlighting

### 📱 **Modern Dashboard**
- **Real-time Updates**: WebSocket-powered live data
- **Multiple Leaderboards**: New Mints, 5m Momentum, 15m Continuation, Unusual Volume
- **Advanced Filtering**: Chain, liquidity, age, score, security filters
- **Dark/Light Theme**: Responsive design with Tailwind CSS

### 🎯 **RADAR_ONLY Mode**
- **Focused Interface**: Streamlined UI showing only radar functionality
- **Route Filtering**: API endpoints restricted to core radar features
- **Feature Toggle**: Easily enable/disable advanced trading features
- **Production Ready**: Ideal for public deployments with limited functionality

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   DataCollector │    │    SecAuditor   │    │     Scorer      │
│                 │    │                 │    │                 │
│ • DEX Screener  │    │ • GoPlus API    │    │ • Signal Calc   │
│ • GeckoTerminal │────│ • Honeypot.is   │────│ • Leaderboards  │
│ • Birdeye (SOL) │    │ • Risk Analysis │    │ • Score Formula │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────────┐
                    │  Orchestrator   │
                    │                 │
                    │ • Pipeline Mgmt │
                    │ • Rate Limiting │
                    │ • CEX Boost     │
                    │ • Health Check  │
                    └─────────────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         │                       │                       │
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│    Frontend     │    │    Alerter      │    │  CEX Sentinel   │
│                 │    │                 │    │                 │
│ • Next.js App   │    │ • Discord       │    │ • Exchange      │
│ • Real-time UI  │    │ • Telegram      │    │   Monitoring    │
│ • WebSocket     │    │ • Webhooks      │    │ • Auto-detect   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ 
- **npm** or **yarn**
- **Redis** (optional, falls back to memory cache)

### 1. Clone & Install

```bash
git clone <repository-url>
cd meme-coin-radar
npm install
```

### 2. Environment Setup

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# =============================================================================
# ESSENTIAL CONFIGURATION
# =============================================================================

# Supported chains (comma-separated)
CHAINS=sol,eth,bsc,base

# Alert thresholds
MIN_LIQUIDITY_ALERT=20000
SCORE_ALERT=70
SURGE15_THRESHOLD=2.5
IMBALANCE5_THRESHOLD=0.4

# Refresh intervals (milliseconds)
REFRESH_MS=30000
SENTINEL_REFRESH_MS=120000

# Feature flags
RADAR_ONLY=false

# =============================================================================
# OPTIONAL API KEYS (Free tier works without these)
# =============================================================================

# Birdeye API (for enhanced Solana data)
BIRDEYE_API_KEY=your_birdeye_key

# CoinGecko Pro (for enhanced data)
COINGECKO_API_KEY=your_coingecko_key

# =============================================================================
# ALERT CONFIGURATION
# =============================================================================

# Discord webhook URL
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/your_webhook

# Telegram bot configuration
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Custom webhook URL
WEBHOOK_URL=https://your-webhook-endpoint.com

# =============================================================================
# OPTIONAL: REDIS & DATABASE
# =============================================================================

# Redis for caching (optional)
REDIS_URL=redis://localhost:6379

# SQLite database path
DATABASE_PATH=./data/radar.db
```

### 3. Start Services

#### Development Mode
```bash
# Start all services
npm run dev

# Or start individually
npm run dev:api      # API server (port 3001)
npm run dev:frontend # Frontend (port 3000)
npm run dev:sentinel # CEX Sentinel
```

#### Production Mode
```bash
# Build all services
npm run build

# Start production
npm start
```

### 4. Access Dashboard

Open [http://localhost:3000](http://localhost:3000) to view the dashboard.

## 📊 Default Configuration

### **Filtering Thresholds**
- **Minimum Liquidity**: $12,000 (list) / $20,000 (alerts)
- **Maximum Tax**: 10% (buy or sell)
- **Maximum Age**: 48 hours
- **Minimum Score**: 55 (display) / 70 (alerts)

### **Signal Thresholds**
- **Volume Surge**: 2.5x baseline
- **Buy Imbalance**: 40% buy pressure
- **Security**: Must pass GoPlus + Honeypot.is checks

### **Rate Limits** (Respects free-tier limits)
- **Birdeye**: 0.9 requests/second
- **GoPlus**: 25 requests/minute
- **DEX Screener**: 2 requests/second
- **GeckoTerminal**: 1 request/second

## 🔧 API Endpoints

### **Signals & Data**
```
GET /api/signals/top?limit=20           # Top tokens by score
GET /api/signals/hotlist                # All filtered tokens
GET /api/signals/leaderboards           # All leaderboard categories
GET /api/signals/leaderboards/:category # Specific leaderboard
```

### **Token Details**
```
GET /api/tokens/:chain/:address         # Token details
GET /api/search?q=symbol&chain=sol      # Search tokens
```

### **CEX Listings**
```
GET /api/listings/recent?limit=10       # Recent CEX listings
POST /api/webhooks/cex-listing          # CEX listing webhook
```

### **System**
```
GET /api/health                         # Basic health check
GET /api/health/detailed                # Detailed system status
GET /api/config                         # Current configuration
POST /api/config                        # Update configuration
```

## 🔌 WebSocket Events

Connect to `ws://localhost:3001` for real-time updates:

### **Subscribe to Topics**
```javascript
// Subscribe to hotlist updates
ws.send(JSON.stringify({
  type: 'subscribe',
  data: { topic: 'hotlist' }
}));

// Subscribe to CEX listing alerts
ws.send(JSON.stringify({
  type: 'subscribe',
  data: { topic: 'listings' }
}));
```

### **Event Types**
- `hotlist` - Real-time token updates
- `listing` - CEX listing events
- `health` - System health updates

## 🚨 Alert Setup

### **Discord Webhook**

1. Create a Discord webhook in your server
2. Copy the webhook URL
3. Set `DISCORD_WEBHOOK_URL` in your `.env`

### **Telegram Bot**

1. Create a bot with [@BotFather](https://t.me/botfather)
2. Get your bot token
3. Get your chat ID (send a message to your bot, then visit `https://api.telegram.org/bot<TOKEN>/getUpdates`)
4. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in your `.env`

### **Custom Webhooks**

Set `WEBHOOK_URL` to receive JSON payloads:

```json
{
  "type": "score_alert",
  "token": {
    "chainId": "sol",
    "token": {
      "address": "...",
      "symbol": "MEME",
      "name": "Meme Token"
    },
    "score": 85.2,
    "priceUsd": 0.001234,
    "liquidityUsd": 45000,
    "security": { "ok": true, "flags": [] }
  },
  "timestamp": 1703123456789,
  "message": "High-scoring token detected..."
}
```

## 🏢 CEX Listing Detection

The system monitors these exchanges for new token listings:

- **KuCoin** - Listing announcements page
- **Bybit** - Spot trading announcements
- **MEXC** - New listing notices
- **Gate.io** - Trading announcements
- **LBank** - Listing notices
- **BitMart** - New token announcements

### **Detection Logic**

1. **Scraping**: Monitors announcement pages every 2 minutes (staggered)
2. **Analysis**: Extracts token symbols and contract addresses
3. **Verification**: Cross-references with CoinGecko for address confirmation
4. **Alerting**: Sends immediate alerts with +10 score boost
5. **Pinning**: Highlights token on dashboard for 30 minutes

## 📈 Scoring Formula

The radar uses a sophisticated scoring system (0-100 scale):

```
Score = 28×Imbalance5 + 28×Z(Surge15) + 16×Z(PriceAccel) + 18×LiquidityQuality + 10×AgeFactor - Penalties + Boosts
```

### **Signal Components**

- **Imbalance5** (28 points): `(buys5 - sells5) / max(1, buys5 + sells5)`
- **Surge15** (28 points): `vol15 / baseline(vol15 over 2-4h)` (z-score normalized)
- **PriceAccel** (16 points): Z-score of 1m/5m price slope difference
- **LiquidityQuality** (18 points): `log10(liquidityUsd)` + stability bonus
- **AgeFactor** (10 points): Optimal range 2-48 hours

### **Penalties**
- **Honeypot**: -100 (excluded)
- **High Tax** (>10%): -15
- **Upgradeable Contract**: -12
- **Blacklist Capability**: -12
- **Mintable**: -8
- **Anti-whale**: -5

### **Boosts**
- **CEX Listing**: +10 (30-minute duration)

## 🔧 Advanced Configuration

### **Complete Environment Variables Reference**

#### **Core System Settings**
```env
# Node environment
NODE_ENV=development                    # development | production
PORT=3001                              # API server port
LOG_LEVEL=info                         # error | warn | info | debug

# Supported blockchain networks
CHAINS=sol,eth,bsc,base                # Comma-separated chain IDs

# Data refresh intervals (milliseconds)
REFRESH_MS=30000                       # Main data collection interval
SENTINEL_REFRESH_MS=120000             # CEX monitoring interval
HEALTH_CHECK_INTERVAL=60000            # Health check frequency
```

#### **Rate Limiting Configuration**
```env
# API rate limits (requests per second/minute)
BIRDEYE_RPS=0.9                        # Birdeye API (free tier: 1 RPS)
DEXSCREENER_RPS=2                      # DEX Screener (free tier: 300 RPM)
GECKOTERMINAL_RPS=1                    # GeckoTerminal (free tier: 30 RPM)
GOPLUS_RPM=25                          # GoPlus Security (free tier: 100 RPM)

# Rate limit behavior
RATE_LIMIT_RETRY_ATTEMPTS=3            # Max retry attempts on 429
RATE_LIMIT_BACKOFF_MS=5000            # Initial backoff delay
RATE_LIMIT_MAX_BACKOFF_MS=60000       # Maximum backoff delay
```

#### **Token Filtering Thresholds**
```env
# Minimum requirements for token inclusion
MIN_LIQUIDITY=12000                    # Minimum liquidity USD for listing
MIN_LIQUIDITY_ALERT=20000             # Minimum liquidity USD for alerts
MIN_VOLUME_5M=1000                    # Minimum 5-minute volume USD
MAX_AGE_HOURS=48                      # Maximum token age in hours
MAX_TAX=10                            # Maximum buy/sell tax percentage

# Score thresholds
MIN_SCORE_DISPLAY=55                  # Minimum score for dashboard display
SCORE_ALERT=70                        # Minimum score for alerts
MAX_SCORE=100                         # Maximum possible score
```

#### **Signal Detection Parameters**
```env
# Volume surge detection
SURGE15_THRESHOLD=2.5                 # 15-min volume surge multiplier
SURGE5_THRESHOLD=2.0                  # 5-min volume surge multiplier
BASELINE_WINDOW_HOURS=3               # Hours for baseline calculation

# Buy/sell imbalance
IMBALANCE5_THRESHOLD=0.4              # 5-min buy imbalance threshold (40%)
IMBALANCE_WEIGHT=28                   # Imbalance component weight in score

# Price acceleration
PRICE_ACCEL_WEIGHT=16                 # Price acceleration weight in score
PRICE_SLOPE_WINDOW=5                  # Minutes for price slope calculation
```

#### **Alert System Configuration**
```env
# Alert thresholds and limits
MAX_ALERTS_PER_HOUR=50                # Maximum alerts per hour
ALERT_COOLDOWN_MINUTES=30             # Cooldown between same-token alerts
CEX_LISTING_COOLDOWN_HOURS=24         # CEX listing alert cooldown
DUPLICATE_ALERT_WINDOW=1800           # Seconds to prevent duplicate alerts

# Discord webhook
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/your_webhook
DISCORD_RATE_LIMIT=5                  # Messages per second limit

# Telegram bot
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
TELEGRAM_RATE_LIMIT=1                 # Messages per second limit

# Custom webhook
WEBHOOK_URL=https://your-webhook-endpoint.com
WEBHOOK_TIMEOUT=5000                  # Request timeout in milliseconds
```

#### **Security Analysis Settings**
```env
# Security check configuration
SECURITY_CHECK_TIMEOUT=10000          # Timeout for security API calls
HONEYPOT_CHECK_ENABLED=true           # Enable honeypot detection
GOPLUS_CHECK_ENABLED=true             # Enable GoPlus security checks

# Security penalties (score deductions)
HONEYPOT_PENALTY=100                  # Complete exclusion for honeypots
HIGH_TAX_PENALTY=15                   # Penalty for >10% tax
UPGRADEABLE_PENALTY=12                # Penalty for upgradeable contracts
BLACKLIST_PENALTY=12                  # Penalty for blacklist capability
MINTABLE_PENALTY=8                    # Penalty for mintable tokens
ANTI_WHALE_PENALTY=5                  # Penalty for anti-whale mechanisms
```

#### **Caching and Database**
```env
# Redis configuration (optional)
REDIS_URL=redis://localhost:6379      # Redis connection string
REDIS_TTL_TOKENS=60                   # Token data TTL (seconds)
REDIS_TTL_SECURITY=3600               # Security data TTL (seconds)
REDIS_TTL_LEADERBOARDS=30             # Leaderboard TTL (seconds)

# SQLite database
DATABASE_PATH=./data/radar.db          # Database file path
DATABASE_BACKUP_INTERVAL=3600000      # Backup interval (milliseconds)

# Memory cache settings
MAX_CACHE_SIZE=5000                   # Maximum cached items
CACHE_CLEANUP_INTERVAL=300000         # Cleanup interval (milliseconds)
```

#### **CEX Listing Detection**
```env
# CEX monitoring settings
CEX_MONITORING_ENABLED=true           # Enable CEX listing detection
CEX_LISTING_BOOST=10                  # Score boost for CEX listings
CEX_LISTING_DURATION=1800000          # Boost duration (30 minutes)

# Exchange-specific settings
KUCOIN_ENABLED=true                   # Monitor KuCoin listings
BYBIT_ENABLED=true                    # Monitor Bybit listings
MEXC_ENABLED=true                     # Monitor MEXC listings
GATEIO_ENABLED=true                   # Monitor Gate.io listings
LBANK_ENABLED=true                    # Monitor LBank listings
BITMART_ENABLED=true                  # Monitor BitMart listings
```

#### **Performance and Monitoring**
```env
# Performance settings
MAX_CONCURRENT_REQUESTS=10            # Maximum concurrent API requests
REQUEST_TIMEOUT=15000                 # API request timeout (milliseconds)
MEMORY_LIMIT_MB=512                   # Memory usage limit

# Monitoring and health checks
HEALTH_CHECK_ENABLED=true             # Enable health monitoring
METRICS_COLLECTION=true               # Collect performance metrics
ERROR_REPORTING=true                  # Enable error reporting

# WebSocket settings
WS_HEARTBEAT_INTERVAL=30000           # WebSocket ping interval
WS_MAX_CONNECTIONS=100                # Maximum WebSocket connections
```

#### **Development and Testing**
```env
# Development settings
DEBUG=false                           # Enable debug mode
MOCK_APIS=false                       # Use mock API responses for testing
SKIP_SECURITY_CHECKS=false            # Skip security checks (dev only)

# Testing configuration
TEST_MODE=false                       # Enable test mode
TEST_DATA_ENABLED=false               # Use test data instead of live APIs
UNIT_TEST_TIMEOUT=10000               # Unit test timeout (milliseconds)
```

## 🐛 Troubleshooting

### **Common Issues**

#### **No tokens appearing**
- **Check API rate limits**: Look for `429` errors in logs
- **Verify chain configuration**: Ensure `CHAINS` env var includes desired chains
- **Review thresholds**: Lower `MIN_LIQUIDITY` and `SCORE_ALERT` temporarily
- **Check data sources**: DEX Screener may return 404s for new pairs (expected)

#### **Alerts not working**
- **Discord**: Verify webhook URL format and server permissions
- **Telegram**: Ensure bot token is valid and chat ID is correct
- **Rate limiting**: Check if alert cooldowns are preventing notifications
- **Score thresholds**: Verify `SCORE_ALERT` isn't set too high

#### **High memory usage**
- **Enable Redis**: Set `REDIS_URL` to offload memory cache
- **Reduce intervals**: Increase `REFRESH_MS` to 60000+ 
- **Lower limits**: Reduce token processing limits in config
- **Clear cache**: Restart services to clear accumulated data

#### **Rate limit errors (429 responses)**
- **Expected behavior**: DEX Screener 404s are normal for new pairs
- **Backoff strategy**: System automatically implements exponential backoff
- **API keys**: Add `BIRDEYE_API_KEY` and `COINGECKO_API_KEY` for higher limits
- **Monitor status**: Check `/api/health/detailed` for rate limit status

#### **DataCollector not starting**
- **Discovery phase**: Initial startup may take 2-3 minutes for chain discovery
- **Rate limiting**: System respects API limits during startup
- **Logs**: Check for "Discovery completed" message in logs
- **Fallback**: System uses cached data if APIs are unavailable

#### **WebSocket connection issues**
- **Port conflicts**: Ensure port 3001 is available
- **Firewall**: Check if WebSocket connections are blocked
- **Browser**: Try refreshing the dashboard page
- **Logs**: Check for WebSocket errors in browser console

### **Debug Mode**

Enable detailed logging:

```env
LOG_LEVEL=debug
DEBUG=true
NODE_ENV=development
```

### **Health Monitoring**

#### **API Endpoints**
- **Basic health**: `GET /api/health`
- **Detailed status**: `GET /api/health/detailed`
- **Cache status**: `GET /api/status/cache`
- **Configuration**: `GET /api/config`

#### **Health Check Response**
```json
{
  "status": "healthy",
  "timestamp": 1703123456789,
  "services": {
    "dataCollector": {
      "status": "healthy",
      "lastUpdate": 1703123456789,
      "pairsProcessed": 1250,
      "apiErrors": 12,
      "rateLimitHits": 3
    },
    "secAuditor": {
      "status": "healthy",
      "pendingChecks": 5,
      "completedChecks": 890
    },
    "scorer": {
      "status": "healthy",
      "leaderboards": {
        "new_mints": 45,
        "momentum_5m": 32,
        "unusual_volume": 18
      }
    }
  }
}
```

### **Log Analysis**

#### **Key Log Messages**
- `Discovery completed for chain: sol` - DataCollector ready
- `Rate limit hit for service: dexscreener` - Expected rate limiting
- `Security check completed` - Token security analysis done
- `Score calculated: 85.2` - Token scoring complete
- `Alert sent via discord` - Notification delivered

#### **Error Patterns**
- `404 errors from DEX Screener` - **Normal**: New pairs not yet indexed
- `429 Too Many Requests` - **Normal**: Rate limiting active
- `ECONNRESET` - **Network**: Temporary connection issues
- `Invalid token address` - **Data**: Malformed API responses

### **Performance Tuning**

#### **Memory Optimization**
```env
# Reduce cache sizes
MAX_CACHE_SIZE=1000
BASELINE_HISTORY_SIZE=12
PRICE_HISTORY_SIZE=5

# Increase cleanup intervals
CACHE_CLEANUP_INTERVAL=300000
```

#### **Rate Limit Tuning**
```env
# Conservative settings for free tiers
BIRDEYE_RPS=0.5
DEXSCREENER_RPS=1.5
GOPLUS_RPM=20
GECKOTERMINAL_RPS=0.8
```

#### **Alert Optimization**
```env
# Prevent alert spam
MAX_ALERTS_PER_HOUR=30
ALERT_COOLDOWN_MINUTES=45
DUPLICATE_ALERT_WINDOW=1800
```

## 📊 Performance Optimization

### **Caching Strategy**

- **Token Data**: 1 minute TTL
- **Security Reports**: 1 hour TTL
- **Leaderboards**: 30 seconds TTL
- **Rate Limits**: Dynamic TTL based on reset time

### **Memory Management**

- **Baseline History**: 24 data points (2-4 hours)
- **Price History**: 10 data points (1m/5m slopes)
- **Alert History**: 1 hour retention
- **Cache Cleanup**: Every 5 minutes

### **Rate Limit Optimization**

- **Token Bucket**: Burst handling with refill rates
- **Exponential Backoff**: 429 response handling
- **Request Queuing**: Prevents overwhelming APIs
- **Staggered Requests**: Distributes load across time

## 🚀 Deployment

### **Vercel (Frontend)**

```bash
cd frontend
npm run build
# Deploy to Vercel
```

### **Render/Railway (API)**

```dockerfile
# Dockerfile for API
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["npm", "start"]
```

### **Cloudflare Workers (Sentinel)**

The CEX Sentinel can be deployed as a Cloudflare Worker with cron triggers.

### **Environment Variables**

Ensure all production environment variables are set:

```env
NODE_ENV=production
PORT=3001
REDIS_URL=redis://your-redis-url

# Feature flags
RADAR_ONLY=false                          # Set to true for limited functionality
NEXT_PUBLIC_RADAR_ONLY=false              # Frontend feature toggle

# ... other production configs
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## ⚠️ Disclaimer

This tool is for educational and research purposes only. Always conduct your own research before making any investment decisions. The authors are not responsible for any financial losses incurred from using this software.

## 🙏 Acknowledgments

- **DEX Screener** - Token pair data
- **GeckoTerminal** - OHLC data
- **Birdeye** - Solana ecosystem data
- **GoPlus** - Security analysis
- **Honeypot.is** - EVM honeypot detection

---

**Built with ❤️ for the DeFi community**

For support, join our [Discord](https://discord.gg/your-server) or open an issue on GitHub.