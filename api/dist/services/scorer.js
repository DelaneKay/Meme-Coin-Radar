"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Scorer = void 0;
const logger_1 = require("../utils/logger");
class Scorer {
    constructor(cache) {
        this.isRunning = false;
        this.leaderboards = new Map();
        this.priceHistory = new Map();
        this.volumeHistory = new Map();
        this.cache = cache;
        this.initializeLeaderboards();
    }
    async start() {
        if (this.isRunning)
            return;
        this.isRunning = true;
        logger_1.scorerLogger.info('Scorer started');
    }
    async stop() {
        this.isRunning = false;
        logger_1.scorerLogger.info('Scorer stopped');
    }
    initializeLeaderboards() {
        const categories = ['new_mints', 'momentum_5m', 'continuation_15m', 'unusual_volume'];
        categories.forEach(category => {
            this.leaderboards.set(category, []);
        });
    }
    computeSignals(pair, security) {
        const tokenKey = `${pair.chainId}:${pair.baseToken.address}`;
        const buys5 = pair.txns.m5.buys || 0;
        const sells5 = pair.txns.m5.sells || 0;
        const imbalance5 = (buys5 - sells5) / Math.max(1, buys5 + sells5);
        const vol15 = pair.volume.m5 * 3;
        const surge15 = this.calculateVolumeSurge(tokenKey, vol15);
        const priceAccel = this.calculatePriceAcceleration(tokenKey, parseFloat(pair.priceUsd));
        const liquidityQuality = this.calculateLiquidityQuality(pair);
        const ageFactor = this.calculateAgeFactor(pair);
        const securityPenalty = security.penalty;
        const listingBoost = 0;
        return {
            imbalance5,
            surge15,
            priceAccel,
            liquidityQuality,
            ageFactor,
            securityPenalty,
            listingBoost,
        };
    }
    calculateVolumeSurge(tokenKey, currentVolume) {
        const history = this.volumeHistory.get(tokenKey) || [];
        history.push(currentVolume);
        if (history.length > 24) {
            history.shift();
        }
        this.volumeHistory.set(tokenKey, history);
        if (history.length < 3) {
            return 1;
        }
        const baseline = history.slice(0, -1).reduce((sum, vol) => sum + vol, 0) / (history.length - 1);
        if (baseline === 0) {
            return currentVolume > 0 ? 10 : 1;
        }
        return currentVolume / baseline;
    }
    calculatePriceAcceleration(tokenKey, currentPrice) {
        const history = this.priceHistory.get(tokenKey) || [];
        history.push(currentPrice);
        if (history.length > 10) {
            history.shift();
        }
        this.priceHistory.set(tokenKey, history);
        if (history.length < 6) {
            return 0;
        }
        const slope1m = history.length >= 2 ?
            (history[history.length - 1] - history[history.length - 2]) / history[history.length - 2] : 0;
        const slope5m = history.length >= 6 ?
            (history[history.length - 1] - history[history.length - 6]) / history[history.length - 6] : 0;
        const acceleration = slope1m - slope5m;
        return Math.max(-3, Math.min(3, acceleration * 100));
    }
    calculateLiquidityQuality(pair) {
        const liquidityUsd = pair.liquidity?.usd || 0;
        if (liquidityUsd <= 0) {
            return 0;
        }
        let score = Math.log10(liquidityUsd);
        const volume24h = pair.volume.h24 || 0;
        const turnoverRatio = volume24h / liquidityUsd;
        if (turnoverRatio > 0.1 && turnoverRatio < 5) {
            score += 1;
        }
        else if (turnoverRatio > 10) {
            score -= 0.5;
        }
        return Math.max(0, score);
    }
    calculateAgeFactor(pair) {
        if (!pair.pairCreatedAt) {
            return 0;
        }
        const ageMs = Date.now() - (pair.pairCreatedAt * 1000);
        const ageHours = ageMs / (1000 * 60 * 60);
        if (ageHours < 2) {
            return Math.max(0, ageHours / 2);
        }
        else if (ageHours <= 48) {
            return 1;
        }
        else {
            return Math.max(0, 1 - (ageHours - 48) / 48);
        }
    }
    calculateScore(signals) {
        const reasons = [];
        const zSurge15 = this.normalizeToZScore(signals.surge15, 1, 2);
        const zPriceAccel = signals.priceAccel;
        let score = 0;
        const imbalanceScore = 28 * Math.max(0, signals.imbalance5);
        score += imbalanceScore;
        if (signals.imbalance5 > 0.3) {
            reasons.push(`Strong buy pressure (${(signals.imbalance5 * 100).toFixed(1)}%)`);
        }
        const surgeScore = 28 * Math.max(0, Math.min(1, zSurge15 / 3));
        score += surgeScore;
        if (signals.surge15 > 2) {
            reasons.push(`Volume surge ${signals.surge15.toFixed(1)}x`);
        }
        const accelScore = 16 * Math.max(0, Math.min(1, (zPriceAccel + 3) / 6));
        score += accelScore;
        if (signals.priceAccel > 1) {
            reasons.push('Price acceleration detected');
        }
        const liquidityScore = 18 * Math.max(0, Math.min(1, signals.liquidityQuality / 6));
        score += liquidityScore;
        if (signals.liquidityQuality > 4) {
            reasons.push('High liquidity quality');
        }
        const ageScore = 10 * signals.ageFactor;
        score += ageScore;
        if (signals.ageFactor > 0.8) {
            reasons.push('Optimal age range');
        }
        score -= signals.securityPenalty;
        if (signals.securityPenalty > 0) {
            reasons.push(`Security penalty: -${signals.securityPenalty}`);
        }
        score += signals.listingBoost;
        if (signals.listingBoost > 0) {
            reasons.push(`CEX listing boost: +${signals.listingBoost}`);
        }
        const finalScore = Math.max(0, Math.min(100, score));
        return { score: finalScore, reasons };
    }
    normalizeToZScore(value, mean, stdDev) {
        return (value - mean) / stdDev;
    }
    generateTokenSummary(pair, security, listingBoost = 0) {
        const signals = this.computeSignals(pair, security);
        signals.listingBoost = listingBoost;
        const { score, reasons } = this.calculateScore(signals);
        const ageMinutes = pair.pairCreatedAt ?
            Math.floor((Date.now() - pair.pairCreatedAt * 1000) / (1000 * 60)) : 0;
        return {
            chainId: this.mapChainId(pair.chainId),
            token: {
                address: pair.baseToken.address,
                symbol: pair.baseToken.symbol,
                name: pair.baseToken.name,
            },
            pairAddress: pair.pairAddress,
            priceUsd: parseFloat(pair.priceUsd),
            buys5: pair.txns.m5.buys,
            sells5: pair.txns.m5.sells,
            vol5Usd: pair.volume.m5,
            vol15Usd: pair.volume.m5 * 3,
            liquidityUsd: pair.liquidity?.usd || 0,
            fdvUsd: pair.fdv,
            ageMinutes,
            score,
            reasons,
            security: {
                ok: security.security_ok,
                flags: security.flags,
            },
            links: {
                dexscreener: pair.url,
                chart: this.generateChartLink(pair),
            },
        };
    }
    mapChainId(dexScreenerChainId) {
        const chainMap = {
            'solana': 'sol',
            'ethereum': 'eth',
            'bsc': 'bsc',
            'base': 'base',
        };
        return chainMap[dexScreenerChainId] || 'eth';
    }
    generateChartLink(pair) {
        const chainId = this.mapChainId(pair.chainId);
        switch (chainId) {
            case 'sol':
                return `https://dexscreener.com/solana/${pair.pairAddress}`;
            case 'eth':
                return `https://dexscreener.com/ethereum/${pair.pairAddress}`;
            case 'bsc':
                return `https://dexscreener.com/bsc/${pair.pairAddress}`;
            case 'base':
                return `https://dexscreener.com/base/${pair.pairAddress}`;
            default:
                return pair.url;
        }
    }
    async updateLeaderboards(tokens) {
        const startTime = Date.now();
        try {
            const minLiquidity = parseInt(process.env.MIN_LIQUIDITY_LIST || '12000');
            const maxAge = parseInt(process.env.MAX_AGE_HOURS || '48') * 60;
            const minScore = 55;
            const eligibleTokens = tokens.filter(token => token.liquidityUsd >= minLiquidity &&
                token.ageMinutes <= maxAge &&
                token.score >= minScore &&
                token.security.ok);
            await this.generateNewMintsLeaderboard(eligibleTokens);
            await this.generateMomentum5mLeaderboard(eligibleTokens);
            await this.generateContinuation15mLeaderboard(eligibleTokens);
            await this.generateUnusualVolumeLeaderboard(eligibleTokens);
            for (const [category, tokens] of this.leaderboards.entries()) {
                await this.cache.cacheHotlist(category, tokens, 30);
            }
            const duration = Date.now() - startTime;
            (0, logger_1.logPerformance)('updateLeaderboards', duration, {
                totalTokens: tokens.length,
                eligibleTokens: eligibleTokens.length
            });
        }
        catch (error) {
            (0, logger_1.logError)(error, 'Failed to update leaderboards');
        }
    }
    async generateNewMintsLeaderboard(tokens) {
        const newMints = tokens
            .filter(token => token.ageMinutes <= 120)
            .sort((a, b) => {
            const ageDiff = a.ageMinutes - b.ageMinutes;
            if (Math.abs(ageDiff) > 30)
                return ageDiff;
            return b.score - a.score;
        })
            .slice(0, 50);
        this.leaderboards.set('new_mints', newMints);
    }
    async generateMomentum5mLeaderboard(tokens) {
        const momentum = tokens
            .filter(token => token.buys5 > token.sells5)
            .sort((a, b) => {
            const aImbalance = (a.buys5 - a.sells5) / Math.max(1, a.buys5 + a.sells5);
            const bImbalance = (b.buys5 - b.sells5) / Math.max(1, b.buys5 + b.sells5);
            const imbalanceDiff = bImbalance - aImbalance;
            if (Math.abs(imbalanceDiff) > 0.1)
                return imbalanceDiff;
            return b.vol5Usd - a.vol5Usd;
        })
            .slice(0, 50);
        this.leaderboards.set('momentum_5m', momentum);
    }
    async generateContinuation15mLeaderboard(tokens) {
        const continuation = tokens
            .filter(token => token.vol15Usd > token.vol5Usd * 2)
            .sort((a, b) => {
            const aRatio = a.vol15Usd / Math.max(1, a.vol5Usd);
            const bRatio = b.vol15Usd / Math.max(1, b.vol5Usd);
            const ratioDiff = bRatio - aRatio;
            if (Math.abs(ratioDiff) > 0.5)
                return ratioDiff;
            return b.score - a.score;
        })
            .slice(0, 50);
        this.leaderboards.set('continuation_15m', continuation);
    }
    async generateUnusualVolumeLeaderboard(tokens) {
        const unusual = tokens
            .filter(token => {
            const turnover = token.vol15Usd / Math.max(1, token.liquidityUsd);
            return turnover > 0.5 && turnover < 20;
        })
            .sort((a, b) => {
            const aTurnover = a.vol15Usd / Math.max(1, a.liquidityUsd);
            const bTurnover = b.vol15Usd / Math.max(1, b.liquidityUsd);
            return bTurnover - aTurnover;
        })
            .slice(0, 50);
        this.leaderboards.set('unusual_volume', unusual);
    }
    async getLeaderboard(category) {
        const cached = await this.cache.getHotlist(category);
        if (cached) {
            return cached;
        }
        return this.leaderboards.get(category) || [];
    }
    async getAllLeaderboards() {
        const result = {};
        const categories = ['new_mints', 'momentum_5m', 'continuation_15m', 'unusual_volume'];
        for (const category of categories) {
            result[category] = await this.getLeaderboard(category);
        }
        return result;
    }
    async getTopTokens(limit = 20) {
        const allCategories = await this.getAllLeaderboards();
        const allTokens = [];
        Object.values(allCategories).forEach(tokens => {
            allTokens.push(...tokens);
        });
        const uniqueTokens = allTokens.filter((token, index, self) => index === self.findIndex(t => t.token.address === token.token.address));
        return uniqueTokens
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }
    getHealthStatus() {
        return {
            status: this.isRunning ? 'up' : 'down',
            lastCheck: Date.now(),
        };
    }
}
exports.Scorer = Scorer;
//# sourceMappingURL=scorer.js.map