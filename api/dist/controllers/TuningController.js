"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TuningController = void 0;
const logger_1 = __importDefault(require("../utils/logger"));
const AlertTuningService_1 = require("../services/AlertTuningService");
const ShadowTestingService_1 = require("../services/ShadowTestingService");
const ReportGenerationService_1 = require("../services/ReportGenerationService");
const TuningSchedulerService_1 = require("../services/TuningSchedulerService");
class TuningController {
    constructor(db, redis) {
        this.db = db;
        this.redis = redis;
        this.tuningService = new AlertTuningService_1.AlertTuningService(db, redis);
        this.shadowTestingService = new ShadowTestingService_1.ShadowTestingService(db, redis);
        this.reportService = new ReportGenerationService_1.ReportGenerationService(db, redis, './reports');
        this.schedulerService = new TuningSchedulerService_1.TuningSchedulerService(db, redis, this.tuningService, this.shadowTestingService, this.reportService);
    }
    async execute48HourBacktest() {
        try {
            logger_1.default.info('Starting 48-hour backtest with grid search optimization');
            const gridSearchParams = {
                SCORE_ALERT: { min: 60, max: 80, step: 5 },
                SURGE15_MIN: { min: 2.0, max: 4.0, step: 0.5 },
                IMBALANCE5_MIN: { min: 0.25, max: 0.6, step: 0.05 },
                MIN_LIQ_ALERT: { min: 12000, max: 50000, step: 5000 }
            };
            const chains = ['ethereum', 'bsc', 'polygon'];
            const backtestResults = await this.tuningService.runBacktest({
                lookback_hours: 48,
                chains,
                bucket_hours: 3,
                grid_search: gridSearchParams
            });
            logger_1.default.info('Backtest completed', {
                chains: backtestResults.length,
                totalConfigurations: backtestResults.reduce((sum, r) => sum + (r.total_configurations || 0), 0)
            });
            const allProposals = [];
            const chainSummaries = [];
            for (const result of backtestResults) {
                if (result.proposals.length > 0) {
                    const validProposals = result.proposals.filter(proposal => {
                        const evidence = proposal.evidence;
                        const currentF1 = result.current_performance?.f1 || 0.5;
                        const f1Improvement = evidence.f1 ? ((evidence.f1 - currentF1) / currentF1) * 100 : 0;
                        return (f1Improvement >= 10 &&
                            (evidence.alerts_per_hour || 0) <= 10 &&
                            (evidence.precision || 0) >= 0.5);
                    });
                    for (const proposal of validProposals.slice(0, 3)) {
                        const savedProposal = await this.tuningService.saveProposal(proposal);
                        allProposals.push(savedProposal);
                        await this.tuningService.updateProposalStatus(savedProposal.id, 'shadow_testing');
                    }
                    const topProposal = validProposals[0];
                    if (topProposal) {
                        const currentF1 = result.current_performance?.f1 || 0.5;
                        const f1Improvement = ((topProposal.evidence.f1 - currentF1) / currentF1) * 100;
                        chainSummaries.push({
                            chain: result.chain,
                            best_proposal: {
                                id: topProposal.id,
                                rules: topProposal.rules,
                                evidence: topProposal.evidence,
                                f1_improvement: f1Improvement
                            },
                            total_valid_proposals: validProposals.length,
                            configurations_tested: result.total_configurations
                        });
                    }
                }
            }
            logger_1.default.info('Proposals processed', {
                totalProposals: allProposals.length,
                chainsWithProposals: chainSummaries.length
            });
            await this.shadowTestingService.startShadowTesting();
            await new Promise(resolve => setTimeout(resolve, 5000));
            const shadowTestingStatus = 'Running for next 24 hours';
            logger_1.default.info('Shadow testing started for proposals');
            const shadowMetrics = await this.shadowTestingService.getAllActiveShadowTestMetrics();
            const reportPath = await this.reportService.generateTuningReport(backtestResults, shadowMetrics, new Date().toISOString().split('T')[0]);
            logger_1.default.info('Report generated', { reportPath });
            const proposalSubmissions = [];
            for (const proposal of allProposals) {
                try {
                    const submissionResult = {
                        proposal_id: proposal.id,
                        chain: proposal.chain,
                        status: 'submitted',
                        shadow_testing: true
                    };
                    proposalSubmissions.push(submissionResult);
                }
                catch (error) {
                    logger_1.default.error('Failed to submit proposal', {
                        proposalId: proposal.id,
                        error: error.message
                    });
                }
            }
            const summary = {
                execution_time: new Date().toISOString(),
                backtest_period: '48 hours',
                chains_analyzed: chains,
                time_bucket_size: '3 hours',
                grid_search_parameters: gridSearchParams,
                total_configurations_tested: backtestResults.reduce((sum, r) => sum + (r.total_configurations || 0), 0),
                proposals_generated: allProposals.length,
                chains_with_proposals: chainSummaries.length,
                shadow_testing_duration: '24 hours',
                report_location: reportPath,
                top_candidates_per_chain: chainSummaries
            };
            logger_1.default.info('48-hour backtest process completed successfully', {
                proposalsGenerated: allProposals.length,
                reportPath,
                shadowTestingActive: true
            });
            return {
                success: true,
                proposals: proposalSubmissions,
                report_path: reportPath,
                shadow_testing_status: shadowTestingStatus,
                summary
            };
        }
        catch (error) {
            logger_1.default.error('48-hour backtest process failed', { error: error.message });
            throw error;
        }
    }
    async getBacktestStatus() {
        try {
            const status = await this.tuningService.getBacktestStatus();
            const shadowMetrics = await this.shadowTestingService.getAllActiveShadowTestMetrics();
            const schedulerStatus = this.schedulerService.getStatus();
            return {
                backtest: status,
                shadow_testing: {
                    active_proposals: shadowMetrics.length,
                    metrics: shadowMetrics
                },
                scheduler: schedulerStatus
            };
        }
        catch (error) {
            logger_1.default.error('Error getting backtest status', { error: error.message });
            throw error;
        }
    }
    async initialize() {
        try {
            logger_1.default.info('Initializing tuning controller services');
            await this.schedulerService.start();
            logger_1.default.info('Tuning controller initialized successfully');
        }
        catch (error) {
            logger_1.default.error('Failed to initialize tuning controller', { error: error.message });
            throw error;
        }
    }
    async shutdown() {
        try {
            logger_1.default.info('Shutting down tuning controller services');
            await this.schedulerService.stop();
            await this.shadowTestingService.stopShadowTesting();
            logger_1.default.info('Tuning controller shutdown completed');
        }
        catch (error) {
            logger_1.default.error('Error during tuning controller shutdown', { error: error.message });
        }
    }
    async getTuningMetrics() {
        try {
            const currentConfig = await this.tuningService.getCurrentConfig();
            const recentProposals = await this.tuningService.getProposals({
                limit: 20,
                offset: 0
            });
            const shadowMetrics = await this.shadowTestingService.getAllActiveShadowTestMetrics();
            const improvements = recentProposals
                .filter(p => p.evidence.f1)
                .map(p => {
                const chainConfig = currentConfig[p.chain] || { f1: 0.5 };
                const improvement = ((p.evidence.f1 - chainConfig.f1) / chainConfig.f1) * 100;
                return {
                    chain: p.chain,
                    proposal_id: p.id,
                    current_f1: chainConfig.f1,
                    proposed_f1: p.evidence.f1,
                    improvement_percent: improvement
                };
            });
            return {
                current_config: currentConfig,
                recent_proposals: recentProposals.length,
                active_shadow_tests: shadowMetrics.length,
                performance_improvements: improvements,
                shadow_test_metrics: shadowMetrics,
                system_status: {
                    tuning_service: 'active',
                    shadow_testing: shadowMetrics.length > 0 ? 'active' : 'inactive',
                    scheduler: this.schedulerService.getStatus().running ? 'active' : 'inactive'
                }
            };
        }
        catch (error) {
            logger_1.default.error('Error getting tuning metrics', { error: error.message });
            throw error;
        }
    }
    async forceApplyProposal(proposalId, reason) {
        try {
            logger_1.default.info('Force applying proposal', { proposalId, reason });
            const proposal = await this.tuningService.getProposal(proposalId);
            if (!proposal) {
                throw new Error('Proposal not found');
            }
            await this.tuningService.updateProposalStatus(proposalId, 'approved', reason);
            await this.tuningService.applyProposal(proposalId);
            logger_1.default.info('Proposal force applied successfully', {
                proposalId,
                chain: proposal.chain,
                reason
            });
            return {
                success: true,
                proposal_id: proposalId,
                chain: proposal.chain,
                applied_rules: proposal.rules,
                reason
            };
        }
        catch (error) {
            logger_1.default.error('Error force applying proposal', {
                proposalId,
                error: error.message
            });
            throw error;
        }
    }
}
exports.TuningController = TuningController;
//# sourceMappingURL=TuningController.js.map