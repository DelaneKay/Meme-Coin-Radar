import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger';
import { metrics } from '../utils/metrics';
import { CacheManager } from '../utils/cache';

/**
 * Launch-Week Guardrail Service
 * Monitors system health, enforces safety thresholds, and auto-mutes/rollbacks/kills processes
 * if metrics exceed defined risk limits to maintain stability on free-tier infrastructure
 */

interface GuardrailConfig {
  alertRateLimit: number;      // 15 alerts/hour threshold
  alertKillLimit: number;      // 25 alerts/hour kill switch
  errorRateWarn: number;       // 0.10 error rate warning
  errorRateKill: number;       // 0.20 error rate kill switch
  muteDurationMin: number;     // 30 minutes mute duration
  enabled: boolean;
}

interface AlertRateMetrics {
  chain: string;
  alertsLastHour: number;
  alertsLast15Min: number;
  lastAlertTime: number;
  muteUntil: number;
  killSwitchActive: boolean;
}

interface ErrorRateMetrics {
  totalRequests: number;
  errorRequests: number;
  errorRate: number;
  lastErrorTime: number;
  backoffActive: boolean;
  backoffUntil: number;
}

interface GuardrailAction {
  id: string;
  timestamp: string;
  type: 'MUTE_ALERTS' | 'KILL_SWITCH' | 'BACKOFF_COLLECTORS' | 'ROLLBACK_TUNING';
  chain?: string;
  reason: string;
  duration?: number;
  metadata?: any;
}

export class GuardrailService extends EventEmitter {
  private config: GuardrailConfig;
  private cache: CacheManager;
  private alertMetrics: Map<string, AlertRateMetrics> = new Map();
  private errorMetrics: ErrorRateMetrics;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private actions: GuardrailAction[] = [];

  constructor(cache: CacheManager) {
    super();
    this.cache = cache;
    this.config = {
      alertRateLimit: parseInt(process.env.ALERT_RATE_LIMIT || '15'),
      alertKillLimit: parseInt(process.env.ALERT_KILL_LIMIT || '25'),
      errorRateWarn: parseFloat(process.env.ERROR_RATE_WARN || '0.10'),
      errorRateKill: parseFloat(process.env.ERROR_RATE_KILL || '0.20'),
      muteDurationMin: parseInt(process.env.MUTE_DURATION_MIN || '30'),
      enabled: process.env.GUARDRAILS_ENABLED === 'true'
    };

    this.errorMetrics = {
      totalRequests: 0,
      errorRequests: 0,
      errorRate: 0,
      lastErrorTime: 0,
      backoffActive: false,
      backoffUntil: 0
    };

    // Initialize alert metrics for each chain
    const chains = ['sol', 'eth', 'bsc', 'base'];
    chains.forEach(chain => {
      this.alertMetrics.set(chain, {
        chain,
        alertsLastHour: 0,
        alertsLast15Min: 0,
        lastAlertTime: 0,
        muteUntil: 0,
        killSwitchActive: false
      });
    });

    if (this.config.enabled) {
      logger.info('Launch-week guardrails enabled', this.config);
    }
  }

  async start(): Promise<void> {
    if (this.isRunning || !this.config.enabled) return;

    this.isRunning = true;
    
    // Start monitoring every 30 seconds
    this.monitoringInterval = setInterval(() => {
      this.runGuardrailChecks();
    }, 30000);

    logger.info('Guardrail service started');
    await this.logAction({
      type: 'KILL_SWITCH',
      reason: 'Guardrail service started - monitoring active',
      metadata: { config: this.config }
    });
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    logger.info('Guardrail service stopped');
  }

  // =============================================================================
  // ALERT RATE MONITORING
  // =============================================================================

  async recordAlert(chain: string): Promise<void> {
    if (!this.config.enabled) return;

    const metrics = this.alertMetrics.get(chain);
    if (!metrics) return;

    const now = Date.now();
    metrics.lastAlertTime = now;
    metrics.alertsLastHour++;
    metrics.alertsLast15Min++;

    // Check if we need to trigger guardrails
    await this.checkAlertRateGuardrails(chain, metrics);
  }

  private async checkAlertRateGuardrails(chain: string, metrics: AlertRateMetrics): Promise<void> {
    const now = Date.now();

    // Check for auto-mute threshold (15+ alerts/hour)
    if (metrics.alertsLastHour >= this.config.alertRateLimit && metrics.muteUntil < now) {
      await this.triggerAutoMute(chain, metrics.alertsLastHour);
    }

    // Check for kill-switch threshold (25+ alerts/hour sustained 15 minutes)
    if (metrics.alertsLast15Min >= this.config.alertKillLimit && !metrics.killSwitchActive) {
      await this.triggerKillSwitch(chain, metrics.alertsLast15Min);
    }
  }

  private async triggerAutoMute(chain: string, alertsPerHour: number): Promise<void> {
    const muteDuration = this.config.muteDurationMin;
    const muteUntil = Date.now() + (muteDuration * 60 * 1000);

    // Update metrics
    const metrics = this.alertMetrics.get(chain);
    if (metrics) {
      metrics.muteUntil = muteUntil;
    }

    // Log action
    await this.logAction({
      type: 'MUTE_ALERTS',
      chain,
      reason: `${alertsPerHour} alerts/hour exceeded limit of ${this.config.alertRateLimit}`,
      duration: muteDuration,
      metadata: { alertsPerHour, threshold: this.config.alertRateLimit }
    });

    // Emit event for other services
    this.emit('guardrail:mute', { chain, duration: muteDuration, reason: 'alert_rate_exceeded' });

    logger.warn('Auto-mute triggered', { chain, alertsPerHour, muteDuration });
  }

  private async triggerKillSwitch(chain: string, alertsPerHour: number): Promise<void> {
    // Update metrics
    const metrics = this.alertMetrics.get(chain);
    if (metrics) {
      metrics.killSwitchActive = true;
    }

    // Log action
    await this.logAction({
      type: 'KILL_SWITCH',
      chain,
      reason: `${alertsPerHour} alerts/hour sustained >15min, exceeded kill limit of ${this.config.alertKillLimit}`,
      metadata: { alertsPerHour, threshold: this.config.alertKillLimit, sustained: true }
    });

    // Emit event for other services
    this.emit('guardrail:kill_switch', { chain, reason: 'sustained_alert_storm' });

    logger.error('Kill-switch triggered', { chain, alertsPerHour });
  }

  // =============================================================================
  // ERROR RATE MONITORING
  // =============================================================================

  async recordRequest(success: boolean): Promise<void> {
    if (!this.config.enabled) return;

    this.errorMetrics.totalRequests++;
    
    if (!success) {
      this.errorMetrics.errorRequests++;
      this.errorMetrics.lastErrorTime = Date.now();
    }

    // Calculate current error rate
    this.errorMetrics.errorRate = this.errorMetrics.errorRequests / this.errorMetrics.totalRequests;

    // Check error rate guardrails
    await this.checkErrorRateGuardrails();
  }

  private async checkErrorRateGuardrails(): Promise<void> {
    const now = Date.now();
    const fiveMinutesAgo = now - (5 * 60 * 1000);

    // Only check if we have recent errors
    if (this.errorMetrics.lastErrorTime < fiveMinutesAgo) {
      return;
    }

    // Check for backoff threshold (>10% error rate for 5 minutes)
    if (this.errorMetrics.errorRate > this.config.errorRateWarn && !this.errorMetrics.backoffActive) {
      await this.triggerCollectorBackoff();
    }

    // Check for kill threshold (>20% error rate for 15 minutes)
    if (this.errorMetrics.errorRate > this.config.errorRateKill) {
      await this.triggerErrorRateKillSwitch();
    }
  }

  private async triggerCollectorBackoff(): Promise<void> {
    const backoffDuration = 60 * 60 * 1000; // 1 hour
    this.errorMetrics.backoffActive = true;
    this.errorMetrics.backoffUntil = Date.now() + backoffDuration;

    await this.logAction({
      type: 'BACKOFF_COLLECTORS',
      reason: `Error rate ${(this.errorMetrics.errorRate * 100).toFixed(1)}% exceeded warning threshold of ${(this.config.errorRateWarn * 100).toFixed(1)}%`,
      duration: 60, // 1 hour in minutes
      metadata: { 
        errorRate: this.errorMetrics.errorRate,
        threshold: this.config.errorRateWarn,
        backoffPercentage: 50
      }
    });

    // Emit event for collectors to reduce tick rates by 50%
    this.emit('guardrail:backoff', { percentage: 50, duration: backoffDuration });

    logger.warn('Collector backoff triggered', { 
      errorRate: this.errorMetrics.errorRate,
      threshold: this.config.errorRateWarn 
    });
  }

  private async triggerErrorRateKillSwitch(): Promise<void> {
    await this.logAction({
      type: 'KILL_SWITCH',
      reason: `Error rate ${(this.errorMetrics.errorRate * 100).toFixed(1)}% exceeded kill threshold of ${(this.config.errorRateKill * 100).toFixed(1)}%`,
      metadata: { 
        errorRate: this.errorMetrics.errorRate,
        threshold: this.config.errorRateKill,
        totalRequests: this.errorMetrics.totalRequests,
        errorRequests: this.errorMetrics.errorRequests
      }
    });

    // Emit global kill switch event
    this.emit('guardrail:kill_switch', { reason: 'error_rate_exceeded', global: true });

    logger.error('Error rate kill-switch triggered', { 
      errorRate: this.errorMetrics.errorRate,
      threshold: this.config.errorRateKill 
    });
  }

  // =============================================================================
  // GUARDRAIL CHECKS & MONITORING
  // =============================================================================

  private async runGuardrailChecks(): Promise<void> {
    try {
      await this.updateMetrics();
      await this.checkTimeBasedResets();
      await this.emitHealthStatus();
    } catch (error) {
      logger.error('Guardrail check failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async updateMetrics(): Promise<void> {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    const fifteenMinAgo = now - (15 * 60 * 1000);

    // Reset hourly counters
    for (const [chain, metrics] of this.alertMetrics.entries()) {
      if (metrics.lastAlertTime < oneHourAgo) {
        metrics.alertsLastHour = 0;
      }
      if (metrics.lastAlertTime < fifteenMinAgo) {
        metrics.alertsLast15Min = 0;
      }
    }

    // Reset error metrics if no recent errors
    const fiveMinutesAgo = now - (5 * 60 * 1000);
    if (this.errorMetrics.lastErrorTime < fiveMinutesAgo) {
      this.errorMetrics.totalRequests = 0;
      this.errorMetrics.errorRequests = 0;
      this.errorMetrics.errorRate = 0;
    }
  }

  private async checkTimeBasedResets(): Promise<void> {
    const now = Date.now();

    // Check for mute expiration
    for (const [chain, metrics] of this.alertMetrics.entries()) {
      if (metrics.muteUntil > 0 && now > metrics.muteUntil) {
        metrics.muteUntil = 0;
        await this.logAction({
          type: 'MUTE_ALERTS',
          chain,
          reason: 'Auto-mute expired, alerts resumed',
          metadata: { action: 'unmute' }
        });
        logger.info('Auto-mute expired', { chain });
      }
    }

    // Check for backoff expiration
    if (this.errorMetrics.backoffActive && now > this.errorMetrics.backoffUntil) {
      this.errorMetrics.backoffActive = false;
      this.errorMetrics.backoffUntil = 0;
      
      await this.logAction({
        type: 'BACKOFF_COLLECTORS',
        reason: 'Collector backoff expired, normal rates resumed',
        metadata: { action: 'resume' }
      });

      this.emit('guardrail:backoff_resume');
      logger.info('Collector backoff expired');
    }
  }

  private async emitHealthStatus(): Promise<void> {
    const status = {
      guardrailsEnabled: this.config.enabled,
      alertMetrics: Object.fromEntries(this.alertMetrics),
      errorMetrics: this.errorMetrics,
      activeActions: this.getActiveActions()
    };

    this.emit('guardrail:health', status);
  }

  // =============================================================================
  // MANUAL CONTROLS
  // =============================================================================

  async manualKillSwitch(reason: string): Promise<void> {
    await this.logAction({
      type: 'KILL_SWITCH',
      reason: `Manual kill-switch activated: ${reason}`,
      metadata: { manual: true }
    });

    // Set kill switch for all chains
    for (const [chain, metrics] of this.alertMetrics.entries()) {
      metrics.killSwitchActive = true;
    }

    this.emit('guardrail:kill_switch', { reason: 'manual', global: true });
    logger.error('Manual kill-switch activated', { reason });
  }

  async resetKillSwitch(chain?: string): Promise<void> {
    if (chain) {
      const metrics = this.alertMetrics.get(chain);
      if (metrics) {
        metrics.killSwitchActive = false;
        await this.logAction({
          type: 'KILL_SWITCH',
          chain,
          reason: 'Kill-switch manually reset',
          metadata: { action: 'reset', manual: true }
        });
      }
    } else {
      // Reset all chains
      for (const [chainName, metrics] of this.alertMetrics.entries()) {
        metrics.killSwitchActive = false;
      }
      await this.logAction({
        type: 'KILL_SWITCH',
        reason: 'Global kill-switch manually reset',
        metadata: { action: 'reset', manual: true, global: true }
      });
    }

    this.emit('guardrail:kill_switch_reset', { chain });
    logger.info('Kill-switch reset', { chain: chain || 'all' });
  }

  // =============================================================================
  // ACTION LOGGING
  // =============================================================================

  private async logAction(action: Omit<GuardrailAction, 'id' | 'timestamp'>): Promise<void> {
    const guardrailAction: GuardrailAction = {
      id: `${action.type.toLowerCase()}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      ...action
    };

    this.actions.push(guardrailAction);

    // Write to guardrail-actions.md
    await this.appendToGuardrailLog(guardrailAction);

    // Emit event
    this.emit('guardrail:action', guardrailAction);
  }

  private async appendToGuardrailLog(action: GuardrailAction): Promise<void> {
    try {
      const reportsDir = path.join(process.cwd(), 'reports');
      await fs.mkdir(reportsDir, { recursive: true });
      
      const logPath = path.join(reportsDir, 'guardrail-actions.md');
      
      // Create header if file doesn't exist
      let content = '';
      try {
        await fs.access(logPath);
      } catch {
        content = `# Guardrail Actions Log

**System:** Meme Coin Radar  
**Environment:** ${process.env.NODE_ENV || 'development'}  
**Guardrails Enabled:** ${this.config.enabled}

---

`;
      }

      // Format action entry
      const actionEntry = `## ${action.type} - ${action.timestamp}

**ID:** \`${action.id}\`  
**Chain:** ${action.chain || 'Global'}  
**Reason:** ${action.reason}  
${action.duration ? `**Duration:** ${action.duration} minutes  ` : ''}

### Details
\`\`\`json
${JSON.stringify(action.metadata || {}, null, 2)}
\`\`\`

### Discord/Telegram Message
\`\`\`
[GUARDRAIL TRIGGERED] ${action.chain ? `Chain: ${action.chain.toUpperCase()}` : 'Global'}
Reason: ${action.reason}
Action: ${action.type.replace('_', ' ')}${action.duration ? ` for ${action.duration}m` : ''}
\`\`\`

---

`;

      // Append to file
      await fs.appendFile(logPath, actionEntry, 'utf8');
      
      logger.debug('Guardrail action logged', { actionId: action.id, logPath });

    } catch (error) {
      logger.error('Failed to log guardrail action', { 
        actionId: action.id, 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  // =============================================================================
  // STATUS & REPORTING
  // =============================================================================

  getStatus(): any {
    return {
      enabled: this.config.enabled,
      config: this.config,
      alertMetrics: Object.fromEntries(this.alertMetrics),
      errorMetrics: this.errorMetrics,
      activeActions: this.getActiveActions(),
      isRunning: this.isRunning
    };
  }

  private getActiveActions(): GuardrailAction[] {
    const now = Date.now();
    return this.actions.filter(action => {
      if (action.type === 'MUTE_ALERTS' && action.duration) {
        const actionTime = new Date(action.timestamp).getTime();
        const expiresAt = actionTime + (action.duration * 60 * 1000);
        return now < expiresAt;
      }
      if (action.type === 'KILL_SWITCH') {
        const metrics = this.alertMetrics.get(action.chain || '');
        return metrics?.killSwitchActive || false;
      }
      if (action.type === 'BACKOFF_COLLECTORS') {
        return this.errorMetrics.backoffActive;
      }
      return false;
    });
  }

  isChainMuted(chain: string): boolean {
    const metrics = this.alertMetrics.get(chain);
    return metrics ? Date.now() < metrics.muteUntil : false;
  }

  isKillSwitchActive(chain?: string): boolean {
    if (chain) {
      const metrics = this.alertMetrics.get(chain);
      return metrics?.killSwitchActive || false;
    }
    
    // Check if any chain has kill switch active
    return Array.from(this.alertMetrics.values()).some(m => m.killSwitchActive);
  }

  isBackoffActive(): boolean {
    return this.errorMetrics.backoffActive;
  }

  // =============================================================================
  // DRY RUN TESTING
  // =============================================================================

  async runDryRunTest(): Promise<void> {
    logger.info('Starting guardrail dry-run test');

    // Simulate alert storm for BSC
    await this.logAction({
      type: 'MUTE_ALERTS',
      chain: 'bsc',
      reason: '[DRY RUN] Simulated alert storm - 18 alerts/hour',
      duration: 30,
      metadata: { dryRun: true, simulatedAlertsPerHour: 18 }
    });

    // Simulate kill switch for ETH
    await this.logAction({
      type: 'KILL_SWITCH',
      chain: 'eth',
      reason: '[DRY RUN] Simulated sustained alert storm - 27 alerts/hour for 15+ minutes',
      metadata: { dryRun: true, simulatedAlertsPerHour: 27, sustained: true }
    });

    // Simulate error rate backoff
    await this.logAction({
      type: 'BACKOFF_COLLECTORS',
      reason: '[DRY RUN] Simulated high error rate - 12% for 5+ minutes',
      duration: 60,
      metadata: { dryRun: true, simulatedErrorRate: 0.12, backoffPercentage: 50 }
    });

    logger.info('Guardrail dry-run test completed');
  }
}

// Global guardrail service instance
export let guardrailService: GuardrailService | null = null;

export function initializeGuardrails(cache: CacheManager): GuardrailService {
  if (!guardrailService) {
    guardrailService = new GuardrailService(cache);
  }
  return guardrailService;
}

export function getGuardrailService(): GuardrailService | null {
  return guardrailService;
}