import { app, BrowserWindow, ipcMain, shell, dialog, Notification } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import {
  ProtectedPathService,
  SessionManager,
  SafetyEngine,
  CleanupExecutor,
  DiskService,
  EnvironmentDetector,
  DirectoryScanner,
  PauseController
} from '@cleaner/safety-engine';
import { RuleRegistry } from '@cleaner/cleanup-rules';
import {
  StartScanRequestSchema,
  CancelScanRequestSchema,
  ExecuteCleanupRequestSchema,
  AddProtectedPathSchema,
  RemoveProtectedPathSchema,
  CleanupTransaction,
  ScannedItem,
  formatScanNotification,
  formatCleanupNotification,
  NativeNotificationPayload,
  HistoryRetentionConfig,
  DEFAULT_RETENTION_CONFIG,
  validateRetentionConfig,
  pruneHistoryRecords,
  createThrottledProgressEmitter,
  PROGRESS_UPDATE_INTERVAL_MS
} from '@cleaner/shared';
import { perf } from './perf.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// User data and storage directory: %APPDATA%/DevSweep
const baseAppData = process.env.APPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Roaming');
const appDataDir = path.join(baseAppData, 'DevSweep');
const legacyAppDataDir = path.join(baseAppData, 'developer-disk-cleaner');

const configPath = path.join(appDataDir, 'config.json');
const historyPath = path.join(appDataDir, 'history.json');

interface AppConfig {
  userProtectedPaths: string[];
  historyRetention?: HistoryRetentionConfig;
}

// --------------------------------------------------------------------------
// Storage Readiness & Failure-Isolated Migration
// --------------------------------------------------------------------------
let storageReadyPromise: Promise<void> | null = null;

function ensureStorageReady(): Promise<void> {
  if (!storageReadyPromise) {
    storageReadyPromise = (async () => {
      try {
        await fs.promises.mkdir(appDataDir, { recursive: true });
      } catch {}

      // One-time safe historical migration from legacy storage directory ('developer-disk-cleaner')
      try {
        const legacyExists = await fs.promises.stat(legacyAppDataDir).then(() => true).catch(() => false);
        if (legacyExists) {
          const legacyHistory = path.join(legacyAppDataDir, 'history.json');
          const targetHistory = path.join(appDataDir, 'history.json');
          const [hasLegacyHist, hasTargetHist] = await Promise.all([
            fs.promises.stat(legacyHistory).then(() => true).catch(() => false),
            fs.promises.stat(targetHistory).then(() => true).catch(() => false)
          ]);
          if (hasLegacyHist && !hasTargetHist) {
            try {
              const raw = await fs.promises.readFile(legacyHistory, 'utf8');
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed)) {
                await fs.promises.copyFile(legacyHistory, targetHistory);
                console.log('[DevSweep] Migrated historical transactions from legacy storage to DevSweep');
              }
            } catch (migErr) {
              console.error('[DevSweep] Legacy history migration skipped due to format:', migErr);
            }
          }

          const legacyConfig = path.join(legacyAppDataDir, 'config.json');
          const targetConfig = path.join(appDataDir, 'config.json');
          const [hasLegacyCfg, hasTargetCfg] = await Promise.all([
            fs.promises.stat(legacyConfig).then(() => true).catch(() => false),
            fs.promises.stat(targetConfig).then(() => true).catch(() => false)
          ]);
          if (hasLegacyCfg && !hasTargetCfg) {
            try {
              const raw = await fs.promises.readFile(legacyConfig, 'utf8');
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed === 'object') {
                await fs.promises.copyFile(legacyConfig, targetConfig);
                console.log('[DevSweep] Migrated user settings from legacy storage to DevSweep');
              }
            } catch (migErr) {
              console.error('[DevSweep] Legacy config migration skipped due to format:', migErr);
            }
          }
        }
      } catch (err) {
        console.error('[DevSweep] Storage preparation error:', err);
      }
    })();
  }
  return storageReadyPromise;
}

// --------------------------------------------------------------------------
// Asynchronous, Cached Config & History Hydration
// --------------------------------------------------------------------------
let configCache: AppConfig | null = null;
let configPromise: Promise<AppConfig> | null = null;

async function getConfig(): Promise<AppConfig> {
  if (configCache) return configCache;
  if (!configPromise) {
    configPromise = (async () => {
      await ensureStorageReady();
      try {
        const raw = await fs.promises.readFile(configPath, 'utf8');
        const parsed = JSON.parse(raw);
        const protectedPaths = Array.isArray(parsed?.userProtectedPaths) ? parsed.userProtectedPaths : [];
        let retention = DEFAULT_RETENTION_CONFIG;
        if (parsed?.historyRetention) {
          const validation = validateRetentionConfig(parsed.historyRetention);
          if (validation.valid && validation.config) {
            retention = validation.config;
          }
        }
        configCache = {
          userProtectedPaths: protectedPaths,
          historyRetention: retention
        };
      } catch {
        configCache = { userProtectedPaths: [], historyRetention: DEFAULT_RETENTION_CONFIG };
      }
      return configCache;
    })();
  }
  return configPromise;
}

async function saveConfig(cfg: AppConfig): Promise<void> {
  configCache = cfg;
  await ensureStorageReady();
  try {
    await fs.promises.writeFile(configPath, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (err) {
    console.error('[DevSweep] Failed to save config:', err);
  }
}

let historyCache: CleanupTransaction[] | null = null;
let historyPromise: Promise<CleanupTransaction[]> | null = null;

async function getHistoryList(): Promise<CleanupTransaction[]> {
  if (historyCache !== null) return historyCache;
  if (!historyPromise) {
    historyPromise = (async () => {
      await ensureStorageReady();
      try {
        const raw = await fs.promises.readFile(historyPath, 'utf8');
        const parsed = JSON.parse(raw);
        historyCache = Array.isArray(parsed) ? parsed : [];
      } catch {
        historyCache = [];
      }
      return historyCache;
    })();
  }
  return historyPromise;
}

async function saveHistory(history: CleanupTransaction[]): Promise<void> {
  historyCache = history;
  await ensureStorageReady();
  const cfg = await getConfig();
  const retentionConfig = cfg.historyRetention || DEFAULT_RETENTION_CONFIG;
  let toPersist = history;

  if (retentionConfig.autoPruneOnSave) {
    const { prunedHistory } = pruneHistoryRecords(history, {
      maxRecords: retentionConfig.maxRecords,
      maxAgeDays: retentionConfig.maxAgeDays
    });
    toPersist = prunedHistory;
    historyCache.length = 0;
    historyCache.push(...toPersist);
  }

  const tempPath = `${historyPath}.tmp.${Date.now()}`;
  try {
    await fs.promises.writeFile(tempPath, JSON.stringify(toPersist, null, 2), 'utf8');
    await fs.promises.rename(tempPath, historyPath);
  } catch {
    try {
      await fs.promises.writeFile(historyPath, JSON.stringify(toPersist, null, 2), 'utf8');
    } catch {}
  }
}

// --------------------------------------------------------------------------
// Services Initialization
// --------------------------------------------------------------------------
const protectedService = new ProtectedPathService([]);
const sessionManager = new SessionManager();
const safetyEngine = new SafetyEngine(protectedService, sessionManager);
const ruleRegistry = new RuleRegistry();
const cleanupExecutor = new CleanupExecutor(safetyEngine, ruleRegistry);
const directoryScanner = new DirectoryScanner(protectedService);

async function syncProtectedPathsFromConfig(): Promise<void> {
  const cfg = await getConfig();
  for (const p of cfg.userProtectedPaths) {
    protectedService.addUserProtectedPath(p);
  }
}

let mainWindow: BrowserWindow | null = null;
let activeScanAbortController: AbortController | null = null;
let activePauseController: PauseController = new PauseController();
let activeCleanupAbortController: AbortController | null = null;
let activeCleanupPauseController: PauseController = new PauseController();
let isCleanupActive = false;

function createWindow() {
  app.setName('DevSweep');

  // Resolve application icon across development and packaged builds
  const appRoot = app.getAppPath();
  const iconCandidates = [
    path.join(appRoot, 'build/icon.ico'),
    path.join(__dirname, '../../build/icon.ico'),
    path.join(appRoot, 'public/icon.png'),
    path.join(__dirname, '../../public/icon.png'),
    path.join(appRoot, 'dist/icon.png')
  ];
  const resolvedIcon = iconCandidates.find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });

  mainWindow = new BrowserWindow({
    title: 'DevSweep',
    icon: resolvedIcon,
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 650,
    frame: false, // Custom accessible Windows desktop titlebar
    backgroundColor: '#090d16',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  perf.mark('window-created');

  // Block opening arbitrary new windows
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

function shouldNotify(targetWindow: BrowserWindow | null): boolean {
  if (!targetWindow || targetWindow.isDestroyed()) return false;
  return !targetWindow.isFocused() || targetWindow.isMinimized();
}

function dispatchNativeNotification(payload: NativeNotificationPayload) {
  if (!shouldNotify(mainWindow)) return;
  if (!Notification.isSupported()) return;

  try {
    const notification = new Notification({
      title: payload.title,
      body: payload.body,
      silent: payload.silent ?? false,
      urgency: payload.urgency ?? 'normal'
    });

    notification.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });

    notification.show();
  } catch (err) {
    console.error('[DevSweep] Failed to display native notification:', err);
  }
}

app.whenReady().then(() => {
  perf.mark('app-ready');

  if (process.platform === 'win32') {
    app.setAppUserModelId('com.devsweep.app');
  }

  createWindow();

  // Non-blocking async background hydration: prepare storage, cache config and history
  ensureStorageReady()
    .then(() => {
      getConfig().then(() => syncProtectedPathsFromConfig());
      getHistoryList();
    })
    .catch((err) => {
      console.error('[DevSweep] Background hydration error:', err);
    });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Window controls
ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.handle('window:close', () => mainWindow?.close());

// System & Disk info
ipcMain.handle('disk:get-drives', async () => {
  return DiskService.getAllDrives();
});

ipcMain.handle('env:get-detected', async () => {
  return EnvironmentDetector.detectAll();
});

ipcMain.handle('rules:get-all', async () => {
  const rules = ruleRegistry.getAllRules();
  return rules.map((r: any) => ({
    id: r.id,
    version: r.version,
    name: r.name,
    category: r.category,
    safetyLevel: r.safetyLevel,
    defaultSelection: r.defaultSelection,
    requiresElevation: r.requiresElevation,
    rebuildCost: r.rebuildCost,
    networkRequiredToRebuild: r.networkRequiredToRebuild,
    warning: r.warning,
    explanation: r.explain()
  }));
});

// Scan handler
ipcMain.handle('scan:start', async (event, rawPayload) => {
  const parseResult = StartScanRequestSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    throw new Error(`Invalid scan payload: ${parseResult.error.message}`);
  }

  // Ensure user protected paths are synced before scan starts
  await syncProtectedPathsFromConfig();

  // Cancel and unpause any existing running scan
  if (activeScanAbortController) {
    activePauseController.resume();
    activeScanAbortController.abort();
  }
  activeScanAbortController = new AbortController();
  activePauseController = new PauseController();
  const session = sessionManager.createSession();

  const rules = ruleRegistry.getAllRules();
  const allScannedItems: ScannedItem[] = [];
  const totalRules = rules.length;

  const progressEmitter = createThrottledProgressEmitter<any>((progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scan:progress', progress);
    }
  });

  for (let ruleIdx = 0; ruleIdx < totalRules; ruleIdx++) {
    const rule = rules[ruleIdx];
    if (activeScanAbortController.signal.aborted) break;

    const targetRoots = await rule.resolveTargets();
    for (const target of targetRoots) {
      if (!target.exists || activeScanAbortController.signal.aborted) continue;

      const items = await directoryScanner.scanTarget({
        scanSessionId: session.id,
        rule,
        targetRoot: target.canonicalPath,
        ruleIndex: ruleIdx + 1,
        totalRules,
        abortSignal: activeScanAbortController.signal,
        pauseController: activePauseController,
        onProgress: (progress: any) => {
          if (progress.status === 'PAUSED' || progress.status === 'CANCELLED') {
            progressEmitter.sendTerminal(progress);
          } else {
            progressEmitter.sendProgress(progress);
          }
        }
      });

      for (const item of items) {
        sessionManager.registerItem(session.id, item);
        allScannedItems.push(item);
      }
    }
  }

  const isCancelled = activeScanAbortController.signal.aborted;
  const totalScannedBytes = allScannedItems.reduce((acc, it) => acc + it.size, 0);

  // Guaranteed terminal delivery superseding any pending throttled progress
  progressEmitter.sendTerminal({
    scanSessionId: session.id,
    status: isCancelled ? 'CANCELLED' : 'COMPLETED',
    currentRuleIndex: totalRules,
    totalRules,
    scannedFiles: allScannedItems.reduce((acc, it) => acc + it.fileCount, 0),
    scannedBytes: totalScannedBytes,
    estimatedReclaimableBytes: totalScannedBytes,
    filesPerSecond: 0,
    bytesPerSecond: 0,
    elapsedTimeMs: 0,
    estimatedRemainingTimeMs: 0
  });

  // Dispatch completion notification respecting background state
  dispatchNativeNotification(
    formatScanNotification(allScannedItems.length, totalScannedBytes, isCancelled)
  );

  return {
    scanSessionId: session.id,
    isCancelled,
    items: allScannedItems
  };
});

ipcMain.handle('scan:pause', async () => {
  activePauseController.pause();
  return true;
});

ipcMain.handle('scan:resume', async () => {
  activePauseController.resume();
  return true;
});

ipcMain.handle('scan:cancel', async (event, rawPayload) => {
  const parseResult = CancelScanRequestSchema.safeParse(rawPayload);
  if (!parseResult.success) return false;

  activePauseController.resume();
  if (activeScanAbortController) {
    activeScanAbortController.abort();
  }
  return sessionManager.cancelSession(parseResult.data.scanSessionId);
});

// Shell reveal in explorer
ipcMain.handle('shell:reveal', async (event, itemPath) => {
  if (typeof itemPath === 'string') {
    try {
      const exists = await fs.promises.stat(itemPath).then(() => true).catch(() => false);
      if (exists) {
        shell.showItemInFolder(itemPath);
        return true;
      }
    } catch {}
  }
  return false;
});

// Shell native folder picker dialog
ipcMain.handle('shell:browse-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Directory to Protect',
    properties: ['openDirectory', 'dontAddToRecent']
  });
  if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// Inline directory validation
ipcMain.handle('path:validate', async (event, pathStr: string) => {
  if (typeof pathStr !== 'string' || !pathStr.trim()) {
    return { valid: false, exists: false, isDirectory: false, message: 'Path is empty' };
  }
  const trimmed = pathStr.trim();
  if (!path.isAbsolute(trimmed)) {
    return { valid: false, exists: false, isDirectory: false, message: 'Path must be an absolute Windows path (e.g. C:\\Projects)' };
  }
  try {
    const stat = await fs.promises.stat(trimmed);
    if (!stat.isDirectory()) {
      return { valid: false, exists: true, isDirectory: false, message: 'Path is a file, not a directory' };
    }
    return { valid: true, exists: true, isDirectory: true, message: 'Valid existing directory' };
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return { valid: false, exists: false, isDirectory: false, message: 'Directory does not exist' };
    }
    if (err?.code === 'EACCES' || err?.code === 'EPERM') {
      return { valid: false, exists: true, isDirectory: false, message: 'Access denied by Windows security policy' };
    }
    return { valid: false, exists: false, isDirectory: false, message: err?.message || 'Invalid path' };
  }
});

// Cleanup handlers
ipcMain.handle('cleanup:execute', async (event, rawPayload) => {
  const parseResult = ExecuteCleanupRequestSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    throw new Error(`Invalid cleanup payload: ${parseResult.error.message}`);
  }

  const { scanSessionId, ruleId, selectedItemIds, dryRun } = parseResult.data;

  // Cancel and unpause any prior running cleanup
  if (activeCleanupAbortController) {
    activeCleanupPauseController.resume();
    activeCleanupAbortController.abort();
  }
  activeCleanupAbortController = new AbortController();
  activeCleanupPauseController = new PauseController();

  let ruleRoot: string | undefined = undefined;
  if (ruleId) {
    const rule = ruleRegistry.getRule(ruleId);
    if (rule) {
      const targets = await rule.resolveTargets();
      ruleRoot = targets.length > 0 ? targets[0].canonicalPath : '';
    }
  }

  const cleanupEmitter = createThrottledProgressEmitter<any>((prog) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cleanup:progress', prog);
    }
  });

  isCleanupActive = true;
  try {
    const tx = await cleanupExecutor.execute({
      scanSessionId,
      ruleId,
      selectedItemIds,
      ruleRoot,
      dryRun,
      abortSignal: activeCleanupAbortController.signal,
      pauseController: activeCleanupPauseController,
      onProgress: (prog) => {
        if (prog.status === 'COMPLETED' || prog.status === 'CANCELLED' || prog.status === 'FAILED') {
          cleanupEmitter.sendTerminal(prog);
        } else {
          cleanupEmitter.sendProgress(prog);
        }
      }
    });

    cleanupEmitter.flush();

    if (!dryRun) {
      // Enrich transaction with item-level audit metadata directly from sessionManager
      const itemAuditList: any[] = [];
      const skippedMap = new Map<string, { reason: string; errorCode?: string }>();
      for (const s of tx.skippedDetails) {
        skippedMap.set(s.path.toLowerCase().replace(/\\/g, '/'), s);
      }

      for (const itemId of selectedItemIds) {
        const candidate = sessionManager.getItem(scanSessionId, itemId);
        if (!candidate) continue;

        const normPath = candidate.path.toLowerCase().replace(/\\/g, '/');
        let skippedInfo = skippedMap.get(normPath) || skippedMap.get(candidate.id);
        if (!skippedInfo) {
          for (const [sNorm, sVal] of skippedMap.entries()) {
            if (sNorm.startsWith(normPath + '/')) {
              skippedInfo = sVal;
              break;
            }
          }
        }

        let itemResult: 'SUCCESS' | 'SKIPPED' | 'FAILED' | 'CANCELLED';
        let failureReason = '';

        if (tx.status === 'CANCELLED') {
          itemResult = 'CANCELLED';
          failureReason = 'Cancelled by user';
        } else if (skippedInfo) {
          itemResult = tx.status === 'FAILED' ? 'FAILED' : 'SKIPPED';
          failureReason = skippedInfo.reason + (skippedInfo.errorCode ? ` (${skippedInfo.errorCode})` : '');
        } else {
          itemResult = 'SUCCESS';
        }

        itemAuditList.push({
          path: candidate.path,
          sizeBytes: candidate.size,
          result: itemResult,
          failureReason,
          toolchainId: candidate.toolchainId,
          safetyLevel: candidate.safetyLevel,
          ruleId: candidate.ruleId
        });
      }

      if (itemAuditList.length > 0) {
        tx.items = itemAuditList;
        tx.toolchainId = itemAuditList[0].toolchainId;
        tx.safetyLevel = itemAuditList[0].safetyLevel;
      }

      const historyList = await getHistoryList();
      historyList.push(tx);
      await saveHistory(historyList);
    }

    // Dispatch completion notification respecting background state
    dispatchNativeNotification(
      formatCleanupNotification(tx, Boolean(dryRun))
    );

    return tx;
  } finally {
    isCleanupActive = false;
  }
});

ipcMain.handle('cleanup:pause', async () => {
  activeCleanupPauseController.pause();
  return true;
});

ipcMain.handle('cleanup:resume', async () => {
  activeCleanupPauseController.resume();
  return true;
});

ipcMain.handle('cleanup:cancel', async () => {
  activeCleanupPauseController.resume();
  if (activeCleanupAbortController) {
    activeCleanupAbortController.abort();
  }
  return true;
});

// Protected paths management
ipcMain.handle('protected-paths:get', async () => {
  await syncProtectedPathsFromConfig();
  return protectedService.getUserProtectedPaths();
});

ipcMain.handle('protected-paths:add', async (event, rawPayload) => {
  const parseResult = AddProtectedPathSchema.safeParse(rawPayload);
  if (!parseResult.success) throw new Error('Invalid path payload');

  const cfg = await getConfig();
  protectedService.addUserProtectedPath(parseResult.data.path);
  cfg.userProtectedPaths = protectedService.getUserProtectedPaths();
  await saveConfig(cfg);
  return cfg.userProtectedPaths;
});

ipcMain.handle('protected-paths:remove', async (event, rawPayload) => {
  const parseResult = RemoveProtectedPathSchema.safeParse(rawPayload);
  if (!parseResult.success) throw new Error('Invalid path payload');

  const cfg = await getConfig();
  protectedService.removeUserProtectedPath(parseResult.data.path);
  cfg.userProtectedPaths = protectedService.getUserProtectedPaths();
  await saveConfig(cfg);
  return cfg.userProtectedPaths;
});

ipcMain.handle('history:get', async () => {
  return getHistoryList();
});

ipcMain.handle('history:export-file', async (event, payload) => {
  if (!mainWindow) return { canceled: true };
  if (!payload || (payload.format !== 'json' && payload.format !== 'csv')) {
    return { success: false, error: 'Invalid export format requested' };
  }
  if (typeof payload.content !== 'string') {
    return { success: false, error: 'Export content must be a string' };
  }
  const format: 'json' | 'csv' = payload.format;
  const ext = format === 'csv' ? 'csv' : 'json';
  const filterDesc = format === 'csv' ? 'CSV Files (*.csv)' : 'JSON Files (*.json)';
  const dateStr = new Date().toISOString().split('T')[0];
  const defaultFilename = `DevSweep-Audit-${dateStr}.${ext}`;

  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: `Export DevSweep Audit History (${format.toUpperCase()})`,
      defaultPath: defaultFilename,
      filters: [{ name: filterDesc, extensions: [ext] }]
    });

    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }

    await fs.promises.writeFile(result.filePath, payload.content, 'utf8');
    return { success: true, filePath: result.filePath };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Could not export audit history' };
  }
});

// History retention management
ipcMain.handle('history:get-retention-config', async () => {
  const cfg = await getConfig();
  return cfg.historyRetention || DEFAULT_RETENTION_CONFIG;
});

ipcMain.handle('history:save-retention-config', async (event, payload) => {
  const validation = validateRetentionConfig(payload);
  if (!validation.valid || !validation.config) {
    return { success: false, error: validation.error || 'Invalid retention configuration' };
  }
  const cfg = await getConfig();
  cfg.historyRetention = validation.config;
  await saveConfig(cfg);
  return { success: true, config: cfg.historyRetention };
});

ipcMain.handle('history:prune', async () => {
  if (isCleanupActive) {
    return { success: false, error: 'Cannot prune history while a cleanup is in progress' };
  }
  const historyList = await getHistoryList();
  const cfg = await getConfig();
  const retention = cfg.historyRetention || DEFAULT_RETENTION_CONFIG;
  const { prunedHistory, prunedCount } = pruneHistoryRecords(historyList, {
    maxRecords: retention.maxRecords,
    maxAgeDays: retention.maxAgeDays
  });
  historyList.length = 0;
  historyList.push(...prunedHistory);
  await saveHistory(historyList);
  return { success: true, prunedCount, remainingCount: historyList.length };
});

ipcMain.handle('history:clear', async () => {
  if (isCleanupActive) {
    return { success: false, error: 'Cannot clear history while a cleanup is in progress' };
  }
  const historyList = await getHistoryList();
  const clearedCount = historyList.length;
  historyList.length = 0;
  await saveHistory(historyList);
  return { success: true, clearedCount };
});
