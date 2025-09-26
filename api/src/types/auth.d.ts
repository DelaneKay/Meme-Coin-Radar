import { Request } from "express";

export interface AuthUser {
  id?: string;
  role?: string;
}

export type AuthRequest = Request & {
  user?: AuthUser;
  apiKey?: string;
};