import { Server } from 'http';
export interface ShutdownHandler {
    name: string;
    handler: () => Promise<void>;
    timeout?: number;
    priority?: number;
}
export declare class GracefulShutdown {
    private handlers;
    private isShuttingDown;
    private shutdownTimeout;
    private server?;
    constructor(server?: Server);
    private setupSignalHandlers;
    addHandler(handler: ShutdownHandler): void;
    removeHandler(name: string): void;
    setShutdownTimeout(timeout: number): void;
    shutdown(signal?: string): Promise<void>;
    private stopServer;
    private executeHandlers;
    private emergencyShutdown;
    getStatus(): {
        isShuttingDown: boolean;
        handlersCount: number;
        shutdownTimeout: number;
        handlers: {
            name: string;
            priority: number;
            timeout: number;
        }[];
    };
}
export declare function createDefaultShutdownHandlers(gracefulShutdown: GracefulShutdown): void;
export declare function initializeGracefulShutdown(server?: Server): GracefulShutdown;
export declare function getGracefulShutdown(): GracefulShutdown | null;
//# sourceMappingURL=gracefulShutdown.d.ts.map