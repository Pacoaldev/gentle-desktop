import type { AgentPermissionMode } from '../../../shared/ipc.ts'

/**
 * The four permission modes as the terminal's own menu names them (gentle-desktop S20),
 * kept as pure data so node can pin it against a drift from gentle-pi's strings.
 *
 * This module exists because the app is a reader here, not a writer: gentle-pi gates
 * `setMode` and `saveDefault` on `interactive(ctx)` (`ctx.mode === "tui"`), so an RPC
 * session — which is what the desktop runs — can change neither the running session's
 * mode nor the saved default. The window this feeds shows the meaning of each mode,
 * marks the saved default the next session here starts with, and names the route that
 * works: `/gentle:mode default <mode>` in a terminal.
 */

export interface PermissionModeChoice {
  mode: AgentPermissionMode
  label: string
  detail: string
}

/** In the engine's menu order. Label and detail are its menu strings, split at the dash. */
export const PERMISSION_MODES: readonly PermissionModeChoice[] = [
  { mode: 'normal', label: 'normal', detail: 'standard permission prompts' },
  { mode: 'auto', label: 'auto', detail: 'independent checks; extra model calls' },
  { mode: 'yolo', label: 'yolo', detail: 'scoped work; destructive actions ask' },
  { mode: 'super-yolo', label: 'super-yolo', detail: 'no permission prompts; private paths blocked; consent remains' }
]

/** The command that changes the saved default, from the only place it can be changed. */
export function defaultModeCommand(mode: AgentPermissionMode): string {
  return `/gentle:mode default ${mode}`
}
