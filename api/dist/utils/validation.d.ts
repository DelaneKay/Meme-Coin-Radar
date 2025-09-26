import { Request, Response, NextFunction } from 'express';
import { ValidationChain } from 'express-validator';
export interface ValidationError {
    field: string;
    message: string;
    value: any;
    code: string;
}
export interface SanitizationOptions {
    allowHtml?: boolean;
    maxLength?: number;
    trimWhitespace?: boolean;
    removeSpecialChars?: boolean;
    allowedChars?: RegExp;
}
export declare const SUPPORTED_CHAINS: readonly ["sol", "eth", "bsc", "base", "polygon", "arbitrum", "optimism"];
export type ChainId = typeof SUPPORTED_CHAINS[number];
export declare const ADDRESS_PATTERNS: {
    sol: RegExp;
    eth: RegExp;
    bsc: RegExp;
    base: RegExp;
    polygon: RegExp;
    arbitrum: RegExp;
    optimism: RegExp;
};
export declare const VALIDATION_PATTERNS: {
    email: RegExp;
    url: RegExp;
    uuid: RegExp;
    alphanumeric: RegExp;
    slug: RegExp;
    hexColor: RegExp;
    ipAddress: RegExp;
};
export declare const DANGEROUS_PATTERNS: RegExp[];
export declare class ValidationService {
    private static instance;
    static getInstance(): ValidationService;
    sanitizeString(input: string, options?: SanitizationOptions): string;
    sanitizeObject(obj: any, depth?: number): any;
    detectDangerousPatterns(input: string): string[];
    validateTokenAddress(address: string, chainId: ChainId): boolean;
    validateWebhookUrl(url: string): boolean;
    validatePagination(page?: string, limit?: string): {
        page: number;
        limit: number;
        errors: string[];
    };
    validateTimeRange(timeRange?: string): {
        valid: boolean;
        error?: string;
    };
    validateNumericRange(value: string, min: number, max: number, fieldName: string): {
        valid: boolean;
        value?: number;
        error?: string;
    };
}
export declare const validationRules: {
    chainId: (field?: string) => any;
    tokenAddress: (chainField?: string, addressField?: string) => any;
    pagination: any[];
    searchQuery: (field?: string) => any;
    email: (field?: string) => any;
    password: (field?: string) => any;
    webhookUrl: (field?: string) => any;
    numericRange: (field: string, min: number, max: number) => any;
    timeRange: (field?: string) => any;
    uuid: (field: string) => any;
    alphanumeric: (field: string, minLength?: number, maxLength?: number) => any;
    stringArray: (field: string, maxItems?: number, maxItemLength?: number) => any;
};
export declare const validateRequest: (validations: ValidationChain[]) => (req: Request, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const sanitizeRequest: (req: Request, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
export declare const validationService: ValidationService;
declare const _default: {
    ValidationService: typeof ValidationService;
    validationService: ValidationService;
    validationRules: {
        chainId: (field?: string) => any;
        tokenAddress: (chainField?: string, addressField?: string) => any;
        pagination: any[];
        searchQuery: (field?: string) => any;
        email: (field?: string) => any;
        password: (field?: string) => any;
        webhookUrl: (field?: string) => any;
        numericRange: (field: string, min: number, max: number) => any;
        timeRange: (field?: string) => any;
        uuid: (field: string) => any;
        alphanumeric: (field: string, minLength?: number, maxLength?: number) => any;
        stringArray: (field: string, maxItems?: number, maxItemLength?: number) => any;
    };
    validateRequest: (validations: ValidationChain[]) => (req: Request, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>> | undefined>;
    sanitizeRequest: (req: Request, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
    SUPPORTED_CHAINS: readonly ["sol", "eth", "bsc", "base", "polygon", "arbitrum", "optimism"];
    ADDRESS_PATTERNS: {
        sol: RegExp;
        eth: RegExp;
        bsc: RegExp;
        base: RegExp;
        polygon: RegExp;
        arbitrum: RegExp;
        optimism: RegExp;
    };
    VALIDATION_PATTERNS: {
        email: RegExp;
        url: RegExp;
        uuid: RegExp;
        alphanumeric: RegExp;
        slug: RegExp;
        hexColor: RegExp;
        ipAddress: RegExp;
    };
    DANGEROUS_PATTERNS: RegExp[];
};
export default _default;
//# sourceMappingURL=validation.d.ts.map