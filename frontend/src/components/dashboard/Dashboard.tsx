'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TokenTable } from './TokenTable';
import { StatsCards } from './StatsCards';
import { FilterPanel } from './FilterPanel';
import { LeaderboardTabs } from './LeaderboardTabs';
import { TokenSummary, LeaderboardCategory } from '@shared/types';
import { useWebSocket } from '@/hooks/useWebSocket';
import { fetchLeaderboards, fetchTopTokens } from '@/lib/api';

interface DashboardProps {
  onTokenSelect: (token: TokenSummary) => void;
}

interface FilterState {
  chains: string[];
  minLiquidity: number;
  maxAge: number;
  minScore: number;
  maxTax: number;
  requireSecurity: boolean;
}

const defaultFilters: FilterState = {
  chains: ['sol', 'eth', 'bsc', 'base'],
  minLiquidity: 12000,
  maxAge: 48,
  minScore: 55,
  maxTax: 10,
  requireSecurity: true,
};

export function Dashboard({ onTokenSelect }: DashboardProps) {
  const [activeTab, setActiveTab] = useState<LeaderboardCategory>('new_mints');
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [showFilters, setShowFilters] = useState(false);

  // Get real-time data from WebSocket
  const { hotlist } = useWebSocket();

  // Fetch leaderboards data
  const { data: leaderboards, isLoading: leaderboardsLoading } = useQuery({
    queryKey: ['leaderboards'],
    queryFn: fetchLeaderboards,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  // Fetch top tokens for stats
  const { data: topTokens, isLoading: topTokensLoading } = useQuery({
    queryKey: ['top-tokens'],
    queryFn: () => fetchTopTokens(50),
    refetchInterval: 30000,
  });

  // Apply filters to tokens
  const applyFilters = (tokens: TokenSummary[]): TokenSummary[] => {
    return tokens.filter(token => {
      // Chain filter
      if (filters.chains.length > 0 && !filters.chains.includes(token.chainId)) {
        return false;
      }

      // Liquidity filter
      if (token.liquidityUsd < filters.minLiquidity) {
        return false;
      }

      // Age filter (convert hours to minutes)
      if (token.ageMinutes > filters.maxAge * 60) {
        return false;
      }

      // Score filter
      if (token.score < filters.minScore) {
        return false;
      }

      // Security filter
      if (filters.requireSecurity && !token.security.ok) {
        return false;
      }

      // Tax filter (check security flags for high tax)
      if (filters.maxTax < 100 && token.security.flags.includes('high_tax')) {
        return false;
      }

      return true;
    });
  };

  // Get current tokens based on active tab
  const getCurrentTokens = (): TokenSummary[] => {
    if (activeTab === 'new_mints' && hotlist.length > 0) {
      // Use real-time hotlist for new mints
      return applyFilters(hotlist);
    }

    if (leaderboards && leaderboards[activeTab]) {
      return applyFilters(leaderboards[activeTab]);
    }

    return [];
  };

  const currentTokens = getCurrentTokens();
  const isLoading = leaderboardsLoading || topTokensLoading;

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <StatsCards 
        tokens={topTokens || []}
        isLoading={isLoading}
      />

      {/* Filter Panel */}
      <FilterPanel
        filters={filters}
        onFiltersChange={setFilters}
        isOpen={showFilters}
        onToggle={() => setShowFilters(!showFilters)}
        tokenCount={currentTokens.length}
      />

      {/* Leaderboard Tabs */}
      <div className="card">
        <div className="card-header">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Token Leaderboards
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Real-time token analysis across multiple chains
              </p>
            </div>
            <div className="flex items-center space-x-2">
              {/* Real-time indicator */}
              <div className="flex items-center space-x-1">
                <div className="status-online animate-pulse"></div>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Live
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="card-body p-0">
          <LeaderboardTabs
            activeTab={activeTab}
            onTabChange={setActiveTab}
            leaderboards={leaderboards}
            isLoading={isLoading}
          />

          <TokenTable
            tokens={currentTokens}
            isLoading={isLoading}
            onTokenSelect={onTokenSelect}
            emptyMessage={
              currentTokens.length === 0 && !isLoading
                ? 'No tokens match your current filters. Try adjusting the filter criteria.'
                : undefined
            }
          />
        </div>
      </div>

      {/* Additional Info */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent CEX Listings */}
        <div className="card">
          <div className="card-header">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
              Recent CEX Listings
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Latest exchange listing alerts
            </p>
          </div>
          <div className="card-body">
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <div className="text-4xl mb-2">🚀</div>
              <p>No recent CEX listings</p>
              <p className="text-xs mt-1">Monitoring 6 exchanges for new listings</p>
            </div>
          </div>
        </div>

        {/* System Health */}
        <div className="card">
          <div className="card-header">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
              System Health
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              API and data feed status
            </p>
          </div>
          <div className="card-body">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Data Collection
                </span>
                <div className="flex items-center">
                  <div className="status-online mr-2"></div>
                  <span className="text-sm text-success-600 dark:text-success-400">
                    Active
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Security Analysis
                </span>
                <div className="flex items-center">
                  <div className="status-online mr-2"></div>
                  <span className="text-sm text-success-600 dark:text-success-400">
                    Running
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  CEX Monitoring
                </span>
                <div className="flex items-center">
                  <div className="status-online mr-2"></div>
                  <span className="text-sm text-success-600 dark:text-success-400">
                    Monitoring
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Rate Limits
                </span>
                <div className="flex items-center">
                  <div className="status-online mr-2"></div>
                  <span className="text-sm text-success-600 dark:text-success-400">
                    Healthy
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}