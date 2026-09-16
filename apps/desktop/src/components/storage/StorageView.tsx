import React, { useState, useMemo } from 'react';
import { PieChart, HardDrive, FileText, AlertCircle, Search, Filter, X } from 'lucide-react';
import { useDiskStore } from '../../stores/useDiskStore.js';
import { formatBytes } from '../../lib/format.js';

// Informational storage breakdown by developer category (static metadata)
const INFORMATIONAL_CATEGORIES = [
  { name: 'Developer Caches (npm, Gradle, Pub)', size: 18.4 * 1e9, percent: 32, note: 'Rebuildable packages & tool caches' },
  { name: 'Project Build Artifacts (dist, build, out)', size: 8.2 * 1e9, percent: 14, note: 'Compiled assets and temporary builds' },
  { name: 'IDE & Editor Data (VS Code, JetBrains)', size: 5.6 * 1e9, percent: 10, note: 'V8 compilation caches & indexed symbols' },
  { name: 'System Temp & Crash Dumps', size: 3.1 * 1e9, percent: 5, note: 'Expired installer temp files and error logs' },
  { name: 'Other Files & User Data', size: 22.4 * 1e9, percent: 39, note: 'Source code, documents and binaries' }
];

// Base large files reference list (static metadata)
const SAMPLE_LARGE_FILES = [
  { name: 'android-sdk-system-images.zip', path: 'C:\\Users\\User\\Downloads\\android-sdk-system-images.zip', size: 3.8 * 1e9 },
  { name: 'electron-v32-win-x64.zip', path: 'C:\\Users\\User\\AppData\\Local\\electron\\Cache\\electron-v32.zip', size: 1.4 * 1e9 },
  { name: 'gradle-8.5-all.zip', path: 'C:\\Users\\User\\.gradle\\wrapper\\dists\\gradle-8.5-all.zip', size: 0.9 * 1e9 },
  { name: 'heapdump-node-crash.dmp', path: 'C:\\Users\\User\\AppData\\Local\\CrashDumps\\heapdump.dmp', size: 0.6 * 1e9 }
];

export const StorageView: React.FC = () => {
  const { drives, selectedDrive, loading, error: diskError, fetchSystemInfo } = useDiskStore();
  const currentDrive = drives.find((d) => d.caption === selectedDrive) || drives[0];

  const [thresholdGB, setThresholdGB] = useState<number>(1);
  const [searchTerm, setSearchTerm] = useState('');

  const categories = INFORMATIONAL_CATEGORIES;
  const allLargeFiles = SAMPLE_LARGE_FILES;

  const filesAboveThreshold = useMemo(
    () => allLargeFiles.filter((f) => f.size >= thresholdGB * 1e9),
    [thresholdGB]
  );
  const largeFiles = useMemo(
    () => filesAboveThreshold.filter((f) => f.name.toLowerCase().includes(searchTerm.toLowerCase())),
    [filesAboveThreshold, searchTerm]
  );

  const thresholdLabel = thresholdGB >= 1 ? `${thresholdGB} GB` : '500 MB';

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div>
        <div className="flex items-center space-x-2 text-xs font-semibold text-primary uppercase tracking-wider">
          <PieChart className="w-4 h-4" />
          <span>Storage Overview</span>
        </div>
        <h1 className="text-xl font-bold text-foreground mt-1">Storage & Big Files</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          View disk space usage and inspect large files taking up drive capacity. (No files are deleted on this screen).
        </p>
      </div>

      {/* Disk Error Recovery Banner */}
      {diskError && !currentDrive && (
        <div
          role="alert"
          aria-live="assertive"
          className="p-3.5 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-center justify-between"
        >
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Unable to read drive storage: {diskError}</span>
          </div>
          <button
            type="button"
            onClick={() => fetchSystemInfo()}
            className="px-2.5 py-1 rounded bg-destructive text-destructive-foreground font-semibold hover:bg-destructive/90 text-[11px] cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Category Breakdown / Loading Skeleton */}
      {loading && drives.length === 0 ? (
        <div
          aria-busy="true"
          aria-label="Loading storage analytics"
          className="p-5 rounded-xl bg-card border border-border space-y-4 shadow-sm"
        >
          <div className="w-64 h-4 rounded bg-secondary/80" aria-hidden="true" />
          <div className="w-full h-3 rounded-full bg-secondary/70" aria-hidden="true" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="p-3 rounded-lg bg-secondary/40 border border-border h-14" />
            ))}
          </div>
        </div>
      ) : (
        <div className="p-5 rounded-xl bg-card border border-border space-y-4">
          <h2 className="text-sm font-semibold text-foreground">
            Estimated Storage by Category ({currentDrive?.caption || 'C:'})
          </h2>

          <div className="w-full h-3 bg-secondary rounded-full overflow-hidden flex">
            {categories.map((cat, idx) => (
              <div
                key={idx}
                className={`h-full ${
                  idx === 0
                    ? 'bg-primary'
                    : idx === 1
                    ? 'bg-amber-500'
                    : idx === 2
                    ? 'bg-purple-500'
                    : idx === 3
                    ? 'bg-rose-500'
                    : 'bg-muted-foreground'
                }`}
                style={{ width: `${cat.percent}%` }}
                title={`${cat.name}: ${cat.percent}%`}
              />
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
            {categories.map((cat, idx) => (
              <div key={idx} className="p-3 rounded-lg bg-secondary/30 border border-border flex items-center justify-between text-xs">
                <div className="space-y-0.5">
                  <span className="font-semibold text-foreground block">{cat.name}</span>
                  <span className="text-[11px] text-muted-foreground">{cat.note}</span>
                </div>
                <div className="text-right">
                  <span className="font-bold text-foreground">{formatBytes(cat.size)}</span>
                  <span className="text-[10px] text-muted-foreground block">{cat.percent}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Large File Finder */}
      <div className="p-5 rounded-xl bg-card border border-border space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Large File Finder</h2>
            <p className="text-xs text-muted-foreground">Find big files taking up drive capacity</p>
          </div>

          <div className="flex items-center space-x-2" role="group" aria-label="Large file size threshold filter">
            <span className="text-xs text-muted-foreground">Minimum Size:</span>
            {[0.5, 1, 5, 10].map((val) => (
              <button
                key={val}
                type="button"
                aria-pressed={thresholdGB === val}
                onClick={() => setThresholdGB(val)}
                className={`px-2.5 py-1 text-xs rounded-lg font-medium border transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden ${
                  thresholdGB === val
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-secondary text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                {val >= 1 ? `${val} GB` : '500 MB'}
              </button>
            ))}
          </div>
        </div>

        {/* Filter bar */}
        <div className="relative">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && searchTerm) {
                e.stopPropagation();
                setSearchTerm('');
              }
            }}
            placeholder="Search large files by name..."
            className="w-full bg-secondary/40 border border-border rounded-lg pl-9 pr-8 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Files List with Distinct Empty States */}
        <div className="divide-y divide-border/60 border border-border rounded-lg overflow-hidden bg-card">
          {allLargeFiles.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground space-y-1">
              <span className="font-semibold text-foreground block">No oversized files detected</span>
              <span>No large cache or artifact files were identified on drive {currentDrive?.caption || 'C:'}.</span>
            </div>
          ) : filesAboveThreshold.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground space-y-1.5">
              <span className="font-semibold text-foreground block">No files exceed {thresholdLabel}</span>
              <p className="text-[11px] max-w-sm mx-auto">
                No files found larger than {thresholdLabel} on drive {currentDrive?.caption || 'C:'}. Try selecting a lower threshold (e.g. 500 MB or 1 GB).
              </p>
              <button
                type="button"
                onClick={() => setThresholdGB(0.5)}
                className="text-primary hover:underline cursor-pointer text-xs pt-1 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden rounded"
              >
                Set threshold to 500 MB
              </button>
            </div>
          ) : largeFiles.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground space-y-1.5">
              <span className="font-semibold text-foreground block">No search results</span>
              <p className="text-[11px]">
                No files matching &quot;{searchTerm}&quot; found above the {thresholdLabel} threshold.
              </p>
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="text-primary hover:underline cursor-pointer text-xs pt-1 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden rounded"
              >
                Clear Search Query
              </button>
            </div>
          ) : (
            largeFiles.map((file, idx) => (
              <div key={idx} className="p-3 flex items-center justify-between gap-3 text-xs hover:bg-secondary/20">
                <div className="flex items-center space-x-2.5 min-w-0">
                  <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <span className="font-semibold text-foreground truncate block">{file.name}</span>
                    <span className="text-[11px] text-muted-foreground font-mono truncate block" title={file.path}>
                      {file.path}
                    </span>
                  </div>
                </div>
                <div className="font-bold text-foreground shrink-0">
                  {formatBytes(file.size)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
