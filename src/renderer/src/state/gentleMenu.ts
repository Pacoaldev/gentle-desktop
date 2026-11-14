import type { CommandChoice } from '../../../shared/ipc.ts'

/**
 * The Gentle window's contents (gentle-desktop S17, S21), kept as a pure function so node
 * can pin it: the destinations a user reaches for when they want to change something about
 * the agent.
 *
 * Every destination is the app's own surface. Profiles became the Models window (S21),
 * which reads and writes the engine's real profile store over IPC instead of running an
 * engine command, and the mode row opens the read-only Permissions window. The engine's
 * command list is still accepted so pinned tests can prove no command changes the result,
 * but no destination maps to a command anymore: a row here can never start a turn, so it
 * can never press a button that does nothing.
 */

export type GentleDestinationId = 'profiles' | 'mode' | 'folder' | 'subagents' | 'providers' | 'commands'

export interface GentleDestination {
  id: GentleDestinationId
  /** What the user is changing, in their words, not the command's. */
  label: string
  /** One line that says what pressing it does. */
  detail: string
  /** Always null: every destination opens an app window. */
  command: string | null
}

/**
 * Builds the destination list in a fixed order: the things that change *how the agent
 * behaves* come first, then where it works, who is working, where the keys live, and
 * finally the escape hatch to every command the engine has.
 */
export function resolveGentleDestinations(_commands: readonly CommandChoice[]): GentleDestination[] {
  return [
    {
      id: 'profiles',
      label: 'Models',
      detail: 'Choose the model each agent and the orchestrator use',
      command: null
    },
    {
      id: 'mode',
      label: 'Permission mode',
      detail: 'See the mode new sessions start with, and how to change it',
      command: null
    },
    {
      id: 'folder',
      label: 'Choose a folder',
      detail: 'Pick the folder the agent works in, through the system folder picker',
      command: null
    },
    {
      id: 'subagents',
      label: 'Subagents',
      detail: 'See which agents are running and what they are doing',
      command: null
    },
    {
      id: 'providers',
      label: 'Providers',
      detail: 'Connect a provider, or add one with its own server address',
      command: null
    },
    {
      id: 'commands',
      label: 'All commands',
      detail: 'Everything this engine exposes, with a filter',
      command: null
    }
  ]
}
