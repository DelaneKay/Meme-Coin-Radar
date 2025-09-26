import { EventEmitter } from 'events';
import { logger, logSecurityEvent } from '../utils/logger';
import { metrics } from '../utils/metrics';
import { redisClient } from '../utils/redis';

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

export type SecurityEventType = 
  | 'failed_login'
  | 'brute_force_attempt'
  | 'suspicious_activity'
  | 'rate_limit_exceeded'
  | 'invalid_token'
  | 'unauthorized_access'
  | 'sql_injection_attempt'
  | 'xss_attempt'
  | 'malicious_payload'
  | 'api_abuse'
  | 'account_lockout'
  | 'privilege_escalation'
  | 'data_exfiltration'
  | 'ddos_attempt';

export type SecuritySeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ThreatPattern {
  id: string;
  name: string;
  pattern: RegExp | string;
  type: SecurityEventType;
  severity: SecuritySeverity;
  enabled: boolean;
  threshold?: number;
  timeWindow?: number; // minutes
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
  topThreats: Array<{ type: SecurityEventType; count: number }>;
  ipBlacklist: string[];
  userBlacklist: string[];
}

class SecurityMonitorService extends EventEmitter {
  private events: Map<string, SecurityEvent> = new Map();
  private alerts: Map<string, SecurityAlert> = new Map();
  private threatPatterns: Map<string, ThreatPattern> = new Map();
  private ipAttempts: Map<string, number> = new Map();
  private userAttempts: Map<string, number> = new Map();
  private blacklistedIPs: Set<string> = new Set();
  private blacklistedUsers: Set<string> = new Set();
  
  private readonly MAX_EVENTS = 10000;
  private readonly CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
  private readonly BRUTE_FORCE_THRESHOLD = 5;
  private readonly BRUTE_FORCE_WINDOW = 15; // minutes
  
  constructor() {
    super();
    this.initializeThreatPatterns();
    this.startCleanupInterval();
    this.loadBlacklists();
  }

  private initializeThreatPatterns(): void {
    const patterns: ThreatPattern[] = [
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

  private startCleanupInterval(): void {
    setInterval(() => {
      this.cleanupOldEvents();
      this.resetAttemptCounters();
    }, this.CLEANUP_INTERVAL);
  }

  private async loadBlacklists(): Promise<void> {
    try {
      const [ipBlacklist, userBlacklist] = await Promise.all([
        redisClient.smembers('security:blacklist:ips'),
        redisClient.smembers('security:blacklist:users')
      ]);

      ipBlacklist.forEach((ip: string) => this.blacklistedIPs.add(ip));
      userBlacklist.forEach((user: string) => this.blacklistedUsers.add(user));

      logger.info('Security blacklists loaded', {
        type: 'security_monitor_init',
        ipCount: this.blacklistedIPs.size,
        userCount: this.blacklistedUsers.size
      });
    } catch (error) {
      logger.error('Failed to load security blacklists', {
        type: 'security_monitor_error',
        error: (error as Error).message
      });
    }
  }

  public async recordEvent(
    type: SecurityEventType,
    severity: SecuritySeverity,
    source: string,
    details: Record<string, any> = {},
    ip?: string,
    userId?: string,
    userAgent?: string
  ): Promise<SecurityEvent> {
    const eventId = `sec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const event: SecurityEvent = {
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
    
    // Update metrics
    metrics.incrementCounter('security_events_total', 1, {
      type,
      severity,
      source
    });

    // Log the event
    logSecurityEvent(type, severity, {
      eventId,
      source,
      ip,
      userId,
      ...details
    });

    // Check for patterns and thresholds
    await this.analyzeEvent(event);
    
    // Emit event for real-time monitoring
    this.emit('securityEvent', event);

    // Cleanup if we have too many events
    if (this.events.size > this.MAX_EVENTS) {
      this.cleanupOldEvents();
    }

    return event;
  }

  private async analyzeEvent(event: SecurityEvent): Promise<void> {
    // Check for brute force attempts
    if (event.type === 'failed_login' && event.ip) {
      await this.checkBruteForce(event.ip, event.userId);
    }

    // Check for rate limit abuse
    if (event.type === 'rate_limit_exceeded') {
      await this.checkRateLimitAbuse(event.ip, event.userId);
    }

    // Check threat patterns in request data
    if (event.details.requestData) {
      await this.checkThreatPatterns(event);
    }

    // Auto-escalate critical events
    if (event.severity === 'critical') {
      await this.createAlert(event, `Critical security event: ${event.type}`);
    }
  }

  private async checkBruteForce(ip?: string, userId?: string): Promise<void> {
    if (ip) {
      const attempts = (this.ipAttempts.get(ip) || 0) + 1;
      this.ipAttempts.set(ip, attempts);

      if (attempts >= this.BRUTE_FORCE_THRESHOLD) {
        await this.recordEvent(
          'brute_force_attempt',
          'high',
          'security_monitor',
          { ip, attempts, threshold: this.BRUTE_FORCE_THRESHOLD },
          ip
        );

        await this.blacklistIP(ip, `Brute force attempt: ${attempts} failed logins`);
      }
    }

    if (userId) {
      const attempts = (this.userAttempts.get(userId) || 0) + 1;
      this.userAttempts.set(userId, attempts);

      if (attempts >= this.BRUTE_FORCE_THRESHOLD) {
        await this.recordEvent(
          'account_lockout',
          'medium',
          'security_monitor',
          { userId, attempts, threshold: this.BRUTE_FORCE_THRESHOLD },
          undefined,
          userId
        );
      }
    }
  }

  private async checkRateLimitAbuse(ip?: string, userId?: string): Promise<void> {
    // Check if this IP/user has exceeded rate limits multiple times
    const recentEvents = Array.from(this.events.values())
      .filter(e => 
        e.type === 'rate_limit_exceeded' &&
        e.timestamp > new Date(Date.now() - 60 * 60 * 1000) && // Last hour
        (e.ip === ip || e.userId === userId)
      );

    if (recentEvents.length >= 10) {
      await this.recordEvent(
        'api_abuse',
        'high',
        'security_monitor',
        { ip, userId, violations: recentEvents.length },
        ip,
        userId
      );

      if (ip) {
        await this.blacklistIP(ip, `API abuse: ${recentEvents.length} rate limit violations`);
      }
    }
  }

  private async checkThreatPatterns(event: SecurityEvent): Promise<void> {
    const requestData = JSON.stringify(event.details.requestData);

    for (const pattern of Array.from(this.threatPatterns.values())) {
      if (!pattern.enabled) continue;

      const regex = pattern.pattern instanceof RegExp ? pattern.pattern : new RegExp(pattern.pattern, 'i');
      
      if (regex.test(requestData)) {
        await this.recordEvent(
          pattern.type,
          pattern.severity,
          'threat_detection',
          {
            patternId: pattern.id,
            patternName: pattern.name,
            matchedContent: requestData.substring(0, 200),
            originalEvent: event.id
          },
          event.ip,
          event.userId,
          event.userAgent
        );

        // Auto-block critical threats
        if (pattern.severity === 'critical' && event.ip) {
          await this.blacklistIP(event.ip, `Critical threat pattern detected: ${pattern.name}`);
        }
      }
    }
  }

  public async createAlert(event: SecurityEvent, message: string): Promise<SecurityAlert> {
    const alertId = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const alert: SecurityAlert = {
      id: alertId,
      eventId: event.id,
      type: event.type,
      severity: event.severity,
      message,
      timestamp: new Date(),
      acknowledged: false
    };

    this.alerts.set(alertId, alert);

    // Emit alert for real-time notifications
    this.emit('securityAlert', alert);

    // Store in Redis for persistence
    await redisClient.setex(
      `security:alert:${alertId}`,
      24 * 60 * 60, // 24 hours
      JSON.stringify(alert)
    );

    logger.warn('Security alert created', {
      type: 'security_alert',
      alertId,
      eventId: event.id,
      severity: event.severity,
      message
    });

    return alert;
  }

  public async blacklistIP(ip: string, reason: string): Promise<void> {
    this.blacklistedIPs.add(ip);
    
    await Promise.all([
      redisClient.sadd('security:blacklist:ips', ip),
      redisClient.setex(`security:blacklist:reason:${ip}`, 7 * 24 * 60 * 60, reason)
    ]);

    await this.recordEvent(
      'suspicious_activity',
      'medium',
      'security_monitor',
      { action: 'ip_blacklisted', ip, reason }
    );

    logger.warn('IP blacklisted', {
      type: 'ip_blacklisted',
      ip,
      reason
    });
  }

  public async blacklistUser(userId: string, reason: string): Promise<void> {
    this.blacklistedUsers.add(userId);
    
    await Promise.all([
      redisClient.sadd('security:blacklist:users', userId),
      redisClient.setex(`security:blacklist:reason:${userId}`, 7 * 24 * 60 * 60, reason)
    ]);

    await this.recordEvent(
      'account_lockout',
      'high',
      'security_monitor',
      { action: 'user_blacklisted', userId, reason },
      undefined,
      userId
    );

    logger.warn('User blacklisted', {
      type: 'user_blacklisted',
      userId,
      reason
    });
  }

  public isIPBlacklisted(ip: string): boolean {
    return this.blacklistedIPs.has(ip);
  }

  public isUserBlacklisted(userId: string): boolean {
    return this.blacklistedUsers.has(userId);
  }

  public async whitelistIP(ip: string): Promise<void> {
    this.blacklistedIPs.delete(ip);
    
    await Promise.all([
      redisClient.srem('security:blacklist:ips', ip),
      redisClient.del(`security:blacklist:reason:${ip}`)
    ]);

    logger.info('IP whitelisted', {
      type: 'ip_whitelisted',
      ip
    });
  }

  public async whitelistUser(userId: string): Promise<void> {
    this.blacklistedUsers.delete(userId);
    
    await Promise.all([
      redisClient.srem('security:blacklist:users', userId),
      redisClient.del(`security:blacklist:reason:${userId}`)
    ]);

    logger.info('User whitelisted', {
      type: 'user_whitelisted',
      userId
    });
  }

  public async acknowledgeAlert(alertId: string, acknowledgedBy: string): Promise<boolean> {
    const alert = this.alerts.get(alertId);
    
    if (!alert) {
      return false;
    }

    alert.acknowledged = true;
    alert.acknowledgedBy = acknowledgedBy;
    alert.acknowledgedAt = new Date();

    // Update in Redis
    await redisClient.setex(
      `security:alert:${alertId}`,
      24 * 60 * 60,
      JSON.stringify(alert)
    );

    logger.info('Security alert acknowledged', {
      type: 'alert_acknowledged',
      alertId,
      acknowledgedBy
    });

    return true;
  }

  public async resolveEvent(eventId: string, resolvedBy: string): Promise<boolean> {
    const event = this.events.get(eventId);
    
    if (!event) {
      return false;
    }

    event.resolved = true;
    event.resolvedAt = new Date();
    event.resolvedBy = resolvedBy;

    logger.info('Security event resolved', {
      type: 'event_resolved',
      eventId,
      resolvedBy,
      eventType: event.type
    });

    return true;
  }

  public getMetrics(): SecurityMetrics {
    const events = Array.from(this.events.values());
    const alerts = Array.from(this.alerts.values());

    const eventsBySeverity = events.reduce((acc, event) => {
      acc[event.severity] = (acc[event.severity] || 0) + 1;
      return acc;
    }, {} as Record<SecuritySeverity, number>);

    const eventsByType = events.reduce((acc, event) => {
      acc[event.type] = (acc[event.type] || 0) + 1;
      return acc;
    }, {} as Record<SecurityEventType, number>);

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
      .map(([type, count]) => ({ type: type as SecurityEventType, count }));

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

  public getRecentEvents(limit: number = 100): SecurityEvent[] {
    return Array.from(this.events.values())
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  public getActiveAlerts(): SecurityAlert[] {
    return Array.from(this.alerts.values())
      .filter(alert => !alert.acknowledged)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  private cleanupOldEvents(): void {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days
    
    for (const [id, event] of Array.from(this.events.entries())) {
      if (event.timestamp < cutoff) {
        this.events.delete(id);
      }
    }

    for (const [id, alert] of Array.from(this.alerts.entries())) {
      if (alert.timestamp < cutoff && alert.acknowledged) {
        this.alerts.delete(id);
      }
    }
  }

  private resetAttemptCounters(): void {
    this.ipAttempts.clear();
    this.userAttempts.clear();
  }
}

export const securityMonitor = new SecurityMonitorService();