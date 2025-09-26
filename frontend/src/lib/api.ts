import axios from 'axios';
import { TokenSummary, LeaderboardCategory, ApiResponse, HealthCheckResponse } from '@shared/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// Create axios instance with default config
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error);
    throw error;
  }
);

// =============================================================================
// TOKEN & LEADERBOARD APIs
// =============================================================================

export async function fetchTopTokens(limit: number = 20): Promise<TokenSummary[]> {
  const response = await api.get<ApiResponse<TokenSummary[]>>(`/api/signals/top?limit=${limit}`);
  return response.data.data || [];
}

export async function fetchHotlist(): Promise<TokenSummary[]> {
  const response = await api.get<ApiResponse<TokenSummary[]>>('/api/signals/hotlist');
  return response.data.data || [];
}

export async function fetchLeaderboards(): Promise<Record<LeaderboardCategory, TokenSummary[]>> {
  const response = await api.get<ApiResponse<Record<LeaderboardCategory, TokenSummary[]>>>('/api/signals/leaderboards');
  return response.data.data || {
    new_mints: [],
    momentum_5m: [],
    continuation_15m: [],
    unusual_volume: [],
  };
}

export async function fetchLeaderboard(category: LeaderboardCategory): Promise<TokenSummary[]> {
  const response = await api.get<ApiResponse<TokenSummary[]>>(`/api/signals/leaderboards/${category}`);
  return response.data.data || [];
}

export async function fetchTokenDetails(chain: string, address: string): Promise<TokenSummary | null> {
  try {
    const response = await api.get<ApiResponse<TokenSummary>>(`/api/tokens/${chain}/${address}`);
    return response.data.data || null;
  } catch (error: any) {
    if (error.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function searchTokens(query: string, chain?: string): Promise<TokenSummary[]> {
  const params = new URLSearchParams({ q: query });
  if (chain) {
    params.append('chain', chain);
  }
  
  const response = await api.get<ApiResponse<TokenSummary[]>>(`/api/search?${params}`);
  return response.data.data || [];
}

// =============================================================================
// CEX LISTINGS APIs
// =============================================================================

export async function fetchRecentListings(limit: number = 10): Promise<any[]> {
  const response = await api.get<ApiResponse<any[]>>(`/api/listings/recent?limit=${limit}`);
  return response.data.data || [];
}

// =============================================================================
// CONFIGURATION APIs
// =============================================================================

export async function fetchConfig(): Promise<any> {
  const response = await api.get<ApiResponse<any>>('/api/config');
  return response.data.data || {};
}

export async function updateConfig(config: any): Promise<any> {
  const response = await api.post<ApiResponse<any>>('/api/config', config);
  return response.data.data || {};
}

// =============================================================================
// HEALTH & STATUS APIs
// =============================================================================

export async function fetchHealthStatus(): Promise<HealthCheckResponse> {
  const response = await api.get<HealthCheckResponse>('/api/health/detailed');
  return response.data;
}

export async function fetchCacheStats(): Promise<any> {
  const response = await api.get<ApiResponse<any>>('/api/status/cache');
  return response.data.data || {};
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

export function formatNumber(num: number, decimals: number = 2): string {
  if (num >= 1e9) {
    return `${(num / 1e9).toFixed(decimals)}B`;
  }
  if (num >= 1e6) {
    return `${(num / 1e6).toFixed(decimals)}M`;
  }
  if (num >= 1e3) {
    return `${(num / 1e3).toFixed(decimals)}K`;
  }
  return num.toFixed(decimals);
}

export function formatCurrency(num: number, decimals: number = 2): string {
  return `$${formatNumber(num, decimals)}`;
}

export function formatPercentage(num: number, decimals: number = 1): string {
  return `${num.toFixed(decimals)}%`;
}

export function formatAge(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function getChainName(chainId: string): string {
  const chainNames: Record<string, string> = {
    sol: 'Solana',
    eth: 'Ethereum',
    bsc: 'BSC',
    base: 'Base',
  };
  return chainNames[chainId] || chainId.toUpperCase();
}

export function getChainColor(chainId: string): string {
  const chainColors: Record<string, string> = {
    sol: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    eth: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    bsc: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    base: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
  };
  return chainColors[chainId] || 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
}

export function getScoreColor(score: number): string {
  if (score >= 80) {
    return 'text-success-600 dark:text-success-400';
  }
  if (score >= 60) {
    return 'text-warning-600 dark:text-warning-400';
  }
  return 'text-danger-600 dark:text-danger-400';
}

export function getScoreBadgeColor(score: number): string {
  if (score >= 80) {
    return 'badge-success';
  }
  if (score >= 60) {
    return 'badge-warning';
  }
  return 'badge-danger';
}