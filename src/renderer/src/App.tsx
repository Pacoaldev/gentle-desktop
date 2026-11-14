import { useCallback, useEffect, useRef, useState } from 'react'
import { CommandPalette } from './components/CommandPalette.tsx'
import { AgentsView } from './components/AgentsView.tsx'
import { DialogHost } from './components/DialogHost.tsx'
import { GentleView } from './components/GentleView.tsx'
import { Header } from './components/Header.tsx'
import { NoticeToast } from './components/NoticeToast.tsx'
import { PermissionModeWindow } from './components/PermissionModeWindow.tsx'
import { HistoryPicker } from './components/HistoryPicker.tsx'
import { ModelsWindow } from './components/ModelsWindow.tsx'
import { PromptPanel } from './components/PromptPanel.tsx'
import { Rail } from './components/Rail.tsx'
import { SetupWizard } from './components/SetupWizard.tsx'
import { Transcript } from './components/Transcript.tsx'
import { opensModelsWindow, opensPermissionsWindow } from './state/commandSurfaces.ts'
import { useEngine } from './state/useEngine.ts'

/** The terminal folds its rail below this many columns of available width. */
const RAIL_BREAKPOINT_COLUMNS = 140

/**
 * Available width measured in `ch` columns, matching the terminal's
 * SIDEBAR_BREAKPOINT = 140. A hidden `0` glyph measures the chrome's monospace
 * column; the body's client width is divided by it.
 */
function useAvailableColumns(bodyRef: React.RefObject<HTMLDivElement | null>): number {
  const [columns, setColumns] = useState(Number.POSITIVE_INFINITY)
  useEffect(() => {
    const measure = (): void => {
      const body = bodyRef.current
      if (!body) return
      const probe = document.createElement('span')
      probe.textContent = '0'
      probe.style.position = 'absolute'
      probe.style.visibility = 'hidden'
      probe.style.whiteSpace = 'pre'
      probe.style.font = getComputedStyle(document.body).font
      document.body.appendChild(probe)
      const chWidth = probe.getBoundingClientRect().width
      probe.remove()
      if (chWidth > 0) setColumns(Math.floor(body.clientWidth / chWidth))
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (bodyRef.current) observer.observe(bodyRef.current)
    return () => observer.disconnect()
  }, [bodyRef])
  return columns
}

export function App(): React.JSX.Element {
  const engine = useEngine()

  // First-run gate: if no provider is configured yet, the setup window opens itself
  // once. The dismissal is remembered for this session only (a plain ref, not storage),
  // so the next launch offers onboarding again until a provider is connected.
  const [agentsOpen, setAgentsOpen] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const autoOpenDone = useRef(false)
  const dismissedThisSession = useRef(false)

  // The history picker (S12), the command palette (S13) and the folded rail (S11)
  // are overlays, not layout. The seed is the draft the `/` trigger hands over.
  const [gentleOpen, setGentleOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteSeed, setPaletteSeed] = useState('')
  const [railOverlayOpen, setRailOverlayOpen] = useState(false)
  // The Permissions window (S20) is read-only: it shows the saved default and the four
  // modes' meaning; it is opened from the Gentle row and by the engine's mode commands.
  // The Models window (S21) is the engine's profile store, opened from the Gentle row
  // and by the bare profiles command.
  const [permissionsOpen, setPermissionsOpen] = useState(false)
  const [modelsOpen, setModelsOpen] = useState(false)

  const bodyRef = useRef<HTMLDivElement | null>(null)
  const columns = useAvailableColumns(bodyRef)
  const railWide = columns >= RAIL_BREAKPOINT_COLUMNS

  useEffect(() => {
    if (!engine.ready || autoOpenDone.current) return
    autoOpenDone.current = true
    void window.gentle.auth
      .providers()
      .then((choices) => {
        if (!choices.some((choice) => choice.configured) && !dismissedThisSession.current) {
          setWizardOpen(true)
        }
      })
      .catch(() => {
        // A failed readiness check must not block the app; the header affordance
        // still opens the window manually.
      })
  }, [engine.ready])

  // Alt+K opens the Gentle window: the settings hub, not the engine's command list.
  // Ctrl+K (or Ctrl+P) keeps the command palette for whoever knows the command they want,
  // Ctrl+H opens history and Alt+A the agents overlay. The terminal reserves Ctrl+K for its
  // editor, which does not exist here, so Ctrl+K follows the habit users arrive with.
  // Pressing an accelerator again closes its overlay, and overlays never stack.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      const key = event.key.toLowerCase()

      // Alt+A must be handled before the modifier guard below: it is the terminal's
      // agents shortcut, and a user who reaches for it expects the same overlay here.
      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        if (key === 'a') {
          event.preventDefault()
          setPaletteOpen(false)
          setHistoryOpen(false)
          setGentleOpen(false)
          setPermissionsOpen(false)
          setModelsOpen(false)
          setAgentsOpen((open) => !open)
        } else if (key === 'k') {
          event.preventDefault()
          setPaletteOpen(false)
          setHistoryOpen(false)
          setAgentsOpen(false)
          setPermissionsOpen(false)
          setModelsOpen(false)
          setGentleOpen((open) => !open)
        }
        return
      }

      if (!(event.metaKey || event.ctrlKey)) return

      if (key === 'k') {
        event.preventDefault()
        setHistoryOpen(false)
        setWizardOpen(false)
        setGentleOpen(false)
        setPermissionsOpen(false)
        setModelsOpen(false)
        setPaletteSeed('')
        setPaletteOpen((open) => !open)
        return
      }

      if (key === ',') {
        event.preventDefault()
        setPaletteOpen(false)
        setHistoryOpen(false)
        setPermissionsOpen(false)
        setModelsOpen(false)
        setWizardOpen(true)
        return
      }

      if (key === 'h') {
        event.preventDefault()
        setPaletteOpen(false)
        setPermissionsOpen(false)
        setModelsOpen(false)
        setHistoryOpen((open) => !open)
      } else if (key === 'p') {
        event.preventDefault()
        setHistoryOpen(false)
        setPermissionsOpen(false)
        setModelsOpen(false)
        setPaletteSeed('')
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Folding the rail while the window widens must not leave a stale overlay.
  useEffect(() => {
    if (railWide) setRailOverlayOpen(false)
  }, [railWide])

  const closeWizard = useCallback(() => {
    dismissedThisSession.current = true
    setWizardOpen(false)
  }, [])

  const openWizard = useCallback(() => {
    setGentleOpen(false)
    setWizardOpen(true)
  }, [])

  const openHistory = useCallback(() => {
    setGentleOpen(false)
    setHistoryOpen(true)
  }, [])

  const openPermissions = useCallback(() => {
    // The engine's mode commands and the Gentle row land here: overlays never stack,
    // so the other windows close first (S20).
    setPaletteOpen(false)
    setHistoryOpen(false)
    setGentleOpen(false)
    setAgentsOpen(false)
    setPermissionsOpen(true)
  }, [])

  const openModels = useCallback(() => {
    // The Gentle row and the bare profiles command land here: overlays never stack,
    // so the other windows close first (S21).
    setPaletteOpen(false)
    setHistoryOpen(false)
    setGentleOpen(false)
    setAgentsOpen(false)
    setPermissionsOpen(false)
    setModelsOpen(true)
  }, [])

  const openPalette = useCallback(() => {
    setGentleOpen(false)
    setHistoryOpen(false)
    setPaletteSeed('')
    setPaletteOpen(true)
  }, [])
  const closeHistory = useCallback(() => setHistoryOpen(false), [])
  const closePalette = useCallback(() => setPaletteOpen(false), [])

  // The `/` trigger: the prompt hands its draft over and stays empty, so the text
  // the user typed continues in the palette's filter, never in the message.
  const openPaletteFromSlash = useCallback((draft: string) => {
    setHistoryOpen(false)
    setPaletteSeed(draft)
    setPaletteOpen(true)
  }, [])

  // Running a command goes through the ordinary prompt path, so the turn starts
  // exactly as if the user had typed `/<name>` themselves — except the commands the
  // app shows better than the engine can answer over RPC: the permission mode commands
  // (S20) only print "Mode unchanged — interactive primary session required", and the
  // bare profiles command (S21) is the Models window's own surface. They open their
  // windows instead; every other command, including the profiles subcommands, runs.
  const runCommand = useCallback(
    (command: string) => {
      if (opensPermissionsWindow(command)) {
        openPermissions()
        return
      }
      if (opensModelsWindow(command)) {
        openModels()
        return
      }
      engine.send(command)
    },
    [engine, openPermissions, openModels]
  )

  const switchSession = useCallback(
    (sessionPath: string) => {
      engine.switchSession(sessionPath)
    },
    [engine]
  )

  return (
    <div className="app-shell">
      <Header
        status={engine.status}
        model={engine.model}
        thinkingLevel={engine.thinkingLevel}
        stats={engine.stats}
        repo={engine.repo}
        usage={engine.usage}
        railCollapsed={!railWide}
        onNewSession={engine.newSession}
        onOpenCommands={openPalette}
        onOpenGentle={() => setGentleOpen((open) => !open)}
        onOpenAgents={() => setAgentsOpen((open) => !open)}
        onToggleRail={() => setRailOverlayOpen((open) => !open)}
        onOpenSetup={openWizard}
        onOpenHistory={openHistory}
        onChooseFolder={() => {
          void engine.chooseWorkspace()
        }}
      />
      <div className={`app-body${railWide ? '' : ' app-body-rail-hidden'}`} ref={bodyRef}>
        <section className="app-conversation">
          <Transcript items={engine.transcript.items} />
          <NoticeToast notice={engine.notice} onDismiss={engine.dismissNotice} />
          <PromptPanel
            disabled={!engine.ready}
            streaming={engine.streaming}
            mode={engine.permissionMode}
            onSend={engine.send}
            onAbort={engine.abort}
            onSlashTrigger={openPaletteFromSlash}
          />
        </section>
        {railWide ? (
          <Rail
          tasks={engine.oddTasks}
          integrations={engine.integrations}
          activeProfile={engine.activeProfile}
          status={engine.status}
          permissionMode={engine.permissionMode}
          stats={engine.stats}
          repo={engine.repo}
          sessionName={engine.sessionName}
        />
        ) : railOverlayOpen ? (
          <div className="rail-overlay">
            <Rail
              tasks={engine.oddTasks}
              integrations={engine.integrations}
              activeProfile={engine.activeProfile}
              status={engine.status}
              permissionMode={engine.permissionMode}
              stats={engine.stats}
              repo={engine.repo}
              sessionName={engine.sessionName}
            />
          </div>
        ) : null}
      </div>
      <DialogHost dialogs={engine.dialogs} onAnswer={engine.answerDialog} />
      {historyOpen ? (
        <HistoryPicker currentPath={engine.sessionPath} onSwitch={switchSession} onClose={closeHistory} />
      ) : null}
      {gentleOpen ? (
        <GentleView
          onClose={() => setGentleOpen(false)}
          onOpenModels={openModels}
          onOpenSubagents={() => setAgentsOpen(true)}
          onOpenProviders={openWizard}
          onOpenCommands={openPalette}
          onChooseFolder={() => {
            void engine.chooseWorkspace()
          }}
          onOpenPermissions={openPermissions}
        />
      ) : null}
      {paletteOpen ? (
        <CommandPalette initialQuery={paletteSeed} onClose={closePalette} onRun={runCommand} />
      ) : null}
      {permissionsOpen ? <PermissionModeWindow savedDefault={engine.permissionMode} onClose={() => setPermissionsOpen(false)} /> : null}
      {modelsOpen ? <ModelsWindow onClose={() => setModelsOpen(false)} /> : null}
      {agentsOpen ? <AgentsView activity={engine.activity} onClose={() => setAgentsOpen(false)} /> : null}
      {wizardOpen ? <SetupWizard onClose={closeWizard} /> : null}
    </div>
  )
}
