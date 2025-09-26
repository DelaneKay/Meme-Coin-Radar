'use client';

import { useState } from 'react';
import { TokenSummary } from '@shared/types';
import { 
  formatCurrency, 
  formatNumber, 
  formatPercentage, 
  formatAge,
  getChainName,
  getChainColor,
  getScoreColor,
  getScoreBadgeColor
} from '@/lib/api';
import { 
  ChevronUpIcon, 
  ChevronDownIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon,
  FireIcon,
  ClockIcon,
  CurrencyDollarIcon,
  TrendingUpIcon,
  TrendingDownIcon
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

interface TokenTableProps {
  tokens: TokenSummary[];
  isLoading: boolean;
  onTokenSelect: (token: TokenSummary) => void;
  emptyMessage?: string;
}

type SortField = 'score' | 'priceChange5m' | 'priceChange15m' | 'liquidityUsd' | 'ageMinutes' | 'volumeUsd24h';
type SortDirection = 'asc' | 'desc';

export function TokenTable({ tokens, isLoading, onTokenSelect, emptyMessage }: TokenTableProps) {
  const [sortField, setSortField] = useState<SortField>('score');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const sortedTokens = [...tokens].sort((a, b) => {
    let aValue: number;
    let bValue: number;

    switch (sortField) {
      case 'score':
        aValue = a.score;
        bValue = b.score;
        break;
      case 'priceChange5m':
        aValue = a.priceChange5m;
        bValue = b.priceChange5m;
        break;
      case 'priceChange15m':
        aValue = a.priceChange15m;
        bValue = b.priceChange15m;
        break;
      case 'liquidityUsd':
        aValue = a.liquidityUsd;
        bValue = b.liquidityUsd;
        break;
      case 'ageMinutes':
        aValue = a.ageMinutes;
        bValue = b.ageMinutes;
        break;
      case 'volumeUsd24h':
        aValue = a.volumeUsd24h;
        bValue = b.volumeUsd24h;
        break;
      default:
        aValue = a.score;
        bValue = b.score;
    }

    if (sortDirection === 'asc') {
      return aValue - bValue;
    } else {
      return bValue - aValue;
    }
  });

  const SortButton = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <button
      onClick={() => handleSort(field)}
      className="flex items-center space-x-1 text-left font-medium text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
    >
      <span>{children}</span>
      {sortField === field && (
        sortDirection === 'desc' ? 
          <ChevronDownIcon className="h-4 w-4" /> : 
          <ChevronUpIcon className="h-4 w-4" />
      )}
    </button>
  );

  const SecurityBadge = ({ security }: { security: TokenSummary['security'] }) => {
    if (security.ok) {
      return (
        <div className="flex items-center space-x-1 text-green-600 dark:text-green-400">
          <ShieldCheckIcon className="h-4 w-4" />
          <span className="text-xs">Secure</span>
        </div>
      );
    }

    const criticalFlags = security.flags.filter(flag => 
      ['honeypot', 'rugpull', 'scam'].includes(flag)
    );

    if (criticalFlags.length > 0) {
      return (
        <div className="flex items-center space-x-1 text-red-600 dark:text-red-400">
          <ExclamationTriangleIcon className="h-4 w-4" />
          <span className="text-xs">High Risk</span>
        </div>
      );
    }

    return (
      <div className="flex items-center space-x-1 text-yellow-600 dark:text-yellow-400">
        <ExclamationTriangleIcon className="h-4 w-4" />
        <span className="text-xs">Caution</span>
      </div>
    );
  };

  const PriceChangeCell = ({ change }: { change: number }) => {
    const isPositive = change > 0;
    const isNegative = change < 0;
    
    return (
      <div className={clsx(
        'flex items-center space-x-1',
        isPositive && 'text-green-600 dark:text-green-400',
        isNegative && 'text-red-600 dark:text-red-400',
        !isPositive && !isNegative && 'text-gray-500 dark:text-gray-400'
      )}>
        {isPositive && <TrendingUpIcon className="h-4 w-4" />}
        {isNegative && <TrendingDownIcon className="h-4 w-4" />}
        <span className="font-medium">{formatPercentage(change)}</span>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="animate-pulse">
        <div className="space-y-3">
          {[...Array(10)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-200 dark:bg-dark-700 rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  if (tokens.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-gray-400 dark:text-gray-500 text-4xl mb-4">📊</div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
          No tokens found
        </h3>
        <p className="text-gray-500 dark:text-gray-400">
          {emptyMessage || 'No tokens match your current criteria.'}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-dark-700">
        <thead className="bg-gray-50 dark:bg-dark-800">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Token
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              <SortButton field="score">Score</SortButton>
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              <SortButton field="priceChange5m">5m</SortButton>
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              <SortButton field="priceChange15m">15m</SortButton>
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              <SortButton field="liquidityUsd">Liquidity</SortButton>
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              <SortButton field="volumeUsd24h">Volume 24h</SortButton>
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              <SortButton field="ageMinutes">Age</SortButton>
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Security
            </th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-dark-800 divide-y divide-gray-200 dark:divide-dark-700">
          {sortedTokens.map((token, index) => (
            <tr 
              key={`${token.chainId}-${token.address}`}
              onClick={() => onTokenSelect(token)}
              className="hover:bg-gray-50 dark:hover:bg-dark-700 cursor-pointer transition-colors"
            >
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center">
                  <div className="flex-shrink-0 h-10 w-10">
                    <div className="h-10 w-10 rounded-full bg-gradient-to-r from-primary-400 to-primary-600 flex items-center justify-center">
                      <span className="text-white font-bold text-sm">
                        {token.symbol.charAt(0)}
                      </span>
                    </div>
                  </div>
                  <div className="ml-4">
                    <div className="flex items-center space-x-2">
                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                        {token.symbol}
                      </div>
                      <div className={clsx(
                        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                        getChainColor(token.chainId)
                      )}>
                        {getChainName(token.chainId)}
                      </div>
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400 truncate max-w-32">
                      {token.name}
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center space-x-2">
                  <span className={clsx(
                    'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                    getScoreBadgeColor(token.score)
                  )}>
                    {token.score.toFixed(0)}
                  </span>
                  {token.score >= 80 && <FireIcon className="h-4 w-4 text-orange-500" />}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <PriceChangeCell change={token.priceChange5m} />
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <PriceChangeCell change={token.priceChange15m} />
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                <div className="flex items-center space-x-1">
                  <CurrencyDollarIcon className="h-4 w-4 text-gray-400" />
                  <span>{formatCurrency(token.liquidityUsd)}</span>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                {formatCurrency(token.volumeUsd24h)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center space-x-1 text-sm text-gray-500 dark:text-gray-400">
                  <ClockIcon className="h-4 w-4" />
                  <span>{formatAge(token.ageMinutes)}</span>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <SecurityBadge security={token.security} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}