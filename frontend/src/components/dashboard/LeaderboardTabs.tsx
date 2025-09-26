'use client';

import { Tab } from '@headlessui/react';
import { Fragment } from 'react';
import clsx from 'clsx';
import { 
  FireIcon, 
  TrendingUpIcon, 
  ClockIcon, 
  SpeakerWaveIcon,
  ChartBarIcon 
} from '@heroicons/react/24/outline';
import { LeaderboardCategory, TokenSummary } from '@shared/types';

interface LeaderboardTabsProps {
  activeTab: LeaderboardCategory;
  onTabChange: (tab: LeaderboardCategory) => void;
  leaderboards?: Record<LeaderboardCategory, TokenSummary[]>;
  isLoading: boolean;
}

const TAB_CONFIG = [
  {
    id: 'new_mints' as LeaderboardCategory,
    name: 'New Mints',
    description: 'Recently launched tokens',
    icon: FireIcon,
    color: 'text-red-500',
    radarOnly: true,
  },
  {
    id: 'momentum_5m' as LeaderboardCategory,
    name: '5m Momentum',
    description: 'Short-term price momentum',
    icon: TrendingUpIcon,
    color: 'text-green-500',
    radarOnly: true,
  },
  {
    id: 'continuation_15m' as LeaderboardCategory,
    name: '15m Continuation',
    description: 'Sustained volume patterns',
    icon: ClockIcon,
    color: 'text-blue-500',
    radarOnly: true,
  },
  {
    id: 'unusual_volume' as LeaderboardCategory,
    name: 'Unusual Volume',
    description: 'High turnover activity',
    icon: SpeakerWaveIcon,
    color: 'text-purple-500',
    radarOnly: true,
  },
  {
    id: 'top_gainers' as LeaderboardCategory,
    name: 'Top Gainers',
    description: 'Biggest price increases',
    icon: ChartBarIcon,
    color: 'text-yellow-500',
    radarOnly: false,
  },
];

export function LeaderboardTabs({ 
  activeTab, 
  onTabChange, 
  leaderboards, 
  isLoading 
}: LeaderboardTabsProps) {
  // Filter tabs based on RADAR_ONLY mode
  const isRadarOnly = process.env.NEXT_PUBLIC_RADAR_ONLY === 'true';
  const availableTabs = isRadarOnly 
    ? TAB_CONFIG.filter(tab => tab.radarOnly)
    : TAB_CONFIG;

  const getTokenCount = (category: LeaderboardCategory): number => {
    if (!leaderboards || !leaderboards[category]) return 0;
    return leaderboards[category].length;
  };

  const getActiveTabIndex = () => {
    return availableTabs.findIndex(tab => tab.id === activeTab);
  };

  return (
    <div className="border-b border-gray-200 dark:border-dark-700">
      <Tab.Group 
        selectedIndex={getActiveTabIndex()} 
        onChange={(index) => onTabChange(availableTabs[index].id)}
      >
        <Tab.List className="flex space-x-8 px-6 overflow-x-auto">
          {availableTabs.map((tab) => (
            <Tab key={tab.id} as={Fragment}>
              {({ selected }) => (
                <button
                  className={clsx(
                    'flex items-center space-x-2 py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap transition-colors',
                    selected
                      ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                  )}
                >
                  <tab.icon 
                    className={clsx(
                      'h-5 w-5',
                      selected ? tab.color : 'text-gray-400'
                    )} 
                  />
                  <span>{tab.name}</span>
                  {!isLoading && (
                    <span 
                      className={clsx(
                        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                        selected
                          ? 'bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-200'
                          : 'bg-gray-100 text-gray-800 dark:bg-dark-700 dark:text-gray-300'
                      )}
                    >
                      {getTokenCount(tab.id)}
                    </span>
                  )}
                </button>
              )}
            </Tab>
          ))}
        </Tab.List>

        <Tab.Panels>
          {TAB_CONFIG.map((tab) => (
            <Tab.Panel key={tab.id}>
              <div className="px-6 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                      {tab.name}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {tab.description}
                    </p>
                  </div>
                  <div className="flex items-center space-x-4">
                    {!isLoading && (
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {getTokenCount(tab.id)} tokens
                      </div>
                    )}
                    <div className="flex items-center space-x-1">
                      <div className="status-online animate-pulse"></div>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        Live
                      </span>
                    </div>
                  </div>
                </div>

                {/* Category-specific info */}
                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                  {tab.id === 'new_mints' && (
                    <>
                      <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
                        <div className="flex items-center">
                          <FireIcon className="h-5 w-5 text-red-500 mr-2" />
                          <div>
                            <div className="text-sm font-medium text-red-900 dark:text-red-200">
                              Fresh Launches
                            </div>
                            <div className="text-xs text-red-700 dark:text-red-300">
                              Tokens launched in last 24h
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-3">
                        <div className="flex items-center">
                          <ClockIcon className="h-5 w-5 text-yellow-500 mr-2" />
                          <div>
                            <div className="text-sm font-medium text-yellow-900 dark:text-yellow-200">
                              Early Stage
                            </div>
                            <div className="text-xs text-yellow-700 dark:text-yellow-300">
                              High risk, high reward potential
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
                        <div className="flex items-center">
                          <ChartBarIcon className="h-5 w-5 text-blue-500 mr-2" />
                          <div>
                            <div className="text-sm font-medium text-blue-900 dark:text-blue-200">
                              Score Sorted
                            </div>
                            <div className="text-xs text-blue-700 dark:text-blue-300">
                              Ranked by radar algorithm
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {tab.id === 'momentum_5m' && (
                    <>
                      <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                        <div className="flex items-center">
                          <TrendingUpIcon className="h-5 w-5 text-green-500 mr-2" />
                          <div>
                            <div className="text-sm font-medium text-green-900 dark:text-green-200">
                              Price Action
                            </div>
                            <div className="text-xs text-green-700 dark:text-green-300">
                              5-minute price momentum
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3">
                        <div className="flex items-center">
                          <SpeakerWaveIcon className="h-5 w-5 text-purple-500 mr-2" />
                          <div>
                            <div className="text-sm font-medium text-purple-900 dark:text-purple-200">
                              Volume Surge
                            </div>
                            <div className="text-xs text-purple-700 dark:text-purple-300">
                              Increased trading activity
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3">
                        <div className="flex items-center">
                          <ClockIcon className="h-5 w-5 text-orange-500 mr-2" />
                          <div>
                            <div className="text-sm font-medium text-orange-900 dark:text-orange-200">
                              Short Term
                            </div>
                            <div className="text-xs text-orange-700 dark:text-orange-300">
                              Quick momentum plays
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {(tab.id === 'continuation_15m' || tab.id === 'unusual_volume' || tab.id === 'top_gainers') && (
                    <>
                      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
                        <div className="flex items-center">
                          <tab.icon className={clsx('h-5 w-5 mr-2', tab.color)} />
                          <div>
                            <div className="text-sm font-medium text-blue-900 dark:text-blue-200">
                              {tab.name}
                            </div>
                            <div className="text-xs text-blue-700 dark:text-blue-300">
                              {tab.description}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-900/20 rounded-lg p-3">
                        <div className="flex items-center">
                          <ChartBarIcon className="h-5 w-5 text-gray-500 mr-2" />
                          <div>
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-200">
                              Algorithm Ranked
                            </div>
                            <div className="text-xs text-gray-700 dark:text-gray-300">
                              Sorted by radar score
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-3">
                        <div className="flex items-center">
                          <FireIcon className="h-5 w-5 text-indigo-500 mr-2" />
                          <div>
                            <div className="text-sm font-medium text-indigo-900 dark:text-indigo-200">
                              Real-time
                            </div>
                            <div className="text-xs text-indigo-700 dark:text-indigo-300">
                              Live market data
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </Tab.Panel>
          ))}
        </Tab.Panels>
      </Tab.Group>
    </div>
  );
}