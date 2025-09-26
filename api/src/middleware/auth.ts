import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import { cache } from '../utils/cache';
import { logger, logSecurityEvent } from '../utils/logger';
import { metrics } from '../utils/metrics';

export interface User {
  id: string;
  email: string;
  role: 'admin' | 'user' | 'readonly';
  permissions: string[];
  apiKeyHash?: string;
  lastLogin?: Date;
  loginAttempts?: number;
  lockedUntil?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthRequest extends Request {
  user?: User;
  apiKey?: string;
}

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
  permissions: string[];
  iat: number;
  exp: number;
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  userId: string;
  permissions: string[];
  lastUsed?: Date;
  expiresAt?: Date;
  rateLimit?: {
    requestsPerMinute: number;
    requestsPerHour: number;
  };
}

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRES_IN: string = process.env.JWT_EXPIRES_IN || '24h';
const REFRESH_TOKEN_EXPIRES_IN: string = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';

// Account lockout configuration
const MAX_LOGIN_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5');
const LOCKOUT_DURATION = parseInt(process.env.LOCKOUT_DURATION || '900000'); // 15 minutes

// Permission definitions
export const PERMISSIONS = {
  // Token operations
  'tokens:read': 'Read token information',
  'tokens:write': 'Create/update token information',
  'tokens:delete': 'Delete token information',
  
  // Alert operations
  'alerts:read': 'Read alerts',
  'alerts:write': 'Create/update alerts',
  'alerts:delete': 'Delete alerts',
  
  // Admin operations
  'admin:users': 'Manage users',
  'admin:system': 'System administration',
  'admin:metrics': 'View system metrics',
  
  // API operations
  'api:read': 'Read API access',
  'api:write': 'Write API access',
  'api:admin': 'Admin API access'
} as const;

// Role-based permissions
export const ROLE_PERMISSIONS = {
  readonly: ['tokens:read', 'alerts:read', 'api:read'],
  user: ['tokens:read', 'tokens:write', 'alerts:read', 'alerts:write', 'api:read', 'api:write'],
  admin: Object.keys(PERMISSIONS)
};

export class AuthService {
  private static instance: AuthService;
  private users: Map<string, User> = new Map();
  private apiKeys: Map<string, ApiKeyInfo> = new Map();

  static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  constructor() {
    this.initializeDefaultUsers();
  }

  private async initializeDefaultUsers(): Promise<void> {
    // Create default admin user if none exists
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@memecoinradar.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

    if (!this.users.has(adminEmail)) {
      const hashedPassword = await bcrypt.hash(adminPassword, 12);
      
      const adminUser: User = {
        id: 'admin-001',
        email: adminEmail,
        role: 'admin',
        permissions: ROLE_PERMISSIONS.admin,
        apiKeyHash: hashedPassword,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      this.users.set(adminEmail, adminUser);
      
      logger.info('Default admin user created', {
        type: 'admin_user_created',
        email: adminEmail
      });
    }
  }

  async authenticateUser(email: string, password: string): Promise<{ user: User; tokens: { accessToken: string; refreshToken: string } } | null> {
    const user = this.users.get(email);
    
    if (!user || !user.apiKeyHash) {
      metrics.incrementCounter('auth_failed', 1, { reason: 'user_not_found' });
      return null;
    }

    // Check if account is locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      logSecurityEvent('account_locked_attempt', 'medium', {
        email,
        lockedUntil: user.lockedUntil
      });
      
      metrics.incrementCounter('auth_failed', 1, { reason: 'account_locked' });
      return null;
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.apiKeyHash);
    
    if (!isValidPassword) {
      await this.handleFailedLogin(user);
      
      logSecurityEvent('invalid_password', 'medium', {
        email,
        loginAttempts: user.loginAttempts || 0
      });
      
      metrics.incrementCounter('auth_failed', 1, { reason: 'invalid_password' });
      return null;
    }

    // Reset login attempts on successful login
    user.loginAttempts = 0;
    user.lockedUntil = undefined;
    user.lastLogin = new Date();
    user.updatedAt = new Date();

    // Generate tokens
    const tokens = await this.generateTokens(user);
    
    logSecurityEvent('user_login_success', 'low', {
      userId: user.id,
      email: user.email,
      role: user.role
    });
    
    metrics.incrementCounter('auth_success', 1, { role: user.role });
    
    return { user, tokens };
  }

  private async handleFailedLogin(user: User): Promise<void> {
    user.loginAttempts = (user.loginAttempts || 0) + 1;
    user.updatedAt = new Date();

    if (user.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
      user.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION);
      
      logSecurityEvent('account_locked', 'high', {
        userId: user.id,
        email: user.email,
        attempts: user.loginAttempts,
        lockedUntil: user.lockedUntil
      });
    }
  }

  async generateTokens(user: User): Promise<{ accessToken: string; refreshToken: string }> {
    const payload: JWTPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      permissions: user.permissions,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
    };

    const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN as any });
    const refreshToken = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRES_IN as any });

    // Store refresh token in cache
    await cache.set(`refresh_token:${user.id}`, refreshToken, 7 * 24 * 60 * 60); // 7 days

    return { accessToken, refreshToken };
  }

  async verifyToken(token: string): Promise<JWTPayload | null> {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
      
      // Check if token is blacklisted
      const isBlacklisted = await cache.get(`blacklist:${token}`);
      if (isBlacklisted) {
        return null;
      }

      return decoded;
    } catch (error) {
      logger.debug('Token verification failed', {
        type: 'token_verification_failed',
        error: (error as Error).message
      });
      return null;
    }
  }

  async refreshToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string } | null> {
    try {
      const decoded = jwt.verify(refreshToken, JWT_SECRET) as { userId: string };
      
      // Check if refresh token exists in cache
      const storedToken = await cache.get(`refresh_token:${decoded.userId}`);
      if (storedToken !== refreshToken) {
        return null;
      }

      // Get user
      const user = Array.from(this.users.values()).find(u => u.id === decoded.userId);
      if (!user) {
        return null;
      }

      // Generate new tokens
      const tokens = await this.generateTokens(user);
      
      // Invalidate old refresh token
      await cache.delete(`refresh_token:${decoded.userId}`);
      
      return tokens;
    } catch (error) {
      logger.debug('Refresh token verification failed', {
        type: 'refresh_token_failed',
        error: (error as Error).message
      });
      return null;
    }
  }

  async blacklistToken(token: string): Promise<void> {
    try {
      const decoded = jwt.decode(token) as JWTPayload;
      if (decoded && decoded.exp) {
        const ttl = decoded.exp - Math.floor(Date.now() / 1000);
        if (ttl > 0) {
          await cache.set(`blacklist:${token}`, '1', ttl);
        }
      }
    } catch (error) {
      logger.error('Failed to blacklist token', {
        type: 'token_blacklist_error',
        error: (error as Error).message
      });
    }
  }

  async createApiKey(userId: string, name: string, permissions: string[], expiresAt?: Date): Promise<{ key: string; info: ApiKeyInfo }> {
    const keyId = `ak_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const key = `${keyId}.${Buffer.from(JSON.stringify({ userId, permissions })).toString('base64')}`;
    
    const apiKeyInfo: ApiKeyInfo = {
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
    
    // Store in cache for persistence
    await cache.set(`api_key:${key}`, JSON.stringify(apiKeyInfo), expiresAt ? Math.floor((expiresAt.getTime() - Date.now()) / 1000) : undefined);
    
    logger.info('API key created', {
      type: 'api_key_created',
      keyId,
      userId,
      name,
      permissions
    });
    
    return { key, info: apiKeyInfo };
  }

  async validateApiKey(key: string): Promise<ApiKeyInfo | null> {
    try {
      // Check memory cache first
      let apiKeyInfo = this.apiKeys.get(key);
      
      // Check Redis cache if not in memory
      if (!apiKeyInfo) {
        const cached = await cache.get(`api_key:${key}`);
        if (cached) {
          apiKeyInfo = JSON.parse(cached as string) as ApiKeyInfo;
          this.apiKeys.set(key, apiKeyInfo!);
        }
      }

      if (!apiKeyInfo) {
        return null;
      }

      // Check expiration
      if (apiKeyInfo.expiresAt && apiKeyInfo.expiresAt < new Date()) {
        await this.revokeApiKey(key);
        return null;
      }

      // Update last used
      apiKeyInfo.lastUsed = new Date();
      await cache.set(`api_key:${key}`, JSON.stringify(apiKeyInfo));

      return apiKeyInfo;
    } catch (error) {
      logger.error('API key validation failed', {
        type: 'api_key_validation_error',
        error: (error as Error).message
      });
      return null;
    }
  }

  async revokeApiKey(key: string): Promise<void> {
    this.apiKeys.delete(key);
    await cache.delete(`api_key:${key}`);
    
    logger.info('API key revoked', {
      type: 'api_key_revoked',
      key: key.substring(0, 10) + '...'
    });
  }

  getUserById(id: string): User | undefined {
    return Array.from(this.users.values()).find(user => user.id === id);
  }

  hasPermission(user: User | ApiKeyInfo, permission: string): boolean {
    return user.permissions.includes(permission) || user.permissions.includes('*');
  }
}

// Middleware functions
export const authService = AuthService.getInstance();

export const authenticateJWT = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      error: 'Access token required',
      code: 'MISSING_TOKEN'
    });
  }

  try {
    const payload = await authService.verifyToken(token);
    
    if (!payload) {
      return res.status(401).json({
        error: 'Invalid or expired token',
        code: 'INVALID_TOKEN'
      });
    }

    const user = authService.getUserById(payload.userId);
    if (!user) {
      return res.status(401).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    logger.error('JWT authentication failed', {
      type: 'jwt_auth_error',
      error: (error as Error).message
    });

    return res.status(401).json({
      error: 'Authentication failed',
      code: 'AUTH_FAILED'
    });
  }
};

export const authenticateApiKey = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    return res.status(401).json({
      error: 'API key required',
      code: 'MISSING_API_KEY'
    });
  }

  try {
    const apiKeyInfo = await authService.validateApiKey(apiKey);
    
    if (!apiKeyInfo) {
      logSecurityEvent('invalid_api_key', 'high', {
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
    req.user = authService.getUserById(apiKeyInfo.userId);
    next();
  } catch (error) {
    logger.error('API key authentication failed', {
      type: 'api_key_auth_error',
      error: (error as Error).message
    });

    return res.status(401).json({
      error: 'Authentication failed',
      code: 'AUTH_FAILED'
    });
  }
};

export const requirePermission = (permission: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void | Response => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    if (!authService.hasPermission(req.user, permission)) {
      logSecurityEvent('permission_denied', 'medium', {
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

export const requireRole = (role: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void | Response => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    if (req.user.role !== role && req.user.role !== 'admin') {
      logSecurityEvent('role_denied', 'medium', {
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

// Optional authentication (for public endpoints with optional auth)
export const optionalAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'] as string;

  try {
    if (authHeader) {
      const token = authHeader.split(' ')[1];
      if (token) {
        const payload = await authService.verifyToken(token);
        if (payload) {
          req.user = authService.getUserById(payload.userId);
        }
      }
    } else if (apiKey) {
      const apiKeyInfo = await authService.validateApiKey(apiKey);
      if (apiKeyInfo) {
        req.apiKey = apiKey;
        req.user = authService.getUserById(apiKeyInfo.userId);
      }
    }
  } catch (error) {
    // Ignore errors in optional auth
    logger.debug('Optional auth failed', {
      type: 'optional_auth_failed',
      error: (error as Error).message
    });
  }

  next();
};

export default {
  authService,
  authenticateJWT,
  authenticateApiKey,
  requirePermission,
  requireRole,
  optionalAuth,
  PERMISSIONS,
  ROLE_PERMISSIONS
};