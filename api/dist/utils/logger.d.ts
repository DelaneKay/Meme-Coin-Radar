import winston from 'winston';
export declare class RequestContext {
    private static context;
    static setRequestId(requestId: string): void;
    static getRequestId(): string | undefined;
    static generateRequestId(): string;
    static clear(): void;
}
export declare const logger: winston.Logger;
export declare const dataCollectorLogger: winston.Logger;
export declare const secAuditorLogger: winston.Logger;
export declare const scorerLogger: winston.Logger;
export declare const alerterLogger: winston.Logger;
export declare const sentinelLogger: winston.Logger;
export declare const orchestratorLogger: winston.Logger;
export declare const logHttpRequest: (req: any, res: any, duration: number) => void;
export declare const logRateLimit: (service: string, remaining: number, resetTime: number, endpoint?: string) => void;
export declare const logPerformance: (operation: string, duration: number, metadata?: any) => void;
export declare const logError: (error: Error, context?: string, metadata?: any) => void;
export declare const logApiRequest: (service: string, endpoint: string, duration: number, success: boolean, statusCode?: number, rateLimitRemaining?: number, metadata?: any) => void;
export declare const logSecurityEvent: (event: string, severity: "low" | "medium" | "high", metadata?: any) => void;
export declare const logBusinessMetric: (metric: string, value: number, unit?: string, metadata?: any) => void;
export declare const logCircuitBreaker: (service: string, state: "open" | "closed" | "half-open", metadata?: any) => void;
export declare const logCacheEvent: (operation: "hit" | "miss" | "set" | "delete", key: string, metadata?: any) => void;
export default logger;
//# sourceMappingURL=logger.d.ts.map