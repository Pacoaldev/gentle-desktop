import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

/**
 * The gentle-pi config home, resolved exactly the way the engine resolves it — the same
 * folder, never a look-alike in another directory (S21).
 *
 * gentle-pi's own rule lives in `lib/gentle-shell-bundled.ts` (`resolveGentlePiConfigHome`),
 * and its layers, in order:
 *
 *   1. a bundled prefix's `<prefix>/config/gentle-ai` — not applicable here, because the
 *      desktop launches pi from `node_modules`, not from a bundled prefix;
 *   2. `GENTLE_PI_CONFIG_HOME`, verbatim;
 *   3. `GENTLE_SHELL_CONFIG_HOME`, but only when it is an absolute path — the standalone
 *      launcher always sets an absolute one, so a relative value is not the launcher's
 *      marker and must be ignored rather than guessed;
 *   4. `<home>/.pi/gentle-ai`.
 *
 * Empty values count as unset in every layer, the same way the engine treats them.
 */
export function resolveGentleConfigHome(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): string {
  // Layer 1 (bundled prefix) does not apply to the desktop: it derives from an install
  // prefix that only a bundled gentle-pi build has, and this app never sets one.
  if (env['GENTLE_PI_CONFIG_HOME']) return env['GENTLE_PI_CONFIG_HOME']
  const launcherMarker = env['GENTLE_SHELL_CONFIG_HOME']
  if (launcherMarker && isAbsolute(launcherMarker)) return launcherMarker
  return join(home, '.pi', 'gentle-ai')
}

/**
 * The config home the desktop resolves — the store the Models window reads and writes.
 *
 * It shares the engine's first two layers, but its own defaults come first, because the
 * desktop is itself the launcher of the pi it runs (`src/main/rpc/launch.ts` sets
 * `PI_CODING_AGENT_DIR` beside the shell agent home): the config belongs there too, not
 * in the engine's fallback under `~/.pi`. `resolveGentleConfigHome` above stays the
 * faithful engine-order resolver for callers that must mirror the engine verbatim; the
 * two differ exactly in the final fallback, which the launch plan closes by telling pi
 * which store to read.
 */
export function resolveDesktopConfigHome(
  env: NodeJS.ProcessEnv,
  home: string,
  isDirectory: (path: string) => boolean
): string {
  if (env['GENTLE_PI_CONFIG_HOME']) return env['GENTLE_PI_CONFIG_HOME']
  const launcherMarker = env['GENTLE_SHELL_CONFIG_HOME']
  if (launcherMarker && isAbsolute(launcherMarker)) return launcherMarker
  const desktopStore = join(home, '.gentle-shell', 'gentle-ai')
  if (isDirectory(desktopStore)) return desktopStore
  return join(home, '.pi', 'gentle-ai')
}

/** The desktop resolver against the real process and filesystem. */
export function currentDesktopConfigHome(): string {
  return resolveDesktopConfigHome(process.env, homedir(), existsSync)
}
