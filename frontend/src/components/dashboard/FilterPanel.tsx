'use client';

import { Fragment } from 'react';
import { Disclosure, Transition } from '@headlessui/react';
import { ChevronDownIcon, FunnelIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { Switch } from '@headlessui/react';
import clsx from 'clsx';

interface FilterState {
  chains: string[];
  minLiquidity: number;
  maxAge: number;
  minScore: number;
  maxTax: number;
  requireSecurity: boolean;
}

interface FilterPanelProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  isOpen: boolean;
  onToggle: () => void;
  tokenCount: number;
}

const CHAIN_OPTIONS = [
  { id: 'sol', name: 'Solana', color: 'bg-purple-500' },
  { id: 'eth', name: 'Ethereum', color: 'bg-blue-500' },
  { id: 'bsc', name: 'BSC', color: 'bg-yellow-500' },
  { id: 'base', name: 'Base', color: 'bg-indigo-500' },
];

const LIQUIDITY_PRESETS = [
  { label: 'Any', value: 0 },
  { label: '$5K+', value: 5000 },
  { label: '$12K+', value: 12000 },
  { label: '$25K+', value: 25000 },
  { label: '$50K+', value: 50000 },
  { label: '$100K+', value: 100000 },
];

const AGE_PRESETS = [
  { label: 'Any', value: 168 }, // 1 week
  { label: '1h', value: 1 },
  { label: '6h', value: 6 },
  { label: '24h', value: 24 },
  { label: '48h', value: 48 },
];

const SCORE_PRESETS = [
  { label: 'Any', value: 0 },
  { label: '50+', value: 50 },
  { label: '60+', value: 60 },
  { label: '70+', value: 70 },
  { label: '80+', value: 80 },
  { label: '90+', value: 90 },
];

export function FilterPanel({ 
  filters, 
  onFiltersChange, 
  isOpen, 
  onToggle, 
  tokenCount 
}: FilterPanelProps) {
  const updateFilter = <K extends keyof FilterState>(
    key: K, 
    value: FilterState[K]
  ) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const toggleChain = (chainId: string) => {
    const newChains = filters.chains.includes(chainId)
      ? filters.chains.filter(id => id !== chainId)
      : [...filters.chains, chainId];
    updateFilter('chains', newChains);
  };

  const resetFilters = () => {
    onFiltersChange({
      chains: ['sol', 'eth', 'bsc', 'base'],
      minLiquidity: 12000,
      maxAge: 48,
      minScore: 55,
      maxTax: 10,
      requireSecurity: true,
    });
  };

  const hasActiveFilters = () => {
    return (
      filters.chains.length !== 4 ||
      filters.minLiquidity !== 12000 ||
      filters.maxAge !== 48 ||
      filters.minScore !== 55 ||
      filters.maxTax !== 10 ||
      !filters.requireSecurity
    );
  };

  return (
    <div className="card">
      <div className="card-header">
        <button
          onClick={onToggle}
          className="flex items-center justify-between w-full text-left"
        >
          <div className="flex items-center space-x-2">
            <FunnelIcon className="h-5 w-5 text-gray-500" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
              Filters
            </h3>
            {hasActiveFilters() && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-200">
                Active
              </span>
            )}
          </div>
          <div className="flex items-center space-x-3">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {tokenCount} tokens
            </span>
            <ChevronDownIcon 
              className={clsx(
                'h-5 w-5 text-gray-500 transition-transform duration-200',
                isOpen && 'transform rotate-180'
              )} 
            />
          </div>
        </button>
      </div>

      <Transition
        show={isOpen}
        as={Fragment}
        enter="transition ease-out duration-200"
        enterFrom="opacity-0 -translate-y-1"
        enterTo="opacity-100 translate-y-0"
        leave="transition ease-in duration-150"
        leaveFrom="opacity-100 translate-y-0"
        leaveTo="opacity-0 -translate-y-1"
      >
        <div className="card-body border-t border-gray-200 dark:border-dark-700">
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {/* Chain Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Chains
              </label>
              <div className="grid grid-cols-2 gap-2">
                {CHAIN_OPTIONS.map((chain) => (
                  <button
                    key={chain.id}
                    onClick={() => toggleChain(chain.id)}
                    className={clsx(
                      'flex items-center space-x-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors',
                      filters.chains.includes(chain.id)
                        ? 'border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-600 dark:bg-primary-900 dark:text-primary-200'
                        : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-dark-600 dark:bg-dark-700 dark:text-gray-300 dark:hover:bg-dark-600'
                    )}
                  >
                    <div className={clsx('w-3 h-3 rounded-full', chain.color)} />
                    <span>{chain.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Liquidity Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Min Liquidity
              </label>
              <div className="grid grid-cols-3 gap-1">
                {LIQUIDITY_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    onClick={() => updateFilter('minLiquidity', preset.value)}
                    className={clsx(
                      'px-2 py-1 text-xs rounded border transition-colors',
                      filters.minLiquidity === preset.value
                        ? 'border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-600 dark:bg-primary-900 dark:text-primary-200'
                        : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-dark-600 dark:bg-dark-700 dark:text-gray-300 dark:hover:bg-dark-600'
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Age Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Max Age
              </label>
              <div className="grid grid-cols-3 gap-1">
                {AGE_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    onClick={() => updateFilter('maxAge', preset.value)}
                    className={clsx(
                      'px-2 py-1 text-xs rounded border transition-colors',
                      filters.maxAge === preset.value
                        ? 'border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-600 dark:bg-primary-900 dark:text-primary-200'
                        : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-dark-600 dark:bg-dark-700 dark:text-gray-300 dark:hover:bg-dark-600'
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Score Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Min Score
              </label>
              <div className="grid grid-cols-3 gap-1">
                {SCORE_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    onClick={() => updateFilter('minScore', preset.value)}
                    className={clsx(
                      'px-2 py-1 text-xs rounded border transition-colors',
                      filters.minScore === preset.value
                        ? 'border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-600 dark:bg-primary-900 dark:text-primary-200'
                        : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-dark-600 dark:bg-dark-700 dark:text-gray-300 dark:hover:bg-dark-600'
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tax Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Max Tax: {filters.maxTax}%
              </label>
              <input
                type="range"
                min="0"
                max="25"
                step="1"
                value={filters.maxTax}
                onChange={(e) => updateFilter('maxTax', parseInt(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-dark-600"
              />
              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
                <span>0%</span>
                <span>25%</span>
              </div>
            </div>

            {/* Security Toggle */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Security Requirements
              </label>
              <Switch.Group>
                <div className="flex items-center">
                  <Switch
                    checked={filters.requireSecurity}
                    onChange={(checked) => updateFilter('requireSecurity', checked)}
                    className={clsx(
                      'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
                      filters.requireSecurity ? 'bg-primary-600' : 'bg-gray-200 dark:bg-dark-600'
                    )}
                  >
                    <span
                      className={clsx(
                        'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                        filters.requireSecurity ? 'translate-x-6' : 'translate-x-1'
                      )}
                    />
                  </Switch>
                  <Switch.Label className="ml-3 text-sm text-gray-700 dark:text-gray-300">
                    Require security checks
                  </Switch.Label>
                </div>
              </Switch.Group>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-6 border-t border-gray-200 dark:border-dark-700">
            <button
              onClick={resetFilters}
              className="flex items-center space-x-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <XMarkIcon className="h-4 w-4" />
              <span>Reset Filters</span>
            </button>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Showing {tokenCount} tokens
            </div>
          </div>
        </div>
      </Transition>
    </div>
  );
}