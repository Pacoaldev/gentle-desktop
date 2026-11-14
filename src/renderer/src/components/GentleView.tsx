import { useCallback, useEffect, useRef, useState } from 'react'
import { FloatingWindow } from './FloatingWindow.tsx'
import { resolveGentleDestinations, type GentleDestination } from '../state/gentleMenu.ts'

/**
 * The Gentle window (gentle-desktop S17, S21): the place a user goes to change how the
 * agent behaves — models, permission mode, subagents, providers — without meeting the
 * engine's command list first. The terminal reaches these through slash commands, which
 * is fine when the command names are already in your fingers; they are not, for this
 * audience.
 *
 * Every row opens an app window; none runs an engine command, so nothing here can press
 * a button that does nothing.
 */
export function GentleView({
  onClose,
  onOpenModels,
  onOpenSubagents,
  onOpenProviders,
  onOpenCommands,
  onChooseFolder,
  onOpenPermissions
}: {
  onClose: () => void
  /** Opens the Models window (S21): the engine's profile store, read and written here. */
  onOpenModels: () => void
  onOpenSubagents: () => void
  onOpenProviders: () => void
  onOpenCommands: () => void
  /** Opens the system folder picker so the user can move the agent elsewhere (S17). */
  onChooseFolder: () => void
  /** Opens the Permissions window (S20): the mode a new session starts with, read-only. */
  onOpenPermissions: () => void
}): React.JSX.Element {
  const [index, setIndex] = useState(0)

  const destinations = resolveGentleDestinations([])
  const activeIndex = Math.min(index, Math.max(destinations.length - 1, 0))

  const choose = useCallback(
    (destination: GentleDestination): void => {
      switch (destination.id) {
        case 'profiles':
          onOpenModels()
          break
        case 'mode':
          onOpenPermissions()
          break
        case 'subagents':
          onOpenSubagents()
          break
        case 'providers':
          onOpenProviders()
          break
        case 'commands':
          onOpenCommands()
          break
        case 'folder':
          onChooseFolder()
          break
      }
      onClose()
    },
    [onChooseFolder, onClose, onOpenCommands, onOpenModels, onOpenPermissions, onOpenProviders, onOpenSubagents]
  )

  // There is nothing to type into here, and `autoFocus` on a plain container is not
  // dependable — the focus stays on the body and the arrow keys never arrive. The listener
  // therefore lives on the window for as long as this window is open, and the container is
  // still focused so the scroll and the screen reader land somewhere sensible.
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    containerRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      // A dialog from the engine can sit on top of this window; it owns the keyboard then.
      if (document.querySelector('.floating-panel-dialog') !== null) return

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setIndex((current) => Math.min(current + 1, Math.max(destinations.length - 1, 0)))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setIndex((current) => Math.max(current - 1, 0))
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const chosen = destinations[Math.min(activeIndex, Math.max(destinations.length - 1, 0))]
        if (chosen !== undefined) choose(chosen)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeIndex, destinations, choose])

  return (
    <FloatingWindow title="gentle" className="floating-panel-palette" onClose={onClose} hint="↑ ↓ choose · ⏎ open · esc close">
      <div ref={containerRef} tabIndex={0} style={{ outline: 'none' }}>
        <ul className="palette-list" role="listbox" aria-label="Gentle settings">
          {destinations.map((destination, position) => (
            <li key={destination.id}>
              <button
                type="button"
                role="option"
                aria-selected={position === activeIndex}
                className={`palette-row${position === activeIndex ? ' palette-row-active' : ''}`}
                onClick={() => choose(destination)}
                onMouseEnter={() => setIndex(position)}
              >
                <span className="palette-row-name">{destination.label}</span>
                <span className="palette-row-description">{destination.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </FloatingWindow>
  )
}
