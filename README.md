# DevSweep

<div align="center">

![DevSweep Icon](public/icon.png)

### Developer-Focused Windows Disk Cleanup & Storage Intelligence
*Clean developer caches. Reclaim tens of gigabytes. Zero risk to active projects.*

[![Tests](https://img.shields.io/badge/tests-224%20passing-emerald?style=flat-square)](tests/)
[![Electron](https://img.shields.io/badge/Electron-41.7.1-blue?style=flat-square&logo=electron)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011%20x64-0078d4?style=flat-square&logo=windows)](https://microsoft.com/windows)
[![License](https://img.shields.io/badge/license-ISC-green?style=flat-square)](LICENSE)

</div>

---

## 💡 What is DevSweep?

**DevSweep** is an enterprise-grade, safety-critical Windows desktop application designed specifically for software engineers. Generic PC cleaners delete arbitrary temp folders and frequently corrupt active developer environments, lockfiles, or IDE configurations.

DevSweep is built around **strict allowlist-first security**, **deterministic rule roots**, and **isolated background worker threads**. It detects installed developer toolchains, inspects safe reclaimable caches, provides transparent explanations for every file, and safely reclaims storage without ever touching your active source code.

---

## ✨ Key Capabilities

### 🔍 1. Intelligent Toolchain Detection
- Automatically detects active toolchains installed on your system:
  - **Node.js**: npm, Yarn, pnpm caches
  - **Mobile & Cross-Platform**: Android SDK system images/build-tools, Gradle wrapper caches, Flutter / Dart pub cache
  - **IDEs & Editors**: VS Code caches, JetBrains indexing data, V8 compilation caches
  - **Containerization**: Docker build cache & dangling layer metadata
  - **Version Control**: Git garbage & expired reflogs

### 🛡️ 2. Defense-in-Depth Safety Engine
- **Unconditional Protection**:
  - Semantic system protections (`.git`, `.env*`, `.ssh`, AWS/GCP credential vaults, keystores, PEM certificates) can never be selected or deleted.
  - User-defined protected folders (e.g. `C:\Projects\ImportantRepo`) are enforced in kernel-level pre-validation checks.
- **Pre-Execution Fingerprinting (Anti-TOCTOU)**:
  - File modification times (`mtime`), directory sizes, and file counts are cryptographically cross-checked before deletion. If a file changed after scanning, deletion is immediately aborted.
- **NTFS Reparse-Point Isolation**:
  - Symlinks and NTFS junctions are unlinked directly without recursive traversal into linked destinations.

### ⚡ 3. Resilient Multi-Threaded Execution
- Cleanup runs in dedicated Node.js **Worker Threads**, completely offloaded from the UI rendering and Electron main process.
- Bounded concurrency limits filesystem contention on NVMe/SATA SSDs.
- **Child Error Isolation**: A single locked or in-use file (e.g. `EBUSY`, `EPERM`) never halts the entire cleanup batch; skipped files are gracefully quarantined into the audit trail.
- **Heartbeat Velocity Monitoring**: Detects true filesystem activity (`ACTIVE`, `WORKING`, `SLOW`, `STALLED`) instead of relying on arbitrary timeout crashes.

### 🧠 4. Advisory Locked-File Remediation
- When files cannot be deleted due to running background processes, DevSweep diagnoses the holding application:
  - **Canonical attribution**: Associates locked Gradle or npm files with running Java/Node instances.
  - **Advisory actions**: Provides non-destructive guidance (close running IDE / emulator) with one-click **Retry Failed** or **Skip** options. DevSweep never forcibly terminates processes.

### 📜 5. Audit Trail & Retention Governance
- **Local Transaction Log**: Every deletion transaction records timestamps, bytes reclaimed, deleted items, and skipped details.
- **Export Formats**: One-click export to versioned **JSON** and **RFC-4180 CSV** with automatic user profile and secret sanitization.
- **Configurable Retention Policy**: Set automatic retention limits by age (e.g. 30, 90, 180 days) or max count (50–500 records).

---

## ⌨️ Desktop Keyboard Shortcuts

| Shortcut | Action | Scope |
| :--- | :--- | :--- |
| <kbd>Ctrl</kbd> + <kbd>1</kbd> | Switch to **Dashboard** | Global |
| <kbd>Ctrl</kbd> + <kbd>2</kbd> | Switch to **Cleanup Candidates** | Global |
| <kbd>Ctrl</kbd> + <kbd>3</kbd> | Switch to **Storage Analyzer** | Global |
| <kbd>Ctrl</kbd> + <kbd>4</kbd> | Switch to **Audit & History** | Global |
| <kbd>Ctrl</kbd> + <kbd>5</kbd> | Switch to **Settings & Safety** | Global |
| <kbd>Ctrl</kbd> + <kbd>R</kbd> | Trigger **Smart Scan** | Global |
| <kbd>Esc</kbd> | Dismiss active dialog / Close search | Active Modal |
| <kbd>Tab</kbd> / <kbd>Shift+Tab</kbd> | Cycle modal focus strictly within dialog | Modal Focus Trap |

---

## 🚀 Getting Started

### Prerequisites
- **Windows 10 / 11** (64-bit)
- **Node.js** v20+ or v22+
- **npm** v10+

### Clone & Install
```bash
git clone https://github.com/<your-username>/DevSweep.git
cd DevSweep
npm install
```

### Run Locally in Development Mode
```bash
npm run dev
```

### Run Automated Tests
```bash
npm test
```
*Executes 224 unit, behavioral, and integration tests across 16 test suites.*

---

## 📦 Packaging & Release Builds

To build production executables:

```bash
npm run dist
```

Build outputs are placed in the **[`release/`](file:///c:/Users/mujah/OneDrive/Desktop/Cleaner/release)** folder:

| File | Type | Details |
| :--- | :--- | :--- |
| **`DevSweep Setup.exe`** | **NSIS Installer** | Standard Windows installer with desktop shortcut, Start menu entry, customizable destination, and zero-data-loss upgrades. |
| **`DevSweep-Portable.exe`** | **Portable Binary** | Standalone zero-install executable ready for USB drives or ephemeral environments. |

---

## 🏗️ Architecture Overview

```
DevSweep/
├── apps/
│   └── desktop/
│       ├── electron/           # Electron main process & context-isolated preload bridges
│       ├── src/
│       │   ├── components/     # Accessible React 19 UI (Dashboard, Cleanup, Storage, History, Settings)
│       │   ├── stores/         # Zustand global state stores (Scan, History, Disk, Settings)
│       │   └── styles/         # Tailwind CSS design system tokens
├── packages/
│   ├── cleanup-rules/          # Extensible rule definitions and path resolution
│   ├── safety-engine/          # Protection check, anti-TOCTOU fingerprinting, bounded worker executor
│   └── shared/                 # Data schemas, audit sanitization, and retention calculation
├── build/                      # Multi-resolution Windows application assets (16x16 -> 256x256 .ico)
└── tests/                      # Comprehensive Vitest test suites (224 tests)
```

---

## 🛡️ Security & Privacy Guarantees

1. **Zero Telemetry / 100% Local**: DevSweep runs entirely on your local machine. No file paths, directory names, or system telemetry are transmitted to any remote servers.
2. **Zero Arbitrary File Modification**: Only paths identified through explicit, validated cleanup rules can be queued for removal.
3. **Data Loss Prevention**: Uninstallation policies explicitly preserve your historical audit trails and custom settings in `%APPDATA%\DevSweep`.

---

## 📄 License

DevSweep is released under the **ISC License**. Copyright © 2026 DevSweep Contributors.
