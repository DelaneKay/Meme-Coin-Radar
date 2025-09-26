import { Router, Response } from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { AlertTuningService, TuningProposal, GridSearchParams } from '../services/AlertTuningService';
import { ShadowTestingService, ShadowTestMetrics } from '../services/ShadowTestingService';
import { logger } from '../utils/logger';
import { authenticateJWT, AuthRequest } from '../middleware/auth';
import { validateRequest } from '../utils/validation';
import { body, param, query } from 'express-validator';

const router = Router();

// Initialize services
let tuningService: AlertTuningService;
let shadowTestingService: ShadowTestingService;

export function initializeTuningRoutes(db: Pool, redis: Redis) {
  tuningService = new AlertTuningService(db, redis);
  shadowTestingService = new ShadowTestingService(db, redis);
  return router;
}

/**
 * POST /api/tuning/backtest
 * Start a new backtest with grid search optimization
 */
router.post('/backtest',
  authenticateJWT,
  [
    body('lookback_hours').isInt({ min: 24, max: 168 }).withMessage('Lookback hours must be between 24 and 168'),
    body('chains').isArray().withMessage('Chains must be an array'),
    body('grid_search').optional().isObject().withMessage('Grid search must be an object'),
    body('bucket_hours').optional().isInt({ min: 1, max: 24 }).withMessage('Bucket hours must be between 1 and 24')
  ],
  validateRequest,
  async (req: AuthRequest, res: Response) => {
    try {
      const {
        lookback_hours = 48,
        chains = ['ethereum', 'bsc', 'polygon'],
        grid_search,
        bucket_hours = 3
      } = req.body;

      logger.info('Starting backtest', {
        lookback_hours,
        chains,
        bucket_hours,
        user: req.user?.id
      });

      // Default grid search parameters
      const defaultGridSearch: GridSearchParams = {
        SCORE_ALERT: { min: 60, max: 80, step: 5 },
        SURGE15_MIN: { min: 2.0, max: 4.0, step: 0.5 },
        IMBALANCE5_MIN: { min: 0.25, max: 0.6, step: 0.05 },
        MIN_LIQ_ALERT: { min: 12000, max: 50000, step: 5000 }
      };

      const gridSearchParams = { ...defaultGridSearch, ...grid_search };

      // Start backtest asynchronously
      const backtestPromise = tuningService.runBacktest(
        lookback_hours,
        bucket_hours
      );

      // Don't wait for completion, return immediately
      res.json({
        success: true,
        message: 'Backtest started',
        estimated_completion: new Date(Date.now() + lookback_hours * 60 * 60 * 1000 / 24), // Rough estimate
        parameters: {
          lookback_hours,
          chains,
          bucket_hours,
          grid_search: gridSearchParams
        }
      });

      // Handle backtest completion in background
      backtestPromise.then(async (results) => {
        logger.info('Backtest completed', {
          chains: results.length,
          totalProposals: results.reduce((sum, r) => sum + r.proposals.length, 0)
        });

        // Auto-start shadow testing for top proposals
        for (const result of results) {
          if (result.proposals.length > 0) {
            const topProposal = result.proposals[0]; // Best F1 score
            await tuningService.saveProposal(topProposal);
            
            // Update proposal status to shadow testing
            await tuningService.updateProposalStatus(topProposal.id, 'shadow_testing');
          }
        }

        // Start shadow testing service if not already running
        try {
          await shadowTestingService.startShadowTesting();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          logger.warn('Shadow testing already running or failed to start', { error: errorMessage });
        }

      }).catch((error) => {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Backtest failed', { error: errorMessage });
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error starting backtest', { error: errorMessage });
      res.status(500).json({
        success: false,
        error: 'Failed to start backtest',
        details: errorMessage
      });
    }
  }
);

/**
 * GET /api/tuning/backtest/status
 * Get current backtest status
 */
router.get('/backtest/status',
  authenticateJWT,
  async (req: AuthRequest, res: Response) => {
    try {
      // Check Redis for backtest status
      const status = await tuningService.getBacktestStatus();
      
      res.json({
        success: true,
        status
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error getting backtest status', { error: errorMessage });
      res.status(500).json({
        success: false,
        error: 'Failed to get backtest status'
      });
    }
  }
);

/**
 * POST /api/tuning/proposals
 * Submit a new tuning proposal
 */
router.post('/proposals',
  authenticateJWT,
  [
    body('chain').isString().withMessage('Chain is required'),
    body('hour_bucket').isString().withMessage('Hour bucket is required'),
    body('rules').isObject().withMessage('Rules object is required'),
    body('rules.SCORE_ALERT').isNumeric().withMessage('SCORE_ALERT must be numeric'),
    body('rules.SURGE15_MIN').isNumeric().withMessage('SURGE15_MIN must be numeric'),
    body('rules.IMBALANCE5_MIN').isNumeric().withMessage('IMBALANCE5_MIN must be numeric'),
    body('rules.MIN_LIQ_ALERT').isNumeric().withMessage('MIN_LIQ_ALERT must be numeric'),
    body('evidence').isObject().withMessage('Evidence object is required')
  ],
  validateRequest,
  async (req: AuthRequest, res: Response) => {
    try {
      const proposalId = `proposal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const proposal: TuningProposal = {
        id: proposalId,
        chain: req.body.chain,
        hour_bucket: req.body.hour_bucket,
        rules: req.body.rules,
        evidence: req.body.evidence,
        created_at: new Date().toISOString(),
        status: 'pending'
      };

      await tuningService.saveProposal(proposal);

      logger.info('Proposal submitted', {
        proposalId: proposal.id,
        chain: proposal.chain,
        user: req.user?.id
      });

      res.json({
        success: true,
        proposal: proposal
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error saving proposal', { error: errorMessage });
      res.status(500).json({
        success: false,
        error: 'Failed to save proposal'
      });
    }
  }
);

/**
 * GET /api/tuning/proposals
 * Get tuning proposals with filtering
 */
router.get('/proposals',
  authenticateJWT,
  [
    query('chain').optional().isString(),
    query('status').optional().isIn(['pending', 'shadow_testing', 'approved', 'rejected', 'applied']),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('offset').optional().isInt({ min: 0 })
  ],
  validateRequest,
  async (req: AuthRequest, res: Response) => {
    try {
      const {
        chain,
        status,
        limit = 20,
        offset = 0
      } = req.query;

      const proposals = await tuningService.getProposals({
        status: status as string,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string)
      });

      res.json({
        success: true,
        proposals,
        pagination: {
          limit: parseInt(limit as string),
          offset: parseInt(offset as string)
        }
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error getting proposals', { error: errorMessage });
      res.status(500).json({
        success: false,
        error: 'Failed to get proposals'
      });
    }
  }
);

/**
 * GET /api/tuning/proposals/:id
 * Get specific proposal by ID
 */
router.get('/proposals/:id',
  authenticateJWT,
  [
    param('id').isString().withMessage('Proposal ID is required')
  ],
  validateRequest,
  async (req: AuthRequest, res: Response) => {
    try {
      const proposal = await tuningService.getProposal(req.params.id);

      if (!proposal) {
        return res.status(404).json({
          success: false,
          error: 'Proposal not found'
        });
      }

      return res.json({
        success: true,
        proposal
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error getting proposal', { error: errorMessage });
      return res.status(500).json({
        success: false,
        error: 'Failed to get proposal'
      });
    }
  }
);

/**
 * PUT /api/tuning/proposals/:id/status
 * Update proposal status
 */
router.put('/proposals/:id/status',
  authenticateJWT,
  [
    param('id').isUUID().withMessage('Invalid proposal ID'),
    body('status').isIn(['pending', 'shadow_testing', 'approved', 'rejected', 'applied']).withMessage('Invalid status'),
    body('reason').optional().isString().withMessage('Reason must be a string')
  ],
  validateRequest,
  async (req: AuthRequest, res: Response) => {
    try {
      const { status, reason } = req.body;
      const proposalId = req.params.id;

      await tuningService.updateProposalStatus(proposalId, status);

      // If status is shadow_testing, ensure shadow testing service is running
      if (status === 'shadow_testing') {
        try {
          await shadowTestingService.startShadowTesting();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          logger.warn('Shadow testing service already running', { error: errorMessage });
        }
      }

      logger.info('Proposal status updated', {
        proposalId,
        status,
        reason,
        user: req.user?.id
      });

      res.json({
        success: true,
        message: 'Proposal status updated'
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error updating proposal status', { error: errorMessage });
      res.status(500).json({
        success: false,
        error: 'Failed to update proposal status'
      });
    }
  }
);

/**
 * POST /api/tuning/apply
 * Apply approved proposals to production
 */
router.post('/apply',
  authenticateJWT,
  [
    body('proposal_ids').isArray().withMessage('Proposal IDs must be an array'),
    body('proposal_ids.*').isUUID().withMessage('Invalid proposal ID format')
  ],
  validateRequest,
  async (req: AuthRequest, res: Response) => {
    try {
      const { proposal_ids } = req.body;

      // Check if orchestrator allows application
      const orchestratorFlag = await tuningService.checkOrchestratorFlag();
      if (!orchestratorFlag) {
        return res.status(403).json({
          success: false,
          error: 'Orchestrator does not allow proposal application at this time'
        });
      }

      const results = [];

      for (const proposalId of proposal_ids) {
        try {
          const proposal = await tuningService.getProposal(proposalId);
          
          if (!proposal) {
            results.push({
              proposal_id: proposalId,
              success: false,
              error: 'Proposal not found'
            });
            continue;
          }

          if (proposal.status !== 'approved') {
            results.push({
              proposal_id: proposalId,
              success: false,
              error: 'Proposal not approved'
            });
            continue;
          }

          // Apply the proposal
          await tuningService.applyProposal(proposalId);
          
          results.push({
            proposal_id: proposalId,
            success: true,
            chain: proposal.chain,
            rules: proposal.rules
          });

          logger.info('Proposal applied', {
            proposalId,
            chain: proposal.chain,
            user: req.user?.id
          });

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          results.push({
            proposal_id: proposalId,
            success: false,
            error: errorMessage
          });
        }
      }

      return res.json({
        success: true,
        results,
        applied_count: results.filter(r => r.success).length,
        failed_count: results.filter(r => !r.success).length
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error applying proposals', { error: errorMessage });
      return res.status(500).json({
        success: false,
        error: 'Failed to apply proposals'
      });
    }
  }
);

/**
 * POST /api/tuning/shadow/start
 * Start shadow testing
 */
router.post('/shadow/start',
  authenticateJWT,
  async (req: AuthRequest, res: Response) => {
    try {
      await shadowTestingService.startShadowTesting();

      logger.info('Shadow testing started', { user: req.user?.id });

      res.json({
        success: true,
        message: 'Shadow testing started'
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error starting shadow testing', { error: errorMessage });
      res.status(500).json({
        success: false,
        error: 'Failed to start shadow testing',
        details: errorMessage
      });
    }
  }
);

/**
 * POST /api/tuning/shadow/stop
 * Stop shadow testing
 */
router.post('/shadow/stop',
  authenticateJWT,
  async (req: AuthRequest, res: Response) => {
    try {
      await shadowTestingService.stopShadowTesting();

      logger.info('Shadow testing stopped', { user: req.user?.id });

      res.json({
        success: true,
        message: 'Shadow testing stopped'
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error stopping shadow testing', { error: errorMessage });
      res.status(500).json({
        success: false,
        error: 'Failed to stop shadow testing'
      });
    }
  }
);

/**
 * GET /api/tuning/shadow/metrics
 * Get shadow testing metrics
 */
router.get('/shadow/metrics',
  authenticateJWT,
  [
    query('proposal_id').optional().isUUID().withMessage('Invalid proposal ID')
  ],
  validateRequest,
  async (req: AuthRequest, res: Response) => {
    try {
      const { proposal_id } = req.query;

      let metrics: ShadowTestMetrics[];

      if (proposal_id) {
        const singleMetrics = await shadowTestingService.generateShadowTestMetrics(proposal_id as string);
        metrics = [singleMetrics];
      } else {
        metrics = await shadowTestingService.getAllActiveShadowTestMetrics();
      }

      res.json({
        success: true,
        metrics
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error getting shadow metrics', { error: errorMessage });
      res.status(500).json({
        success: false,
        error: 'Failed to get shadow metrics'
      });
    }
  }
);

/**
 * GET /api/tuning/config/current
 * Get current alert configuration
 */
router.get('/config/current',
  authenticateJWT,
  async (req: AuthRequest, res: Response) => {
    try {
      const config = await tuningService.getCurrentConfig();

      res.json({
        success: true,
        config
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error getting current config', { error: errorMessage });
      res.status(500).json({
        success: false,
        error: 'Failed to get current config'
      });
    }
  }
);

/**
 * GET /api/tuning/orchestrator/status
 * Get orchestrator flag status
 */
router.get('/orchestrator/status',
  authenticateJWT,
  async (req: AuthRequest, res: Response) => {
    try {
      const flag = await tuningService.checkOrchestratorFlag();

      res.json({
        success: true,
        orchestrator_allows_application: flag
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error getting orchestrator status', { error: errorMessage });
      res.status(500).json({
        success: false,
        error: 'Failed to get orchestrator status'
      });
    }
  }
);

/**
 * PUT /api/tuning/orchestrator/status
 * Update orchestrator flag (admin only)
 */
router.put('/orchestrator/status',
  authenticateJWT,
  [
    body('allow_application').isBoolean().withMessage('allow_application must be boolean')
  ],
  validateRequest,
  async (req: AuthRequest, res: Response) => {
    try {
      // Check if user is admin
      if (req.user?.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Admin access required'
        });
      }

      const { allow_application } = req.body;

      await tuningService.setOrchestratorFlag(allow_application);

      logger.info('Orchestrator flag updated', {
        allow_application,
        user: req.user?.id
      });

      return res.json({
        success: true,
        message: 'Orchestrator flag updated',
        orchestrator_allows_application: allow_application
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error updating orchestrator flag', { error: errorMessage });
      return res.status(500).json({
        success: false,
        error: 'Failed to update orchestrator flag'
      });
    }
  }
);

export default router;