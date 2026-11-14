import type { AgentPermissionMode } from '../../../shared/ipc.ts'
import { FloatingWindow } from './FloatingWindow.tsx'
import { PERMISSION_MODES } from '../state/permissionModes.ts'

/**
 * The Permissions window (gentle-desktop S20): the four permission modes with the
 * meaning the terminal gives them, the saved default marked as the one a session
 * started here begins with, and the route that changes it named exactly. It never
 * claims to change the running session — the engine grants elevated modes only to
 * an interactive terminal session, so over RPC this app can only read the default
 * the terminal saved. It reuses the dialog classes so it matches the DialogHost.
 */
export function PermissionModeWindow({
  savedDefault,
  onClose
}: {
  savedDefault: AgentPermissionMode
  onClose: () => void
}): React.JSX.Element {
  return (
    <FloatingWindow title="Permissions" onClose={onClose} hint="esc close">
      <div className="dialog-body">
        <p className="dialog-message">
          New sessions in this app start with the mode saved as the default. The running
          session cannot be raised from here: the engine grants elevated modes only to an
          interactive terminal session.
        </p>
        <div className="dialog-options">
          {PERMISSION_MODES.map((choice) => (
            <div
              key={choice.mode}
              className={
                choice.mode === savedDefault ? 'permission-mode-row permission-mode-row-current' : 'permission-mode-row'
              }
            >
              <span className="permission-mode-name">{choice.label}</span>
              <span className="permission-mode-detail">{choice.detail}</span>
              {choice.mode === savedDefault ? (
                <span className="permission-mode-current">saved default</span>
              ) : null}
            </div>
          ))}
        </div>
        <p className="dialog-message">
          To change it, open Gentle Shell in a terminal and run{' '}
          <code className="permission-mode-command">/gentle:mode default &lt;mode&gt;</code>. Sessions
          started here afterwards use the new default.
        </p>
        <div className="dialog-actions">
          <button type="button" className="dialog-cancel" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </FloatingWindow>
  )
}
