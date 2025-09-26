import { EventEmitter } from 'events';
export interface SecurityEvent {
    id: string;
    type: SecurityEventType;
    severity: SecuritySeverity;
    source: string;
    timestamp: Date;
    ip?: string;
    userId?: string;
    userAgent?: string;
    details: Record<string, any>;
    resolved: boolean;
    resolvedAt?: Date;
    resolvedBy?: string;
}
export type SecurityEventType = 'failed_login' | 'brute_force_attempt' | 'suspicious_activity' | 'rate_limit_exceeded' | 'invalid_token' | 'unauthorized_access' | 'sql_injection_attempt' | 'xss_attempt' | 'malicious_payload' | 'api_abuse' | 'account_lockout' | 'privilege_escalation' | 'data_exfiltration' | 'ddos_attempt';
export type SecuritySeverity = 'low' | 'medium' | 'high' | 'critical';
export interface ThreatPattern {
    id: string;
    name: string;
    pattern: RegExp | string;
    type: SecurityEventType;
    severity: SecuritySeverity;
    enabled: boolean;
    threshold?: number;
    timeWindow?: number;
}
export interface SecurityAlert {
    id: string;
    eventId: string;
    type: SecurityEventType;
    severity: SecuritySeverity;
    message: string;
    timestamp: Date;
    acknowledged: boolean;
    acknowledgedBy?: string;
    acknowledgedAt?: Date;
}
export interface SecurityMetrics {
    totalEvents: number;
    eventsBySeverity: Record<SecuritySeverity, number>;
    eventsByType: Record<SecurityEventType, number>;
    activeAlerts: number;
    resolvedEvents: number;
    averageResolutionTime: number;
    topThreats: Array<{
        type: SecurityEventType;
        count: number;
    }>;
    ipBlacklist: string[];
    userBlacklist: string[];
}
declare class SecurityMonitorService extends EventEmitter {
    private events;
    private alerts;
    private threatPatterns;
    private ipAttempts;
    private userAttempts;
    private blacklistedIPs;
    private blacklistedUsers;
    private readonly MAX_EVENTS;
    private readonly CLEANUP_INTERVAL;
    private readonly BRUTE_FORCE_THRESHOLD;
    private readonly BRUTE_FORCE_WINDOW;
    constructor();
    private initializeThreatPatterns;
    private startCleanupInterval;
    private loadBlacklists;
    recordEvent(type: SecurityEventType, severity: SecuritySeverity, source: string, details?: Record<string, any>, ip?: string, userId?: string, userAgent?: string): Promise<SecurityEvent>;
    private analyzeEvent;
    private checkBruteForce;
    private checkRateLimitAbuse;
    private checkThreatPatterns;
    createAlert(event: SecurityEvent, message: string): Promise<SecurityAlert>;
    blacklistIP(ip: string, reason: string): Promise<void>;
    blacklistUser(userId: string, reason: string): Promise<void>;
    isIPBlacklisted(ip: string): boolean;
    isUserBlacklisted(userId: string): boolean;
    whitelistIP(ip: string): Promise<void>;
    whitelistUser(userId: string): Promise<void>;
    acknowledgeAlert(alertId: string, acknowledgedBy: string): Promise<boolean>;
    resolveEvent(eventId: string, resolvedBy: string): Promise<boolean>;
    getMetrics(): SecurityMetrics;
    getRecentEvents(limit?: number): SecurityEvent[];
    getActiveAlerts(): SecurityAlert[];
    private cleanupOldEvents;
    private resetAttemptCounters;
}
export declare const securityMonitor: SecurityMonitorService;
export {};
//# sourceMappingURL=securityMonitor.d.ts.map