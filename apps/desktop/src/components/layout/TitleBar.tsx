import React from 'react';
import { Minus, Square, X, HardDrive, Sun, Moon } from 'lucide-react';
import { useSettingsStore } from '../../stores/useSettingsStore.js';

export const TitleBar: React.FC = () => {
  const { theme, toggleTheme } = useSettingsStore();

  const handleMinimize = () => window.cleaner?.minimize();
  const handleMaximize = () => window.cleaner?.maximize();
  const handleClose = () => window.cleaner?.close();

  return (
    <header className="app-titlebar h-9 w-full bg-background border-b border-border flex items-center justify-between px-3 select-none z-50">
      <div className="flex items-center space-x-2 text-xs font-medium text-foreground">
        <img src="/icon.png" alt="DevSweep" className="w-4 h-4 rounded-xs object-contain" />
        <span>DevSweep</span>
        <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">v1.0 Windows</span>
      </div>

      <div className="app-no-drag flex items-center space-x-1">
        <button
          type="button"
          onClick={toggleTheme}
          title="Toggle Light/Dark Theme"
          aria-label="Toggle Light/Dark Theme"
          className="p-1 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden cursor-pointer"
        >
          {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
        </button>
        <button
          type="button"
          onClick={handleMinimize}
          title="Minimize Window"
          aria-label="Minimize Window"
          className="p-1.5 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden cursor-pointer"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={handleMaximize}
          title="Maximize Window"
          aria-label="Maximize Window"
          className="p-1.5 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden cursor-pointer"
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={handleClose}
          title="Close Window"
          aria-label="Close Window"
          className="p-1.5 hover:bg-destructive hover:text-destructive-foreground rounded text-muted-foreground transition-colors focus-visible:ring-2 focus-visible:ring-destructive focus-visible:outline-hidden cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
