# DevSweep

> **Developer-focused Windows disk cleanup & storage intelligence**  
> *Clean developer caches. Reclaim disk space. Stay in control.*

---

## Overview

**DevSweep** is a high-performance, safety-critical Windows desktop application designed specifically for software engineers, power users, and IT teams. Unlike generic consumer PC cleaners, DevSweep targets only developer-specific storage bloat—package managers, build tools, toolchains, and IDE caches—with strict allowlist-first security and bounded background workers.

---

## Core Capabilities

- **Smart Scan Engine**: Discovers installed development toolchains (Node/npm, pnpm, Yarn, Python/pip, Rust/Cargo, Go, Docker, Gradle, Android SDK, Flutter/Dart, Visual Studio, VS Code, JetBrains) and computes disk usage without touching active source code.
- **Strict Allowlist-First Safety**:
  - Semantic path protection: `.git`, `.env`, and SSH/keystore credentials are unconditionally protected.
  - Zero arbitrary path deletion: Every candidate must belong to a registered cleanup rule root and match pre-scan fingerprints.
  - Reparse-point safety: Never recursively traverses or follows NTFS junctions or symbolic links.
- **Cleanup Resilience Architecture**:
  - Execution runs out of the Electron main process in dedicated worker threads.
  - Bounded filesystem concurrency (limit: 6 concurrent operations) prevents thread pool saturation.
  - Child error isolation: Single locked/in-use files do not abort entire directories.
  - Activity monitoring: Heartbeat detection (`ACTIVE`, `WORKING`, `SLOW`, `STALLED`) tracks genuine I/O velocity without artificial timeouts.
- **Hierarchical Progress UI**:
  - Live active-item file counters (`Files processed: 4,120 / 18,930`, `✓ 4,108 deleted`, `⚠ 12 skipped`).
  - Subordinate session counter and detailed audit view.
  - Cooperative Pause/Resume and Cancellation.
- **Storage & History Integrity**:
  - Atomic persistence (`.tmp` + atomic rename) prevents history corruptions.
  - Safe, automatic migration from legacy `%APPDATA%/developer-disk-cleaner` to `%APPDATA%/DevSweep`.

---

## Tech Stack

- **Runtime**: Electron 41 (Sandboxed, Context Isolated)
- **Frontend**: React 19, TypeScript, TailwindCSS v4, Lucide Icons
- **Backend / Core**: Node.js, Vitest, Native Windows Filesystem APIs (`WindowsFileService`)

---

## Development & Build

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run comprehensive test suite
npm test

# Build production bundles
npm run build

# Package Windows installer and portable executable
npm run dist
```

---

## License

ISC © 2026 DevSweep Contributors
