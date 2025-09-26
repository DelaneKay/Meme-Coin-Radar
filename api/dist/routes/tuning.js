"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeTuningRoutes = initializeTuningRoutes;
const express_1 = require("express");
const AlertTuningService_1 = require("../services/AlertTuningService");
const ShadowTestingService_1 = require("../services/ShadowTestingService");
const logger_1 = require("../utils/logger");
const auth_1 = require("../middleware/auth");
const validation_1 = require("../middleware/validation");
const express_validator_1 = require("express-validator");
const router = (0, express_1.Router)();
let tuningService;
let shadowTestingService;
function initializeTuningRoutes(db, redis) {
    tuningService = new AlertTuningService_1.AlertTuningService(db, redis);
    shadowTestingService = new ShadowTestingService_1.ShadowTestingService(db, redis);
    return router;
}
router.post('/backtest', auth_1.authenticateToken, [
    (0, express_validator_1.body)('lookback_hours').isInt({ min: 24, max: 168 }).withMessage('Lookback hours must be between 24 and 168'),
    (0, express_validator_1.body)('chains').isArray().withMessage('Chains must be an array'),
    (0, express_validator_1.body)('grid_search').optional().isObject().withMessage('Grid search must be an object'),
    (0, express_validator_1.body)('bucket_hours').optional().isInt({ min: 1, max: 24 }).withMessage('Bucket hours must be between 1 and 24')
], validation_1.validateRequest, async (req, res) => {
    try {
        const { lookback_hours = 48, chains = ['ethereum', 'bsc', 'polygon'], grid_search, bucket_hours = 3 } = req.body;
        logger_1.logger.info('Starting backtest', {
            lookback_hours,
            chains,
            bucket_hours,
            user: req.user?.id
        });
        const defaultGridSearch = {
            SCORE_ALERT: { min: 60, max: 80, step: 5 },
            SURGE15_MIN: { min: 2.0, max: 4.0, step: 0.5 },
            IMBALANCE5_MIN: { min: 0.25, max: 0.6, step: 0.05 },
            MIN_LIQ_ALERT: { min: 12000, max: 50000, step: 5000 }
        };
        const gridSearchParams = { ...defaultGridSearch, ...grid_search };
        const backtestPromise = tuningService.runBacktest({
            lookback_hours,
            chains,
            bucket_hours,
            grid_search: gridSearchParams
        });
        res.json({
            success: true,
            message: 'Backtest started',
            estimated_completion: new Date(Date.now() + lookback_hours * 60 * 60 * 1000 / 24),
            parameters: {
                lookback_hours,
                chains,
                bucket_hours,
                grid_search: gridSearchParams
            }
        });
        backtestPromise.then(async (results) => {
            logger_1.logger.info('Backtest completed', {
                chains: results.length,
                totalProposals: results.reduce((sum, r) => sum + r.proposals.length, 0)
            });
            for (const result of results) {
                if (result.proposals.length > 0) {
                    const topProposal = result.proposals[0];
                    await tuningService.saveProposal(topProposal);
                    await tuningService.updateProposalStatus(topProposal.id, 'shadow_testing');
                }
            }
            try {
                await shadowTestingService.startShadowTesting();
            }
            catch (error) {
                logger_1.logger.warn('Shadow testing already running or failed to start', { error: error.message });
            }
        }).catch((error) => {
            logger_1.logger.error('Backtest failed', { error: error.message });
        });
    }
    catch (error) {
        logger_1.logger.error('Error starting backtest', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to start backtest',
            details: error.message
        });
    }
});
router.get('/backtest/status', auth_1.authenticateToken, async (req, res) => {
    try {
        const status = await tuningService.getBacktestStatus();
        res.json({
            success: true,
            status
        });
    }
    catch (error) {
        logger_1.logger.error('Error getting backtest status', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to get backtest status'
        });
    }
});
router.post('/proposals', auth_1.authenticateToken, [
    (0, express_validator_1.body)('chain').isString().withMessage('Chain is required'),
    (0, express_validator_1.body)('hour_bucket').isString().withMessage('Hour bucket is required'),
    (0, express_validator_1.body)('rules').isObject().withMessage('Rules object is required'),
    (0, express_validator_1.body)('rules.SCORE_ALERT').isNumeric().withMessage('SCORE_ALERT must be numeric'),
    (0, express_validator_1.body)('rules.SURGE15_MIN').isNumeric().withMessage('SURGE15_MIN must be numeric'),
    (0, express_validator_1.body)('rules.IMBALANCE5_MIN').isNumeric().withMessage('IMBALANCE5_MIN must be numeric'),
    (0, express_validator_1.body)('rules.MIN_LIQ_ALERT').isNumeric().withMessage('MIN_LIQ_ALERT must be numeric'),
    (0, express_validator_1.body)('evidence').isObject().withMessage('Evidence object is required')
], validation_1.validateRequest, async (req, res) => {
    try {
        const proposal = {
            chain: req.body.chain,
            hour_bucket: req.body.hour_bucket,
            rules: req.body.rules,
            evidence: req.body.evidence
        };
        const savedProposal = await tuningService.saveProposal(proposal);
        logger_1.logger.info('Proposal submitted', {
            proposalId: savedProposal.id,
            chain: proposal.chain,
            user: req.user?.id
        });
        res.json({
            success: true,
            proposal: savedProposal
        });
    }
    catch (error) {
        logger_1.logger.error('Error saving proposal', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to save proposal'
        });
    }
});
router.get('/proposals', auth_1.authenticateToken, [
    (0, express_validator_1.query)('chain').optional().isString(),
    (0, express_validator_1.query)('status').optional().isIn(['pending', 'shadow_testing', 'approved', 'rejected', 'applied']),
    (0, express_validator_1.query)('limit').optional().isInt({ min: 1, max: 100 }),
    (0, express_validator_1.query)('offset').optional().isInt({ min: 0 })
], validation_1.validateRequest, async (req, res) => {
    try {
        const { chain, status, limit = 20, offset = 0 } = req.query;
        const proposals = await tuningService.getProposals({
            chain: chain,
            status: status,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
        res.json({
            success: true,
            proposals,
            pagination: {
                limit: parseInt(limit),
                offset: parseInt(offset)
            }
        });
    }
    catch (error) {
        logger_1.logger.error('Error getting proposals', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to get proposals'
        });
    }
});
router.get('/proposals/:id', auth_1.authenticateToken, [
    (0, express_validator_1.param)('id').isUUID().withMessage('Invalid proposal ID')
], validation_1.validateRequest, async (req, res) => {
    try {
        const proposal = await tuningService.getProposal(req.params.id);
        if (!proposal) {
            return res.status(404).json({
                success: false,
                error: 'Proposal not found'
            });
        }
        res.json({
            success: true,
            proposal
        });
    }
    catch (error) {
        logger_1.logger.error('Error getting proposal', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to get proposal'
        });
    }
});
router.put('/proposals/:id/status', auth_1.authenticateToken, [
    (0, express_validator_1.param)('id').isUUID().withMessage('Invalid proposal ID'),
    (0, express_validator_1.body)('status').isIn(['pending', 'shadow_testing', 'approved', 'rejected', 'applied']).withMessage('Invalid status'),
    (0, express_validator_1.body)('reason').optional().isString().withMessage('Reason must be a string')
], validation_1.validateRequest, async (req, res) => {
    try {
        const { status, reason } = req.body;
        const proposalId = req.params.id;
        await tuningService.updateProposalStatus(proposalId, status, reason);
        if (status === 'shadow_testing') {
            try {
                await shadowTestingService.startShadowTesting();
            }
            catch (error) {
                logger_1.logger.warn('Shadow testing service already running', { error: error.message });
            }
        }
        logger_1.logger.info('Proposal status updated', {
            proposalId,
            status,
            reason,
            user: req.user?.id
        });
        res.json({
            success: true,
            message: 'Proposal status updated'
        });
    }
    catch (error) {
        logger_1.logger.error('Error updating proposal status', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to update proposal status'
        });
    }
});
router.post('/apply', auth_1.authenticateToken, [
    (0, express_validator_1.body)('proposal_ids').isArray().withMessage('Proposal IDs must be an array'),
    (0, express_validator_1.body)('proposal_ids.*').isUUID().withMessage('Invalid proposal ID format')
], validation_1.validateRequest, async (req, res) => {
    try {
        const { proposal_ids } = req.body;
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
                await tuningService.applyProposal(proposalId);
                results.push({
                    proposal_id: proposalId,
                    success: true,
                    chain: proposal.chain,
                    rules: proposal.rules
                });
                logger_1.logger.info('Proposal applied', {
                    proposalId,
                    chain: proposal.chain,
                    user: req.user?.id
                });
            }
            catch (error) {
                results.push({
                    proposal_id: proposalId,
                    success: false,
                    error: error.message
                });
            }
        }
        res.json({
            success: true,
            results,
            applied_count: results.filter(r => r.success).length,
            failed_count: results.filter(r => !r.success).length
        });
    }
    catch (error) {
        logger_1.logger.error('Error applying proposals', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to apply proposals'
        });
    }
});
router.post('/shadow/start', auth_1.authenticateToken, async (req, res) => {
    try {
        await shadowTestingService.startShadowTesting();
        logger_1.logger.info('Shadow testing started', { user: req.user?.id });
        res.json({
            success: true,
            message: 'Shadow testing started'
        });
    }
    catch (error) {
        logger_1.logger.error('Error starting shadow testing', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to start shadow testing',
            details: error.message
        });
    }
});
router.post('/shadow/stop', auth_1.authenticateToken, async (req, res) => {
    try {
        await shadowTestingService.stopShadowTesting();
        logger_1.logger.info('Shadow testing stopped', { user: req.user?.id });
        res.json({
            success: true,
            message: 'Shadow testing stopped'
        });
    }
    catch (error) {
        logger_1.logger.error('Error stopping shadow testing', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to stop shadow testing'
        });
    }
});
router.get('/shadow/metrics', auth_1.authenticateToken, [
    (0, express_validator_1.query)('proposal_id').optional().isUUID().withMessage('Invalid proposal ID')
], validation_1.validateRequest, async (req, res) => {
    try {
        const { proposal_id } = req.query;
        let metrics;
        if (proposal_id) {
            const singleMetrics = await shadowTestingService.generateShadowTestMetrics(proposal_id);
            metrics = [singleMetrics];
        }
        else {
            metrics = await shadowTestingService.getAllActiveShadowTestMetrics();
        }
        res.json({
            success: true,
            metrics
        });
    }
    catch (error) {
        logger_1.logger.error('Error getting shadow metrics', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to get shadow metrics'
        });
    }
});
router.get('/config/current', auth_1.authenticateToken, async (req, res) => {
    try {
        const config = await tuningService.getCurrentConfig();
        res.json({
            success: true,
            config
        });
    }
    catch (error) {
        logger_1.logger.error('Error getting current config', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to get current config'
        });
    }
});
router.get('/orchestrator/status', auth_1.authenticateToken, async (req, res) => {
    try {
        const flag = await tuningService.checkOrchestratorFlag();
        res.json({
            success: true,
            orchestrator_allows_application: flag
        });
    }
    catch (error) {
        logger_1.logger.error('Error getting orchestrator status', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to get orchestrator status'
        });
    }
});
router.put('/orchestrator/status', auth_1.authenticateToken, [
    (0, express_validator_1.body)('allow_application').isBoolean().withMessage('allow_application must be boolean')
], validation_1.validateRequest, async (req, res) => {
    try {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }
        const { allow_application } = req.body;
        await tuningService.setOrchestratorFlag(allow_application);
        logger_1.logger.info('Orchestrator flag updated', {
            allow_application,
            user: req.user?.id
        });
        res.json({
            success: true,
            message: 'Orchestrator flag updated',
            orchestrator_allows_application: allow_application
        });
    }
    catch (error) {
        logger_1.logger.error('Error updating orchestrator flag', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to update orchestrator flag'
        });
    }
});
exports.default = router;
//# sourceMappingURL=tuning.js.map