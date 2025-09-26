import { Request, Response, NextFunction } from 'express';
declare global {
    namespace Express {
        interface Request {
            startTime?: number;
            requestId?: string;
        }
    }
}
export declare const requestIdMiddleware: (req: Request, res: Response, next: NextFunction) => void;
export declare const timingMiddleware: (req: Request, res: Response, next: NextFunction) => void;
export declare const httpLoggingMiddleware: (req: Request, res: Response, next: NextFunction) => void;
export declare const errorLoggingMiddleware: (err: Error, req: Request, res: Response, next: NextFunction) => void;
export declare const rateLimitLoggingMiddleware: (req: Request, res: Response, next: NextFunction) => void;
export declare const securityHeadersMiddleware: (req: Request, res: Response, next: NextFunction) => void;
export declare const requestSizeMiddleware: (maxSize?: number) => (req: Request, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
export declare const setupLoggingMiddleware: (app: any, options?: {
    maxRequestSize?: number;
    skipPaths?: string[];
}) => {
    errorMiddleware: (err: Error, req: Request, res: Response, next: NextFunction) => void;
};
//# sourceMappingURL=logging.d.ts.map