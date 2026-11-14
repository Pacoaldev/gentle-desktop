import assert from 'node:assert/strict'
import { sep } from 'node:path'
import { test } from 'node:test'
import { resolveDesktopConfigHome, resolveGentleConfigHome } from '../src/main/config-home.ts'

/** A home that is never the real user's, so a wrong default cannot pass unnoticed. */
const HOME = '/users/someone'

function envWith(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = { ...overrides }
  delete env['GENTLE_PI_CONFIG_HOME']
  delete env['GENTLE_SHELL_CONFIG_HOME']
  return { ...env, ...overrides }
}

test('an explicit GENTLE_PI_CONFIG_HOME wins over the launcher marker', () => {
  const resolved = resolveGentleConfigHome(
    envWith({ GENTLE_PI_CONFIG_HOME: '/engine/home', GENTLE_SHELL_CONFIG_HOME: '/launcher/home' }),
    HOME
  )
  assert.equal(resolved, '/engine/home')
})

test('an absolute GENTLE_SHELL_CONFIG_HOME is used when the engine variable is unset', () => {
  const resolved = resolveGentleConfigHome(
    envWith({ GENTLE_SHELL_CONFIG_HOME: '/launcher/home' }),
    HOME
  )
  assert.equal(resolved, '/launcher/home')
})

test('a relative GENTLE_SHELL_CONFIG_HOME is ignored: the launcher only ever sets an absolute one', () => {
  const resolved = resolveGentleConfigHome(
    envWith({ GENTLE_SHELL_CONFIG_HOME: 'relative/path' }),
    HOME
  )
  assert.equal(resolved, joinDefault(HOME))
})

function joinDefault(home: string): string {
  // Mirrors the last layer of gentle-pi's resolveGentlePiConfigHome.
  return `${home}/.pi/gentle-ai`.replaceAll('/', sep)
}

test('empty values count as unset, exactly as the engine treats them', () => {
  assert.equal(
    resolveGentleConfigHome(envWith({ GENTLE_PI_CONFIG_HOME: '' }), HOME),
    joinDefault(HOME)
  )
  assert.equal(
    resolveGentleConfigHome(
      envWith({ GENTLE_PI_CONFIG_HOME: '', GENTLE_SHELL_CONFIG_HOME: '' }),
      HOME
    ),
    joinDefault(HOME)
  )
})

test('with nothing set the default is the engine home under the given user home', () => {
  assert.equal(resolveGentleConfigHome(envWith({}), HOME), joinDefault(HOME))
})

// --- The desktop resolver -----------------------------------------------------------

/**
 * The desktop is the launcher of the pi it runs, so when neither variable is set its own
 * store wins over the engine's fallback. `isDirectory` is injected so the filesystem
 * state is under the test's control, never the developer machine's.
 */
const SHELL_STORE = `${HOME}/.gentle-shell/gentle-ai`.replaceAll('/', sep)

/** An `isDirectory` that answers only for the given paths, like `existsSync` would. */
function directoriesThat(...existing: string[]): (path: string) => boolean {
  return (path) => existing.includes(path)
}

function joinShellStore(home: string): string {
  return `${home}/.gentle-shell/gentle-ai`.replaceAll('/', sep)
}

test('the desktop resolver also lets GENTLE_PI_CONFIG_HOME win', () => {
  const resolved = resolveDesktopConfigHome(
    envWith({ GENTLE_PI_CONFIG_HOME: '/engine/home', GENTLE_SHELL_CONFIG_HOME: '/launcher/home' }),
    HOME,
    directoriesThat()
  )
  assert.equal(resolved, '/engine/home')
})

test('the desktop resolver prefers an absolute GENTLE_SHELL_CONFIG_HOME over the desktop store', () => {
  const resolved = resolveDesktopConfigHome(
    envWith({ GENTLE_SHELL_CONFIG_HOME: '/launcher/home' }),
    HOME,
    // The desktop store exists here too, so the marker demonstrably outranks it.
    directoriesThat(SHELL_STORE)
  )
  assert.equal(resolved, '/launcher/home')
})

test('with nothing set the desktop resolver picks its store beside the shell agent home', () => {
  const resolved = resolveDesktopConfigHome(
    envWith({}),
    HOME,
    directoriesThat(SHELL_STORE)
  )
  assert.equal(resolved, joinShellStore(HOME))
})

test('an absent desktop store falls back to the engine home, like before', () => {
  const resolved = resolveDesktopConfigHome(envWith({}), HOME, directoriesThat())
  assert.equal(resolved, joinDefault(HOME))
})

test('empty values count as unset in the desktop resolver too', () => {
  assert.equal(
    resolveDesktopConfigHome(
      envWith({ GENTLE_PI_CONFIG_HOME: '', GENTLE_SHELL_CONFIG_HOME: '' }),
      HOME,
      directoriesThat(SHELL_STORE)
    ),
    joinShellStore(HOME)
  )
})

test('a relative GENTLE_SHELL_CONFIG_HOME is ignored by the desktop resolver as well', () => {
  const resolved = resolveDesktopConfigHome(
    envWith({ GENTLE_SHELL_CONFIG_HOME: 'relative/path' }),
    HOME,
    directoriesThat()
  )
  assert.equal(resolved, joinDefault(HOME))
})

test('the desktop resolver differs from the engine resolver exactly where it must', () => {
  // Same env, same home, same directory check: the engine falls through to ~/.pi:
  // it has no way to know the desktop launcher exists — but the desktop does.
  const env = envWith({})
  assert.equal(resolveGentleConfigHome(env, HOME), joinDefault(HOME))
  assert.equal(resolveDesktopConfigHome(env, HOME, directoriesThat(SHELL_STORE)), joinShellStore(HOME))
})
