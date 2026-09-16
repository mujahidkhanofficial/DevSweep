import React, { useState, useEffect } from 'react';
import { TitleBar } from './components/layout/TitleBar.js';
import { Sidebar, TabType } from './components/layout/Sidebar.js';
import { DashboardView } from './components/dashboard/DashboardView.js';
import { CleanupView } from './components/cleanup/CleanupView.js';
import { StorageView } from './components/storage/StorageView.js';
import { HistoryView } from './components/history/HistoryView.js';
import { SettingsView } from './components/settings/SettingsView.js';
import { ScanModal } from './components/scan/ScanModal.js';
import { useDiskStore } from './stores/useDiskStore.js';
import { useScanStore } from './stores/useScanStore.js';
import { isTextInputElement } from './lib/keyboardUtils.js';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [showScanModal, setShowScanModal] = useState(false);

  const { fetchSystemInfo } = useDiskStore();
  const { items, isScanning, startScan, cancelScan } = useScanStore();

  useEffect(() => {
    fetchSystemInfo();
  }, []);

  // Centralized global desktop keyboard shortcut dispatcher
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Invariant: Never hijack keystrokes while the user is actively typing in text fields
      if (isTextInputElement(e.target)) {
        return;
      }

      // Ctrl + 1..5: Quick view switching
      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        const tabMap: Record<string, TabType> = {
          '1': 'dashboard',
          '2': 'cleanup',
          '3': 'storage',
          '4': 'history',
          '5': 'settings'
        };
        if (tabMap[e.key]) {
          e.preventDefault();
          setActiveTab(tabMap[e.key]);
          return;
        }
      }

      // Ctrl + R: Trigger Smart Scan (when not already scanning or in modal)
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        if (!isScanning && !showScanModal) {
          handleTriggerScan();
        }
        return;
      }

      // Escape: Precedence for ScanModal / Scan cancel
      if (e.key === 'Escape') {
        if (showScanModal) {
          e.preventDefault();
          if (isScanning) {
            cancelScan();
          } else {
            setShowScanModal(false);
            if (items.length > 0) {
              setActiveTab('cleanup');
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isScanning, showScanModal, items.length]);

  const handleTriggerScan = async () => {
    setShowScanModal(true);
    await startScan();
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground font-sans">
      {/* Accessible Skip Link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3.5 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-lg focus:shadow-lg focus:ring-2 focus:ring-primary-foreground focus:outline-hidden text-xs font-semibold"
      >
        Skip to main content
      </a>

      {/* Windows Titlebar */}
      <TitleBar />

      {/* Main App Workspace */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          activeTab={activeTab}
          onTabChange={(tab) => setActiveTab(tab)}
          candidateCount={items.length}
        />

        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto bg-background/50 outline-hidden">
          {activeTab === 'dashboard' && (
            <DashboardView
              onStartScan={handleTriggerScan}
              onNavigateToCleanup={() => setActiveTab('cleanup')}
            />
          )}
          {activeTab === 'cleanup' && <CleanupView />}
          {activeTab === 'storage' && <StorageView />}
          {activeTab === 'history' && <HistoryView />}
          {activeTab === 'settings' && <SettingsView />}
        </main>
      </div>

      {/* Scan Modal */}
      <ScanModal
        isOpen={showScanModal}
        onClose={() => {
          setShowScanModal(false);
          if (items.length > 0) {
            setActiveTab('cleanup');
          }
        }}
      />
    </div>
  );
};
