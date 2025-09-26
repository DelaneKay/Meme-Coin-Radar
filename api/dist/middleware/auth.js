"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.optionalAuth = exports.requireRole = exports.requirePermission = exports.authenticateApiKey = exports.authenticateJWT = exports.authService = exports.AuthService = exports.ROLE_PERMISSIONS = exports.PERMISSIONS = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const cache_1 = require("../utils/cache");
const logger_1 = require("../utils/logger");
const metrics_1 = require("../utils/metrics");
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';
const MAX_LOGIN_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5');
const LOCKOUT_DURATION = parseInt(process.env.LOCKOUT_DURATION || '900000');
exports.PERMISSIONS = {
    'tokens:read': 'Read token information',
    'tokens:write': 'Create/update token information',
    'tokens:delete': 'Delete token information',
    'alerts:read': 'Read alerts',
    'alerts:write': 'Create/update alerts',
    'alerts:delete': 'Delete alerts',
    'admin:users': 'Manage users',
    'admin:system': 'System administration',
    'admin:metrics': 'View system metrics',
    'api:read': 'Read API access',
    'api:write': 'Write API access',
    'api:admin': 'Admin API access'
};
exports.ROLE_PERMISSIONS = {
    readonly: ['tokens:read', 'alerts:read', 'api:read'],
    user: ['tokens:read', 'tokens:write', 'alerts:read', 'alerts:write', 'api:read', 'api:write'],
    admin: Object.keys(exports.PERMISSIONS)
};
class AuthService {
    static getInstance() {
        if (!AuthService.instance) {
            AuthService.instance = new AuthService();
        }
        return AuthService.instance;
    }
    constructor() {
        this.users = new Map();
        this.apiKeys = new Map();
        this.initializeDefaultUsers();
    }
    async initializeDefaultUsers() {
        const adminEmail = process.env.ADMIN_EMAIL || 'admin@memecoinradar.com';
        const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
        if (!this.users.has(adminEmail)) {
            const hashedPassword = await bcrypt_1.default.hash(adminPassword, 12);
            const adminUser = {
                id: 'admin-001',
                email: adminEmail,
                role: 'admin',
                permissions: exports.ROLE_PERMISSIONS.admin,
                apiKeyHash: hashedPassword,
                createdAt: new Date(),
                updatedAt: new Date()
            };
            this.users.set(adminEmail, adminUser);
            logger_1.logger.info('Default admin user created', {
                type: 'admin_user_created',
                email: adminEmail
            });
        }
    }
    async authenticateUser(email, password) {
        const user = this.users.get(email);
        if (!user || !user.apiKeyHash) {
            metrics_1.metrics.incrementCounter('auth_failed', 1, { reason: 'user_not_found' });
            return null;
        }
        if (user.lockedUntil && user.lockedUntil > new Date()) {
            (0, logger_1.logSecurityEvent)('account_locked_attempt', {
                email,
                lockedUntil: user.lockedUntil
            });
            metrics_1.metrics.incrementCounter('auth_failed', 1, { reason: 'account_locked' });
            return null;
        }
        const isValidPassword = await bcrypt_1.default.compare(password, user.apiKeyHash);
        if (!isValidPassword) {
            await this.handleFailedLogin(user);
            (0, logger_1.logSecurityEvent)('invalid_password', {
                email,
                loginAttempts: user.loginAttempts || 0
            });
            metrics_1.metrics.incrementCounter('auth_failed', 1, { reason: 'invalid_password' });
            return null;
        }
        user.loginAttempts = 0;
        user.lockedUntil = undefined;
        user.lastLogin = new Date();
        user.updatedAt = new Date();
        const tokens = await this.generateTokens(user);
        (0, logger_1.logSecurityEvent)('user_login_success', {
            userId: user.id,
            email: user.email,
            role: user.role
        });
        metrics_1.metrics.incrementCounter('auth_success', 1, { role: user.role });
        return { user, tokens };
    }
    async handleFailedLogin(user) {
        user.loginAttempts = (user.loginAttempts || 0) + 1;
        user.updatedAt = new Date();
        if (user.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
            user.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION);
            (0, logger_1.logSecurityEvent)('account_locked', {
                userId: user.id,
                email: user.email,
                attempts: user.loginAttempts,
                lockedUntil: user.lockedUntil
            });
        }
    }
    async generateTokens(user) {
        const payload = {
            userId: user.id,
            email: user.email,
            role: user.role,
            permissions: user.permissions,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60)
        };
        const accessToken = jsonwebtoken_1.default.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
        const refreshToken = jsonwebtoken_1.default.sign({ userId: user.id }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRES_IN });
        await cache_1.cache.set(`refresh_token:${user.id}`, refreshToken, 7 * 24 * 60 * 60);
        return { accessToken, refreshToken };
    }
    async verifyToken(token) {
        try {
            const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
            const isBlacklisted = await cache_1.cache.get(`blacklist:${token}`);
            if (isBlacklisted) {
                return null;
            }
            return decoded;
        }
        catch (error) {
            logger_1.logger.debug('Token verification failed', {
                type: 'token_verification_failed',
                error: error.message
            });
            return null;
        }
    }
    async refreshToken(refreshToken) {
        try {
            const decoded = jsonwebtoken_1.default.verify(refreshToken, JWT_SECRET);
            const storedToken = await cache_1.cache.get(`refresh_token:${decoded.userId}`);
            if (storedToken !== refreshToken) {
                return null;
            }
            const user = Array.from(this.users.values()).find(u => u.id === decoded.userId);
            if (!user) {
                return null;
            }
            const tokens = await this.generateTokens(user);
            await cache_1.cache.delete(`refresh_token:${decoded.userId}`);
            return tokens;
        }
        catch (error) {
            logger_1.logger.debug('Refresh token verification failed', {
                type: 'refresh_token_failed',
                error: error.message
            });
            return null;
        }
    }
    async blacklistToken(token) {
        try {
            const decoded = jsonwebtoken_1.default.decode(token);
            if (decoded && decoded.exp) {
                const ttl = decoded.exp - Math.floor(Date.now() / 1000);
                if (ttl > 0) {
                    await cache_1.cache.set(`blacklist:${token}`, '1', ttl);
                }
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to blacklist token', {
                type: 'token_blacklist_error',
                error: error.message
            });
        }
    }
    async createApiKey(userId, name, permissions, expiresAt) {
        const keyId = `ak_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const key = `${keyId}.${Buffer.from(JSON.stringify({ userId, permissions })).toString('base64')}`;
        const apiKeyInfo = {
            id: keyId,
            name,
            userId,
            permissions,
            expiresAt,
            rateLimit: {
                requestsPerMinute: 100,
                requestsPerHour: 1000
            }
        };
        this.apiKeys.set(key, apiKeyInfo);
        await cache_1.cache.set(`api_key:${key}`, JSON.stringify(apiKeyInfo), expiresAt ? Math.floor((expiresAt.getTime() - Date.now()) / 1000) : undefined);
        logger_1.logger.info('API key created', {
            type: 'api_key_created',
            keyId,
            userId,
            name,
            permissions
        });
        return { key, info: apiKeyInfo };
    }
    async validateApiKey(key) {
        try {
            let apiKeyInfo = this.apiKeys.get(key);
            if (!apiKeyInfo) {
                const cached = await cache_1.cache.get(`api_key:${key}`);
                if (cached) {
                    apiKeyInfo = JSON.parse(cached);
                    this.apiKeys.set(key, apiKeyInfo);
                }
            }
            if (!apiKeyInfo) {
                return null;
            }
            if (apiKeyInfo.expiresAt && apiKeyInfo.expiresAt < new Date()) {
                await this.revokeApiKey(key);
                return null;
            }
            apiKeyInfo.lastUsed = new Date();
            await cache_1.cache.set(`api_key:${key}`, JSON.stringify(apiKeyInfo));
            return apiKeyInfo;
        }
        catch (error) {
            logger_1.logger.error('API key validation failed', {
                type: 'api_key_validation_error',
                error: error.message
            });
            return null;
        }
    }
    async revokeApiKey(key) {
        this.apiKeys.delete(key);
        await cache_1.cache.delete(`api_key:${key}`);
        logger_1.logger.info('API key revoked', {
            type: 'api_key_revoked',
            key: key.substring(0, 10) + '...'
        });
    }
    getUserById(id) {
        return Array.from(this.users.values()).find(user => user.id === id);
    }
    hasPermission(user, permission) {
        return user.permissions.includes(permission) || user.permissions.includes('*');
    }
}
exports.AuthService = AuthService;
exports.authService = AuthService.getInstance();
const authenticateJWT = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({
            error: 'Access token required',
            code: 'MISSING_TOKEN'
        });
    }
    try {
        const payload = await exports.authService.verifyToken(token);
        if (!payload) {
            return res.status(401).json({
                error: 'Invalid or expired token',
                code: 'INVALID_TOKEN'
            });
        }
        const user = exports.authService.getUserById(payload.userId);
        if (!user) {
            return res.status(401).json({
                error: 'User not found',
                code: 'USER_NOT_FOUND'
            });
        }
        req.user = user;
        next();
    }
    catch (error) {
        logger_1.logger.error('JWT authentication failed', {
            type: 'jwt_auth_error',
            error: error.message
        });
        return res.status(401).json({
            error: 'Authentication failed',
            code: 'AUTH_FAILED'
        });
    }
};
exports.authenticateJWT = authenticateJWT;
const authenticateApiKey = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
        return res.status(401).json({
            error: 'API key required',
            code: 'MISSING_API_KEY'
        });
    }
    try {
        const apiKeyInfo = await exports.authService.validateApiKey(apiKey);
        if (!apiKeyInfo) {
            (0, logger_1.logSecurityEvent)('invalid_api_key', {
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                path: req.path
            });
            return res.status(401).json({
                error: 'Invalid API key',
                code: 'INVALID_API_KEY'
            });
        }
        req.apiKey = apiKey;
        req.user = exports.authService.getUserById(apiKeyInfo.userId);
        next();
    }
    catch (error) {
        logger_1.logger.error('API key authentication failed', {
            type: 'api_key_auth_error',
            error: error.message
        });
        return res.status(401).json({
            error: 'Authentication failed',
            code: 'AUTH_FAILED'
        });
    }
};
exports.authenticateApiKey = authenticateApiKey;
const requirePermission = (permission) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'Authentication required',
                code: 'AUTH_REQUIRED'
            });
        }
        if (!exports.authService.hasPermission(req.user, permission)) {
            (0, logger_1.logSecurityEvent)('permission_denied', {
                userId: req.user.id,
                permission,
                path: req.path,
                method: req.method
            });
            return res.status(403).json({
                error: 'Insufficient permissions',
                code: 'PERMISSION_DENIED',
                required: permission
            });
        }
        next();
    };
};
exports.requirePermission = requirePermission;
const requireRole = (role) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'Authentication required',
                code: 'AUTH_REQUIRED'
            });
        }
        if (req.user.role !== role && req.user.role !== 'admin') {
            (0, logger_1.logSecurityEvent)('role_denied', {
                userId: req.user.id,
                userRole: req.user.role,
                requiredRole: role,
                path: req.path,
                method: req.method
            });
            return res.status(403).json({
                error: 'Insufficient role',
                code: 'ROLE_DENIED',
                required: role,
                current: req.user.role
            });
        }
        next();
    };
};
exports.requireRole = requireRole;
const optionalAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    const apiKey = req.headers['x-api-key'];
    try {
        if (authHeader) {
            const token = authHeader.split(' ')[1];
            if (token) {
                const payload = await exports.authService.verifyToken(token);
                if (payload) {
                    req.user = exports.authService.getUserById(payload.userId);
                }
            }
        }
        else if (apiKey) {
            const apiKeyInfo = await exports.authService.validateApiKey(apiKey);
            if (apiKeyInfo) {
                req.apiKey = apiKey;
                req.user = exports.authService.getUserById(apiKeyInfo.userId);
            }
        }
    }
    catch (error) {
        logger_1.logger.debug('Optional auth failed', {
            type: 'optional_auth_failed',
            error: error.message
        });
    }
    next();
};
exports.optionalAuth = optionalAuth;
exports.default = {
    authService: exports.authService,
    authenticateJWT: exports.authenticateJWT,
    authenticateApiKey: exports.authenticateApiKey,
    requirePermission: exports.requirePermission,
    requireRole: exports.requireRole,
    optionalAuth: exports.optionalAuth,
    PERMISSIONS: exports.PERMISSIONS,
    ROLE_PERMISSIONS: exports.ROLE_PERMISSIONS
};
//# sourceMappingURL=auth.js.map