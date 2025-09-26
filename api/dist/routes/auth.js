"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const auth_1 = require("../middleware/auth");
const validation_1 = require("../utils/validation");
const logger_1 = require("../utils/logger");
const metrics_1 = require("../utils/metrics");
const rateLimiter_1 = require("../utils/rateLimiter");
const router = (0, express_1.Router)();
exports.authRouter = router;
router.post('/login', async (req, res, next) => {
    const result = await rateLimiter_1.rateLimiterManager.checkLimit('auth', req.ip);
    if (!result.allowed) {
        return res.status(429).json({
            error: 'Too many authentication attempts',
            code: 'AUTH_RATE_LIMITED',
            retryAfter: result.retryAfter
        });
    }
    next();
}, (0, validation_1.validateRequest)([
    (0, express_validator_1.body)('email')
        .isEmail()
        .normalizeEmail()
        .withMessage('Valid email is required'),
    (0, express_validator_1.body)('password')
        .isLength({ min: 1 })
        .withMessage('Password is required')
]), async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await auth_1.authService.authenticateUser(email, password);
        if (!result) {
            metrics_1.metrics.incrementCounter('auth_failed', 1, { reason: 'invalid_credentials' });
            return res.status(401).json({
                error: 'Invalid credentials',
                code: 'INVALID_CREDENTIALS'
            });
        }
        const { user, tokens } = result;
        res.cookie('refreshToken', tokens.refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });
        res.json({
            success: true,
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    role: user.role,
                    permissions: user.permissions
                },
                accessToken: tokens.accessToken,
                expiresIn: 24 * 60 * 60
            }
        });
    }
    catch (error) {
        logger_1.logger.error('Login error', {
            type: 'login_error',
            error: error.message,
            ip: req.ip
        });
        res.status(500).json({
            error: 'Authentication failed',
            code: 'AUTH_ERROR'
        });
    }
});
router.post('/refresh', async (req, res) => {
    try {
        const refreshToken = req.cookies.refreshToken || req.body.refreshToken;
        if (!refreshToken) {
            return res.status(401).json({
                error: 'Refresh token required',
                code: 'MISSING_REFRESH_TOKEN'
            });
        }
        const tokens = await auth_1.authService.refreshToken(refreshToken);
        if (!tokens) {
            return res.status(401).json({
                error: 'Invalid refresh token',
                code: 'INVALID_REFRESH_TOKEN'
            });
        }
        res.cookie('refreshToken', tokens.refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });
        res.json({
            success: true,
            data: {
                accessToken: tokens.accessToken,
                expiresIn: 24 * 60 * 60
            }
        });
    }
    catch (error) {
        logger_1.logger.error('Token refresh error', {
            type: 'token_refresh_error',
            error: error.message,
            ip: req.ip
        });
        res.status(500).json({
            error: 'Token refresh failed',
            code: 'REFRESH_ERROR'
        });
    }
});
router.post('/logout', auth_1.authenticateJWT, async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1];
        if (token) {
            await auth_1.authService.blacklistToken(token);
        }
        res.clearCookie('refreshToken');
        (0, logger_1.logSecurityEvent)('user_logout', {
            userId: req.user?.id,
            email: req.user?.email
        });
        res.json({
            success: true,
            message: 'Logged out successfully'
        });
    }
    catch (error) {
        logger_1.logger.error('Logout error', {
            type: 'logout_error',
            error: error.message,
            userId: req.user?.id
        });
        res.status(500).json({
            error: 'Logout failed',
            code: 'LOGOUT_ERROR'
        });
    }
});
router.get('/profile', auth_1.authenticateJWT, async (req, res) => {
    try {
        const user = req.user;
        res.json({
            success: true,
            data: {
                id: user.id,
                email: user.email,
                role: user.role,
                permissions: user.permissions,
                lastLogin: user.lastLogin,
                createdAt: user.createdAt
            }
        });
    }
    catch (error) {
        logger_1.logger.error('Profile fetch error', {
            type: 'profile_error',
            error: error.message,
            userId: req.user?.id
        });
        res.status(500).json({
            error: 'Failed to fetch profile',
            code: 'PROFILE_ERROR'
        });
    }
});
router.post('/api-keys', auth_1.authenticateJWT, (0, auth_1.requirePermission)('api:admin'), (0, validation_1.validateRequest)([
    (0, express_validator_1.body)('name')
        .isLength({ min: 1, max: 100 })
        .trim()
        .withMessage('API key name is required (1-100 characters)'),
    (0, express_validator_1.body)('permissions')
        .isArray({ min: 1 })
        .withMessage('At least one permission is required'),
    (0, express_validator_1.body)('expiresAt')
        .optional()
        .isISO8601()
        .withMessage('Expiration date must be valid ISO 8601 format')
]), async (req, res) => {
    try {
        const { name, permissions, expiresAt } = req.body;
        const userId = req.user.id;
        const expirationDate = expiresAt ? new Date(expiresAt) : undefined;
        const { key, info } = await auth_1.authService.createApiKey(userId, name, permissions, expirationDate);
        (0, logger_1.logSecurityEvent)('api_key_created', {
            userId,
            keyId: info.id,
            name,
            permissions
        });
        res.status(201).json({
            success: true,
            data: {
                key,
                id: info.id,
                name: info.name,
                permissions: info.permissions,
                expiresAt: info.expiresAt,
                rateLimit: info.rateLimit
            }
        });
    }
    catch (error) {
        logger_1.logger.error('API key creation error', {
            type: 'api_key_creation_error',
            error: error.message,
            userId: req.user?.id
        });
        res.status(500).json({
            error: 'Failed to create API key',
            code: 'API_KEY_ERROR'
        });
    }
});
router.get('/api-keys', auth_1.authenticateJWT, (0, auth_1.requirePermission)('api:read'), async (req, res) => {
    try {
        res.json({
            success: true,
            data: []
        });
    }
    catch (error) {
        logger_1.logger.error('API key list error', {
            type: 'api_key_list_error',
            error: error.message,
            userId: req.user?.id
        });
        res.status(500).json({
            error: 'Failed to fetch API keys',
            code: 'API_KEY_LIST_ERROR'
        });
    }
});
router.delete('/api-keys/:keyId', auth_1.authenticateJWT, (0, auth_1.requirePermission)('api:admin'), async (req, res) => {
    try {
        const { keyId } = req.params;
        (0, logger_1.logSecurityEvent)('api_key_revoked', {
            userId: req.user.id,
            keyId
        });
        res.json({
            success: true,
            message: 'API key revoked successfully'
        });
    }
    catch (error) {
        logger_1.logger.error('API key revocation error', {
            type: 'api_key_revocation_error',
            error: error.message,
            userId: req.user?.id,
            keyId: req.params.keyId
        });
        res.status(500).json({
            error: 'Failed to revoke API key',
            code: 'API_KEY_REVOCATION_ERROR'
        });
    }
});
router.post('/change-password', auth_1.authenticateJWT, (0, validation_1.validateRequest)([
    (0, express_validator_1.body)('currentPassword')
        .isLength({ min: 1 })
        .withMessage('Current password is required'),
    (0, express_validator_1.body)('newPassword')
        .isLength({ min: 8, max: 128 })
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
        .withMessage('New password must be 8-128 characters with uppercase, lowercase, number, and special character')
]), async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const user = req.user;
        (0, logger_1.logSecurityEvent)('password_changed', {
            userId: user.id,
            email: user.email
        });
        res.json({
            success: true,
            message: 'Password changed successfully'
        });
    }
    catch (error) {
        logger_1.logger.error('Password change error', {
            type: 'password_change_error',
            error: error.message,
            userId: req.user?.id
        });
        res.status(500).json({
            error: 'Failed to change password',
            code: 'PASSWORD_CHANGE_ERROR'
        });
    }
});
router.get('/users', auth_1.authenticateJWT, (0, auth_1.requireRole)('admin'), async (req, res) => {
    try {
        res.json({
            success: true,
            data: [
                {
                    id: 'admin-001',
                    email: 'admin@memecoinradar.com',
                    role: 'admin',
                    lastLogin: new Date(),
                    createdAt: new Date()
                }
            ]
        });
    }
    catch (error) {
        logger_1.logger.error('User list error', {
            type: 'user_list_error',
            error: error.message,
            userId: req.user?.id
        });
        res.status(500).json({
            error: 'Failed to fetch users',
            code: 'USER_LIST_ERROR'
        });
    }
});
router.post('/validate', async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) {
            return res.status(400).json({
                error: 'Token is required',
                code: 'MISSING_TOKEN'
            });
        }
        const payload = await auth_1.authService.verifyToken(token);
        if (!payload) {
            return res.status(401).json({
                error: 'Invalid token',
                code: 'INVALID_TOKEN'
            });
        }
        const user = auth_1.authService.getUserById(payload.userId);
        if (!user) {
            return res.status(401).json({
                error: 'User not found',
                code: 'USER_NOT_FOUND'
            });
        }
        res.json({
            success: true,
            data: {
                valid: true,
                user: {
                    id: user.id,
                    email: user.email,
                    role: user.role,
                    permissions: user.permissions
                }
            }
        });
    }
    catch (error) {
        logger_1.logger.error('Token validation error', {
            type: 'token_validation_error',
            error: error.message,
            ip: req.ip
        });
        res.status(500).json({
            error: 'Token validation failed',
            code: 'VALIDATION_ERROR'
        });
    }
});
//# sourceMappingURL=auth.js.map