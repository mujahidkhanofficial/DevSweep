import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { ProtectedPathService, SessionManager, SafetyEngine, CleanupExecutor, DiskService, EnvironmentDetector, DirectoryScanner } from '@cleaner/safety-engine';
import { RuleRegistry } from '@cleaner/cleanup-rules';
import { StartScanRequestSchema, CancelScanRequestSchema, ExecuteCleanupRequestSchema, AddProtectedPathSchema, RemoveProtectedPathSchema } from '@cleaner/shared';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Persistence directory in %APPDATA%/developer-disk-cleaner
const appDataDir = path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Roaming'), 'developer-disk-cleaner');
if (!fs.existsSync(appDataDir)) {
    fs.mkdirSync(appDataDir, { recursive: true });
}
const configPath = path.join(appDataDir, 'config.json');
const historyPath = path.join(appDataDir, 'history.json');
// Load stored settings and history
function loadConfig() {
    try {
        if (fs.existsSync(configPath)) {
            return JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
    }
    catch { }
    return { userProtectedPaths: [] };
}
function saveConfig(config) {
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    }
    catch { }
}
function loadHistory() {
    try {
        if (fs.existsSync(historyPath)) {
            return JSON.parse(fs.readFileSync(historyPath, 'utf8'));
        }
    }
    catch { }
    return [];
}
function saveHistory(history) {
    try {
        fs.writeFileSync(historyPath, JSON.stringify(history.slice(-50), null, 2), 'utf8');
    }
    catch { }
}
const config = loadConfig();
const historyList = loadHistory();
// Initialize Services
const protectedService = new ProtectedPathService(config.userProtectedPaths);
const sessionManager = new SessionManager();
const safetyEngine = new SafetyEngine(protectedService, sessionManager);
const cleanupExecutor = new CleanupExecutor(safetyEngine);
const ruleRegistry = new RuleRegistry();
const directoryScanner = new DirectoryScanner(protectedService);
let mainWindow = null;
let activeScanAbortController = null;
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 1000,
        minHeight: 650,
        frame: false, // Custom accessible Windows desktop titlebar
        backgroundColor: '#090d16',
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });
    // Block opening arbitrary new windows
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    }
    else {
        mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
    }
}
app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        app.quit();
});
// Window controls
ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
        mainWindow.unmaximize();
    }
    else {
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
    return rules.map((r) => ({
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
    // Cancel any existing running scan
    if (activeScanAbortController) {
        activeScanAbortController.abort();
    }
    activeScanAbortController = new AbortController();
    const session = sessionManager.createSession();
    const rules = ruleRegistry.getAllRules();
    const allScannedItems = [];
    for (const rule of rules) {
        if (activeScanAbortController.signal.aborted)
            break;
        const targetRoots = await rule.resolveTargets();
        for (const target of targetRoots) {
            if (!target.exists || activeScanAbortController.signal.aborted)
                continue;
            const items = await directoryScanner.scanTarget({
                scanSessionId: session.id,
                rule,
                targetRoot: target.canonicalPath,
                abortSignal: activeScanAbortController.signal,
                onProgress: (progress) => {
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
    if (!mainWindow?.isDestroyed()) {
        mainWindow?.webContents.send('scan:progress', {
            scanSessionId: session.id,
            status: isCancelled ? 'CANCELLED' : 'COMPLETED',
            scannedFiles: allScannedItems.reduce((acc, it) => acc + it.fileCount, 0),
            scannedBytes: allScannedItems.reduce((acc, it) => acc + it.size, 0),
            estimatedReclaimableBytes: allScannedItems.reduce((acc, it) => acc + it.size, 0)
        });
    }
    return {
        scanSessionId: session.id,
        isCancelled,
        items: allScannedItems
    };
});
ipcMain.handle('scan:cancel', async (event, rawPayload) => {
    const parseResult = CancelScanRequestSchema.safeParse(rawPayload);
    if (!parseResult.success)
        return false;
    if (activeScanAbortController) {
        activeScanAbortController.abort();
    }
    return sessionManager.cancelSession(parseResult.data.scanSessionId);
});
// Cleanup handler
ipcMain.handle('cleanup:execute', async (event, rawPayload) => {
    const parseResult = ExecuteCleanupRequestSchema.safeParse(rawPayload);
    if (!parseResult.success) {
        throw new Error(`Invalid cleanup payload: ${parseResult.error.message}`);
    }
    const { scanSessionId, ruleId, selectedItemIds, dryRun } = parseResult.data;
    const rule = ruleRegistry.getRule(ruleId);
    if (!rule) {
        throw new Error(`Unknown cleanup rule: "${ruleId}"`);
    }
    const targets = await rule.resolveTargets();
    const ruleRoot = targets.length > 0 ? targets[0].canonicalPath : '';
    const tx = await cleanupExecutor.execute({
        scanSessionId,
        ruleId,
        selectedItemIds,
        ruleRoot,
        dryRun
    });
    if (!dryRun) {
        historyList.push(tx);
        saveHistory(historyList);
    }
    return tx;
});
// Protected paths management
ipcMain.handle('protected-paths:get', async () => {
    return protectedService.getUserProtectedPaths();
});
ipcMain.handle('protected-paths:add', async (event, rawPayload) => {
    const parseResult = AddProtectedPathSchema.safeParse(rawPayload);
    if (!parseResult.success)
        throw new Error('Invalid path payload');
    protectedService.addUserProtectedPath(parseResult.data.path);
    config.userProtectedPaths = protectedService.getUserProtectedPaths();
    saveConfig(config);
    return config.userProtectedPaths;
});
ipcMain.handle('protected-paths:remove', async (event, rawPayload) => {
    const parseResult = RemoveProtectedPathSchema.safeParse(rawPayload);
    if (!parseResult.success)
        throw new Error('Invalid path payload');
    protectedService.removeUserProtectedPath(parseResult.data.path);
    config.userProtectedPaths = protectedService.getUserProtectedPaths();
    saveConfig(config);
    return config.userProtectedPaths;
});
ipcMain.handle('history:get', async () => {
    return historyList;
});
