/**
 * Which engine commands the command palette routes to one of the app's own windows
 * instead of the ordinary prompt path. Pure data over strings, so node can pin it.
 *
 * The rule is the same for both windows: only a command whose RPC answer tells the user
 * nothing this app cannot show better gets intercepted. Every other command — including
 * the engine's real `gentle:profiles` subcommands — keeps the prompt path, so a turn
 * still runs exactly as if it had been typed.
 */

/**
 * True for the engine commands whose only useful answer over RPC is the mode it already
 * reports. The palette routes them to the Permissions window instead of spending a turn
 * on a notice; every other command keeps the ordinary prompt path. Matching is by exact
 * name, with or without the leading slash and with arguments allowed, so a command that
 * merely mentions a mode is never swallowed.
 */
export function opensPermissionsWindow(command: string): boolean {
  const name = command.startsWith('/') ? command.slice(1) : command
  return name === 'gentle:mode' || name.startsWith('gentle:mode ') || name === 'gentle:yolo' || name.startsWith('gentle:yolo ')
}

/**
 * True only for a bare `gentle:profiles` (with or without the leading slash, arguments
 * ignored only when they are empty). `gentle:profiles export|publish|import|
 * restore-routing|clear` are real engine subcommands that must keep the prompt path —
 * anything after the name means the user asked the engine to do something, not to be
 * shown the Models window.
 */
export function opensModelsWindow(command: string): boolean {
  const name = command.startsWith('/') ? command.slice(1) : command
  return name.trim() === 'gentle:profiles'
}
