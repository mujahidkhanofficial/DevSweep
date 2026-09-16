import React from 'react';
import {
  LayoutDashboard,
  Trash2,
  PieChart,
  History,
  Settings,
  ShieldCheck
} from 'lucide-react';

export type TabType = 'dashboard' | 'cleanup' | 'storage' | 'history' | 'settings';

interface SidebarProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  candidateCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, candidateCount }) => {
  const navItems = [
    { id: 'dashboard' as TabType, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'cleanup' as TabType, label: 'Cleanup', icon: Trash2, badge: candidateCount > 0 ? candidateCount : undefined },
    { id: 'storage' as TabType, label: 'Storage', icon: PieChart },
    { id: 'history' as TabType, label: 'History', icon: History },
    { id: 'settings' as TabType, label: 'Settings', icon: Settings }
  ];

  return (
    <aside className="w-56 h-full bg-card border-r border-border flex flex-col justify-between p-3 select-none">
      <div className="space-y-4">
        <nav className="space-y-1" aria-label="Main navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-card focus-visible:outline-hidden cursor-pointer ${
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                }`}
              >
                <div className="flex items-center space-x-2.5">
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </div>
                {item.badge !== undefined && (
                  <span
                    className={`px-1.5 py-0.2 text-[10px] rounded-full font-semibold ${
                      isActive ? 'bg-primary-foreground text-primary' : 'bg-primary/20 text-primary'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="p-2.5 rounded-lg bg-secondary/50 border border-border/50 text-[11px] space-y-1 text-muted-foreground">
        <div className="flex items-center space-x-1.5 text-foreground font-medium">
          <ShieldCheck className="w-3.5 h-3.5 text-safety-safe" />
          <span>Safety Protection Active</span>
        </div>
        <p className="text-[10px] leading-tight text-muted-foreground">
          Important files, documents & projects are kept safe.
        </p>
      </div>
    </aside>
  );
};
