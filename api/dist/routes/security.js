"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.securityRouter = void 0;
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const auth_1 = require("../middleware/auth");
const validation_1 = require("../utils/validation");
const securityMonitor_1 = require("../services/securityMonitor");
const logger_1 = require("../utils/logger");
const router = (0, express_1.Router)();
exports.securityRouter = router;
router.use(auth_1.authenticateJWT);
router.get('/dashboard', (0, auth_1.requirePermission)('security:read'), async (req, res) => {
    try {
        const securityMetrics = securityMonitor_1.securityMonitor.getMetrics();
        const recentEvents = securityMonitor_1.securityMonitor.getRecentEvents(20);
        const activeAlerts = securityMonitor_1.securityMonitor.getActiveAlerts();
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
    }
    catch (error) {
        logger_1.logger.error('Security dashboard error', {
            type: 'security_dashboard_error',
            error: error.message,
            userId: req.user?.id
        });
        res.status(500).json({
            error: 'Failed to fetch security dashboard',
            code: 'DASHBOARD_ERROR'
        });
    }
});
router.get('/events', (0, auth_1.requirePermission)('security:read'), (0, validation_1.validateRequest)([
    (0, express_validator_1.query)('page')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Page must be a positive integer'),
    (0, express_validator_1.query)('limit')
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage('Limit must be between 1 and 100'),
    (0, express_validator_1.query)('type')
        .optional()
        .isIn(['failed_login', 'brute_force_attempt', 'suspicious_activity', 'rate_limit_exceeded', 'invalid_token', 'unauthorized_access', 'sql_injection_attempt', 'xss_attempt', 'malicious_payload', 'api_abuse', 'account_lockout', 'privilege_escalation', 'data_exfiltration', 'ddos_attempt'])
        .withMessage('Invalid event type'),
    (0, express_validator_1.query)('severity')
        .optional()
        .isIn(['low', 'medium', 'high', 'critical'])
        .withMessage('Invalid severity level'),
    (0, express_validator_1.query)('resolved')
        .optional()
        .isBoolean()
        .withMessage('Resolved must be a boolean'),
    (0, express_validator_1.query)('ip')
        .optional()
        .isIP()
        .withMessage('Invalid IP address'),
    (0, express_validator_1.query)('userId')
        .optional()
        .isString()
        .withMessage('User ID must be a string'),
    (0, express_validator_1.query)('from')
        .optional()
        .isISO8601()
        .withMessage('From date must be valid ISO 8601 format'),
    (0, express_validator_1.query)('to')
        .optional()
        .isISO8601()
        .withMessage('To date must be valid ISO 8601 format')
]), async (req, res) => {
    try {
        const { page = 1, limit = 50, type, severity, resolved, ip, userId, from, to } = req.query;
        let events = securityMonitor_1.securityMonitor.getRecentEvents(1000);
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
            const fromDate = new Date(from);
            events = events.filter(event => event.timestamp >= fromDate);
        }
        if (to) {
            const toDate = new Date(to);
            events = events.filter(event => event.timestamp <= toDate);
        }
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
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
    }
    catch (error) {
        logger_1.logger.error('Security events fetch error', {
            type: 'security_events_error',
            error: error.message,
            userId: req.user?.id
        });
        res.status(500).json({
            error: 'Failed to fetch security events',
            code: 'EVENTS_ERROR'
        });
    }
});
router.get('/events/:eventId', (0, auth_1.requirePermission)('security:read'), (0, validation_1.validateRequest)([
    (0, express_validator_1.param)('eventId')
        .isString()
        .isLength({ min: 1 })
        .withMessage('Event ID is required')
]), async (req, res) => {
    try {
        const { eventId } = req.params;
        const events = securityMonitor_1.securityMonitor.getRecentEvents(10000);
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
    }
    catch (error) {
        logger_1.logger.error('Security event fetch error', {
            type: 'security_event_error',
            error: error.message,
            userId: req.user?.id,
            eventId: req.params.eventId
        });
        res.status(500).json({
            error: 'Failed to fetch security event',
            code: 'EVENT_ERROR'
        });
    }
});
router.post('/events/:eventId/resolve', (0, auth_1.requirePermission)('security:admin'), (0, validation_1.validateRequest)([
    (0, express_validator_1.param)('eventId')
        .isString()
        .isLength({ min: 1 })
        .withMessage('Event ID is required')
]), async (req, res) => {
    try {
        const { eventId } = req.params;
        const resolvedBy = req.user.id;
        const success = await securityMonitor_1.securityMonitor.resolveEvent(eventId, resolvedBy);
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
    }
    catch (error) {
        logger_1.logger.error('Security event resolution error', {
            type: 'security_event_resolution_error',
            error: error.message,
            userId: req.user?.id,
            eventId: req.params.eventId
        });
        res.status(500).json({
            error: 'Failed to resolve security event',
            code: 'RESOLUTION_ERROR'
        });
    }
});
router.get('/alerts', (0, auth_1.requirePermission)('security:read'), async (req, res) => {
    try {
        const activeAlerts = securityMonitor_1.securityMonitor.getActiveAlerts();
        res.json({
            success: true,
            data: { alerts: activeAlerts }
        });
    }
    catch (error) {
        logger_1.logger.error('Security alerts fetch error', {
            type: 'security_alerts_error',
            error: error.message,
            userId: req.user?.id
        });
        res.status(500).json({
            error: 'Failed to fetch security alerts',
            code: 'ALERTS_ERROR'
        });
    }
});
router.post('/alerts/:alertId/acknowledge', (0, auth_1.requirePermission)('security:admin'), (0, validation_1.validateRequest)([
    (0, express_validator_1.param)('alertId')
        .isString()
        .isLength({ min: 1 })
        .withMessage('Alert ID is required')
]), async (req, res) => {
    try {
        const { alertId } = req.params;
        const acknowledgedBy = req.user.id;
        const success = await securityMonitor_1.securityMonitor.acknowledgeAlert(alertId, acknowledgedBy);
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
    }
    catch (error) {
        logger_1.logger.error('Security alert acknowledgment error', {
            type: 'security_alert_ack_error',
            error: error.message,
            userId: req.user?.id,
            alertId: req.params.alertId
        });
        res.status(500).json({
            error: 'Failed to acknowledge security alert',
            code: 'ACKNOWLEDGMENT_ERROR'
        });
    }
});
router.post('/events', (0, auth_1.requirePermission)('security:admin'), (0, validation_1.validateRequest)([
    (0, express_validator_1.body)('type')
        .isIn(['failed_login', 'brute_force_attempt', 'suspicious_activity', 'rate_limit_exceeded', 'invalid_token', 'unauthorized_access', 'sql_injection_attempt', 'xss_attempt', 'malicious_payload', 'api_abuse', 'account_lockout', 'privilege_escalation', 'data_exfiltration', 'ddos_attempt'])
        .withMessage('Invalid event type'),
    (0, express_validator_1.body)('severity')
        .isIn(['low', 'medium', 'high', 'critical'])
        .withMessage('Invalid severity level'),
    (0, express_validator_1.body)('source')
        .isString()
        .isLength({ min: 1, max: 100 })
        .withMessage('Source is required (1-100 characters)'),
    (0, express_validator_1.body)('details')
        .optional()
        .isObject()
        .withMessage('Details must be an object'),
    (0, express_validator_1.body)('ip')
        .optional()
        .isIP()
        .withMessage('Invalid IP address'),
    (0, express_validator_1.body)('userId')
        .optional()
        .isString()
        .withMessage('User ID must be a string'),
    (0, express_validator_1.body)('userAgent')
        .optional()
        .isString()
        .withMessage('User agent must be a string')
]), async (req, res) => {
    try {
        const { type, severity, source, details = {}, ip, userId, userAgent } = req.body;
        const event = await securityMonitor_1.securityMonitor.recordEvent(type, severity, source, { ...details, createdBy: req.user.id }, ip, userId, userAgent);
        res.status(201).json({
            success: true,
            data: { event }
        });
    }
    catch (error) {
        logger_1.logger.error('Manual security event creation error', {
            type: 'manual_security_event_error',
            error: error.message,
            userId: req.user?.id
        });
        res.status(500).json({
            error: 'Failed to create security event',
            code: 'EVENT_CREATION_ERROR'
        });
    }
});
router.get('/blacklist/ips', (0, auth_1.requirePermission)('security:read'), async (req, res) => {
    try {
        const metrics = securityMonitor_1.securityMonitor.getMetrics();
        res.json({
            success: true,
            data: {
                blacklistedIPs: metrics.ipBlacklist
            }
        });
    }
    catch (error) {
        logger_1.logger.error('IP blacklist fetch error', {
            type: 'ip_blacklist_error',
            error: error.message,
            userId: req.user?.id
        });
        res.status(500).json({
            error: 'Failed to fetch IP blacklist',
            code: 'BLACKLIST_ERROR'
        });
    }
});
router.post('/blacklist/ips', (0, auth_1.requireRole)('admin'), (0, validation_1.validateRequest)([
    (0, express_validator_1.body)('ip')
        .isIP()
        .withMessage('Valid IP address is required'),
    (0, express_validator_1.body)('reason')
        .isString()
        .isLength({ min: 1, max: 500 })
        .withMessage('Reason is required (1-500 characters)')
]), async (req, res) => {
    try {
        const { ip, reason } = req.body;
        await securityMonitor_1.securityMonitor.blacklistIP(ip, reason);
        res.json({
            success: true,
            message: 'IP blacklisted successfully'
        });
    }
    catch (error) {
        logger_1.logger.error('IP blacklist addition error', {
            type: 'ip_blacklist_add_error',
            error: error.message,
            userId: req.user?.id,
            ip: req.body.ip
        });
        res.status(500).json({
            error: 'Failed to blacklist IP',
            code: 'BLACKLIST_ADD_ERROR'
        });
    }
});
router.delete('/blacklist/ips/:ip', (0, auth_1.requireRole)('admin'), (0, validation_1.validateRequest)([
    (0, express_validator_1.param)('ip')
        .isIP()
        .withMessage('Valid IP address is required')
]), async (req, res) => {
    try {
        const { ip } = req.params;
        await securityMonitor_1.securityMonitor.whitelistIP(ip);
        res.json({
            success: true,
            message: 'IP removed from blacklist successfully'
        });
    }
    catch (error) {
        logger_1.logger.error('IP whitelist error', {
            type: 'ip_whitelist_error',
            error: error.message,
            userId: req.user?.id,
            ip: req.params.ip
        });
        res.status(500).json({
            error: 'Failed to remove IP from blacklist',
            code: 'WHITELIST_ERROR'
        });
    }
});
router.get('/blacklist/users', (0, auth_1.requirePermission)('security:read'), async (req, res) => {
    try {
        const metrics = securityMonitor_1.securityMonitor.getMetrics();
        res.json({
            success: true,
            data: {
                blacklistedUsers: metrics.userBlacklist
            }
        });
    }
    catch (error) {
        logger_1.logger.error('User blacklist fetch error', {
            type: 'user_blacklist_error',
            error: error.message,
            userId: req.user?.id
        });
        res.status(500).json({
            error: 'Failed to fetch user blacklist',
            code: 'USER_BLACKLIST_ERROR'
        });
    }
});
router.post('/blacklist/users', (0, auth_1.requireRole)('admin'), (0, validation_1.validateRequest)([
    (0, express_validator_1.body)('userId')
        .isString()
        .isLength({ min: 1 })
        .withMessage('User ID is required'),
    (0, express_validator_1.body)('reason')
        .isString()
        .isLength({ min: 1, max: 500 })
        .withMessage('Reason is required (1-500 characters)')
]), async (req, res) => {
    try {
        const { userId, reason } = req.body;
        await securityMonitor_1.securityMonitor.blacklistUser(userId, reason);
        res.json({
            success: true,
            message: 'User blacklisted successfully'
        });
    }
    catch (error) {
        logger_1.logger.error('User blacklist addition error', {
            type: 'user_blacklist_add_error',
            error: error.message,
            userId: req.user?.id,
            targetUserId: req.body.userId
        });
        res.status(500).json({
            error: 'Failed to blacklist user',
            code: 'USER_BLACKLIST_ADD_ERROR'
        });
    }
});
router.delete('/blacklist/users/:userId', (0, auth_1.requireRole)('admin'), (0, validation_1.validateRequest)([
    (0, express_validator_1.param)('userId')
        .isString()
        .isLength({ min: 1 })
        .withMessage('User ID is required')
]), async (req, res) => {
    try {
        const { userId } = req.params;
        await securityMonitor_1.securityMonitor.whitelistUser(userId);
        res.json({
            success: true,
            message: 'User removed from blacklist successfully'
        });
    }
    catch (error) {
        logger_1.logger.error('User whitelist error', {
            type: 'user_whitelist_error',
            error: error.message,
            userId: req.user?.id,
            targetUserId: req.params.userId
        });
        res.status(500).json({
            error: 'Failed to remove user from blacklist',
            code: 'USER_WHITELIST_ERROR'
        });
    }
});
router.get('/metrics', (0, auth_1.requirePermission)('security:read'), async (req, res) => {
    try {
        const securityMetrics = securityMonitor_1.securityMonitor.getMetrics();
        res.json({
            success: true,
            data: { metrics: securityMetrics }
        });
    }
    catch (error) {
        logger_1.logger.error('Security metrics fetch error', {
            type: 'security_metrics_error',
            error: error.message,
            userId: req.user?.id
        });
        res.status(500).json({
            error: 'Failed to fetch security metrics',
            code: 'METRICS_ERROR'
        });
    }
});
//# sourceMappingURL=security.js.map