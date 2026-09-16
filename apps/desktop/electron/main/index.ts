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
  shouldSendNotification,
  NativeNotificationPayload,
  HistoryRetentionConfig,
  DEFAULT_RETENTION_CONFIG,
  validateRetentionConfig,
  pruneHistoryRecords
} from '@cleaner/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// User data and storage directory: %APPDATA%/DevSweep
const baseAppData = process.env.APPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Roaming');
const appDataDir = path.join(baseAppData, 'DevSweep');
const legacyAppDataDir = path.join(baseAppData, 'developer-disk-cleaner');

if (!fs.existsSync(appDataDir)) {
  fs.mkdirSync(appDataDir, { recursive: true });
}

// One-time safe historical migration from legacy storage directory
if (fs.existsSync(legacyAppDataDir)) {
  const legacyHistory = path.join(legacyAppDataDir, 'history.json');
  const targetHistory = path.join(appDataDir, 'history.json');
  if (fs.existsSync(legacyHistory) && !fs.existsSync(targetHistory)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(legacyHistory, 'utf8'));
      if (Array.isArray(parsed)) {
        fs.copyFileSync(legacyHistory, targetHistory);
        console.log('[DevSweep] Migrated historical transactions from legacy storage to DevSweep');
      }
    } catch (migErr) {
      console.error('[DevSweep] Legacy history migration skipped due to format:', migErr);
    }
  }

  const legacyConfig = path.join(legacyAppDataDir, 'config.json');
  const targetConfig = path.join(appDataDir, 'config.json');
  if (fs.existsSync(legacyConfig) && !fs.existsSync(targetConfig)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(legacyConfig, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        fs.copyFileSync(legacyConfig, targetConfig);
        console.log('[DevSweep] Migrated user settings from legacy storage to DevSweep');
      }
    } catch (migErr) {
      console.error('[DevSweep] Legacy config migration skipped due to format:', migErr);
    }
  }
}

const configPath = path.join(appDataDir, 'config.json');
const historyPath = path.join(appDataDir, 'history.json');

interface AppConfig {
  userProtectedPaths: string[];
  historyRetention?: HistoryRetentionConfig;
}

// Load stored settings and history
function loadConfig(): AppConfig {
  try {
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const protectedPaths = Array.isArray(parsed?.userProtectedPaths) ? parsed.userProtectedPaths : [];
      let retention = DEFAULT_RETENTION_CONFIG;
      if (parsed?.historyRetention) {
        const validation = validateRetentionConfig(parsed.historyRetention);
        if (validation.valid && validation.config) {
          retention = validation.config;
        }
      }
      return {
        userProtectedPaths: protectedPaths,
        historyRetention: retention
      };
    }
  } catch {}
  return { userProtectedPaths: [], historyRetention: DEFAULT_RETENTION_CONFIG };
}

function saveConfig(cfg: AppConfig) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
  } catch {}
}

function loadHistory(): CleanupTransaction[] {
  try {
    if (fs.existsSync(historyPath)) {
      return JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    }
  } catch {}
  return [];
}

async function saveHistory(history: CleanupTransaction[]) {
  try {
    const retentionConfig = config.historyRetention || DEFAULT_RETENTION_CONFIG;
    let toPersist = history;
    if (retentionConfig.autoPruneOnSave) {
      const { prunedHistory } = pruneHistoryRecords(history, {
        maxRecords: retentionConfig.maxRecords,
        maxAgeDays: retentionConfig.maxAgeDays
      });
      toPersist = prunedHistory;
      // Synchronize in-memory historyList with pruned list
      historyList.length = 0;
      historyList.push(...toPersist);
    }
    const tempPath = `${historyPath}.tmp.${Date.now()}`;
    await fs.promises.writeFile(tempPath, JSON.stringify(toPersist, null, 2), 'utf8');
    await fs.promises.rename(tempPath, historyPath);
  } catch {
    try {
      fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf8');
    } catch {}
  }
}

const config = loadConfig();
const historyList = loadHistory();

// Initialize Services
const protectedService = new ProtectedPathService(config.userProtectedPaths);
const sessionManager = new SessionManager();
const safetyEngine = new SafetyEngine(protectedService, sessionManager);
const ruleRegistry = new RuleRegistry();
const cleanupExecutor = new CleanupExecutor(safetyEngine, ruleRegistry);
const directoryScanner = new DirectoryScanner(protectedService);

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
  const resolvedIcon = iconCandidates.find((p) => fs.existsSync(p));

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
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.devsweep.app');
  }

  createWindow();

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
          if (!mainWindow?.isDestroyed()) {
            mainWindow?.webContents.send('scan:progress', progress);
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

  if (!mainWindow?.isDestroyed()) {
    mainWindow?.webContents.send('scan:progress', {
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
  }

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
  if (typeof itemPath === 'string' && fs.existsSync(itemPath)) {
    shell.showItemInFolder(itemPath);
    return true;
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
    if (!fs.existsSync(trimmed)) {
      return { valid: false, exists: false, isDirectory: false, message: 'Directory does not exist' };
    }
    const stat = await fs.promises.stat(trimmed);
    if (!stat.isDirectory()) {
      return { valid: false, exists: true, isDirectory: false, message: 'Path is a file, not a directory' };
    }
    return { valid: true, exists: true, isDirectory: true, message: 'Valid existing directory' };
  } catch (err: any) {
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
        if (!mainWindow?.isDestroyed()) {
          mainWindow?.webContents.send('cleanup:progress', prog);
        }
      }
    });

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
  return protectedService.getUserProtectedPaths();
});

ipcMain.handle('protected-paths:add', async (event, rawPayload) => {
  const parseResult = AddProtectedPathSchema.safeParse(rawPayload);
  if (!parseResult.success) throw new Error('Invalid path payload');

  protectedService.addUserProtectedPath(parseResult.data.path);
  config.userProtectedPaths = protectedService.getUserProtectedPaths();
  saveConfig(config);
  return config.userProtectedPaths;
});

ipcMain.handle('protected-paths:remove', async (event, rawPayload) => {
  const parseResult = RemoveProtectedPathSchema.safeParse(rawPayload);
  if (!parseResult.success) throw new Error('Invalid path payload');

  protectedService.removeUserProtectedPath(parseResult.data.path);
  config.userProtectedPaths = protectedService.getUserProtectedPaths();
  saveConfig(config);
  return config.userProtectedPaths;
});

ipcMain.handle('history:get', async () => {
  return historyList;
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
  return config.historyRetention || DEFAULT_RETENTION_CONFIG;
});

ipcMain.handle('history:save-retention-config', async (event, payload) => {
  const validation = validateRetentionConfig(payload);
  if (!validation.valid || !validation.config) {
    return { success: false, error: validation.error || 'Invalid retention configuration' };
  }
  config.historyRetention = validation.config;
  saveConfig(config);
  // Invariant: Saving retention configuration does NOT trigger an automatic purge of existing history.
  return { success: true, config: config.historyRetention };
});

ipcMain.handle('history:prune', async () => {
  if (isCleanupActive) {
    return { success: false, error: 'Cannot prune history while a cleanup is in progress' };
  }
  const retention = config.historyRetention || DEFAULT_RETENTION_CONFIG;
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
  const clearedCount = historyList.length;
  historyList.length = 0;
  try {
    const tempPath = `${historyPath}.tmp.${Date.now()}`;
    await fs.promises.writeFile(tempPath, JSON.stringify([], null, 2), 'utf8');
    await fs.promises.rename(tempPath, historyPath);
  } catch {
    try {
      fs.writeFileSync(historyPath, JSON.stringify([], null, 2), 'utf8');
    } catch {}
  }
  return { success: true, clearedCount };
});
