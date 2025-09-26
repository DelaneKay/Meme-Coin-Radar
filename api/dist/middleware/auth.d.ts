import { Request, Response, NextFunction } from 'express';
export interface User {
    id: string;
    email: string;
    role: 'admin' | 'user' | 'readonly';
    permissions: string[];
    apiKeyHash?: string;
    lastLogin?: Date;
    loginAttempts?: number;
    lockedUntil?: Date;
    createdAt: Date;
    updatedAt: Date;
}
export interface AuthRequest extends Request {
    user?: User;
    apiKey?: string;
}
export interface JWTPayload {
    userId: string;
    email: string;
    role: string;
    permissions: string[];
    iat: number;
    exp: number;
}
export interface ApiKeyInfo {
    id: string;
    name: string;
    userId: string;
    permissions: string[];
    lastUsed?: Date;
    expiresAt?: Date;
    rateLimit?: {
        requestsPerMinute: number;
        requestsPerHour: number;
    };
}
export declare const PERMISSIONS: {
    readonly 'tokens:read': "Read token information";
    readonly 'tokens:write': "Create/update token information";
    readonly 'tokens:delete': "Delete token information";
    readonly 'alerts:read': "Read alerts";
    readonly 'alerts:write': "Create/update alerts";
    readonly 'alerts:delete': "Delete alerts";
    readonly 'admin:users': "Manage users";
    readonly 'admin:system': "System administration";
    readonly 'admin:metrics': "View system metrics";
    readonly 'api:read': "Read API access";
    readonly 'api:write': "Write API access";
    readonly 'api:admin': "Admin API access";
};
export declare const ROLE_PERMISSIONS: {
    readonly: string[];
    user: string[];
    admin: string[];
};
export declare class AuthService {
    private static instance;
    private users;
    private apiKeys;
    static getInstance(): AuthService;
    constructor();
    private initializeDefaultUsers;
    authenticateUser(email: string, password: string): Promise<{
        user: User;
        tokens: {
            accessToken: string;
            refreshToken: string;
        };
    } | null>;
    private handleFailedLogin;
    generateTokens(user: User): Promise<{
        accessToken: string;
        refreshToken: string;
    }>;
    verifyToken(token: string): Promise<JWTPayload | null>;
    refreshToken(refreshToken: string): Promise<{
        accessToken: string;
        refreshToken: string;
    } | null>;
    blacklistToken(token: string): Promise<void>;
    createApiKey(userId: string, name: string, permissions: string[], expiresAt?: Date): Promise<{
        key: string;
        info: ApiKeyInfo;
    }>;
    validateApiKey(key: string): Promise<ApiKeyInfo | null>;
    revokeApiKey(key: string): Promise<void>;
    getUserById(id: string): User | undefined;
    hasPermission(user: User | ApiKeyInfo, permission: string): boolean;
}
export declare const authService: AuthService;
export declare const authenticateJWT: (req: AuthRequest, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const authenticateApiKey: (req: AuthRequest, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const requirePermission: (permission: string) => (req: AuthRequest, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
export declare const requireRole: (role: string) => (req: AuthRequest, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
export declare const optionalAuth: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>;
declare const _default: {
    authService: AuthService;
    authenticateJWT: (req: AuthRequest, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>> | undefined>;
    authenticateApiKey: (req: AuthRequest, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>> | undefined>;
    requirePermission: (permission: string) => (req: AuthRequest, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
    requireRole: (role: string) => (req: AuthRequest, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
    optionalAuth: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>;
    PERMISSIONS: {
        readonly 'tokens:read': "Read token information";
        readonly 'tokens:write': "Create/update token information";
        readonly 'tokens:delete': "Delete token information";
        readonly 'alerts:read': "Read alerts";
        readonly 'alerts:write': "Create/update alerts";
        readonly 'alerts:delete': "Delete alerts";
        readonly 'admin:users': "Manage users";
        readonly 'admin:system': "System administration";
        readonly 'admin:metrics': "View system metrics";
        readonly 'api:read': "Read API access";
        readonly 'api:write': "Write API access";
        readonly 'api:admin': "Admin API access";
    };
    ROLE_PERMISSIONS: {
        readonly: string[];
        user: string[];
        admin: string[];
    };
};
export default _default;
//# sourceMappingURL=auth.d.ts.map