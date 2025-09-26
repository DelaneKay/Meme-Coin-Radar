import { Router, Request, Response, NextFunction } from 'express';
import { body } from 'express-validator';
import { authService, authenticateJWT, requirePermission, requireRole, AuthRequest } from '../middleware/auth';
import { validateRequest } from '../utils/validation';
import { logger, logSecurityEvent } from '../utils/logger';
import { metrics } from '../utils/metrics';
import { RateLimitManager, rateLimiterManager } from '../utils/rateLimiter';

const router = Router();

// Login endpoint
router.post('/login',
  // Rate limiting for auth attempts
  async (req: Request, res: Response, next: NextFunction): Promise<void | Response> => {
    const result = await rateLimiterManager.checkLimit('auth', req.ip);
    
    if (!result.allowed) {
      return res.status(429).json({
        error: 'Too many authentication attempts',
        code: 'AUTH_RATE_LIMITED',
        retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
      });
    }
    
    next();
  },
  
  // Validation
  validateRequest([
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Valid email is required'),
    body('password')
      .isLength({ min: 1 })
      .withMessage('Password is required')
  ]),
  
  async (req: Request, res: Response): Promise<Response | void> => {
    try {
      const { email, password } = req.body;
      
      const result = await authService.authenticateUser(email, password);
      
      if (!result) {
        metrics.incrementCounter('auth_failed', 1, { reason: 'invalid_credentials' });
        
        return res.status(401).json({
          error: 'Invalid credentials',
          code: 'INVALID_CREDENTIALS'
        });
      }

      const { user, tokens } = result;
      
      // Set secure HTTP-only cookie for refresh token
      res.cookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
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
          expiresIn: 24 * 60 * 60 // 24 hours in seconds
        }
      });

    } catch (error) {
      logger.error('Login error', {
        type: 'login_error',
        error: (error as Error).message,
        ip: req.ip
      });

      res.status(500).json({
        error: 'Authentication failed',
        code: 'AUTH_ERROR'
      });
    }
  }
);

// Refresh token endpoint
router.post('/refresh',
  async (req: Request, res: Response): Promise<Response | void> => {
    try {
      const refreshToken = req.cookies.refreshToken || req.body.refreshToken;
      
      if (!refreshToken) {
        return res.status(401).json({
          error: 'Refresh token required',
          code: 'MISSING_REFRESH_TOKEN'
        });
      }

      const tokens = await authService.refreshToken(refreshToken);
      
      if (!tokens) {
        return res.status(401).json({
          error: 'Invalid refresh token',
          code: 'INVALID_REFRESH_TOKEN'
        });
      }

      // Set new refresh token cookie
      res.cookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });

      res.json({
        success: true,
        data: {
          accessToken: tokens.accessToken,
          expiresIn: 24 * 60 * 60 // 24 hours in seconds
        }
      });

    } catch (error) {
      logger.error('Token refresh error', {
        type: 'token_refresh_error',
        error: (error as Error).message,
        ip: req.ip
      });

      res.status(500).json({
        error: 'Token refresh failed',
        code: 'REFRESH_ERROR'
      });
    }
  }
);

// Logout endpoint
router.post('/logout',
  authenticateJWT,
  async (req: AuthRequest, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.split(' ')[1];
      
      if (token) {
        await authService.blacklistToken(token);
      }

      // Clear refresh token cookie
      res.clearCookie('refreshToken');

      logSecurityEvent('user_logout', 'low', {
        userId: req.user?.id,
        email: req.user?.email
      });

      res.json({
        success: true,
        message: 'Logged out successfully'
      });

    } catch (error) {
      logger.error('Logout error', {
        type: 'logout_error',
        error: (error as Error).message,
        userId: req.user?.id
      });

      res.status(500).json({
        error: 'Logout failed',
        code: 'LOGOUT_ERROR'
      });
    }
  }
);

// Get current user profile
router.get('/profile',
  authenticateJWT,
  async (req: AuthRequest, res: Response) => {
    try {
      const user = req.user!;
      
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

    } catch (error) {
      logger.error('Profile fetch error', {
        type: 'profile_error',
        error: (error as Error).message,
        userId: req.user?.id
      });

      res.status(500).json({
        error: 'Failed to fetch profile',
        code: 'PROFILE_ERROR'
      });
    }
  }
);

// Create API key
router.post('/api-keys',
  authenticateJWT,
  requirePermission('api:admin'),
  
  validateRequest([
    body('name')
      .isLength({ min: 1, max: 100 })
      .trim()
      .withMessage('API key name is required (1-100 characters)'),
    body('permissions')
      .isArray({ min: 1 })
      .withMessage('At least one permission is required'),
    body('expiresAt')
      .optional()
      .isISO8601()
      .withMessage('Expiration date must be valid ISO 8601 format')
  ]),
  
  async (req: AuthRequest, res: Response) => {
    try {
      const { name, permissions, expiresAt } = req.body;
      const userId = req.user!.id;
      
      const expirationDate = expiresAt ? new Date(expiresAt) : undefined;
      
      const { key, info } = await authService.createApiKey(
        userId,
        name,
        permissions,
        expirationDate
      );

      logSecurityEvent('api_key_created', 'low', {
        userId,
        keyId: info.id,
        name,
        permissions
      });

      res.status(201).json({
        success: true,
        data: {
          key, // Only returned once
          id: info.id,
          name: info.name,
          permissions: info.permissions,
          expiresAt: info.expiresAt,
          rateLimit: info.rateLimit
        }
      });

    } catch (error) {
      logger.error('API key creation error', {
        type: 'api_key_creation_error',
        error: (error as Error).message,
        userId: req.user?.id
      });

      res.status(500).json({
        error: 'Failed to create API key',
        code: 'API_KEY_ERROR'
      });
    }
  }
);

// List API keys (without the actual keys)
router.get('/api-keys',
  authenticateJWT,
  requirePermission('api:read'),
  
  async (req: AuthRequest, res: Response) => {
    try {
      // This would typically fetch from a database
      // For now, return empty array as this is a demo
      
      res.json({
        success: true,
        data: []
      });

    } catch (error) {
      logger.error('API key list error', {
        type: 'api_key_list_error',
        error: (error as Error).message,
        userId: req.user?.id
      });

      res.status(500).json({
        error: 'Failed to fetch API keys',
        code: 'API_KEY_LIST_ERROR'
      });
    }
  }
);

// Revoke API key
router.delete('/api-keys/:keyId',
  authenticateJWT,
  requirePermission('api:admin'),
  
  async (req: AuthRequest, res: Response) => {
    try {
      const { keyId } = req.params;
      
      // This would typically revoke from database
      // For now, just log the action
      
      logSecurityEvent('api_key_revoked', 'medium', {
        userId: req.user!.id,
        keyId
      });

      res.json({
        success: true,
        message: 'API key revoked successfully'
      });

    } catch (error) {
      logger.error('API key revocation error', {
        type: 'api_key_revocation_error',
        error: (error as Error).message,
        userId: req.user?.id,
        keyId: req.params.keyId
      });

      res.status(500).json({
        error: 'Failed to revoke API key',
        code: 'API_KEY_REVOCATION_ERROR'
      });
    }
  }
);

// Change password
router.post('/change-password',
  authenticateJWT,
  
  validateRequest([
    body('currentPassword')
      .isLength({ min: 1 })
      .withMessage('Current password is required'),
    body('newPassword')
      .isLength({ min: 8, max: 128 })
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage('New password must be 8-128 characters with uppercase, lowercase, number, and special character')
  ]),
  
  async (req: AuthRequest, res: Response) => {
    try {
      const { currentPassword, newPassword } = req.body;
      const user = req.user!;
      
      // This would typically verify current password and update in database
      // For now, just log the action
      
      logSecurityEvent('password_changed', 'medium', {
        userId: user.id,
        email: user.email
      });

      res.json({
        success: true,
        message: 'Password changed successfully'
      });

    } catch (error) {
      logger.error('Password change error', {
        type: 'password_change_error',
        error: (error as Error).message,
        userId: req.user?.id
      });

      res.status(500).json({
        error: 'Failed to change password',
        code: 'PASSWORD_CHANGE_ERROR'
      });
    }
  }
);

// Admin: List all users
router.get('/users',
  authenticateJWT,
  requireRole('admin'),
  
  async (req: AuthRequest, res: Response) => {
    try {
      // This would typically fetch from database
      // For now, return demo data
      
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

    } catch (error) {
      logger.error('User list error', {
        type: 'user_list_error',
        error: (error as Error).message,
        userId: req.user?.id
      });

      res.status(500).json({
        error: 'Failed to fetch users',
        code: 'USER_LIST_ERROR'
      });
    }
  }
);

// Validate token endpoint (for other services)
router.post('/validate',
  async (req: Request, res: Response): Promise<Response | void> => {
    try {
      const { token } = req.body;
      
      if (!token) {
        return res.status(400).json({
          error: 'Token is required',
          code: 'MISSING_TOKEN'
        });
      }

      const payload = await authService.verifyToken(token);
      
      if (!payload) {
        return res.status(401).json({
          error: 'Invalid token',
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

    } catch (error) {
      logger.error('Token validation error', {
        type: 'token_validation_error',
        error: (error as Error).message,
        ip: req.ip
      });

      res.status(500).json({
        error: 'Token validation failed',
        code: 'VALIDATION_ERROR'
      });
    }
  }
);

export { router as authRouter };