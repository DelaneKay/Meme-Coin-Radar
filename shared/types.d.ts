export type ChainId = "sol" | "eth" | "bsc" | "base";
export interface TokenSummary {
    chainId: ChainId;
    token: {
        address: string;
        symbol: string;
        name: string;
    };
    pairAddress: string;
    priceUsd: number;
    buys5: number;
    sells5: number;
    vol5Usd: number;
    vol15Usd: number;
    liquidityUsd: number;
    fdvUsd?: number;
    ageMinutes: number;
    score: number;
    reasons: string[];
    security: {
        ok: boolean;
        flags: string[];
    };
    links: {
        dexscreener: string;
        chart?: string;
    };
}
export interface SecurityReport {
    address: string;
    security_ok: boolean;
    penalty: number;
    flags: string[];
    sources: string[];
}
export interface CEXListingEvent {
    source: "cex_listing";
    exchange: string;
    markets: string[];
    urls: string[];
    token: {
        symbol: string;
        address: string;
        chainId: string;
    };
    confirmation: "address" | "coingecko";
    radarScore: number;
    liquidityUsd: number;
    ts: number;
}
export interface DexScreenerPair {
    chainId: string;
    dexId: string;
    url: string;
    pairAddress: string;
    baseToken: {
        address: string;
        name: string;
        symbol: string;
    };
    quoteToken: {
        address: string;
        name: string;
        symbol: string;
    };
    priceNative: string;
    priceUsd: string;
    txns: {
        m5: {
            buys: number;
            sells: number;
        };
        h1: {
            buys: number;
            sells: number;
        };
        h6: {
            buys: number;
            sells: number;
        };
        h24: {
            buys: number;
            sells: number;
        };
    };
    volume: {
        m5: number;
        h1: number;
        h6: number;
        h24: number;
    };
    priceChange: {
        m5: number;
        h1: number;
        h6: number;
        h24: number;
    };
    liquidity?: {
        usd?: number;
        base: number;
        quote: number;
    };
    fdv?: number;
    pairCreatedAt?: number;
    info?: {
        imageUrl?: string;
        websites?: {
            label: string;
            url: string;
        }[];
        socials?: {
            type: string;
            url: string;
        }[];
    };
    boosts?: {
        active: number;
    };
}
export interface GoPlusSecurityData {
    code: string;
    message: string;
    result: {
        [address: string]: {
            is_honeypot: string;
            honeypot_with_same_creator: string;
            fake_token: string;
            is_blacklisted: string;
            is_whitelisted: string;
            is_in_dex: string;
            buy_tax: string;
            sell_tax: string;
            slippage_modifiable: string;
            is_proxy: string;
            is_mintable: string;
            can_take_back_ownership: string;
            owner_change_balance: string;
            hidden_owner: string;
            selfdestruct: string;
            external_call: string;
            gas_abuse: string;
            is_anti_whale: string;
            anti_whale_modifiable: string;
            cannot_buy: string;
            cannot_sell_all: string;
            trading_cooldown: string;
            is_true_token: string;
            is_airdrop_scam: string;
            trust_list: string;
            other_potential_risks: string;
            note: string;
            holders: string;
            total_supply: string;
            valid: string;
        };
    };
}
export interface HoneypotIsResponse {
    status: string;
    message?: string;
    honeypotResult: {
        isHoneypot: boolean;
    };
    simulationResult: {
        buyTax: number;
        sellTax: number;
        transferTax: number;
    };
    holderAnalysis: {
        holders: string;
        successful: boolean;
    };
    summary: {
        risk: string;
        riskLevel: number;
    };
}
export interface BirdeyeTokenData {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    logoURI?: string;
    price: number;
    priceChange24h: number;
    volume24h: number;
    liquidity: number;
    fdv: number;
    mc: number;
    holder: number;
    supply: number;
    extensions?: {
        coingeckoId?: string;
    };
}
export interface GeckoTerminalOHLC {
    data: {
        id: string;
        type: string;
        attributes: {
            ohlcv_list: [number, number, number, number, number, number][];
        };
    };
}
export interface ScoringSignals {
    imbalance5: number;
    surge15: number;
    priceAccel: number;
    liquidityQuality: number;
    ageFactor: number;
    securityPenalty: number;
    listingBoost: number;
}
export type LeaderboardCategory = "new_mints" | "momentum_5m" | "continuation_15m" | "unusual_volume";
export interface AlertPayload {
    type: "score_alert" | "cex_listing";
    token: TokenSummary;
    event?: CEXListingEvent;
    timestamp: number;
    message: string;
}
export interface RateLimitStatus {
    service: string;
    remaining: number;
    resetTime: number;
    isLimited: boolean;
}
export interface HealthCheckResponse {
    status: "healthy" | "degraded" | "unhealthy";
    timestamp: number;
    services: {
        [serviceName: string]: {
            status: "up" | "down" | "degraded";
            lastCheck: number;
            error?: string;
        };
    };
    rateLimits: RateLimitStatus[];
}
export interface RadarConfig {
    chains: ChainId[];
    minLiquidityAlert: number;
    minLiquidityList: number;
    maxTax: number;
    maxAgeHours: number;
    scoreAlert: number;
    surge15Threshold: number;
    imbalance5Threshold: number;
    refreshMs: number;
    sentinelRefreshMs: number;
}
export interface CacheEntry<T> {
    data: T;
    timestamp: number;
    ttl: number;
}
export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
    timestamp: number;
    rateLimitRemaining?: number;
}
export interface WSMessage {
    type: "hotlist" | "listing" | "health" | "error" | "connection" | "subscribed" | "unsubscribed" | "leaderboards";
    data: any;
    timestamp: number;
}
export interface ExchangeAnnouncement {
    exchange: string;
    title: string;
    content: string;
    url: string;
    publishedAt: number;
    tokens: {
        symbol: string;
        address?: string;
        chainId?: string;
    }[];
    markets: string[];
}
//# sourceMappingURL=types.d.ts.map