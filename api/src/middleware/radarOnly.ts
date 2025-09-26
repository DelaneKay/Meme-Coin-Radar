import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

/**
 * Radar-Only Mode Middleware
 * Restricts API access to only radar-specific endpoints when RADAR_ONLY=true
 */

interface RadarOnlyConfig {
  enabled: boolean;
  allowedRoutes: string[];
  allowedWebSocketTopics: string[];
}

export class RadarOnlyFilter {
  private config: RadarOnlyConfig;

  constructor() {
    this.config = {
      enabled: process.env.RADAR_ONLY === 'true',
      allowedRoutes: (process.env.PUBLIC_ROUTES || 'config,signals,search,health,listings').split(','),
      allowedWebSocketTopics: ['hotlist', 'listings', 'health']
    };

    if (this.config.enabled) {
      logger.info('Radar-Only mode active', {
        allowedRoutes: this.config.allowedRoutes,
        allowedWebSocketTopics: this.config.allowedWebSocketTopics
      });
    }
  }

  /**
   * Middleware function to filter routes based on radar-only configuration
   */
  filterRoutes = (req: Request, res: Response, next: NextFunction): void | Response => {
    // If radar-only mode is disabled, allow all routes
    if (!this.config.enabled) {
      return next();
    }

    const path = req.path;
    
    // Always allow health checks
    if (path === '/api/health' || path.startsWith('/api/health/')) {
      return next();
    }

    // Check if the route is in the allowed list
    const isAllowed = this.config.allowedRoutes.some(route => {
      const routePath = `/api/${route}`;
      return path === routePath || path.startsWith(`${routePath}/`);
    });

    if (isAllowed) {
      return next();
    }

    // Log blocked request for monitoring
    logger.warn('Route blocked by radar-only filter', {
      path,
      method: req.method,
      ip: req.ip || 'unknown',
      userAgent: req.get('User-Agent')
    });

    // Return 404 for blocked routes to hide their existence
    return res.status(404).json({
      error: 'Not Found',
      message: 'The requested endpoint is not available in radar-only mode',
      code: 'RADAR_ONLY_RESTRICTION'
    });
  };

  /**
   * Filter WebSocket topics based on radar-only configuration
   */
  filterWebSocketTopic(topic: string): boolean {
    if (!this.config.enabled) {
      return true; // Allow all topics if radar-only is disabled
    }

    return this.config.allowedWebSocketTopics.includes(topic);
  }

  /**
   * Get current configuration
   */
  getConfig(): RadarOnlyConfig {
    return { ...this.config };
  }

  /**
   * Check if a specific route is allowed
   */
  isRouteAllowed(path: string): boolean {
    if (!this.config.enabled) {
      return true;
    }

    // Health checks are always allowed
    if (path === '/api/health' || path.startsWith('/api/health/')) {
      return true;
    }

    return this.config.allowedRoutes.some(route => {
      const routePath = `/api/${route}`;
      return path === routePath || path.startsWith(`${routePath}/`);
    });
  }

  /**
   * Get list of allowed routes for documentation
   */
  getAllowedRoutes(): string[] {
    if (!this.config.enabled) {
      return ['*']; // All routes allowed
    }

    return [
      '/api/health',
      ...this.config.allowedRoutes.map(route => `/api/${route}`)
    ];
  }

  /**
   * Get blocked routes for documentation
   */
  getBlockedRouteExamples(): string[] {
    if (!this.config.enabled) {
      return [];
    }

    return [
      '/api/portfolio/*',
      '/api/trading/*', 
      '/api/wallet/*',
      '/api/admin/*',
      '/api/users/*',
      '/api/auth/*',
      '/api/tuning/*'
    ];
  }
}

// Global radar-only filter instance
export const radarOnlyFilter = new RadarOnlyFilter();

// Export the middleware function for easy use
export const radarOnlyMiddleware = radarOnlyFilter.filterRoutes;