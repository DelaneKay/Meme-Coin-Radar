"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecAuditor = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
class SecAuditor {
    constructor(cache, rateLimiter) {
        this.isRunning = false;
        this.cache = cache;
        this.rateLimiter = rateLimiter;
        this.maxConcurrentChecks = parseInt(process.env.MAX_CONCURRENT_SECURITY_CHECKS || '5');
    }
    async start() {
        if (this.isRunning)
            return;
        this.isRunning = true;
        logger_1.secAuditorLogger.info('SecAuditor started');
    }
    async stop() {
        this.isRunning = false;
        logger_1.secAuditorLogger.info('SecAuditor stopped');
    }
    async analyzeToken(address, chainId) {
        const cacheKey = `security:${chainId}:${address}`;
        const cached = await this.cache.getSecurityReport(address);
        if (cached) {
            logger_1.secAuditorLogger.debug(`Using cached security report for ${address}`);
            return cached;
        }
        try {
            logger_1.secAuditorLogger.debug(`Starting security analysis for ${address} on ${chainId}`);
            const [goPlusResult, honeypotResult] = await Promise.allSettled([
                this.getGoPlusSecurityData(address, chainId),
                this.getHoneypotIsData(address, chainId),
            ]);
            const goPlusData = goPlusResult.status === 'fulfilled' ? goPlusResult.value : null;
            const honeypotData = honeypotResult.status === 'fulfilled' ? honeypotResult.value : null;
            const report = this.generateSecurityReport(address, goPlusData, honeypotData);
            await this.cache.cacheSecurityReport(address, report, 3600);
            logger_1.secAuditorLogger.debug(`Security analysis completed for ${address}`, {
                security_ok: report.security_ok,
                penalty: report.penalty,
                flags: report.flags,
            });
            return report;
        }
        catch (error) {
            (0, logger_1.logError)(error, `Security analysis failed for ${address}`);
            return {
                address,
                security_ok: false,
                penalty: 50,
                flags: ['analysis_failed'],
                sources: [],
            };
        }
    }
    async analyzeBatch(tokens) {
        const reports = [];
        const semaphore = new Array(this.maxConcurrentChecks).fill(null);
        const processToken = async (token) => {
            return await this.analyzeToken(token.address, token.chainId);
        };
        for (let i = 0; i < tokens.length; i += this.maxConcurrentChecks) {
            const batch = tokens.slice(i, i + this.maxConcurrentChecks);
            const batchPromises = batch.map(processToken);
            const batchResults = await Promise.allSettled(batchPromises);
            for (const result of batchResults) {
                if (result.status === 'fulfilled') {
                    reports.push(result.value);
                }
                else {
                    logger_1.secAuditorLogger.error('Batch security analysis failed:', result.reason);
                }
            }
            if (i + this.maxConcurrentChecks < tokens.length) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        return reports;
    }
    async getGoPlusSecurityData(address, chainId) {
        if (!await this.rateLimiter.canMakeRequest('goplus')) {
            logger_1.secAuditorLogger.warn('GoPlus rate limited');
            return null;
        }
        try {
            const startTime = Date.now();
            const chainMap = {
                'sol': 'solana',
                'eth': '1',
                'bsc': '56',
                'base': '8453'
            };
            const chainParam = chainMap[chainId];
            if (!chainParam) {
                logger_1.secAuditorLogger.warn(`Unsupported chain for GoPlus: ${chainId}`);
                return null;
            }
            const url = `https://api.gopluslabs.io/api/v1/token_security/${chainParam}`;
            const response = await axios_1.default.get(url, {
                params: {
                    contract_addresses: address,
                },
                timeout: parseInt(process.env.SECURITY_TIMEOUT || '10000'),
                headers: {
                    'User-Agent': 'Meme-Coin-Radar/1.0',
                },
            });
            await this.rateLimiter.recordRequest('goplus');
            const duration = Date.now() - startTime;
            (0, logger_1.logApiRequest)('goplus', 'token_security', duration, true, response.status);
            if (response.data && response.data.result) {
                return response.data;
            }
            return null;
        }
        catch (error) {
            if (error.response?.status === 429) {
                this.rateLimiter.handle429Response('goplus', error.response.headers['retry-after']);
            }
            (0, logger_1.logError)(error, 'GoPlus API error');
            return null;
        }
    }
    async getHoneypotIsData(address, chainId) {
        if (chainId === 'sol') {
            return null;
        }
        if (!await this.rateLimiter.canMakeRequest('honeypot')) {
            logger_1.secAuditorLogger.warn('Honeypot.is rate limited');
            return null;
        }
        try {
            const startTime = Date.now();
            const response = await axios_1.default.get(`https://api.honeypot.is/v2/IsHoneypot`, {
                params: {
                    address,
                    chainID: this.getHoneypotChainId(chainId),
                },
                timeout: parseInt(process.env.SECURITY_TIMEOUT || '10000'),
                headers: {
                    'User-Agent': 'Meme-Coin-Radar/1.0',
                },
            });
            await this.rateLimiter.recordRequest('honeypot');
            const duration = Date.now() - startTime;
            (0, logger_1.logApiRequest)('honeypot', 'IsHoneypot', duration, true, response.status);
            return response.data;
        }
        catch (error) {
            if (error.response?.status === 429) {
                this.rateLimiter.handle429Response('honeypot', error.response.headers['retry-after']);
            }
            (0, logger_1.logError)(error, 'Honeypot.is API error');
            return null;
        }
    }
    getHoneypotChainId(chainId) {
        const chainMap = {
            'eth': 1,
            'bsc': 56,
            'base': 8453,
            'sol': 0,
        };
        return chainMap[chainId] || 1;
    }
    generateSecurityReport(address, goPlusData, honeypotData) {
        const flags = [];
        const sources = [];
        let penalty = 0;
        if (goPlusData && goPlusData.result && goPlusData.result[address]) {
            const tokenData = goPlusData.result[address];
            sources.push('goplus');
            const securityFlags = this.parseGoPlusFlags(tokenData);
            if (securityFlags.isHoneypot) {
                flags.push('honeypot');
                penalty += 100;
            }
            if (securityFlags.cannotSell) {
                flags.push('cannot_sell');
                penalty += 100;
            }
            if (securityFlags.fakeToken) {
                flags.push('fake_token');
                penalty += 100;
            }
            if (securityFlags.highTax) {
                flags.push('high_tax');
                penalty += 15;
            }
            if (securityFlags.upgradeable) {
                flags.push('upgradeable');
                penalty += 12;
            }
            if (securityFlags.blacklistable) {
                flags.push('blacklistable');
                penalty += 12;
            }
            if (securityFlags.mintable) {
                flags.push('mintable');
                penalty += 8;
            }
            if (securityFlags.antiWhale) {
                flags.push('anti_whale');
                penalty += 5;
            }
            if (securityFlags.tradingCooldown) {
                flags.push('trading_cooldown');
                penalty += 5;
            }
            if (securityFlags.externalCall) {
                flags.push('external_call');
                penalty += 3;
            }
            if (securityFlags.gasAbuse) {
                flags.push('gas_abuse');
                penalty += 3;
            }
            if (securityFlags.airdropScam) {
                flags.push('airdrop_scam');
                penalty += 20;
            }
        }
        if (honeypotData && honeypotData.honeypotResult) {
            sources.push('honeypot.is');
            if (honeypotData.honeypotResult.isHoneypot) {
                if (!flags.includes('honeypot')) {
                    flags.push('honeypot');
                    penalty += 100;
                }
            }
            if (honeypotData.simulationResult) {
                const maxTax = Math.max(honeypotData.simulationResult.buyTax || 0, honeypotData.simulationResult.sellTax || 0);
                const maxTaxThreshold = parseInt(process.env.MAX_TAX || '10');
                if (maxTax > maxTaxThreshold) {
                    if (!flags.includes('high_tax')) {
                        flags.push('high_tax');
                        penalty += 15;
                    }
                }
            }
            if (honeypotData.summary && honeypotData.summary.riskLevel > 7) {
                flags.push('high_risk');
                penalty += 10;
            }
        }
        const security_ok = penalty < 50 && !flags.some(flag => ['honeypot', 'cannot_sell', 'fake_token'].includes(flag));
        return {
            address,
            security_ok,
            penalty: Math.min(penalty, 100),
            flags,
            sources,
        };
    }
    parseGoPlusFlags(tokenData) {
        const parseFlag = (value) => {
            return value === '1' || value === 'true';
        };
        const buyTax = parseFloat(tokenData.buy_tax || '0');
        const sellTax = parseFloat(tokenData.sell_tax || '0');
        const maxTaxThreshold = parseInt(process.env.MAX_TAX || '10');
        return {
            isHoneypot: parseFlag(tokenData.is_honeypot),
            highTax: Math.max(buyTax, sellTax) > maxTaxThreshold,
            upgradeable: parseFlag(tokenData.is_proxy) || parseFlag(tokenData.can_take_back_ownership),
            blacklistable: parseFlag(tokenData.is_blacklisted),
            mintable: parseFlag(tokenData.is_mintable),
            cannotSell: parseFlag(tokenData.cannot_sell_all),
            fakeToken: parseFlag(tokenData.fake_token),
            airdropScam: parseFlag(tokenData.is_airdrop_scam),
            antiWhale: parseFlag(tokenData.is_anti_whale),
            tradingCooldown: parseFlag(tokenData.trading_cooldown),
            externalCall: parseFlag(tokenData.external_call),
            gasAbuse: parseFlag(tokenData.gas_abuse),
        };
    }
    async getSecuritySummary(addresses) {
        const reports = await Promise.all(addresses.map(async (address) => {
            const cached = await this.cache.getSecurityReport(address);
            return cached;
        }));
        let safe = 0;
        let risky = 0;
        let unknown = 0;
        for (const report of reports) {
            if (!report) {
                unknown++;
            }
            else if (report.security_ok) {
                safe++;
            }
            else {
                risky++;
            }
        }
        return { safe, risky, unknown };
    }
    isTokenSafe(report) {
        return report.security_ok && report.penalty < 20;
    }
    getSecurityScore(report) {
        return Math.max(0, 100 - report.penalty);
    }
    getHealthStatus() {
        return {
            status: this.isRunning ? 'up' : 'down',
            lastCheck: Date.now(),
        };
    }
    async filterSafeTokens(tokens) {
        const reports = await this.analyzeBatch(tokens);
        const safeTokens = [];
        for (let i = 0; i < tokens.length; i++) {
            const report = reports[i];
            if (report && this.isTokenSafe(report)) {
                safeTokens.push(tokens[i]);
            }
        }
        logger_1.secAuditorLogger.info(`Filtered ${safeTokens.length} safe tokens from ${tokens.length} total`);
        return safeTokens;
    }
    async getSecurityFlags(address, chainId) {
        const report = await this.analyzeToken(address, chainId);
        return report.flags;
    }
}
exports.SecAuditor = SecAuditor;
//# sourceMappingURL=secAuditor.js.map