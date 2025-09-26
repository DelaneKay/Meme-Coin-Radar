export interface RetryOptions {
    maxAttempts: number;
    baseDelay: number;
    maxDelay: number;
    backoffMultiplier: number;
    jitter: boolean;
    retryCondition?: (error: any) => boolean;
    onRetry?: (error: any, attempt: number) => void;
    name?: string;
}
export interface RetryResult<T> {
    result: T;
    attempts: number;
    totalTime: number;
}
export declare class RetryError extends Error {
    readonly attempts: number;
    readonly lastError: Error;
    readonly allErrors: Error[];
    constructor(message: string, attempts: number, lastError: Error, allErrors: Error[]);
}
export declare class RetryUtility {
    private static defaultOptions;
    static execute<T>(operation: () => Promise<T>, options?: Partial<RetryOptions>): Promise<RetryResult<T>>;
    private static calculateDelay;
    private static sleep;
    static executeHttp<T>(operation: () => Promise<T>, serviceName: string, options?: Partial<RetryOptions>): Promise<T>;
    static executeDb<T>(operation: () => Promise<T>, operationName: string, options?: Partial<RetryOptions>): Promise<T>;
    static executeCache<T>(operation: () => Promise<T>, operationName: string, options?: Partial<RetryOptions>): Promise<T>;
}
export declare const retryConfigs: {
    dexscreener: {
        maxAttempts: number;
        baseDelay: number;
        maxDelay: number;
        backoffMultiplier: number;
        jitter: boolean;
        name: string;
    };
    goplus: {
        maxAttempts: number;
        baseDelay: number;
        maxDelay: number;
        backoffMultiplier: number;
        jitter: boolean;
        name: string;
    };
    birdeye: {
        maxAttempts: number;
        baseDelay: number;
        maxDelay: number;
        backoffMultiplier: number;
        jitter: boolean;
        name: string;
    };
    coingecko: {
        maxAttempts: number;
        baseDelay: number;
        maxDelay: number;
        backoffMultiplier: number;
        jitter: boolean;
        name: string;
    };
    redis: {
        maxAttempts: number;
        baseDelay: number;
        maxDelay: number;
        backoffMultiplier: number;
        jitter: boolean;
        name: string;
    };
    database: {
        maxAttempts: number;
        baseDelay: number;
        maxDelay: number;
        backoffMultiplier: number;
        jitter: boolean;
        name: string;
    };
};
export declare const retry: typeof RetryUtility.execute;
export declare const retryHttp: typeof RetryUtility.executeHttp;
export declare const retryDb: typeof RetryUtility.executeDb;
export declare const retryCache: typeof RetryUtility.executeCache;
//# sourceMappingURL=retry.d.ts.map