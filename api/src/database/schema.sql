-- Meme Coin Radar Database Schema
-- SQLite database for storing token data, cache, and alert history

-- Tokens table for storing basic token information
CREATE TABLE IF NOT EXISTS tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT NOT NULL,
    chain_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    name TEXT,
    decimals INTEGER DEFAULT 18,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(address, chain_id)
);

-- Token metrics for storing real-time data
CREATE TABLE IF NOT EXISTS token_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_id INTEGER NOT NULL,
    price_usd REAL,
    price_change_5m REAL DEFAULT 0,
    price_change_15m REAL DEFAULT 0,
    price_change_1h REAL DEFAULT 0,
    price_change_24h REAL DEFAULT 0,
    volume_usd_5m REAL DEFAULT 0,
    volume_usd_15m REAL DEFAULT 0,
    volume_usd_1h REAL DEFAULT 0,
    volume_usd_24h REAL DEFAULT 0,
    liquidity_usd REAL DEFAULT 0,
    market_cap_usd REAL DEFAULT 0,
    holders_count INTEGER DEFAULT 0,
    age_minutes INTEGER DEFAULT 0,
    score REAL DEFAULT 0,
    momentum_score REAL DEFAULT 0,
    volume_score REAL DEFAULT 0,
    liquidity_score REAL DEFAULT 0,
    security_score REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (token_id) REFERENCES tokens (id) ON DELETE CASCADE
);

-- Security analysis results
CREATE TABLE IF NOT EXISTS token_security (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_id INTEGER NOT NULL,
    is_honeypot BOOLEAN DEFAULT FALSE,
    is_rugpull BOOLEAN DEFAULT FALSE,
    is_scam BOOLEAN DEFAULT FALSE,
    has_high_tax BOOLEAN DEFAULT FALSE,
    has_mint_function BOOLEAN DEFAULT FALSE,
    has_proxy BOOLEAN DEFAULT FALSE,
    has_blacklist BOOLEAN DEFAULT FALSE,
    buy_tax REAL DEFAULT 0,
    sell_tax REAL DEFAULT 0,
    security_flags TEXT, -- JSON array of flags
    risk_level TEXT DEFAULT 'unknown', -- low, medium, high, critical
    last_checked DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (token_id) REFERENCES tokens (id) ON DELETE CASCADE
);

-- Cache table for API responses
CREATE TABLE IF NOT EXISTS cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cache_key TEXT UNIQUE NOT NULL,
    cache_value TEXT NOT NULL, -- JSON data
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Rate limiting tracking
CREATE TABLE IF NOT EXISTS rate_limits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_name TEXT NOT NULL,
    endpoint TEXT,
    requests_count INTEGER DEFAULT 1,
    window_start DATETIME DEFAULT CURRENT_TIMESTAMP,
    reset_time DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Alert history
CREATE TABLE IF NOT EXISTS alert_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_id INTEGER,
    alert_type TEXT NOT NULL, -- score_alert, cex_listing, security_warning
    title TEXT NOT NULL,
    message TEXT,
    score REAL,
    exchange TEXT, -- for CEX listings
    channels TEXT, -- JSON array of channels sent to (discord, telegram, webhook)
    metadata TEXT, -- JSON metadata
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (token_id) REFERENCES tokens (id) ON DELETE SET NULL
);

-- CEX listing events
CREATE TABLE IF NOT EXISTS cex_listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_id INTEGER,
    exchange TEXT NOT NULL,
    symbol TEXT NOT NULL,
    announcement_url TEXT,
    listing_date DATETIME,
    boost_applied BOOLEAN DEFAULT FALSE,
    boost_expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (token_id) REFERENCES tokens (id) ON DELETE SET NULL
);

-- Leaderboard snapshots for historical data
CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL, -- new_mints, momentum_5m, continuation_15m, unusual_volume, top_gainers
    token_data TEXT NOT NULL, -- JSON array of token summaries
    snapshot_time DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- System health metrics
CREATE TABLE IF NOT EXISTS health_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_name TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    metric_value REAL,
    status TEXT DEFAULT 'ok', -- ok, warning, error
    details TEXT, -- JSON details
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_tokens_chain_address ON tokens(chain_id, address);
CREATE INDEX IF NOT EXISTS idx_token_metrics_token_id ON token_metrics(token_id);
CREATE INDEX IF NOT EXISTS idx_token_metrics_score ON token_metrics(score DESC);
CREATE INDEX IF NOT EXISTS idx_token_metrics_created_at ON token_metrics(created_at);
CREATE INDEX IF NOT EXISTS idx_token_security_token_id ON token_security(token_id);
CREATE INDEX IF NOT EXISTS idx_cache_key ON cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_rate_limits_api ON rate_limits(api_name, window_start);
CREATE INDEX IF NOT EXISTS idx_alert_history_type ON alert_history(alert_type, sent_at);
CREATE INDEX IF NOT EXISTS idx_cex_listings_exchange ON cex_listings(exchange, created_at);
CREATE INDEX IF NOT EXISTS idx_leaderboard_category ON leaderboard_snapshots(category, snapshot_time);
CREATE INDEX IF NOT EXISTS idx_health_metrics_service ON health_metrics(service_name, recorded_at);

-- Triggers for updating timestamps
CREATE TRIGGER IF NOT EXISTS update_tokens_timestamp 
    AFTER UPDATE ON tokens
    BEGIN
        UPDATE tokens SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

-- Clean up expired cache entries
CREATE TRIGGER IF NOT EXISTS cleanup_expired_cache
    AFTER INSERT ON cache
    BEGIN
        DELETE FROM cache WHERE expires_at < CURRENT_TIMESTAMP;
    END;

-- Clean up old rate limit entries (keep last 24 hours)
CREATE TRIGGER IF NOT EXISTS cleanup_old_rate_limits
    AFTER INSERT ON rate_limits
    BEGIN
        DELETE FROM rate_limits WHERE created_at < datetime('now', '-24 hours');
    END;

-- Clean up old health metrics (keep last 7 days)
CREATE TRIGGER IF NOT EXISTS cleanup_old_health_metrics
    AFTER INSERT ON health_metrics
    BEGIN
        DELETE FROM health_metrics WHERE recorded_at < datetime('now', '-7 days');
    END;

-- Clean up old leaderboard snapshots (keep last 30 days)
CREATE TRIGGER IF NOT EXISTS cleanup_old_leaderboard_snapshots
    AFTER INSERT ON leaderboard_snapshots
    BEGIN
        DELETE FROM leaderboard_snapshots WHERE snapshot_time < datetime('now', '-30 days');
    END;