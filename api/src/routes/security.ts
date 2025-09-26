import { Router, Request, Response } from 'express';
import { query, param, body } from 'express-validator';
import { authenticateJWT, requireRole, requirePermission, AuthRequest } from '../middleware/auth';
import { validateRequest } from '../utils/validation';
import { securityMonitor, SecurityEventType, SecuritySeverity } from '../services/securityMonitor';
import { logger } from '../utils/logger';
import { metrics } from '../utils/metrics';

const router = Router();

// All security routes require authentication
router.use(authenticateJWT);

// Get security dashboard metrics
router.get('/dashboard',
  requirePermission('security:read'),
  async (req: AuthRequest, res: Response): Promise<Response | void> => {
    try {
      const securityMetrics = securityMonitor.getMetrics();
      const recentEvents = securityMonitor.getRecentEvents(20);
      const activeAlerts = securityMonitor.getActiveAlerts();

      res.json({
        success: true,
        data: {
          metrics: securityMetrics,
          recentEvents: recentEvents.map(event => ({
            id: event.id,
            type: event.type,
            severity: event.severity,
            source: event.source,
            timestamp: event.timestamp,
            ip: event.ip,
            resolved: event.resolved
          })),
          activeAlerts: activeAlerts.map(alert => ({
            id: alert.id,
            type: alert.type,
            severity: alert.severity,
            message: alert.message,
            timestamp: alert.timestamp
          }))
        }
      });

    } catch (error) {
      logger.error('Security dashboard error', {
        type: 'security_dashboard_error',
        error: (error as Error).message,
        userId: req.user?.id
      });

      res.status(500).json({
        error: 'Failed to fetch security dashboard',
        code: 'DASHBOARD_ERROR'
      });
    }
  }
);

// Get security events with filtering and pagination
router.get('/events',
  requirePermission('security:read'),
  
  validateRequest([
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page must be a positive integer'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
    query('type')
      .optional()
      .isIn(['failed_login', 'brute_force_attempt', 'suspicious_activity', 'rate_limit_exceeded', 'invalid_token', 'unauthorized_access', 'sql_injection_attempt', 'xss_attempt', 'malicious_payload', 'api_abuse', 'account_lockout', 'privilege_escalation', 'data_exfiltration', 'ddos_attempt'])
      .withMessage('Invalid event type'),
    query('severity')
      .optional()
      .isIn(['low', 'medium', 'high', 'critical'])
      .withMessage('Invalid severity level'),
    query('resolved')
      .optional()
      .isBoolean()
      .withMessage('Resolved must be a boolean'),
    query('ip')
      .optional()
      .isIP()
      .withMessage('Invalid IP address'),
    query('userId')
      .optional()
      .isString()
      .withMessage('User ID must be a string'),
    query('from')
      .optional()
      .isISO8601()
      .withMessage('From date must be valid ISO 8601 format'),
    query('to')
      .optional()
      .isISO8601()
      .withMessage('To date must be valid ISO 8601 format')
  ]),
  
  async (req: AuthRequest, res: Response): Promise<Response | void> => {
    try {
      const {
        page = 1,
        limit = 50,
        type,
        severity,
        resolved,
        ip,
        userId,
        from,
        to
      } = req.query;

      let events = securityMonitor.getRecentEvents(1000);

      // Apply filters
      if (type) {
        events = events.filter(event => event.type === type);
      }

      if (severity) {
        events = events.filter(event => event.severity === severity);
      }

      if (resolved !== undefined) {
        const isResolved = resolved === 'true';
        events = events.filter(event => event.resolved === isResolved);
      }

      if (ip) {
        events = events.filter(event => event.ip === ip);
      }

      if (userId) {
        events = events.filter(event => event.userId === userId);
      }

      if (from) {
        const fromDate = new Date(from as string);
        events = events.filter(event => event.timestamp >= fromDate);
      }

      if (to) {
        const toDate = new Date(to as string);
        events = events.filter(event => event.timestamp <= toDate);
      }

      // Pagination
      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);
      const startIndex = (pageNum - 1) * limitNum;
      const endIndex = startIndex + limitNum;

      const paginatedEvents = events.slice(startIndex, endIndex);

      res.json({
        success: true,
        data: {
          events: paginatedEvents,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total: events.length,
            pages: Math.ceil(events.length / limitNum)
          }
        }
      });

    } catch (error) {
      logger.error('Security events fetch error', {
        type: 'security_events_error',
        error: (error as Error).message,
        userId: req.user?.id
      });

      res.status(500).json({
        error: 'Failed to fetch security events',
        code: 'EVENTS_ERROR'
      });
    }
  }
);

// Get specific security event details
router.get('/events/:eventId',
  requirePermission('security:read'),
  
  validateRequest([
    param('eventId')
      .isString()
      .isLength({ min: 1 })
      .withMessage('Event ID is required')
  ]),
  
  async (req: AuthRequest, res: Response): Promise<Response | void> => {
    try {
      const { eventId } = req.params;
      const events = securityMonitor.getRecentEvents(10000);
      const event = events.find(e => e.id === eventId);

      if (!event) {
        return res.status(404).json({
          error: 'Security event not found',
          code: 'EVENT_NOT_FOUND'
        });
      }

      res.json({
        success: true,
        data: { event }
      });

    } catch (error) {
      logger.error('Security event fetch error', {
        type: 'security_event_error',
        error: (error as Error).message,
        userId: req.user?.id,
        eventId: req.params.eventId
      });

      res.status(500).json({
        error: 'Failed to fetch security event',
        code: 'EVENT_ERROR'
      });
    }
  }
);

// Resolve a security event
router.post('/events/:eventId/resolve',
  requirePermission('security:admin'),
  
  validateRequest([
    param('eventId')
      .isString()
      .isLength({ min: 1 })
      .withMessage('Event ID is required')
  ]),
  
  async (req: AuthRequest, res: Response): Promise<Response | void> => {
    try {
      const { eventId } = req.params;
      const resolvedBy = req.user!.id;

      const success = await securityMonitor.resolveEvent(eventId, resolvedBy);

      if (!success) {
        return res.status(404).json({
          error: 'Security event not found',
          code: 'EVENT_NOT_FOUND'
        });
      }

      res.json({
        success: true,
        message: 'Security event resolved successfully'
      });

    } catch (error) {
      logger.error('Security event resolution error', {
        type: 'security_event_resolution_error',
        error: (error as Error).message,
        userId: req.user?.id,
        eventId: req.params.eventId
      });

      res.status(500).json({
        error: 'Failed to resolve security event',
        code: 'RESOLUTION_ERROR'
      });
    }
  }
);

// Get security alerts
router.get('/alerts',
  requirePermission('security:read'),
  
  async (req: AuthRequest, res: Response) => {
    try {
      const activeAlerts = securityMonitor.getActiveAlerts();

      res.json({
        success: true,
        data: { alerts: activeAlerts }
      });

    } catch (error) {
      logger.error('Security alerts fetch error', {
        type: 'security_alerts_error',
        error: (error as Error).message,
        userId: req.user?.id
      });

      res.status(500).json({
        error: 'Failed to fetch security alerts',
        code: 'ALERTS_ERROR'
      });
    }
  }
);

// Acknowledge a security alert
router.post('/alerts/:alertId/acknowledge',
  requirePermission('security:admin'),
  
  validateRequest([
    param('alertId')
      .isString()
      .isLength({ min: 1 })
      .withMessage('Alert ID is required')
  ]),
  
  async (req: AuthRequest, res: Response): Promise<Response | void> => {
    try {
      const { alertId } = req.params;
      const acknowledgedBy = req.user!.id;

      const success = await securityMonitor.acknowledgeAlert(alertId, acknowledgedBy);

      if (!success) {
        return res.status(404).json({
          error: 'Security alert not found',
          code: 'ALERT_NOT_FOUND'
        });
      }

      res.json({
        success: true,
        message: 'Security alert acknowledged successfully'
      });

    } catch (error) {
      logger.error('Security alert acknowledgment error', {
        type: 'security_alert_ack_error',
        error: (error as Error).message,
        userId: req.user?.id,
        alertId: req.params.alertId
      });

      res.status(500).json({
        error: 'Failed to acknowledge security alert',
        code: 'ACKNOWLEDGMENT_ERROR'
      });
    }
  }
);

// Create manual security event
router.post('/events',
  requirePermission('security:admin'),
  
  validateRequest([
    body('type')
      .isIn(['failed_login', 'brute_force_attempt', 'suspicious_activity', 'rate_limit_exceeded', 'invalid_token', 'unauthorized_access', 'sql_injection_attempt', 'xss_attempt', 'malicious_payload', 'api_abuse', 'account_lockout', 'privilege_escalation', 'data_exfiltration', 'ddos_attempt'])
      .withMessage('Invalid event type'),
    body('severity')
      .isIn(['low', 'medium', 'high', 'critical'])
      .withMessage('Invalid severity level'),
    body('source')
      .isString()
      .isLength({ min: 1, max: 100 })
      .withMessage('Source is required (1-100 characters)'),
    body('details')
      .optional()
      .isObject()
      .withMessage('Details must be an object'),
    body('ip')
      .optional()
      .isIP()
      .withMessage('Invalid IP address'),
    body('userId')
      .optional()
      .isString()
      .withMessage('User ID must be a string'),
    body('userAgent')
      .optional()
      .isString()
      .withMessage('User agent must be a string')
  ]),
  
  async (req: AuthRequest, res: Response) => {
    try {
      const { type, severity, source, details = {}, ip, userId, userAgent } = req.body;

      const event = await securityMonitor.recordEvent(
        type as SecurityEventType,
        severity as SecuritySeverity,
        source,
        { ...details, createdBy: req.user!.id },
        ip,
        userId,
        userAgent
      );

      res.status(201).json({
        success: true,
        data: { event }
      });

    } catch (error) {
      logger.error('Manual security event creation error', {
        type: 'manual_security_event_error',
        error: (error as Error).message,
        userId: req.user?.id
      });

      res.status(500).json({
        error: 'Failed to create security event',
        code: 'EVENT_CREATION_ERROR'
      });
    }
  }
);

// Get IP blacklist
router.get('/blacklist/ips',
  requirePermission('security:read'),
  
  async (req: AuthRequest, res: Response) => {
    try {
      const metrics = securityMonitor.getMetrics();

      res.json({
        success: true,
        data: {
          blacklistedIPs: metrics.ipBlacklist
        }
      });

    } catch (error) {
      logger.error('IP blacklist fetch error', {
        type: 'ip_blacklist_error',
        error: (error as Error).message,
        userId: req.user?.id
      });

      res.status(500).json({
        error: 'Failed to fetch IP blacklist',
        code: 'BLACKLIST_ERROR'
      });
    }
  }
);

// Add IP to blacklist
router.post('/blacklist/ips',
  requireRole('admin'),
  
  validateRequest([
    body('ip')
      .isIP()
      .withMessage('Valid IP address is required'),
    body('reason')
      .isString()
      .isLength({ min: 1, max: 500 })
      .withMessage('Reason is required (1-500 characters)')
  ]),
  
  async (req: AuthRequest, res: Response) => {
    try {
      const { ip, reason } = req.body;

      await securityMonitor.blacklistIP(ip, reason);

      res.json({
        success: true,
        message: 'IP blacklisted successfully'
      });

    } catch (error) {
      logger.error('IP blacklist addition error', {
        type: 'ip_blacklist_add_error',
        error: (error as Error).message,
        userId: req.user?.id,
        ip: req.body.ip
      });

      res.status(500).json({
        error: 'Failed to blacklist IP',
        code: 'BLACKLIST_ADD_ERROR'
      });
    }
  }
);

// Remove IP from blacklist
router.delete('/blacklist/ips/:ip',
  requireRole('admin'),
  
  validateRequest([
    param('ip')
      .isIP()
      .withMessage('Valid IP address is required')
  ]),
  
  async (req: AuthRequest, res: Response) => {
    try {
      const { ip } = req.params;

      await securityMonitor.whitelistIP(ip);

      res.json({
        success: true,
        message: 'IP removed from blacklist successfully'
      });

    } catch (error) {
      logger.error('IP whitelist error', {
        type: 'ip_whitelist_error',
        error: (error as Error).message,
        userId: req.user?.id,
        ip: req.params.ip
      });

      res.status(500).json({
        error: 'Failed to remove IP from blacklist',
        code: 'WHITELIST_ERROR'
      });
    }
  }
);

// Get user blacklist
router.get('/blacklist/users',
  requirePermission('security:read'),
  
  async (req: AuthRequest, res: Response) => {
    try {
      const metrics = securityMonitor.getMetrics();

      res.json({
        success: true,
        data: {
          blacklistedUsers: metrics.userBlacklist
        }
      });

    } catch (error) {
      logger.error('User blacklist fetch error', {
        type: 'user_blacklist_error',
        error: (error as Error).message,
        userId: req.user?.id
      });

      res.status(500).json({
        error: 'Failed to fetch user blacklist',
        code: 'USER_BLACKLIST_ERROR'
      });
    }
  }
);

// Add user to blacklist
router.post('/blacklist/users',
  requireRole('admin'),
  
  validateRequest([
    body('userId')
      .isString()
      .isLength({ min: 1 })
      .withMessage('User ID is required'),
    body('reason')
      .isString()
      .isLength({ min: 1, max: 500 })
      .withMessage('Reason is required (1-500 characters)')
  ]),
  
  async (req: AuthRequest, res: Response) => {
    try {
      const { userId, reason } = req.body;

      await securityMonitor.blacklistUser(userId, reason);

      res.json({
        success: true,
        message: 'User blacklisted successfully'
      });

    } catch (error) {
      logger.error('User blacklist addition error', {
        type: 'user_blacklist_add_error',
        error: (error as Error).message,
        userId: req.user?.id,
        targetUserId: req.body.userId
      });

      res.status(500).json({
        error: 'Failed to blacklist user',
        code: 'USER_BLACKLIST_ADD_ERROR'
      });
    }
  }
);

// Remove user from blacklist
router.delete('/blacklist/users/:userId',
  requireRole('admin'),
  
  validateRequest([
    param('userId')
      .isString()
      .isLength({ min: 1 })
      .withMessage('User ID is required')
  ]),
  
  async (req: AuthRequest, res: Response) => {
    try {
      const { userId } = req.params;

      await securityMonitor.whitelistUser(userId);

      res.json({
        success: true,
        message: 'User removed from blacklist successfully'
      });

    } catch (error) {
      logger.error('User whitelist error', {
        type: 'user_whitelist_error',
        error: (error as Error).message,
        userId: req.user?.id,
        targetUserId: req.params.userId
      });

      res.status(500).json({
        error: 'Failed to remove user from blacklist',
        code: 'USER_WHITELIST_ERROR'
      });
    }
  }
);

// Get security metrics
router.get('/metrics',
  requirePermission('security:read'),
  
  async (req: AuthRequest, res: Response) => {
    try {
      const securityMetrics = securityMonitor.getMetrics();

      res.json({
        success: true,
        data: { metrics: securityMetrics }
      });

    } catch (error) {
      logger.error('Security metrics fetch error', {
        type: 'security_metrics_error',
        error: (error as Error).message,
        userId: req.user?.id
      });

      res.status(500).json({
        error: 'Failed to fetch security metrics',
        code: 'METRICS_ERROR'
      });
    }
  }
);

export { router as securityRouter };