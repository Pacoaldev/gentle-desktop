# Changelog

All notable changes to this repository are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- **Electron missing after `pnpm install`** — On a fresh clone or after lockfile
  changes, the `electron` package sometimes installed without its binary
  (`path.txt` / `dist/electron.exe`), which made `pnpm dev` fail with
  `Error: Electron uninstall`. A root `postinstall` script runs
  `node node_modules/electron/install.js` so the download runs reliably. If it
  still fails, run that command once manually, or ensure `electron` is approved
  under pnpm’s `onlyBuiltDependencies` (`pnpm approve`).
- **“Session transport startup failed” on New (Windows)** — Gentle Agents starts a
  PowerShell helper for cross-session coordination. When the engine’s working
  directory was this repo (large `node_modules`), the helper inherited that cwd and
  the JSON control protocol broke (`phase=start`, `code=protocol`,
  `lastStartupMarker=script-entered`). We ship a **pnpm patch** on `gentle-pi@4.7.0`
  (`patches/gentle-pi@4.7.0.patch`) so the helper spawns with `cwd` set to the
  system temp directory instead of the session cwd. Upstream fix belongs in
  gentle-pi; until then the patch is applied via `pnpm-workspace.yaml`
  `patchedDependencies`.
- **`builtin:codemode` warning on every launch** — Desktop RPC has no TUI prompt
  for gentle-pi’s codemode opt-out. On startup the main process calls
  `ensureAgentSettingsForDesktop()` so the agent home gets (or updates)
  `settings.json` with `-builtin:codemode`, matching gentle-shell’s silent
  opt-out for owned homes.

### Added

- `src/main/agent-settings.ts` — prepares `settings.json` before the engine
  starts.
- `tests/agent-settings.test.mts` — regression test for the codemode opt-out entry.
- `patches/gentle-pi@4.7.0.patch` — Windows session transport spawn cwd fix.
- Root `postinstall` in `package.json` — ensures the Electron binary is present.

### Changed

- `.gitignore` — ignore `.atl/` (local harness metadata); clarify that `release/`
  holds packaged installers, not source.

### Windows notes (development and packaging)

1. `pnpm install` → `pnpm dev` for development.
2. If `Electron uninstall` appears: `node node_modules/electron/install.js`.
3. Package an installer: `pnpm dist:installer` → `release/gentle-desktop-*-x64.exe`,
   or run `release/win-unpacked/Gentle Desktop.exe` without installing.
4. Close any running dev instance before repackaging.

[Unreleased]: https://github.com/leav-dev/gentle-desktop/compare/main...HEAD