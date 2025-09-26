import { Request, Response, NextFunction } from 'express';
import cors from 'cors';
export declare const securityConfig: {
    cors: {
        origin: string[];
        credentials: boolean;
        optionsSuccessStatus: number;
        methods: string[];
        allowedHeaders: string[];
        exposedHeaders: string[];
    };
    helmet: {
        contentSecurityPolicy: {
            directives: {
                defaultSrc: string[];
                styleSrc: string[];
                scriptSrc: string[];
                imgSrc: string[];
                connectSrc: string[];
                fontSrc: string[];
                objectSrc: string[];
                mediaSrc: string[];
                frameSrc: string[];
            };
        };
        crossOriginEmbedderPolicy: boolean;
        hsts: {
            maxAge: number;
            includeSubDomains: boolean;
            preload: boolean;
        };
    };
    rateLimit: {
        global: {
            windowMs: number;
            max: number;
            message: string;
            standardHeaders: boolean;
            legacyHeaders: boolean;
        };
        api: {
            windowMs: number;
            max: number;
            message: string;
            standardHeaders: boolean;
            legacyHeaders: boolean;
        };
        auth: {
            windowMs: number;
            max: number;
            message: string;
            standardHeaders: boolean;
            legacyHeaders: boolean;
        };
    };
};
export declare const validateApiKey: (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
export declare const validateInput: (validations: any[]) => (req: Request, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const validationRules: {
    chainId: any;
    tokenAddress: any;
    page: any;
    limit: any;
    searchQuery: any;
    webhookUrl: any;
    timeRange: any;
    minLiquidity: any;
    minScore: any;
};
export declare const sanitizeRequest: (req: Request, res: Response, next: NextFunction) => void;
export declare const ipFilter: (req: Request, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
export declare const detectSuspiciousActivity: (req: Request, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const createRateLimiter: (options: any) => import("express-rate-limit").RateLimitRequestHandler;
export declare const createSpeedLimiter: (options: any) => import("express-rate-limit").RateLimitRequestHandler;
export declare const securityHeaders: (req: import("http").IncomingMessage, res: import("http").ServerResponse, next: (err?: unknown) => void) => void;
export declare const corsMiddleware: (req: cors.CorsRequest, res: {
    statusCode?: number | undefined;
    setHeader(key: string, value: string): any;
    end(): any;
}, next: (err?: any) => any) => void;
export declare const setupSecurityMiddleware: (app: any) => void;
declare const _default: {
    setupSecurityMiddleware: (app: any) => void;
    validateApiKey: (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
    validateInput: (validations: any[]) => (req: Request, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>> | undefined>;
    validationRules: {
        chainId: any;
        tokenAddress: any;
        page: any;
        limit: any;
        searchQuery: any;
        webhookUrl: any;
        timeRange: any;
        minLiquidity: any;
        minScore: any;
    };
    createRateLimiter: (options: any) => import("express-rate-limit").RateLimitRequestHandler;
    createSpeedLimiter: (options: any) => import("express-rate-limit").RateLimitRequestHandler;
    securityConfig: {
        cors: {
            origin: string[];
            credentials: boolean;
            optionsSuccessStatus: number;
            methods: string[];
            allowedHeaders: string[];
            exposedHeaders: string[];
        };
        helmet: {
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: string[];
                    styleSrc: string[];
                    scriptSrc: string[];
                    imgSrc: string[];
                    connectSrc: string[];
                    fontSrc: string[];
                    objectSrc: string[];
                    mediaSrc: string[];
                    frameSrc: string[];
                };
            };
            crossOriginEmbedderPolicy: boolean;
            hsts: {
                maxAge: number;
                includeSubDomains: boolean;
                preload: boolean;
            };
        };
        rateLimit: {
            global: {
                windowMs: number;
                max: number;
                message: string;
                standardHeaders: boolean;
                legacyHeaders: boolean;
            };
            api: {
                windowMs: number;
                max: number;
                message: string;
                standardHeaders: boolean;
                legacyHeaders: boolean;
            };
            auth: {
                windowMs: number;
                max: number;
                message: string;
                standardHeaders: boolean;
                legacyHeaders: boolean;
            };
        };
    };
};
export default _default;
//# sourceMappingURL=security.d.ts.map