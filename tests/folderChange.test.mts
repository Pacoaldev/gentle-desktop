import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { PiHost, type PiHostListener } from '../src/main/rpc/host.ts'
import type { HostStatus } from '../src/shared/ipc.ts'

/**
 * S18: choosing a different folder starts a new session there, and the active one ends.
 * These tests drive the real `PiHost` supervision code against a fake engine, so what is
 * pinned is the observable contract — a fresh child in the new folder with no session
 * re-open — instead of an internal detail of how the restart is written.
 */
const FAKE_ENGINE = new URL('./fixtures/fake-engine.mjs', import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  '$1'
)

const scratchDirs: string[] = []
const envKeys = ['GENTLE_DESKTOP_PI_ENTRY', 'GENTLE_DESKTOP_GENTLE_PI_ROOT', 'GENTLE_SHELL_HOME', 'FAKE_ENGINE_LOG']
const previousEnv = new Map<string, string | undefined>()

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gentle-desktop-folder-'))
  scratchDirs.push(dir)
  return dir
}

function setEnv(key: string, value: string): void {
  if (!previousEnv.has(key)) previousEnv.set(key, process.env[key])
  process.env[key] = value
}

afterEach(() => {
  for (const [key, value] of previousEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  previousEnv.clear()
  for (const key of envKeys) delete process.env[key]
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A scratch workspace whose engine log records every start and session command. */
function workspace(): { root: string; log: string; folder: (name: string) => string } {
  const root = scratch()
  const home = join(root, 'home')
  const gentlePiRoot = join(root, 'gentle-pi')
  mkdirSync(home, { recursive: true })
  mkdirSync(gentlePiRoot, { recursive: true })
  const log = join(root, 'engine.log')
  setEnv('GENTLE_DESKTOP_PI_ENTRY', FAKE_ENGINE)
  setEnv('GENTLE_DESKTOP_GENTLE_PI_ROOT', gentlePiRoot)
  setEnv('GENTLE_SHELL_HOME', home)
  setEnv('FAKE_ENGINE_LOG', log)
  return {
    root,
    log,
    folder: (name: string) => {
      const dir = join(root, name)
      mkdirSync(dir, { recursive: true })
      return dir
    }
  }
}

function lines(log: string): string[] {
  try {
    return readFileSync(log, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0)
  } catch {
    return []
  }
}

function listener(statuses: HostStatus[], diagnostics: string[]): PiHostListener {
  return {
    onStatus: (status) => statuses.push(status),
    onEvent: () => {},
    onDialog: () => {},
    onNotice: () => {},
    onDiagnostic: (message) => diagnostics.push(message)
  }
}

async function waitForReady(host: PiHost): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (host.status().phase === 'ready') return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`the engine never became ready (phase: ${host.status().phase})`)
}

test(
  'a different folder starts a new session instead of re-opening the old conversation',
  { timeout: 60_000 },
  async () => {
    const scratchWorkspace = workspace()
    const first = scratchWorkspace.folder('first-project')
    const second = scratchWorkspace.folder('second-project')
    const host = new PiHost(listener([], []))

    try {
      host.start({ cwd: first })
      await waitForReady(host)
      assert.deepEqual(lines(scratchWorkspace.log), [`start ${first}`], 'the engine starts once, in the remembered folder')

      const result = await host.changeDirectory(second)

      assert.equal(result.outcome, 'changed')
      assert.equal(result.cwd, second)
      assert.equal(host.status().phase, 'ready')
      assert.equal(host.status().cwd, second, 'the engine now runs in the chosen folder')
      assert.deepEqual(
        lines(scratchWorkspace.log),
        [`start ${first}`, `start ${second}`],
        'the new folder gets a fresh child and no session is re-opened: the active session ended'
      )
    } finally {
      await host.stop()
    }
  }
)

test(
  'choosing the folder the agent already works in changes nothing',
  { timeout: 60_000 },
  async () => {
    const scratchWorkspace = workspace()
    const folder = scratchWorkspace.folder('current-project')
    const host = new PiHost(listener([], []))

    try {
      host.start({ cwd: folder })
      await waitForReady(host)

      // The same folder, written with the other separator and a trailing one, is still the
      // same folder: no restart, and therefore no new session and no lost conversation.
      const same = `${folder.replace(/\\/g, '/')}/`
      const result = await host.changeDirectory(same)

      assert.equal(result.outcome, 'unchanged')
      assert.equal(result.cwd, folder)
      assert.equal(host.status().phase, 'ready')
      assert.deepEqual(lines(scratchWorkspace.log), [`start ${folder}`], 'nothing restarted')
    } finally {
      await host.stop()
    }
  }
)

test(
  'a folder the engine cannot start in keeps the previous folder and its conversation',
  { timeout: 60_000 },
  async () => {
    const scratchWorkspace = workspace()
    const working = scratchWorkspace.folder('working-project')
    const broken = scratchWorkspace.folder('cannot-start-project')
    const diagnostics: string[] = []
    const host = new PiHost(listener([], diagnostics))

    try {
      host.start({ cwd: working })
      await waitForReady(host)

      const result = await host.changeDirectory(broken)

      assert.equal(result.outcome, 'failed')
      assert.equal(result.cwd, working, 'the previous folder keeps working')
      assert.ok((result.error ?? '').length > 0, 'the reason reaches the user')
      assert.equal(host.status().phase, 'ready')
      assert.equal(host.status().cwd, working)

      const recorded = lines(scratchWorkspace.log)
      assert.ok(
        recorded.some((line) => line === `start ${broken}`),
        'the chosen folder was tried'
      )
      assert.equal(recorded[recorded.length - 2], `start ${working}`, 'the previous folder restarts last')
      assert.equal(
        recorded[recorded.length - 1],
        `switch_session ${join(working, 'fake-session.json')}`,
        'the conversation that never left is re-opened'
      )
    } finally {
      await host.stop()
    }
  }
)
