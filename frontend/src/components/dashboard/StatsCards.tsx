'use client';

import { useMemo } from 'react';
import { TokenSummary } from '@shared/types';
import { formatCurrency, formatNumber, formatPercentage } from '@/lib/api';
import { 
  FireIcon, 
  TrendingUpIcon, 
  ShieldCheckIcon, 
  ExclamationTriangleIcon,
  CurrencyDollarIcon,
  ClockIcon
} from '@heroicons/react/24/outline';

interface StatsCardsProps {
  tokens: TokenSummary[];
  isLoading: boolean;
}

interface StatCard {
  title: string;
  value: string;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  color: 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'indigo';
}

export function StatsCards({ tokens, isLoading }: StatsCardsProps) {
  const stats = useMemo(() => {
    if (!tokens || tokens.length === 0) {
      return {
        totalTokens: 0,
        totalLiquidity: 0,
        avgScore: 0,
        highScoreTokens: 0,
        secureTokens: 0,
        riskyTokens: 0,
        newTokens: 0,
        topGainer: null as TokenSummary | null,
      };
    }

    const totalLiquidity = tokens.reduce((sum, token) => sum + token.liquidityUsd, 0);
    const avgScore = tokens.reduce((sum, token) => sum + token.score, 0) / tokens.length;
    const highScoreTokens = tokens.filter(token => token.score >= 80).length;
    const secureTokens = tokens.filter(token => token.security.ok).length;
    const riskyTokens = tokens.filter(token => !token.security.ok).length;
    const newTokens = tokens.filter(token => token.ageMinutes <= 60).length; // Less than 1 hour old
    const topGainer = tokens.reduce((max, token) => 
      (!max || token.priceChange5m > max.priceChange5m) ? token : max, 
      null as TokenSummary | null
    );

    return {
      totalTokens: tokens.length,
      totalLiquidity,
      avgScore,
      highScoreTokens,
      secureTokens,
      riskyTokens,
      newTokens,
      topGainer,
    };
  }, [tokens]);

  const cards: StatCard[] = [
    {
      title: 'Active Tokens',
      value: isLoading ? '...' : formatNumber(stats.totalTokens),
      icon: FireIcon,
      description: 'Tokens being tracked',
      color: 'blue',
    },
    {
      title: 'Total Liquidity',
      value: isLoading ? '...' : formatCurrency(stats.totalLiquidity),
      icon: CurrencyDollarIcon,
      description: 'Combined liquidity pool value',
      color: 'green',
    },
    {
      title: 'Average Score',
      value: isLoading ? '...' : stats.avgScore.toFixed(1),
      icon: TrendingUpIcon,
      description: 'Mean radar score across all tokens',
      color: 'purple',
    },
    {
      title: 'High Score Tokens',
      value: isLoading ? '...' : formatNumber(stats.highScoreTokens),
      change: stats.totalTokens > 0 ? `${((stats.highScoreTokens / stats.totalTokens) * 100).toFixed(1)}%` : '0%',
      changeType: 'neutral',
      icon: TrendingUpIcon,
      description: 'Tokens with score ≥ 80',
      color: 'indigo',
    },
    {
      title: 'Secure Tokens',
      value: isLoading ? '...' : formatNumber(stats.secureTokens),
      change: stats.totalTokens > 0 ? `${((stats.secureTokens / stats.totalTokens) * 100).toFixed(1)}%` : '0%',
      changeType: 'positive',
      icon: ShieldCheckIcon,
      description: 'Tokens passing security checks',
      color: 'green',
    },
    {
      title: 'New Mints',
      value: isLoading ? '...' : formatNumber(stats.newTokens),
      icon: ClockIcon,
      description: 'Tokens launched in last hour',
      color: 'yellow',
    },
  ];

  const getCardClasses = (color: StatCard['color']) => {
    const baseClasses = 'card hover:shadow-lg transition-all duration-200 border-l-4';
    const colorClasses = {
      blue: 'border-l-blue-500 hover:border-l-blue-600',
      green: 'border-l-green-500 hover:border-l-green-600',
      yellow: 'border-l-yellow-500 hover:border-l-yellow-600',
      red: 'border-l-red-500 hover:border-l-red-600',
      purple: 'border-l-purple-500 hover:border-l-purple-600',
      indigo: 'border-l-indigo-500 hover:border-l-indigo-600',
    };
    return `${baseClasses} ${colorClasses[color]}`;
  };

  const getIconClasses = (color: StatCard['color']) => {
    const colorClasses = {
      blue: 'text-blue-500',
      green: 'text-green-500',
      yellow: 'text-yellow-500',
      red: 'text-red-500',
      purple: 'text-purple-500',
      indigo: 'text-indigo-500',
    };
    return `h-8 w-8 ${colorClasses[color]}`;
  };

  const getChangeClasses = (changeType: StatCard['changeType']) => {
    switch (changeType) {
      case 'positive':
        return 'text-green-600 dark:text-green-400';
      case 'negative':
        return 'text-red-600 dark:text-red-400';
      default:
        return 'text-gray-600 dark:text-gray-400';
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
      {cards.map((card, index) => (
        <div key={index} className={getCardClasses(card.color)}>
          <div className="card-body">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400 truncate">
                  {card.title}
                </p>
                <div className="mt-1">
                  <p className="text-2xl font-semibold text-gray-900 dark:text-white">
                    {card.value}
                  </p>
                  {card.change && (
                    <p className={`text-sm ${getChangeClasses(card.changeType)}`}>
                      {card.change}
                    </p>
                  )}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {card.description}
                </p>
              </div>
              <div className="flex-shrink-0">
                <card.icon className={getIconClasses(card.color)} />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}