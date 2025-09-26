# Deployment Setup Guide

This guide walks you through setting up the Meme Coin Radar stack on free-tier cloud platforms.

## Prerequisites

- GitHub account with repository access
- Vercel account (free tier)
- Render account (free tier)
- Upstash account (free tier)
- Discord webhook URL (optional)
- Telegram bot token (optional)

## 1. Upstash Redis Setup

### Create Redis Database
1. Go to [Upstash Console](https://console.upstash.com/)
2. Click "Create Database"
3. Choose:
   - **Name**: `meme-coin-radar-cache`
   - **Region**: `us-east-1` (or closest to your users)
   - **Type**: `Regional`
   - **TLS**: `Enabled`
4. Click "Create"

### Get Connection Details
After creation, copy these values:
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `REDIS_URL` (for traditional Redis clients)
- `REDIS_PASSWORD`

## 2. Render Setup

### Create Account & Connect GitHub
1. Go to [Render](https://render.com/)
2. Sign up with GitHub
3. Connect your repository

### Deploy API Service
1. Click "New +" → "Web Service"
2. Connect your GitHub repository
3. Configure:
   - **Name**: `meme-coin-radar-api`
   - **Region**: `Oregon (US West)`
   - **Branch**: `main`
   - **Runtime**: `Docker`
   - **Dockerfile Path**: `./infra/docker/Dockerfile`
   - **Docker Context**: `.`
   - **Plan**: `Free`

### Configure Environment Variables
Create these Environment Variable Groups in Render:

#### Group: `api-keys`
```
BIRDEYE_API_KEY=your_birdeye_key_here
GOPLUS_API_KEY=your_goplus_key_here
COINGECKO_API_KEY=your_coingecko_key_here
```

#### Group: `webhooks`
```
DISCORD_WEBHOOK_URL=your_discord_webhook_url
DISCORD_ALERTS_WEBHOOK_URL=your_alerts_webhook_url
DISCORD_ERRORS_WEBHOOK_URL=your_errors_webhook_url
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id
LISTING_WEBHOOK_URL=your_listing_webhook_url
WEBHOOK_SECRET=auto_generated_secret
```

#### Group: `cache-config`
```
REDIS_URL=your_upstash_redis_url
REDIS_TOKEN=your_upstash_redis_token
REDIS_PASSWORD=your_upstash_redis_password
```

#### Group: `frontend-urls`
```
CORS_ORIGIN=https://meme-coin-radar.vercel.app
NEXT_PUBLIC_API_URL=https://meme-coin-radar-api.onrender.com
NEXT_PUBLIC_WS_URL=wss://meme-coin-radar-api.onrender.com
```

### Deploy Sentinel Cron Job
1. Click "New +" → "Cron Job"
2. Configure:
   - **Name**: `meme-coin-radar-sentinel`
   - **Region**: `Oregon (US West)`
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install && npm run build --workspace=sentinel`
   - **Start Command**: `npm run start --workspace=sentinel`
   - **Schedule**: `*/2 * * * *` (every 2 minutes)
   - **Plan**: `Free`

## 3. Vercel Setup

### Create Project
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click "New Project"
3. Import your GitHub repository
4. Configure:
   - **Framework Preset**: `Next.js`
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build --workspace=frontend`
   - **Output Directory**: `frontend/.next`
   - **Install Command**: `npm install`

### Configure Environment Variables
Add these in Vercel Project Settings → Environment Variables:

#### Production Environment
```
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://meme-coin-radar-api.onrender.com
NEXT_PUBLIC_WS_URL=wss://meme-coin-radar-api.onrender.com
NEXT_PUBLIC_APP_NAME=Meme Coin Radar
NEXT_PUBLIC_APP_VERSION=1.0.0
NEXT_PUBLIC_ENABLE_ANALYTICS=false
NEXT_PUBLIC_ENABLE_DEBUG=false
NEXT_PUBLIC_ENABLE_NOTIFICATIONS=true
NEXT_PUBLIC_ENABLE_SOUND_ALERTS=true
NEXT_PUBLIC_DEFAULT_THEME=dark
NEXT_PUBLIC_REFRESH_INTERVAL_MS=5000
NEXT_PUBLIC_MAX_TOKENS_DISPLAY=100
```

#### Preview Environment
```
NODE_ENV=preview
NEXT_PUBLIC_API_URL=https://meme-coin-radar-api-staging.onrender.com
NEXT_PUBLIC_WS_URL=wss://meme-coin-radar-api-staging.onrender.com
NEXT_PUBLIC_ENABLE_DEBUG=true
```

### Configure Domains
1. Go to Project Settings → Domains
2. Add your custom domain (optional)
3. Configure DNS records as instructed

## 4. GitHub Actions Setup

### Repository Secrets
Add these secrets in GitHub Repository Settings → Secrets and Variables → Actions:

#### Render Secrets
```
RENDER_API_KEY=your_render_api_key
RENDER_SERVICE_ID=your_api_service_id
RENDER_CRON_ID=your_sentinel_cron_id
```

#### Vercel Secrets
```
VERCEL_TOKEN=your_vercel_token
VERCEL_ORG_ID=your_vercel_org_id
VERCEL_PROJECT_ID=your_vercel_project_id
```

#### Discord Notifications
```
DISCORD_WEBHOOK_URL=your_ci_discord_webhook
```

### Enable Workflows
1. Push your code to trigger the workflows
2. Check Actions tab for build status
3. Verify deployments in Render and Vercel dashboards

## 5. API Keys Setup

### Birdeye API (Optional)
1. Go to [Birdeye API](https://docs.birdeye.so/)
2. Sign up for free tier
3. Get API key (1 RPS limit)
4. Add to Render environment variables

### GoPlus Security API (Optional)
1. Go to [GoPlus Labs](https://gopluslabs.io/)
2. Sign up for free tier
3. Get API key (~30 RPM limit)
4. Add to Render environment variables

### CoinGecko API (Optional)
1. Go to [CoinGecko API](https://www.coingecko.com/en/api)
2. Sign up for free tier
3. Get API key
4. Add to Render environment variables

## 6. Discord/Telegram Setup

### Discord Webhooks
1. Create Discord server or use existing
2. Go to Server Settings → Integrations → Webhooks
3. Create webhooks for:
   - General alerts
   - Error notifications
   - CEX listing alerts
4. Copy webhook URLs to Render environment variables

### Telegram Bot
1. Message @BotFather on Telegram
2. Create new bot with `/newbot`
3. Get bot token
4. Get chat ID by messaging bot and checking updates
5. Add to Render environment variables

## 7. Monitoring Setup

### Health Checks
- API Health: `https://your-api.onrender.com/health`
- Frontend Health: `https://your-frontend.vercel.app/api/health`

### Log Monitoring
- Render: Check service logs in dashboard
- Vercel: Check function logs in dashboard
- Upstash: Monitor Redis usage in console

### Alerts Setup
Configure alerts for:
- API downtime (>5 minutes)
- High error rate (>5% over 5 minutes)
- Redis connection failures
- Rate limit violations (429 errors)

## 8. Security Checklist

- [ ] All API keys stored in environment variables
- [ ] No secrets committed to repository
- [ ] CORS configured for frontend domain only
- [ ] Rate limiting enabled on all APIs
- [ ] Security headers configured
- [ ] HTTPS enforced on all endpoints
- [ ] Webhook secrets configured
- [ ] Input validation enabled

## 9. Performance Optimization

### Free Tier Limits
- **Render**: 750 hours/month, sleeps after 15min inactivity
- **Vercel**: 100GB bandwidth, 1000 serverless invocations
- **Upstash**: 10K commands/day, 256MB storage

### Optimization Tips
1. Enable Redis caching to reduce API calls
2. Set conservative rate limits to avoid 429 errors
3. Use WebSocket for real-time updates to reduce polling
4. Implement circuit breakers for external APIs
5. Monitor memory usage to avoid OOM errors

## 10. Troubleshooting

### Common Issues

#### API Service Won't Start
- Check Dockerfile syntax
- Verify all required environment variables are set
- Check build logs for dependency issues

#### Frontend Build Fails
- Verify Node.js version (18.17.0+)
- Check for missing environment variables
- Review build logs for syntax errors

#### Redis Connection Fails
- Verify Upstash credentials
- Check network connectivity
- Ensure TLS is enabled

#### Rate Limit Errors
- Reduce rate limit settings
- Implement exponential backoff
- Check API provider limits

### Debug Commands
```bash
# Check API health
curl https://your-api.onrender.com/health

# Test WebSocket connection
wscat -c wss://your-api.onrender.com

# Check Redis connection
redis-cli -u your_redis_url ping
```

## 11. Deployment Verification

After deployment, verify:
- [ ] API responds to health checks
- [ ] Frontend loads and displays data
- [ ] WebSocket connections work
- [ ] Alerts are sent to Discord/Telegram
- [ ] Sentinel cron job runs every 2 minutes
- [ ] Redis caching is working
- [ ] Rate limiting is enforced
- [ ] Security headers are present
- [ ] HTTPS is enforced
- [ ] Error tracking is working

## 12. Maintenance

### Daily Tasks
- Monitor error rates and performance
- Check rate limit usage
- Review alert notifications

### Weekly Tasks
- Update dependencies if needed
- Review and rotate API keys
- Check free tier usage limits

### Monthly Tasks
- Review and optimize performance
- Update documentation
- Backup configuration and data

## Support

For issues:
1. Check the troubleshooting section above
2. Review logs in Render/Vercel dashboards
3. Check GitHub Issues for known problems
4. Create new issue with detailed error information