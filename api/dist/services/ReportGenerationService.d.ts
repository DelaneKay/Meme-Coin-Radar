import { Pool } from 'pg';
import Redis from 'ioredis';
import { TuningProposal, BacktestResult } from './AlertTuningService';
import { ShadowTestMetrics } from './ShadowTestingService';
export interface ReportData {
    backtest_results: BacktestResult[];
    shadow_test_metrics: ShadowTestMetrics[];
    current_config: any;
    proposals: TuningProposal[];
    generated_at: string;
    report_period: {
        start: string;
        end: string;
    };
}
export interface ChartData {
    type: 'line' | 'bar' | 'scatter' | 'heatmap';
    title: string;
    data: any[];
    x_axis: string;
    y_axis: string;
    series?: string;
}
export declare class ReportGenerationService {
    private db;
    private redis;
    private reportsDir;
    constructor(db: Pool, redis: Redis, reportsDir?: string);
    generateTuningReport(backtestResults: BacktestResult[], shadowMetrics?: ShadowTestMetrics[], reportDate?: string): Promise<string>;
    private generateMarkdownContent;
    private generateHeader;
    private generateExecutiveSummary;
    private generateCurrentConfigSection;
    private generateBacktestResultsSection;
    private generateShadowTestingSection;
    private generateTopProposalsSection;
    private generatePerformanceAnalysisSection;
    private generateRecommendationsSection;
    private generateChartsSection;
    private generateAppendixSection;
    private extractProposalsFromResults;
    private calculateAverageF1Improvement;
    private calculateF1Improvement;
    private generateQuickRecommendations;
    private calculateConfidenceScore;
    private calculateTestDuration;
    private analyzeParameterImpacts;
    private analyzeTimePatterns;
    private generateActionableRecommendations;
    private generateASCIICharts;
    private generateSimpleBarChart;
    private getCurrentConfig;
    private saveReportMetadata;
}
//# sourceMappingURL=ReportGenerationService.d.ts.map