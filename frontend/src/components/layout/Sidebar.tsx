'use client';

import { Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import {
  ChartBarIcon,
  FireIcon,
  TrendingUpIcon,
  ClockIcon,
  ShieldCheckIcon,
  Cog6ToothIcon,
  BellIcon,
  GlobeAltIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

type ViewType = 'dashboard' | 'token-detail' | 'settings';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
}

const navigation = [
  {
    name: 'Dashboard',
    id: 'dashboard' as ViewType,
    icon: ChartBarIcon,
    description: 'Overview and leaderboards',
    radarOnly: true,
  },
  {
    name: 'New Mints',
    id: 'dashboard',
    icon: FireIcon,
    description: 'Recently launched tokens',
    category: 'new_mints',
    radarOnly: true,
  },
  {
    name: '5m Momentum',
    id: 'dashboard',
    icon: TrendingUpIcon,
    description: 'Short-term momentum plays',
    category: 'momentum_5m',
    radarOnly: true,
  },
  {
    name: '15m Continuation',
    id: 'dashboard',
    icon: ClockIcon,
    description: 'Sustained volume patterns',
    category: 'continuation_15m',
    radarOnly: true,
  },
  {
    name: 'Unusual Volume',
    id: 'dashboard',
    icon: GlobeAltIcon,
    description: 'High turnover tokens',
    category: 'unusual_volume',
    radarOnly: true,
  },
];

const secondaryNavigation = [
  {
    name: 'Security Center',
    id: 'dashboard',
    icon: ShieldCheckIcon,
    description: 'Token security analysis',
    radarOnly: true,
  },
  {
    name: 'Alerts',
    id: 'dashboard',
    icon: BellIcon,
    description: 'Notification settings',
    radarOnly: true,
  },
  {
    name: 'Settings',
    id: 'settings' as ViewType,
    icon: Cog6ToothIcon,
    description: 'App configuration',
    radarOnly: true,
  },
];

export function Sidebar({ isOpen, onClose, currentView, onViewChange }: SidebarProps) {
  // Filter navigation items based on RADAR_ONLY mode
  const isRadarOnly = process.env.NEXT_PUBLIC_RADAR_ONLY === 'true';
  const availableNavigation = isRadarOnly 
    ? navigation.filter(item => item.radarOnly)
    : navigation;
  const availableSecondaryNavigation = isRadarOnly 
    ? secondaryNavigation.filter(item => item.radarOnly)
    : secondaryNavigation;

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-dark-700 lg:hidden">
        <div className="flex items-center">
          <div className="h-8 w-8 bg-gradient-to-r from-primary-500 to-primary-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">🎯</span>
          </div>
          <span className="ml-2 text-lg font-semibold text-gray-900 dark:text-white">
            Radar
          </span>
        </div>
        <button
          type="button"
          className="p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 dark:hover:bg-dark-700"
          onClick={onClose}
        >
          <XMarkIcon className="h-6 w-6" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-6 space-y-8 overflow-y-auto">
        {/* Primary Navigation */}
        <div>
          <h3 className="px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Leaderboards
          </h3>
          <div className="mt-3 space-y-1">
            {availableNavigation.map((item) => (
              <button
                key={item.name}
                onClick={() => {
                  onViewChange(item.id);
                  onClose();
                }}
                className={clsx(
                  'group flex items-center px-3 py-2 text-sm font-medium rounded-lg w-full text-left transition-colors',
                  currentView === item.id
                    ? 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-200'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-dark-700'
                )}
              >
                <item.icon
                  className={clsx(
                    'mr-3 h-5 w-5 flex-shrink-0',
                    currentView === item.id
                      ? 'text-primary-500'
                      : 'text-gray-400 group-hover:text-gray-500 dark:group-hover:text-gray-300'
                  )}
                />
                <div className="flex-1">
                  <div className="font-medium">{item.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {item.description}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Secondary Navigation */}
        <div>
          <h3 className="px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Tools
          </h3>
          <div className="mt-3 space-y-1">
            {availableSecondaryNavigation.map((item) => (
              <button
                key={item.name}
                onClick={() => {
                  onViewChange(item.id);
                  onClose();
                }}
                className={clsx(
                  'group flex items-center px-3 py-2 text-sm font-medium rounded-lg w-full text-left transition-colors',
                  currentView === item.id
                    ? 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-200'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-dark-700'
                )}
              >
                <item.icon
                  className={clsx(
                    'mr-3 h-5 w-5 flex-shrink-0',
                    currentView === item.id
                      ? 'text-primary-500'
                      : 'text-gray-400 group-hover:text-gray-500 dark:group-hover:text-gray-300'
                  )}
                />
                <div className="flex-1">
                  <div className="font-medium">{item.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {item.description}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Status Section */}
        <div className="border-t border-gray-200 dark:border-dark-700 pt-6">
          <div className="px-3">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
              System Status
            </h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">API Status</span>
                <div className="flex items-center">
                  <div className="status-online mr-2"></div>
                  <span className="text-success-600 dark:text-success-400">Online</span>
                </div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">Data Feed</span>
                <div className="flex items-center">
                  <div className="status-online mr-2"></div>
                  <span className="text-success-600 dark:text-success-400">Active</span>
                </div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">Alerts</span>
                <div className="flex items-center">
                  <div className="status-online mr-2"></div>
                  <span className="text-success-600 dark:text-success-400">Enabled</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Footer */}
      <div className="border-t border-gray-200 dark:border-dark-700 p-4">
        <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
          <div>Meme Coin Radar v1.0</div>
          <div className="mt-1">Free Tier - No API Limits</div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile sidebar */}
      <Transition.Root show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50 lg:hidden" onClose={onClose}>
          <Transition.Child
            as={Fragment}
            enter="transition-opacity ease-linear duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity ease-linear duration-300"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black bg-opacity-25" />
          </Transition.Child>

          <div className="fixed inset-0 z-50 flex">
            <Transition.Child
              as={Fragment}
              enter="transition ease-in-out duration-300 transform"
              enterFrom="-translate-x-full"
              enterTo="translate-x-0"
              leave="transition ease-in-out duration-300 transform"
              leaveFrom="translate-x-0"
              leaveTo="-translate-x-full"
            >
              <Dialog.Panel className="relative flex w-full max-w-xs flex-1 flex-col bg-white dark:bg-dark-800">
                <SidebarContent />
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition.Root>

      {/* Desktop sidebar */}
      <div className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col">
        <div className="flex flex-col flex-grow bg-white dark:bg-dark-800 border-r border-gray-200 dark:border-dark-700 pt-16">
          <SidebarContent />
        </div>
      </div>
    </>
  );
}