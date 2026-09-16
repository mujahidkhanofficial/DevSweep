import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('DevSweep Brand Consistency & Product Identity Suite', () => {
  const rootDir = path.resolve(__dirname, '..');

  it('verifies package.json product identity', () => {
    const pkgPath = path.join(rootDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    expect(pkg.name).toBe('devsweep');
    expect(pkg.productName).toBe('DevSweep');
    expect(pkg.description).toContain('Developer-focused Windows disk cleanup & storage intelligence');
  });

  it('verifies electron-builder.json Windows installer metadata', () => {
    const builderPath = path.join(rootDir, 'electron-builder.json');
    const config = JSON.parse(fs.readFileSync(builderPath, 'utf8'));

    expect(config.appId).toBe('com.devsweep.app');
    expect(config.productName).toBe('DevSweep');
    expect(config.win?.executableName).toBe('DevSweep');
    expect(config.win?.artifactName).toContain('DevSweep');
    expect(config.nsis?.shortcutName).toBe('DevSweep');
    expect(config.nsis?.uninstallDisplayName).toBe('DevSweep');
  });

  it('verifies index.html window title contains DevSweep and no legacy strings', () => {
    const indexPath = path.join(rootDir, 'index.html');
    const html = fs.readFileSync(indexPath, 'utf8');

    expect(html).toContain('<title>DevSweep</title>');
    expect(html).not.toContain('Developer Disk Cleaner');
  });

  it('verifies desktop TitleBar branding', () => {
    const titleBarPath = path.join(rootDir, 'apps/desktop/src/components/layout/TitleBar.tsx');
    const content = fs.readFileSync(titleBarPath, 'utf8');

    expect(content).toContain('DevSweep');
    expect(content).not.toContain('Developer Disk Cleaner');
  });

  it('verifies settings view includes About DevSweep section', () => {
    const settingsPath = path.join(rootDir, 'apps/desktop/src/components/settings/SettingsView.tsx');
    const content = fs.readFileSync(settingsPath, 'utf8');

    expect(content).toContain('DevSweep');
    expect(content).toContain('Developer-focused Windows disk cleanup & storage intelligence');
  });

  it('verifies electron main process configures DevSweep app name and AppData storage', () => {
    const mainPath = path.join(rootDir, 'apps/desktop/electron/main/index.ts');
    const content = fs.readFileSync(mainPath, 'utf8');

    expect(content).toContain("app.setName('DevSweep')");
    expect(content).toContain("title: 'DevSweep'");
    expect(content).toContain("'DevSweep'");
    // Verifies legacy migration logic is present
    expect(content).toContain("developer-disk-cleaner");
  });

  it('verifies Priority 1 Cleanup UX elements (search, safety filters, sticky action bar, legend)', () => {
    const cleanupPath = path.join(rootDir, 'apps/desktop/src/components/cleanup/CleanupView.tsx');
    const content = fs.readFileSync(cleanupPath, 'utf8');

    expect(content).toContain('Search by name or path...');
    expect(content).toContain('Safe Only');
    expect(content).toContain('Rebuildable');
    expect(content).toContain('Review');
    expect(content).toContain('IndeterminateCheckbox');
    expect(content).toContain('Clean Selected Space');
    expect(content).toContain('SAFE:');
    expect(content).toContain('REBUILDABLE:');
    expect(content).toContain('REVIEW:');
  });

  it('verifies Priority 2 Native Folder Picker and path validation in Settings & Preload', () => {
    const settingsPath = path.join(rootDir, 'apps/desktop/src/components/settings/SettingsView.tsx');
    const settingsContent = fs.readFileSync(settingsPath, 'utf8');
    expect(settingsContent).toContain('Browse...');
    expect(settingsContent).toContain('Validating path...');
    expect(settingsContent).toContain('handleBrowseFolder');

    const preloadPath = path.join(rootDir, 'apps/desktop/electron/preload/index.ts');
    const preloadContent = fs.readFileSync(preloadPath, 'utf8');
    expect(preloadContent).toContain('browseFolder');
    expect(preloadContent).toContain('validatePath');

    const mainPath = path.join(rootDir, 'apps/desktop/electron/main/index.ts');
    const mainContent = fs.readFileSync(mainPath, 'utf8');
    expect(mainContent).toContain('shell:browse-folder');
    expect(mainContent).toContain('path:validate');
  });

  // --------------------------------------------------------------------------
  // Priority 4.8 — Windows Packaging, App Assets & Production Hardening
  // --------------------------------------------------------------------------
  it('verifies multi-resolution Windows ICO container and app image assets', () => {
    const icoPath = path.join(rootDir, 'build/icon.ico');
    const pngBuildPath = path.join(rootDir, 'build/icon.png');
    const pngPublicPath = path.join(rootDir, 'public/icon.png');

    expect(fs.existsSync(icoPath)).toBe(true);
    expect(fs.existsSync(pngBuildPath)).toBe(true);
    expect(fs.existsSync(pngPublicPath)).toBe(true);

    const icoBuf = fs.readFileSync(icoPath);
    expect(icoBuf.length).toBeGreaterThan(1000);

    // Verify ICO header: reserved (0), type (1 = icon)
    expect(icoBuf.readUInt16LE(0)).toBe(0);
    expect(icoBuf.readUInt16LE(2)).toBe(1);

    const iconCount = icoBuf.readUInt16LE(4);
    expect(iconCount).toBeGreaterThanOrEqual(5);

    // Read entries
    const resolutions: number[] = [];
    for (let i = 0; i < iconCount; i++) {
      const offset = 6 + i * 16;
      const w = icoBuf[offset] || 256;
      const h = icoBuf[offset + 1] || 256;
      const bytesInRes = icoBuf.readUInt32LE(offset + 8);
      const imgOffset = icoBuf.readUInt32LE(offset + 12);

      expect(w).toBe(h);
      expect(bytesInRes).toBeGreaterThan(0);
      expect(imgOffset).toBeGreaterThan(0);
      expect(imgOffset + bytesInRes).toBeLessThanOrEqual(icoBuf.length);
      resolutions.push(w);
    }

    // Must include essential Windows icon sizes
    expect(resolutions).toContain(16);
    expect(resolutions).toContain(32);
    expect(resolutions).toContain(48);
    expect(resolutions).toContain(256);
  });

  it('verifies electron-builder.json packaging icons and NSIS protection policies', () => {
    const builderPath = path.join(rootDir, 'electron-builder.json');
    const config = JSON.parse(fs.readFileSync(builderPath, 'utf8'));

    expect(config.win?.icon).toBe('build/icon.ico');
    expect(config.nsis?.installerIcon).toBe('build/icon.ico');
    expect(config.nsis?.uninstallerIcon).toBe('build/icon.ico');
    expect(config.nsis?.deleteAppDataOnUninstall).toBe(false);
    expect(config.directories?.buildResources).toBe('build');
    expect(config.portable?.artifactName).toContain('Portable');
  });

  it('verifies BrowserWindow icon configuration and AppUserModelId in Electron main', () => {
    const mainPath = path.join(rootDir, 'apps/desktop/electron/main/index.ts');
    const content = fs.readFileSync(mainPath, 'utf8');

    expect(content).toContain('build/icon.ico');
    expect(content).toContain('icon: resolvedIcon');
    expect(content).toContain("app.setAppUserModelId('com.devsweep.app')");
  });

  it('verifies UI components and index.html embed official DevSweep brand icon', () => {
    const indexPath = path.join(rootDir, 'index.html');
    const indexContent = fs.readFileSync(indexPath, 'utf8');
    expect(indexContent).toContain('<link rel="icon" type="image/png" href="/icon.png" />');

    const titleBarPath = path.join(rootDir, 'apps/desktop/src/components/layout/TitleBar.tsx');
    const titleBarContent = fs.readFileSync(titleBarPath, 'utf8');
    expect(titleBarContent).toContain('src="/icon.png"');

    const settingsPath = path.join(rootDir, 'apps/desktop/src/components/settings/SettingsView.tsx');
    const settingsContent = fs.readFileSync(settingsPath, 'utf8');
    expect(settingsContent).toContain('src="/icon.png"');
  });

  it('verifies zero legacy "Developer Disk Cleaner" strings across user-facing files', () => {
    const userFacingFiles = [
      'index.html',
      'apps/desktop/src/components/layout/TitleBar.tsx',
      'apps/desktop/src/components/settings/SettingsView.tsx',
      'apps/desktop/src/components/dashboard/DashboardView.tsx',
      'apps/desktop/src/components/cleanup/CleanupView.tsx',
      'electron-builder.json',
      'package.json'
    ];

    for (const relPath of userFacingFiles) {
      const fullPath = path.join(rootDir, relPath);
      const content = fs.readFileSync(fullPath, 'utf8');
      expect(content).not.toContain('Developer Disk Cleaner');
    }
  });
});
