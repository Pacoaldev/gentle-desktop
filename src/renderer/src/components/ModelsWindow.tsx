import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProviderChoice, RoutingProfile, RoutingView } from '../../../shared/ipc.ts'
import { FloatingWindow } from './FloatingWindow.tsx'
import { agentNote, modelOptions, orchestratorNote } from '../state/modelsMenu.ts'

/** One inline status line: what a change saved, or why the engine refused it. */
interface ModelsStatus {
  /** The role the line belongs to, or `profile` for the active-profile action. */
  key: string
  kind: 'saved' | 'error'
  text: string
}

/**
 * Picks the profile a tab shows: the one already selected when it still exists, else the
 * active one, else the first — never a selection that outlives its list.
 */
function pickProfile(view: RoutingView, keep: string | null): string | null {
  if (keep !== null && view.profiles.some((profile) => profile.name === keep)) return keep
  if (view.active !== null && view.profiles.some((profile) => profile.name === view.active)) return view.active
  return view.profiles[0]?.name ?? null
}

/**
 * The choices one role's picker offers. `inherit` is a real choice for agents (an empty
 * value clears the stored model) but display-only for the orchestrator, whose model this
 * window can only pin, never clear. A stored model whose provider is not ready right now
 * is still offered as its raw value: a picker that silently showed the wrong current
 * model would lie.
 */
function optionsForRole(
  roleModel: string | null,
  allowInherit: boolean,
  choices: { value: string; label: string }[]
): { value: string; label: string; disabled: boolean }[] {
  const options: { value: string; label: string; disabled: boolean }[] = []
  if (roleModel === null) {
    options.push({ value: '', label: 'inherit', disabled: !allowInherit })
  } else if (!choices.some((choice) => choice.value === roleModel)) {
    options.push({ value: roleModel, label: roleModel, disabled: false })
  }
  for (const choice of choices) options.push({ value: choice.value, label: choice.label, disabled: false })
  return options
}

/**
 * The Models window (gentle-desktop S21): the engine's real profile store, one tab per
 * profile, and the model each routing role — the orchestrator first, then the agents —
 * runs under. A change is written over IPC immediately and the view is reloaded, so what
 * is shown is what the engine holds.
 *
 * Facts this window must not overpromise: an agent's model is frozen when a session
 * starts, so a change takes effect on the next session; the orchestrator also switches
 * live in the running session. A store this app cannot understand is reported and left
 * untouched — no tabs, no pickers, no writes.
 */
export function ModelsWindow({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [view, setView] = useState<RoutingView | null>(null)
  const [providers, setProviders] = useState<readonly ProviderChoice[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [status, setStatus] = useState<ModelsStatus | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  const loadSeq = useRef(0)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const reload = useCallback(async (keep: string | null): Promise<void> => {
    const seq = ++loadSeq.current
    try {
      const [nextView, nextProviders] = await Promise.all([
        window.gentle.routing.read(),
        window.gentle.auth.providers()
      ])
      if (!alive.current || seq !== loadSeq.current) return
      setView(nextView)
      setProviders(nextProviders)
      setLoadFailed(false)
      setSelected(pickProfile(nextView, keep))
    } catch {
      if (!alive.current || seq !== loadSeq.current) return
      setLoadFailed(true)
    }
  }, [])

  useEffect(() => {
    void reload(null)
  }, [reload])

  const changeAgentModel = useCallback(
    async (profile: string, agent: string, value: string): Promise<void> => {
      setBusy(true)
      setStatus(null)
      const result = await window.gentle.routing.setAgentModel({
        profile,
        agent,
        model: value === '' ? null : value
      })
      if (alive.current) {
        setStatus(
          result.ok
            ? { key: agent, kind: 'saved', text: `Saved. ${agentNote()}` }
            : { key: agent, kind: 'error', text: result.error }
        )
      }
      await reload(profile)
      if (alive.current) setBusy(false)
    },
    [reload]
  )

  const changeOrchestrator = useCallback(
    async (profile: string, model: string): Promise<void> => {
      setBusy(true)
      setStatus(null)
      const result = await window.gentle.routing.setOrchestrator({ profile, model })
      if (alive.current) {
        if (!result.ok) {
          setStatus({ key: 'orchestrator', kind: 'error', text: result.error })
        } else if (result.profileActive === false) {
          setStatus({
            key: 'orchestrator',
            kind: 'saved',
            text: 'Saved. This profile is not active, so the running session and its default stay as they are.'
          })
        } else if (result.appliedLive === false) {
          setStatus({
            key: 'orchestrator',
            kind: 'saved',
            text: `The model is saved, but the running session could not switch to it.${
              result.error !== undefined ? ` The engine said: ${result.error}` : ''
            }`
          })
        } else {
          setStatus({ key: 'orchestrator', kind: 'saved', text: `Saved. ${orchestratorNote()}` })
        }
      }
      await reload(profile)
      if (alive.current) setBusy(false)
    },
    [reload]
  )

  const activateProfile = useCallback(
    async (profile: string): Promise<void> => {
      setBusy(true)
      setStatus(null)
      const result = await window.gentle.routing.setActive({ profile })
      if (alive.current) {
        setStatus(
          result.ok
            ? { key: 'profile', kind: 'saved', text: 'Saved. The next session starts under this profile.' }
            : { key: 'profile', kind: 'error', text: result.error }
        )
      }
      await reload(profile)
      if (alive.current) setBusy(false)
    },
    [reload]
  )

  const choices = modelOptions(providers)
  const selectedProfile: RoutingProfile | null =
    view !== null && selected !== null
      ? view.profiles.find((profile) => profile.name === selected) ?? null
      : null
  const readable = view !== null && view.fileStatus === 'valid' && selectedProfile !== null

  return (
    <FloatingWindow title="Models" onClose={onClose} hint="esc close">
      <div className="dialog-body">
        {view === null && !loadFailed ? (
          <p className="dialog-message">Loading the engine's profiles…</p>
        ) : null}
        {loadFailed ? (
          <p className="dialog-message">
            The engine could not be asked for its profiles just now. Nothing was changed —
            please close this window and try again.
          </p>
        ) : null}
        {view !== null && view.fileStatus === 'invalid' ? (
          <p className="dialog-message">
            The engine's profiles file could not be read, so the models it names cannot be
            shown here. Nothing in this window rewrites that file.
          </p>
        ) : null}
        {view !== null && (view.fileStatus === 'missing' || view.profiles.length === 0) ? (
          <p className="dialog-message">
            The engine's config folder has no profiles file yet. Gentle Shell creates
            profiles when models are set up; this window does not invent them.
          </p>
        ) : null}
        {readable && selectedProfile !== null ? (
          <>
            <div className="models-tabs" role="tablist" aria-label="Profiles">
              {view.profiles.map((profile) => (
                <button
                  key={profile.name}
                  type="button"
                  role="tab"
                  aria-selected={profile.name === selectedProfile.name}
                  className={`models-tab${profile.name === selectedProfile.name ? ' models-tab-active' : ''}`}
                  disabled={busy}
                  onClick={() => {
                    setSelected(profile.name)
                    setStatus(null)
                  }}
                >
                  {profile.name}
                  {profile.active ? <span className="models-tab-active-mark">active</span> : null}
                </button>
              ))}
            </div>
            {status !== null && status.key === 'profile' ? (
              <p className={`models-status${status.kind === 'error' ? ' models-status-error' : ''}`}>{status.text}</p>
            ) : null}
            {!selectedProfile.active ? (
              <button
                type="button"
                className="dialog-cancel models-use"
                disabled={busy}
                onClick={() => void activateProfile(selectedProfile.name)}
              >
                Use this profile
              </button>
            ) : null}
            <div className="dialog-options">
              <div className="models-row">
                <span className="models-role">orchestrator</span>
                <span className="models-current">{selectedProfile.orchestrator.model ?? 'inherit'}</span>
                <select
                  className="models-select"
                  value={selectedProfile.orchestrator.model ?? ''}
                  disabled={busy}
                  aria-label="Orchestrator model"
                  onChange={(event) => void changeOrchestrator(selectedProfile.name, event.target.value)}
                >
                  {optionsForRole(selectedProfile.orchestrator.model, false, choices).map((option) => (
                    <option key={option.value} value={option.value} disabled={option.disabled}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              {status !== null && status.key === 'orchestrator' ? (
                <p className={`models-status${status.kind === 'error' ? ' models-status-error' : ''}`}>{status.text}</p>
              ) : null}
              <p className="models-note">{orchestratorNote()}</p>
              {selectedProfile.agents.map((agent) => (
                <div key={agent.name}>
                  <div className="models-row">
                    <span className="models-role">{agent.name}</span>
                    <span className="models-current">{agent.model ?? 'inherit'}</span>
                    <select
                      className="models-select"
                      value={agent.model ?? ''}
                      disabled={busy}
                      aria-label={`${agent.name} model`}
                      onChange={(event) => void changeAgentModel(selectedProfile.name, agent.name, event.target.value)}
                    >
                      {optionsForRole(agent.model, true, choices).map((option) => (
                        <option key={option.value} value={option.value} disabled={option.disabled}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {status !== null && status.key === agent.name ? (
                    <p className={`models-status${status.kind === 'error' ? ' models-status-error' : ''}`}>
                      {status.text}
                    </p>
                  ) : null}
                </div>
              ))}
              <p className="models-note">{agentNote()}</p>
            </div>
          </>
        ) : null}
        <p className="dialog-message">The engine's own profiles file, in its config folder.</p>
        <div className="dialog-actions">
          <button type="button" className="dialog-cancel" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </FloatingWindow>
  )
}
