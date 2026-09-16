import { contextBridge, ipcRenderer } from 'electron';
export const cleanerApi = {
    // Window controls
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    // Drive & Environment Discovery
    getDrives: () => ipcRenderer.invoke('disk:get-drives'),
    getEnvironments: () => ipcRenderer.invoke('env:get-detected'),
    getRules: () => ipcRenderer.invoke('rules:get-all'),
    // Scan lifecycle
    startScan: (payload) => ipcRenderer.invoke('scan:start', payload || {}),
    cancelScan: (scanSessionId) => ipcRenderer.invoke('scan:cancel', { scanSessionId }),
    onScanProgress: (callback) => {
        const listener = (_event, progress) => callback(progress);
        ipcRenderer.on('scan:progress', listener);
        return () => ipcRenderer.removeListener('scan:progress', listener);
    },
    // Cleanup execution (Zero arbitrary paths! Rule ID + Session ID + Item IDs)
    executeCleanup: (payload) => ipcRenderer.invoke('cleanup:execute', payload),
    // Protected paths
    getProtectedPaths: () => ipcRenderer.invoke('protected-paths:get'),
    addProtectedPath: (pathStr) => ipcRenderer.invoke('protected-paths:add', { path: pathStr }),
    removeProtectedPath: (pathStr) => ipcRenderer.invoke('protected-paths:remove', { path: pathStr }),
    // History
    getHistory: () => ipcRenderer.invoke('history:get')
};
contextBridge.exposeInMainWorld('cleaner', cleanerApi);
