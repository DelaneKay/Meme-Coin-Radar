'use client';

import { useState } from 'react';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { Dashboard } from '@/components/dashboard/Dashboard';
import { TokenDetail } from '@/components/token/TokenDetail';
import { Settings } from '@/components/settings/Settings';
import { useWebSocket } from '@/hooks/useWebSocket';
import { TokenSummary } from '@shared/types';

type ViewType = 'dashboard' | 'token-detail' | 'settings';

export default function HomePage() {
  const [currentView, setCurrentView] = useState<ViewType>('dashboard');
  const [selectedToken, setSelectedToken] = useState<TokenSummary | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Initialize WebSocket connection
  const { isConnected, connectionStatus } = useWebSocket();

  const handleTokenSelect = (token: TokenSummary) => {
    setSelectedToken(token);
    setCurrentView('token-detail');
  };

  const handleViewChange = (view: ViewType) => {
    setCurrentView(view);
    if (view !== 'token-detail') {
      setSelectedToken(null);
    }
  };

  const renderCurrentView = () => {
    switch (currentView) {
      case 'dashboard':
        return <Dashboard onTokenSelect={handleTokenSelect} />;
      case 'token-detail':
        return (
          <TokenDetail 
            token={selectedToken} 
            onBack={() => handleViewChange('dashboard')} 
          />
        );
      case 'settings':
        return <Settings />;
      default:
        return <Dashboard onTokenSelect={handleTokenSelect} />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-dark-900">
      {/* Header */}
      <Header 
        onMenuClick={() => setSidebarOpen(!sidebarOpen)}
        connectionStatus={connectionStatus}
        isConnected={isConnected}
      />

      <div className="flex">
        {/* Sidebar */}
        <Sidebar 
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          currentView={currentView}
          onViewChange={handleViewChange}
        />

        {/* Main Content */}
        <main className="flex-1 lg:ml-64">
          <div className="p-4 lg:p-8">
            {renderCurrentView()}
          </div>
        </main>
      </div>

      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black bg-opacity-50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}