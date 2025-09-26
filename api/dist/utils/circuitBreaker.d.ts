export interface CircuitBreakerOptions {
    failureThreshold: number;
    resetTimeout: number;
    monitoringPeriod: number;
    expectedErrors?: string[];
    name: string;
}
export declare enum CircuitBreakerState {
    CLOSED = "closed",
    OPEN = "open",
    HALF_OPEN = "half-open"
}
export declare class CircuitBreakerError extends Error {
    readonly state: CircuitBreakerState;
    constructor(message: string, state: CircuitBreakerState);
}
export declare class CircuitBreaker {
    private options;
    private state;
    private failureCount;
    private lastFailureTime;
    private nextAttemptTime;
    private successCount;
    constructor(options: CircuitBreakerOptions);
    execute<T>(operation: () => Promise<T>): Promise<T>;
    private onSuccess;
    private onFailure;
    private isExpectedError;
    private setState;
    private logStateChange;
    private getStateValue;
    getState(): CircuitBreakerState;
    getFailureCount(): number;
    getSuccessCount(): number;
    getNextAttemptTime(): number;
    forceOpen(): void;
    forceClose(): void;
    reset(): void;
    getStatus(): {
        name: string;
        state: CircuitBreakerState;
        failureCount: number;
        successCount: number;
        failureThreshold: number;
        lastFailureTime: string | null;
        nextAttemptTime: string | null;
        healthy: boolean;
    };
}
export declare class CircuitBreakerManager {
    private breakers;
    createBreaker(name: string, options: Omit<CircuitBreakerOptions, 'name'>): CircuitBreaker;
    getBreaker(name: string): CircuitBreaker | undefined;
    getAllBreakers(): CircuitBreaker[];
    getStatus(): {
        name: string;
        state: CircuitBreakerState;
        failureCount: number;
        successCount: number;
        failureThreshold: number;
        lastFailureTime: string | null;
        nextAttemptTime: string | null;
        healthy: boolean;
    }[];
    openAll(): void;
    closeAll(): void;
    resetAll(): void;
}
export declare const defaultCircuitBreakerConfigs: {
    dexscreener: {
        failureThreshold: number;
        resetTimeout: number;
        monitoringPeriod: number;
        expectedErrors: string[];
    };
    goplus: {
        failureThreshold: number;
        resetTimeout: number;
        monitoringPeriod: number;
        expectedErrors: string[];
    };
    birdeye: {
        failureThreshold: number;
        resetTimeout: number;
        monitoringPeriod: number;
        expectedErrors: string[];
    };
    coingecko: {
        failureThreshold: number;
        resetTimeout: number;
        monitoringPeriod: number;
        expectedErrors: string[];
    };
    redis: {
        failureThreshold: number;
        resetTimeout: number;
        monitoringPeriod: number;
        expectedErrors: string[];
    };
};
export declare const circuitBreakerManager: CircuitBreakerManager;
//# sourceMappingURL=circuitBreaker.d.ts.map