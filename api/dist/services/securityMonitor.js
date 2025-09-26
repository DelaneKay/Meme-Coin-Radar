"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.securityMonitor = void 0;
const events_1 = require("events");
const logger_1 = require("../utils/logger");
const metrics_1 = require("../utils/metrics");
const redis_1 = require("../utils/redis");
class SecurityMonitorService extends events_1.EventEmitter {
    constructor() {
        super();
        this.events = new Map();
        this.alerts = new Map();
        this.threatPatterns = new Map();
        this.ipAttempts = new Map();
        this.userAttempts = new Map();
        this.blacklistedIPs = new Set();
        this.blacklistedUsers = new Set();
        this.MAX_EVENTS = 10000;
        this.CLEANUP_INTERVAL = 60 * 60 * 1000;
        this.BRUTE_FORCE_THRESHOLD = 5;
        this.BRUTE_FORCE_WINDOW = 15;
        this.initializeThreatPatterns();
        this.startCleanupInterval();
        this.loadBlacklists();
    }
    initializeThreatPatterns() {
        const patterns = [
            {
                id: 'sql_injection',
                name: 'SQL Injection Attempt',
                pattern: /(\b(union|select|insert|update|delete|drop|create|alter|exec|execute)\b|--|\/\*|\*\/|;|'|")/i,
                type: 'sql_injection_attempt',
                severity: 'high',
                enabled: true
            },
            {
                id: 'xss_attempt',
                name: 'XSS Attempt',
                pattern: /<script|javascript:|on\w+\s*=|<iframe|<object|<embed/i,
                type: 'xss_attempt',
                severity: 'high',
                enabled: true
            },
            {
                id: 'path_traversal',
                name: 'Path Traversal Attempt',
                pattern: /(\.\.[\/\\]|%2e%2e[\/\\]|\.\.%2f|\.\.%5c)/i,
                type: 'malicious_payload',
                severity: 'medium',
                enabled: true
            },
            {
                id: 'command_injection',
                name: 'Command Injection Attempt',
                pattern: /(\||&|;|`|\$\(|\${|<|>)/,
                type: 'malicious_payload',
                severity: 'high',
                enabled: true
            },
            {
                id: 'suspicious_user_agent',
                name: 'Suspicious User Agent',
                pattern: /(bot|crawler|spider|scraper|scanner|nikto|sqlmap|nmap)/i,
                type: 'suspicious_activity',
                severity: 'low',
                enabled: true
            }
        ];
        patterns.forEach(pattern => {
            this.threatPatterns.set(pattern.id, pattern);
        });
    }
    startCleanupInterval() {
        setInterval(() => {
            this.cleanupOldEvents();
            this.resetAttemptCounters();
        }, this.CLEANUP_INTERVAL);
    }
    async loadBlacklists() {
        try {
            const [ipBlacklist, userBlacklist] = await Promise.all([
                redis_1.redisClient.smembers('security:blacklist:ips'),
                redis_1.redisClient.smembers('security:blacklist:users')
            ]);
            ipBlacklist.forEach(ip => this.blacklistedIPs.add(ip));
            userBlacklist.forEach(user => this.blacklistedUsers.add(user));
            logger_1.logger.info('Security blacklists loaded', {
                type: 'security_monitor_init',
                ipCount: this.blacklistedIPs.size,
                userCount: this.blacklistedUsers.size
            });
        }
        catch (error) {
            logger_1.logger.error('Failed to load security blacklists', {
                type: 'security_monitor_error',
                error: error.message
            });
        }
    }
    async recordEvent(type, severity, source, details = {}, ip, userId, userAgent) {
        const eventId = `sec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const event = {
            id: eventId,
            type,
            severity,
            source,
            timestamp: new Date(),
            ip,
            userId,
            userAgent,
            details,
            resolved: false
        };
        this.events.set(eventId, event);
        metrics_1.metrics.incrementCounter('security_events_total', 1, {
            type,
            severity,
            source
        });
        (0, logger_1.logSecurityEvent)(type, {
            eventId,
            severity,
            source,
            ip,
            userId,
            ...details
        });
        await this.analyzeEvent(event);
        this.emit('securityEvent', event);
        if (this.events.size > this.MAX_EVENTS) {
            this.cleanupOldEvents();
        }
        return event;
    }
    async analyzeEvent(event) {
        if (event.type === 'failed_login' && event.ip) {
            await this.checkBruteForce(event.ip, event.userId);
        }
        if (event.type === 'rate_limit_exceeded') {
            await this.checkRateLimitAbuse(event.ip, event.userId);
        }
        if (event.details.requestData) {
            await this.checkThreatPatterns(event);
        }
        if (event.severity === 'critical') {
            await this.createAlert(event, `Critical security event: ${event.type}`);
        }
    }
    async checkBruteForce(ip, userId) {
        if (ip) {
            const attempts = (this.ipAttempts.get(ip) || 0) + 1;
            this.ipAttempts.set(ip, attempts);
            if (attempts >= this.BRUTE_FORCE_THRESHOLD) {
                await this.recordEvent('brute_force_attempt', 'high', 'security_monitor', { ip, attempts, threshold: this.BRUTE_FORCE_THRESHOLD }, ip);
                await this.blacklistIP(ip, `Brute force attempt: ${attempts} failed logins`);
            }
        }
        if (userId) {
            const attempts = (this.userAttempts.get(userId) || 0) + 1;
            this.userAttempts.set(userId, attempts);
            if (attempts >= this.BRUTE_FORCE_THRESHOLD) {
                await this.recordEvent('account_lockout', 'medium', 'security_monitor', { userId, attempts, threshold: this.BRUTE_FORCE_THRESHOLD }, undefined, userId);
            }
        }
    }
    async checkRateLimitAbuse(ip, userId) {
        const recentEvents = Array.from(this.events.values())
            .filter(e => e.type === 'rate_limit_exceeded' &&
            e.timestamp > new Date(Date.now() - 60 * 60 * 1000) &&
            (e.ip === ip || e.userId === userId));
        if (recentEvents.length >= 10) {
            await this.recordEvent('api_abuse', 'high', 'security_monitor', { ip, userId, violations: recentEvents.length }, ip, userId);
            if (ip) {
                await this.blacklistIP(ip, `API abuse: ${recentEvents.length} rate limit violations`);
            }
        }
    }
    async checkThreatPatterns(event) {
        const requestData = JSON.stringify(event.details.requestData);
        for (const pattern of this.threatPatterns.values()) {
            if (!pattern.enabled)
                continue;
            const regex = pattern.pattern instanceof RegExp ? pattern.pattern : new RegExp(pattern.pattern, 'i');
            if (regex.test(requestData)) {
                await this.recordEvent(pattern.type, pattern.severity, 'threat_detection', {
                    patternId: pattern.id,
                    patternName: pattern.name,
                    matchedContent: requestData.substring(0, 200),
                    originalEvent: event.id
                }, event.ip, event.userId, event.userAgent);
                if (pattern.severity === 'critical' && event.ip) {
                    await this.blacklistIP(event.ip, `Critical threat pattern detected: ${pattern.name}`);
                }
            }
        }
    }
    async createAlert(event, message) {
        const alertId = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const alert = {
            id: alertId,
            eventId: event.id,
            type: event.type,
            severity: event.severity,
            message,
            timestamp: new Date(),
            acknowledged: false
        };
        this.alerts.set(alertId, alert);
        this.emit('securityAlert', alert);
        await redis_1.redisClient.setex(`security:alert:${alertId}`, 24 * 60 * 60, JSON.stringify(alert));
        logger_1.logger.warn('Security alert created', {
            type: 'security_alert',
            alertId,
            eventId: event.id,
            severity: event.severity,
            message
        });
        return alert;
    }
    async blacklistIP(ip, reason) {
        this.blacklistedIPs.add(ip);
        await Promise.all([
            redis_1.redisClient.sadd('security:blacklist:ips', ip),
            redis_1.redisClient.setex(`security:blacklist:reason:${ip}`, 7 * 24 * 60 * 60, reason)
        ]);
        await this.recordEvent('suspicious_activity', 'medium', 'security_monitor', { action: 'ip_blacklisted', ip, reason });
        logger_1.logger.warn('IP blacklisted', {
            type: 'ip_blacklisted',
            ip,
            reason
        });
    }
    async blacklistUser(userId, reason) {
        this.blacklistedUsers.add(userId);
        await Promise.all([
            redis_1.redisClient.sadd('security:blacklist:users', userId),
            redis_1.redisClient.setex(`security:blacklist:reason:${userId}`, 7 * 24 * 60 * 60, reason)
        ]);
        await this.recordEvent('account_lockout', 'high', 'security_monitor', { action: 'user_blacklisted', userId, reason }, undefined, userId);
        logger_1.logger.warn('User blacklisted', {
            type: 'user_blacklisted',
            userId,
            reason
        });
    }
    isIPBlacklisted(ip) {
        return this.blacklistedIPs.has(ip);
    }
    isUserBlacklisted(userId) {
        return this.blacklistedUsers.has(userId);
    }
    async whitelistIP(ip) {
        this.blacklistedIPs.delete(ip);
        await Promise.all([
            redis_1.redisClient.srem('security:blacklist:ips', ip),
            redis_1.redisClient.del(`security:blacklist:reason:${ip}`)
        ]);
        logger_1.logger.info('IP whitelisted', {
            type: 'ip_whitelisted',
            ip
        });
    }
    async whitelistUser(userId) {
        this.blacklistedUsers.delete(userId);
        await Promise.all([
            redis_1.redisClient.srem('security:blacklist:users', userId),
            redis_1.redisClient.del(`security:blacklist:reason:${userId}`)
        ]);
        logger_1.logger.info('User whitelisted', {
            type: 'user_whitelisted',
            userId
        });
    }
    async acknowledgeAlert(alertId, acknowledgedBy) {
        const alert = this.alerts.get(alertId);
        if (!alert) {
            return false;
        }
        alert.acknowledged = true;
        alert.acknowledgedBy = acknowledgedBy;
        alert.acknowledgedAt = new Date();
        await redis_1.redisClient.setex(`security:alert:${alertId}`, 24 * 60 * 60, JSON.stringify(alert));
        logger_1.logger.info('Security alert acknowledged', {
            type: 'alert_acknowledged',
            alertId,
            acknowledgedBy
        });
        return true;
    }
    async resolveEvent(eventId, resolvedBy) {
        const event = this.events.get(eventId);
        if (!event) {
            return false;
        }
        event.resolved = true;
        event.resolvedAt = new Date();
        event.resolvedBy = resolvedBy;
        logger_1.logger.info('Security event resolved', {
            type: 'event_resolved',
            eventId,
            resolvedBy,
            eventType: event.type
        });
        return true;
    }
    getMetrics() {
        const events = Array.from(this.events.values());
        const alerts = Array.from(this.alerts.values());
        const eventsBySeverity = events.reduce((acc, event) => {
            acc[event.severity] = (acc[event.severity] || 0) + 1;
            return acc;
        }, {});
        const eventsByType = events.reduce((acc, event) => {
            acc[event.type] = (acc[event.type] || 0) + 1;
            return acc;
        }, {});
        const resolvedEvents = events.filter(e => e.resolved);
        const averageResolutionTime = resolvedEvents.length > 0
            ? resolvedEvents.reduce((sum, event) => {
                if (event.resolvedAt) {
                    return sum + (event.resolvedAt.getTime() - event.timestamp.getTime());
                }
                return sum;
            }, 0) / resolvedEvents.length
            : 0;
        const topThreats = Object.entries(eventsByType)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([type, count]) => ({ type: type, count }));
        return {
            totalEvents: events.length,
            eventsBySeverity,
            eventsByType,
            activeAlerts: alerts.filter(a => !a.acknowledged).length,
            resolvedEvents: resolvedEvents.length,
            averageResolutionTime,
            topThreats,
            ipBlacklist: Array.from(this.blacklistedIPs),
            userBlacklist: Array.from(this.blacklistedUsers)
        };
    }
    getRecentEvents(limit = 100) {
        return Array.from(this.events.values())
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
            .slice(0, limit);
    }
    getActiveAlerts() {
        return Array.from(this.alerts.values())
            .filter(alert => !alert.acknowledged)
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    }
    cleanupOldEvents() {
        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        for (const [id, event] of this.events.entries()) {
            if (event.timestamp < cutoff) {
                this.events.delete(id);
            }
        }
        for (const [id, alert] of this.alerts.entries()) {
            if (alert.timestamp < cutoff && alert.acknowledged) {
                this.alerts.delete(id);
            }
        }
    }
    resetAttemptCounters() {
        this.ipAttempts.clear();
        this.userAttempts.clear();
    }
}
exports.securityMonitor = new SecurityMonitorService();
//# sourceMappingURL=securityMonitor.js.map