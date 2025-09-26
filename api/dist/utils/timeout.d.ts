export declare class TimeoutError extends Error {
    readonly timeoutMs: number;
    constructor(message: string, timeoutMs: number);
}
export interface TimeoutOptions {
    timeoutMs: number;
    name?: string;
    onTimeout?: () => void;
}
export declare class TimeoutUtility {
    static withTimeout<T>(promise: Promise<T>, options: TimeoutOptions): Promise<T>;
    static createTimeoutWrapper<T extends any[], R>(fn: (...args: T) => Promise<R>, defaultTimeout: number, name?: string): (...args: T) => Promise<R>;
    static withHttpTimeout<T>(promise: Promise<T>, timeoutMs: number, serviceName: string): Promise<T>;
    static withDbTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T>;
    static withCacheTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T>;
    static delay(ms: number): Promise<void>;
    static cancellableDelay(ms: number): {
        promise: Promise<void>;
        cancel: () => void;
    };
    static allWithTimeout<T>(promises: Array<{
        promise: Promise<T>;
        timeout: number;
        name?: string;
    }>, options?: {
        failFast?: boolean;
    }): Promise<Array<T | TimeoutError>>;
    static raceWithTimeout<T>(promises: Array<{
        promise: Promise<T>;
        timeout: number;
        name?: string;
    }>, globalTimeout?: number): Promise<T>;
}
export declare const timeoutConfigs: {
    dexscreener: {
        search: number;
        pairs: number;
        tokens: number;
    };
    goplus: {
        security: number;
        batch: number;
    };
    birdeye: {
        price: number;
        overview: number;
    };
    coingecko: {
        search: number;
        price: number;
        markets: number;
    };
    redis: {
        get: number;
        set: number;
        del: number;
        scan: number;
    };
    database: {
        select: number;
        insert: number;
        update: number;
        delete: number;
    };
    websocket: {
        connect: number;
        send: number;
        close: number;
    };
};
export declare const withTimeout: typeof TimeoutUtility.withTimeout;
export declare const withHttpTimeout: typeof TimeoutUtility.withHttpTimeout;
export declare const withDbTimeout: typeof TimeoutUtility.withDbTimeout;
export declare const withCacheTimeout: typeof TimeoutUtility.withCacheTimeout;
export declare const delay: typeof TimeoutUtility.delay;
export declare const cancellableDelay: typeof TimeoutUtility.cancellableDelay;
//# sourceMappingURL=timeout.d.ts.map